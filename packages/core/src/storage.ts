/**
 * Usage storage - handles persistent storage of usage records
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { getLocalDate, getProvidersConfig } from './utils';
import type {
  UsageRecord,
  UsageQuery,
  CleanupOptions,
  CleanupResult,
  TrackerConfig,
} from './types';

// Default storage directory
const DEFAULT_STORAGE_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.llm-usage-tracker',
  'usage'
);

// Daily file pattern: usage-YYYY-MM-DD.jsonl
const DAILY_FILE_PATTERN = /^usage-(\d{4}-\d{2}-\d{2})\.jsonl$/;

/**
 * Storage class for managing usage records
 */
export class Storage {
  private usageDir: string;

  constructor(config?: TrackerConfig) {
    this.usageDir = config?.storageDir
      ? path.join(config.storageDir, 'usage')
      : DEFAULT_STORAGE_DIR;
  }

  /**
   * Ensure the usage directory exists
   */
  private ensureDir(): void {
    if (!fs.existsSync(this.usageDir)) {
      fs.mkdirSync(this.usageDir, { recursive: true });
    }
  }

  /**
   * Get the daily file path for a given date
   */
  private getDailyFilePath(date: string): string {
    return path.join(this.usageDir, `usage-${date}.jsonl`);
  }

  /**
   * Generate a unique ID for a usage record
   */
  generateId(): string {
    return randomUUID();
  }

  /**
   * Append a usage record to storage
   */
  append(record: Omit<UsageRecord, 'id'>): UsageRecord {
    this.ensureDir();

    const fullRecord: UsageRecord = {
      id: this.generateId(),
      ...record,
    };

    const filePath = this.getDailyFilePath(record.date);
    const line = JSON.stringify(fullRecord) + '\n';

    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf-8');
    }

    const release = lockfile.lockSync(filePath, { stale: 5000 });
    try {
      fs.appendFileSync(filePath, line, 'utf-8');
    } finally {
      release();
    }

    return fullRecord;
  }

  /**
   * Append a usage record asynchronously
   */
  async appendAsync(record: Omit<UsageRecord, 'id'>): Promise<UsageRecord> {
    this.ensureDir();

    const fullRecord: UsageRecord = {
      id: this.generateId(),
      ...record,
    };

    const filePath = this.getDailyFilePath(record.date);
    const line = JSON.stringify(fullRecord) + '\n';

    try {
      await fs.promises.access(filePath);
    } catch {
      await fs.promises.writeFile(filePath, '', 'utf-8');
    }

    const release = await lockfile.lock(filePath, { stale: 5000 });
    try {
      await fs.promises.appendFile(filePath, line, 'utf-8');
    } finally {
      await release();
    }

    return fullRecord;
  }

  /**
   * List all daily files
   */
  listDailyFiles(): string[] {
    this.ensureDir();

    const files = fs.readdirSync(this.usageDir);
    return files
      .filter(f => DAILY_FILE_PATTERN.test(f))
      .sort()
      .map(f => path.join(this.usageDir, f));
  }

  /**
   * Parse a daily file and yield records
   */
  *readDailyFile(filePath: string): Generator<UsageRecord> {
    if (!fs.existsSync(filePath)) return;

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    const config = getProvidersConfig();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as UsageRecord;
        const mStr = String(record.model).toLowerCase();
        
        // OpenRouter style convention: "provider/model-name"
        const slashIndex = mStr.indexOf('/');
        if (slashIndex > 0) {
          record.provider = mStr.substring(0, slashIndex);
        } else {
          for (const [provider, prefixes] of Object.entries(config)) {
            if (prefixes.some(prefix => mStr.startsWith(prefix))) {
              record.provider = provider;
              break;
            }
          }
        }
        yield record;
      } catch {
        // Skip malformed lines
      }
    }
  }

  /**
   * Parse a daily file asynchronously
   */
  async *readDailyFileAsync(filePath: string): AsyncGenerator<UsageRecord> {
    if (!fs.existsSync(filePath)) return;

    const content = await fs.promises.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    const config = getProvidersConfig();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as UsageRecord;
        const mStr = String(record.model).toLowerCase();
        
        // OpenRouter style convention: "provider/model-name"
        const slashIndex = mStr.indexOf('/');
        if (slashIndex > 0) {
          record.provider = mStr.substring(0, slashIndex);
        } else {
          for (const [provider, prefixes] of Object.entries(config)) {
            if (prefixes.some(prefix => mStr.startsWith(prefix))) {
              record.provider = provider;
              break;
            }
          }
        }
        yield record;
      } catch {
        // Skip malformed lines
      }
    }
  }

  /**
   * Query usage records
   */
  query(queryParams: UsageQuery): UsageRecord[] {
    const date = queryParams.startDate;
    if (!date) return [];

    const filePath = this.getDailyFilePath(date);
    const records: UsageRecord[] = [];

    for (const record of this.readDailyFile(filePath)) {
      if (queryParams.provider && record.provider !== queryParams.provider) continue;
      if (queryParams.model && record.model !== queryParams.model) continue;
      records.push(record);
    }

    records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    const offset = queryParams.offset || 0;
    const limit = queryParams.limit || records.length;

    return records.slice(offset, offset + limit);
  }

  /**
   * Get count of records matching query
   */
  count(queryParams: UsageQuery): number {
    const date = queryParams.startDate;
    if (!date) return 0;

    const filePath = this.getDailyFilePath(date);
    let total = 0;

    for (const record of this.readDailyFile(filePath)) {
      if (queryParams.provider && record.provider !== queryParams.provider) continue;
      if (queryParams.model && record.model !== queryParams.model) continue;
      total++;
    }

    return total;
  }

  /**
   * Cleanup old records
   */
  cleanup(options: CleanupOptions): CleanupResult {
    const result: CleanupResult = {
      deletedCount: 0,
      deletedFiles: [],
      freedBytes: 0,
    };

    const files = this.listDailyFiles();

    let cutoffDate: string;
    if (options.beforeDate) {
      cutoffDate = options.beforeDate;
    } else if (options.retentionDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - options.retentionDays);
      cutoffDate = getLocalDate(cutoff);
    } else {
      return result;
    }

    for (const file of files) {
      const match = path.basename(file).match(DAILY_FILE_PATTERN);
      if (!match) continue;

      const date = match[1];

      if (date < cutoffDate) {
        if (options.dryRun) {
          const stats = fs.statSync(file);
          result.deletedFiles.push(file);
          result.freedBytes += stats.size;
          for (const _ of this.readDailyFile(file)) {
            result.deletedCount++;
          }
        } else {
          const stats = fs.statSync(file);
          result.freedBytes += stats.size;

          for (const _ of this.readDailyFile(file)) {
            result.deletedCount++;
          }

          fs.unlinkSync(file);
          result.deletedFiles.push(file);
        }
      }
    }

    return result;
  }

  /**
   * Get unique providers in a date range
   */
  getProviders(startDate?: string, endDate?: string): string[] {
    const providers = new Set<string>();
    const files = this.listDailyFiles();

    for (const file of files) {
      const match = path.basename(file).match(DAILY_FILE_PATTERN);
      if (!match) continue;

      const fileDate = match[1];

      if (startDate && fileDate < startDate) continue;
      if (endDate && fileDate > endDate) continue;

      for (const record of this.readDailyFile(file)) {
        providers.add(record.provider);
      }
    }

    return Array.from(providers).sort();
  }

  /**
   * Get unique models in a date range
   */
  getModels(startDate?: string, endDate?: string): string[] {
    const models = new Set<string>();
    const files = this.listDailyFiles();

    for (const file of files) {
      const match = path.basename(file).match(DAILY_FILE_PATTERN);
      if (!match) continue;

      const fileDate = match[1];

      if (startDate && fileDate < startDate) continue;
      if (endDate && fileDate > endDate) continue;

      for (const record of this.readDailyFile(file)) {
        if (Array.isArray(record.model)) {
          record.model.forEach(m => models.add(m));
        } else {
          models.add(record.model);
        }
      }
    }

    return Array.from(models).sort();
  }
}

// Create default storage instance
export const defaultStorage = new Storage();

// Export convenience functions using default storage
export const append = (record: Omit<UsageRecord, 'id'>) => defaultStorage.append(record);
export const appendAsync = (record: Omit<UsageRecord, 'id'>) => defaultStorage.appendAsync(record);
export const listDailyFiles = () => defaultStorage.listDailyFiles();
export const query = (queryParams: UsageQuery) => defaultStorage.query(queryParams);
export const count = (queryParams: UsageQuery) => defaultStorage.count(queryParams);
export const cleanup = (options: CleanupOptions) => defaultStorage.cleanup(options);
export const getProviders = (startDate?: string, endDate?: string) => defaultStorage.getProviders(startDate, endDate);
export const getModels = (startDate?: string, endDate?: string) => defaultStorage.getModels(startDate, endDate);