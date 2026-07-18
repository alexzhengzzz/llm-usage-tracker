/**
 * Codex session reader - imports per-request usage from local Codex JSONL files.
 *
 * This intentionally reads only metadata and token counters. Prompt contents,
 * tool outputs, and authentication files are never persisted by the tracker.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Storage } from './storage';
import type { TrackerConfig } from './types';
import { getLocalDate } from './utils';

interface ImportState {
  files: Record<string, number>;
}

interface SessionContext {
  sessionId: string;
  model: string;
  requestStart?: number;
  firstResponse?: number;
}

const DEFAULT_CODEX_SESSIONS_DIR = path.join(
  process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  'sessions'
);

function expandHomePath(value: string): string {
  return value === '~' || value.startsWith('~/')
    ? path.join(os.homedir(), value.slice(2))
    : value;
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Imports new Codex usage events while retaining a per-file line cursor. */
export class CodexLogReader {
  private readonly sessionsDir: string;
  private readonly statePath: string;

  constructor(private readonly storage: Storage, config?: TrackerConfig) {
    this.sessionsDir = config?.codexSessionsDir
      ? expandHomePath(config.codexSessionsDir)
      : DEFAULT_CODEX_SESSIONS_DIR;
    const trackerDir = config?.storageDir || path.join(os.homedir(), '.llm-usage-tracker');
    this.statePath = path.join(trackerDir, 'codex-import-state.json');
  }

  sync(): number {
    if (!fs.existsSync(this.sessionsDir)) return 0;

    const state = this.readState();
    let imported = 0;
    for (const filePath of this.findSessionFiles(this.sessionsDir)) {
      imported += this.importFile(filePath, state);
    }
    this.writeState(state);
    return imported;
  }

  private findSessionFiles(directory: string): string[] {
    const files: string[] = [];
    const visit = (current: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) visit(entryPath);
        else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(entryPath);
      }
    };
    visit(directory);
    return files.sort();
  }

  private importFile(filePath: string, state: ImportState): number {
    let lines: string[];
    try {
      lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    } catch {
      return 0;
    }
    // split() adds an empty item for the normal trailing newline; do not count it
    // as an imported line or a later append would be skipped.
    if (lines.at(-1) === '') lines.pop();

    // A session can be truncated or replaced by Codex; in that case rescan it.
    const previousLineCount = state.files[filePath] || 0;
    const importedLineCount = previousLineCount > lines.length ? 0 : previousLineCount;
    const context: SessionContext = {
      sessionId: path.basename(filePath, '.jsonl'),
      model: 'codex',
    };
    let imported = 0;

    // Rebuild request timing context from the existing lines without importing them.
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const isNewLine = index >= importedLineCount;
        imported += this.processEntry(entry, context, isNewLine, index);
      } catch {
        // Codex can leave a partial final line while it is writing; retry next sync.
      }
    }

    state.files[filePath] = lines.length;
    return imported;
  }

  private processEntry(entry: any, context: SessionContext, shouldImport: boolean, lineNumber: number): number {
    const timestamp = parseTimestamp(entry.timestamp);
    const payload = entry.payload;
    if (!payload || !timestamp) return 0;

    if (entry.type === 'session_meta') {
      context.sessionId = typeof payload.session_id === 'string' ? payload.session_id : context.sessionId;
      context.model = typeof payload.model === 'string' ? payload.model : context.model;
      return 0;
    }

    if (entry.type === 'event_msg' && payload.type === 'user_message') {
      context.requestStart = timestamp;
      context.firstResponse = undefined;
      return 0;
    }

    if (entry.type === 'response_item') {
      const isUserMessage = payload.type === 'message' && payload.role === 'user';
      if (!isUserMessage && context.requestStart && !context.firstResponse) {
        context.firstResponse = timestamp;
      }
      // A tool result is the best available start marker for Codex's next model call.
      if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
        context.requestStart = timestamp;
        context.firstResponse = undefined;
      }
      return 0;
    }

    if (entry.type !== 'event_msg' || payload.type !== 'token_count' || !shouldImport) return 0;

    const usage = payload.info?.last_token_usage;
    if (!usage) return 0;

    const requestStart = context.requestStart || timestamp;
    const firstResponse = context.firstResponse;
    this.storage.append({
      timestamp: new Date(timestamp).toISOString(),
      date: getLocalDate(new Date(timestamp)),
      requestId: `codex:${context.sessionId}:${lineNumber}`,
      provider: 'openai-codex',
      model: context.model,
      inputTokens: readNumber(usage.input_tokens),
      outputTokens: readNumber(usage.output_tokens),
      cacheReadInputTokens: readNumber(usage.cached_input_tokens) || undefined,
      reasoningTokens: readNumber(usage.reasoning_output_tokens) || undefined,
      stream: true,
      success: true,
      duration: Math.max(0, timestamp - requestStart),
      timeToFirstToken: firstResponse ? Math.max(0, firstResponse - requestStart) : undefined,
    });

    context.requestStart = undefined;
    context.firstResponse = undefined;
    return 1;
  }

  private readState(): ImportState {
    try {
      const state = JSON.parse(fs.readFileSync(this.statePath, 'utf-8'));
      return state && typeof state.files === 'object' ? state : { files: {} };
    } catch {
      return { files: {} };
    }
  }

  private writeState(state: ImportState): void {
    try {
      fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
      fs.writeFileSync(this.statePath, JSON.stringify(state), 'utf-8');
    } catch {
      // Importing must not stop the tracker when the state file cannot be updated.
    }
  }
}
