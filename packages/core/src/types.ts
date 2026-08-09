/**
 * Type definitions for LLM usage tracking
 */

/**
 * Single usage record
 */
export interface UsageRecord {
  id: string;
  timestamp: string;
  date: string;
  sessionId?: string;
  requestId: string;
  provider: string;
  model: string;
  /** Optional origin marker for records imported from another tracker. */
  source?: string;

  // Token usage
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  reasoningTokens?: number;

  // Request metadata
  stream: boolean;
  success: boolean;
  errorMessage?: string;
  duration?: number;
  timeToFirstToken?: number;
}

/**
 * Hourly statistics with performance metrics
 */
export interface HourlyStats {
  hour: number;
  requests: number;
  successRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  avgLatency?: number;
  avgTimeToFirstToken?: number;
  avgSpeed?: number;
}

/**
 * Hourly aggregation result
 */
export interface HourlyAggregation {
  hour: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  avgLatency?: number;
  avgSpeed?: number;
}

/**
 * Performance metrics for charting
 */
export interface PerformanceMetrics {
  timestamp: string;
  date: string;
  provider: string;
  model?: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  avgLatency?: number;
  avgTimeToFirstToken?: number;
  avgSpeed?: number;
}

/**
 * Daily usage summary
 */
export interface DailyUsageSummary {
  date: string;
  provider: string;
  model: string;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalReasoningTokens: number;
  hourlyBreakdown: HourlyStats[];
  avgLatency?: number;
  avgTimeToFirstToken?: number;
  avgSpeed?: number;
}

/**
 * Provider-level aggregated statistics
 */
export interface ProviderStats {
  provider: string;
  requests: number;
  successRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  avgLatency?: number;
  avgTimeToFirstToken?: number;
  avgSpeed?: number;
  models: ModelStats[];
}

/**
 * Model-level aggregated statistics
 */
export interface ModelStats {
  model: string;
  provider: string;
  requests: number;
  successRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  avgLatency?: number;
  avgTimeToFirstToken?: number;
  avgSpeed?: number;
}

/**
 * Usage query parameters
 */
export interface UsageQuery {
  startDate?: string;
  endDate?: string;
  provider?: string;
  model?: string;
  groupBy?: 'date' | 'provider' | 'model' | 'hour';
  limit?: number;
  offset?: number;
}

/**
 * Aggregated usage result
 */
export interface AggregatedUsage {
  startDate: string;
  endDate: string;
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalReasoningTokens: number;
  avgLatency?: number;
  avgTimeToFirstToken?: number;
  avgSpeed?: number;
  cacheHitRatio?: number;
  byProvider?: ProviderStats[];
  byModel?: ModelStats[];
  byDate?: DailyUsageSummary[];
  records?: UsageRecord[];
}

/**
 * Export format options
 */
export type ExportFormat = 'json' | 'csv';

/**
 * Cleanup options
 */
export interface CleanupOptions {
  beforeDate?: string;
  retentionDays?: number;
  dryRun?: boolean;
}

/**
 * Cleanup result
 */
export interface CleanupResult {
  deletedCount: number;
  deletedFiles: string[];
  freedBytes: number;
}

/**
 * Tracker configuration
 */
export interface TrackerConfig {
  storageDir?: string;
  logsDir?: string;
  codexSessionsDir?: string;
  retentionDays?: number;
}

/**
 * Log search result
 */
export interface LogSearchResult {
  requestId: string;
  payload: Record<string, unknown>;
  responseBody?: string;
  timestamp?: string;
}
