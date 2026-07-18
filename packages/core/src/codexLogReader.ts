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
import type { LogSearchResult, TrackerConfig } from './types';
import { getLocalDate } from './utils';

interface ImportState {
  version?: number;
  files: Record<string, number>;
}

interface SessionContext {
  sessionId: string;
  model: string;
  activeTurn?: {
    id: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    reasoningTokens: number;
  };
}

const IMPORT_STATE_VERSION = 4;

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
    if (state.version !== IMPORT_STATE_VERSION) {
      this.storage.deleteByRequestIdPrefix('codex:');
      state.version = IMPORT_STATE_VERSION;
      state.files = {};
    }
    let imported = 0;
    for (const filePath of this.findSessionFiles(this.sessionsDir)) {
      imported += this.importFile(filePath, state);
    }
    this.writeState(state);
    return imported;
  }

  /**
   * Retrieves a Codex turn's original user prompt on demand. Prompts stay in
   * Codex's session JSONL and are intentionally not copied into usage storage.
   */
  searchPromptByRequestId(requestId: string): LogSearchResult | null {
    const match = /^codex:([^:]+):turn:([^:]+):\d+$/.exec(requestId);
    if (!match || !fs.existsSync(this.sessionsDir)) return null;

    const [, sessionId, turnId] = match;
    const sessionFile = this.findSessionFiles(this.sessionsDir)
      .find(filePath => path.basename(filePath, '.jsonl').includes(sessionId));
    if (!sessionFile) return null;

    let lines: string[];
    try {
      lines = fs.readFileSync(sessionFile, 'utf-8').split('\n');
    } catch {
      return null;
    }

    let inTargetTurn = false;
    let timestamp: string | undefined;
    let fallbackPrompt: string | undefined;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        const payload = entry.payload;
        if (!payload) continue;

        if (entry.type === 'turn_context') {
          if (inTargetTurn) break;
          inTargetTurn = payload.turn_id === turnId;
          if (inTargetTurn) timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : undefined;
          continue;
        }
        if (!inTargetTurn) continue;

        if (entry.type === 'event_msg' && payload.type === 'user_message' && typeof payload.message === 'string') {
          return this.toPromptResult(requestId, payload.message, timestamp);
        }
        if (entry.type === 'response_item' && payload.type === 'message' && payload.role === 'user') {
          fallbackPrompt ||= this.extractUserContent(payload.content);
        }
        if (entry.type === 'event_msg' && payload.type === 'task_complete') break;
      } catch {
        // Ignore partial or malformed lines and continue searching the session.
      }
    }

    return fallbackPrompt ? this.toPromptResult(requestId, fallbackPrompt, timestamp) : null;
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

  private toPromptResult(requestId: string, prompt: string, timestamp?: string): LogSearchResult {
    return {
      requestId,
      timestamp,
      payload: {
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        source: 'codex-local-session',
      },
    };
  }

  private extractUserContent(content: unknown): string | undefined {
    if (!Array.isArray(content)) return undefined;
    const text = content
      .map(item => typeof item === 'object' && item && typeof (item as { text?: unknown }).text === 'string'
        ? (item as { text: string }).text
        : '')
      .filter(Boolean)
      .join('\n');
    return text || undefined;
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

    // Rebuild active turn context from existing lines without importing them.
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
      // A resumed Codex rollout can retain the prior session_id while being
      // written to a new JSONL file. The file-derived id remains the stable
      // lookup key used by requestId and prompt detail retrieval.
      context.model = typeof payload.model === 'string' ? payload.model : context.model;
      return 0;
    }

    if (entry.type === 'turn_context') {
      const turnId = typeof payload.turn_id === 'string' ? payload.turn_id : undefined;
      if (!turnId) return 0;
      context.model = typeof payload.model === 'string' ? payload.model : context.model;
      context.activeTurn = {
        id: turnId,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        reasoningTokens: 0,
      };
      return 0;
    }

    if (entry.type === 'event_msg' && payload.type === 'token_count') {
      const usage = payload.info?.last_token_usage;
      if (!usage || !context.activeTurn) return 0;
      context.activeTurn.inputTokens += readNumber(usage.input_tokens);
      context.activeTurn.outputTokens += readNumber(usage.output_tokens);
      context.activeTurn.cacheReadInputTokens += readNumber(usage.cached_input_tokens);
      context.activeTurn.reasoningTokens += readNumber(usage.reasoning_output_tokens);
      return 0;
    }

    if (entry.type !== 'event_msg' || payload.type !== 'task_complete' || !shouldImport || !context.activeTurn) return 0;

    const turn = context.activeTurn;
    if (typeof payload.turn_id === 'string' && payload.turn_id !== turn.id) return 0;
    const duration = readNumber(payload.duration_ms);
    const timeToFirstToken = readNumber(payload.time_to_first_token_ms);
    this.storage.append({
      timestamp: new Date(timestamp).toISOString(),
      date: getLocalDate(new Date(timestamp)),
      requestId: `codex:${context.sessionId}:turn:${turn.id}:${lineNumber}`,
      provider: 'openai-codex',
      model: context.model,
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
      cacheReadInputTokens: turn.cacheReadInputTokens || undefined,
      reasoningTokens: turn.reasoningTokens || undefined,
      stream: true,
      success: true,
      duration: duration || undefined,
      timeToFirstToken: timeToFirstToken || undefined,
    });

    context.activeTurn = undefined;
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
