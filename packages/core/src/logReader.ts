/**
 * Log reader - search request bodies from log files
 */

import fs from 'node:fs';
import path from 'node:path';
import type { TrackerConfig, LogSearchResult } from './types';

// Default logs directory
const DEFAULT_LOGS_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.llm-usage-tracker',
  'logs'
);

/**
 * Log reader class
 */
export class LogReader {
  private logsDir: string;

  constructor(config?: TrackerConfig) {
    this.logsDir = config?.logsDir
      ? path.join(config.logsDir, 'logs')
      : DEFAULT_LOGS_DIR;
  }

  /**
   * Search recent log files for a request body entry matching the given requestId
   */
  async searchRequestBodyFromLogs(requestId: string): Promise<LogSearchResult | null> {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;

    if (!fs.existsSync(this.logsDir)) return null;

    let logFiles: string[] = [];
    try {
      logFiles = fs.readdirSync(this.logsDir)
        .filter(f => f.endsWith('.log'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(this.logsDir, f)).mtimeMs }))
        .filter(f => f.mtime >= cutoff)
        .sort((a, b) => b.mtime - a.mtime)
        .map(f => path.join(this.logsDir, f.name));
    } catch {
      return null;
    }

    for (const file of logFiles) {
      const result = await this.searchFileForRequestId(file, requestId);
      if (result) return result;
    }

    return null;
  }

  private async searchFileForRequestId(filePath: string, requestId: string): Promise<LogSearchResult | null> {
    return new Promise((resolve) => {
      const stream = fs.createReadStream(filePath, {
        encoding: 'utf-8',
        highWaterMark: 1024 * 1024,
      });

      let leftover = '';
      let closed = false;
      let result: LogSearchResult | null = null;

      stream.on('data', (chunk) => {
        if (closed) return;

        const data = leftover + chunk;
        const lines = data.split('\n');
        leftover = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.reqId === requestId) {
              if (entry.type === 'request body' && entry.data) {
                if (!result) result = { requestId, payload: entry.data, timestamp: entry.time as string | undefined };
                else result.payload = entry.data;
              } else if (entry.type === 'response body' && entry.data) {
                if (!result) result = { requestId, payload: {} as any, responseBody: entry.data, timestamp: entry.time as string | undefined };
                else result.responseBody = entry.data;
              }
            }
          } catch {
            // Skip malformed lines
          }
        }
      });

      stream.on('close', () => {
        if (closed) return;
        if (leftover.trim()) {
          try {
            const entry = JSON.parse(leftover);
            if (entry.reqId === requestId) {
              if (entry.type === 'request body' && entry.data) {
                if (!result) result = { requestId, payload: entry.data, timestamp: entry.time as string | undefined };
                else result.payload = entry.data;
              } else if (entry.type === 'response body' && entry.data) {
                if (!result) result = { requestId, payload: {} as any, responseBody: entry.data, timestamp: entry.time as string | undefined };
                else result.responseBody = entry.data;
              }
            }
          } catch {
            // Skip
          }
        }
        resolve(result);
      });

      stream.on('error', () => resolve(null));
    });
  }
}

// Create default log reader instance
export const defaultLogReader = new LogReader();

// Export convenience function
export const searchRequestBodyFromLogs = (requestId: string) => defaultLogReader.searchRequestBodyFromLogs(requestId);