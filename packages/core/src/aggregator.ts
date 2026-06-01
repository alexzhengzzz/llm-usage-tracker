/**
 * Usage aggregator - handles statistical aggregation of usage data
 */

import path from 'node:path';
import type {
  UsageRecord,
  UsageQuery,
  AggregatedUsage,
  ProviderStats,
  ModelStats,
  DailyUsageSummary,
  HourlyStats,
  PerformanceMetrics,
} from './types';
import { getLocalDate, getProvidersConfig } from './utils';
import { Storage, query } from './storage';

/**
 * Performance tracking helper
 */
interface PerformanceAccumulator {
  durationSum: number;
  durationCount: number;
  ttftSum: number;
  ttftCount: number;
  outputTokensSum: number;
  outputDurationSum: number;
}

function createPerformanceAccumulator(): PerformanceAccumulator {
  return {
    durationSum: 0,
    durationCount: 0,
    ttftSum: 0,
    ttftCount: 0,
    outputTokensSum: 0,
    outputDurationSum: 0,
  };
}

function addRecordPerformance(acc: PerformanceAccumulator, record: UsageRecord): void {
  const outputDuration = Math.max(0, (record.duration || 0) - (record.timeToFirstToken || 0));
  if (outputDuration > 0) {
    acc.durationSum += outputDuration;
    acc.durationCount++;

    const outputTokens = record.outputTokens || 0;
    if (outputTokens > 0) {
      acc.outputTokensSum += outputTokens;
      acc.outputDurationSum += outputDuration;
    }
  }

  if (record.timeToFirstToken && record.timeToFirstToken > 0) {
    acc.ttftSum += record.timeToFirstToken;
    acc.ttftCount++;
  }
}

function calculatePerformance(acc: PerformanceAccumulator): {
  avgLatency?: number;
  avgTimeToFirstToken?: number;
  avgSpeed?: number;
} {
  const result: { avgLatency?: number; avgTimeToFirstToken?: number; avgSpeed?: number } = {};

  if (acc.durationCount > 0) {
    result.avgLatency = Math.round(acc.durationSum / acc.durationCount);
  }

  if (acc.ttftCount > 0) {
    result.avgTimeToFirstToken = Math.round(acc.ttftSum / acc.ttftCount);
  }

  if (acc.outputDurationSum > 0 && acc.outputTokensSum > 0) {
    const outputDurationSeconds = acc.outputDurationSum / 1000;
    result.avgSpeed = Math.round(acc.outputTokensSum / outputDurationSeconds);
  }

  return result;
}

type StatsWithPerf<T = {}> = T & { _perf: PerformanceAccumulator };

function accumulateRecord<T extends {
  requests: number;
  successRequests: number;
  failedRequests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
}>(stats: StatsWithPerf<T>, record: UsageRecord): void {
  stats.requests++;
  if (record.success) stats.successRequests++;
  else stats.failedRequests++;
  stats.inputTokens += record.inputTokens || 0;
  stats.outputTokens += record.outputTokens || 0;
  stats.cacheCreationTokens += record.cacheCreationInputTokens || 0;
  stats.cacheReadTokens += record.cacheReadInputTokens || 0;
  stats.reasoningTokens += record.reasoningTokens || 0;
  addRecordPerformance(stats._perf, record);
}

function accumulateDailyRecord(stats: StatsWithPerf<DailyUsageSummary>, record: UsageRecord): void {
  stats.totalRequests++;
  if (record.success) stats.successRequests++;
  else stats.failedRequests++;
  stats.totalInputTokens += record.inputTokens || 0;
  stats.totalOutputTokens += record.outputTokens || 0;
  stats.totalCacheCreationTokens += record.cacheCreationInputTokens || 0;
  stats.totalCacheReadTokens += record.cacheReadInputTokens || 0;
  stats.totalReasoningTokens += record.reasoningTokens || 0;
  addRecordPerformance(stats._perf, record);
}

function createEmptyHourlyStats(): HourlyStats[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    requests: 0,
    successRequests: 0,
    failedRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
  }));
}

/**
 * Aggregator class
 */
export class Aggregator {
  private storage: Storage;

  constructor(storage?: Storage) {
    this.storage = storage || new Storage();
  }

  /**
   * Aggregate usage statistics
   */
  aggregate(queryParams: UsageQuery): AggregatedUsage {
    const records = queryParams.limit
      ? query({ ...queryParams, limit: undefined })
      : query(queryParams);

    let startDate = queryParams.startDate;
    let endDate = queryParams.endDate;

    if (!startDate || !endDate) {
      const dates = records.map(r => r.date);
      if (dates.length > 0) {
        dates.sort();
        if (!startDate) startDate = dates[0];
        if (!endDate) endDate = dates[dates.length - 1];
      } else {
        const today = getLocalDate();
        if (!startDate) startDate = today;
        if (!endDate) endDate = today;
      }
    }

    const result: AggregatedUsage = {
      startDate,
      endDate,
      totalRequests: 0,
      successRequests: 0,
      failedRequests: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalReasoningTokens: 0,
    };

    const globalPerf = createPerformanceAccumulator();
    const providerMap = new Map<string, ProviderStats & { _perf: PerformanceAccumulator }>();
    const modelMap = new Map<string, ModelStats & { _perf: PerformanceAccumulator }>();
    const dateMap = new Map<string, Map<string, Map<string, DailyUsageSummary & { _perf: PerformanceAccumulator }>>>();
    const hourlyPerfMap = new Map<string, Map<string, Map<string, Map<number, PerformanceAccumulator>>>>();

    for (const record of records) {
      result.totalRequests++;
      if (record.success) result.successRequests++;
      else result.failedRequests++;
      result.totalInputTokens += record.inputTokens || 0;
      result.totalOutputTokens += record.outputTokens || 0;
      result.totalCacheCreationTokens += record.cacheCreationInputTokens || 0;
      result.totalCacheReadTokens += record.cacheReadInputTokens || 0;
      result.totalReasoningTokens += record.reasoningTokens || 0;
      addRecordPerformance(globalPerf, record);

      // By provider
      let providerStats = providerMap.get(record.provider);
      if (!providerStats) {
        providerStats = {
          provider: record.provider,
          requests: 0,
          successRequests: 0,
          failedRequests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          reasoningTokens: 0,
          models: [],
          _perf: createPerformanceAccumulator(),
        };
        providerMap.set(record.provider, providerStats);
      }
      accumulateRecord(providerStats, record);

      // By model
      const modelStr = Array.isArray(record.model) ? record.model.join(',') : String(record.model);
      const modelKey = `${record.provider}/${modelStr}`;
      let modelStats = modelMap.get(modelKey);
      if (!modelStats) {
        modelStats = {
          model: record.model,
          provider: record.provider,
          requests: 0,
          successRequests: 0,
          failedRequests: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          reasoningTokens: 0,
          _perf: createPerformanceAccumulator(),
        };
        modelMap.set(modelKey, modelStats);
      }
      accumulateRecord(modelStats, record);

      const existingModel = providerStats.models.find(m => {
        const mStr = Array.isArray(m.model) ? m.model.join(',') : String(m.model);
        return mStr === modelStr;
      });
      if (!existingModel) {
        providerStats.models.push(modelStats);
      }

      // By date -> provider -> model
      let dateEntry = dateMap.get(record.date);
      if (!dateEntry) {
        dateEntry = new Map();
        dateMap.set(record.date, dateEntry);
      }
      let providerEntry = dateEntry.get(record.provider);
      if (!providerEntry) {
        providerEntry = new Map();
        dateEntry.set(record.provider, providerEntry);
      }
      let dailySummary = providerEntry.get(record.model);
      if (!dailySummary) {
        dailySummary = {
          date: record.date,
          provider: record.provider,
          model: record.model,
          totalRequests: 0,
          successRequests: 0,
          failedRequests: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheCreationTokens: 0,
          totalCacheReadTokens: 0,
          totalReasoningTokens: 0,
          hourlyBreakdown: createEmptyHourlyStats(),
          _perf: createPerformanceAccumulator(),
        };
        providerEntry.set(record.model, dailySummary);
      }

      accumulateDailyRecord(dailySummary, record);

      // Update hourly breakdown
      const hour = new Date(record.timestamp).getHours();
      const hourlyStats = dailySummary.hourlyBreakdown[hour];
      hourlyStats.requests++;
      if (record.success) hourlyStats.successRequests++;
      else hourlyStats.failedRequests++;
      hourlyStats.inputTokens += record.inputTokens || 0;
      hourlyStats.outputTokens += record.outputTokens || 0;
      hourlyStats.cacheCreationTokens += record.cacheCreationInputTokens || 0;
      hourlyStats.cacheReadTokens += record.cacheReadInputTokens || 0;
      hourlyStats.reasoningTokens += record.reasoningTokens || 0;

      // Track hourly performance
      if (!hourlyPerfMap.has(record.date)) {
        hourlyPerfMap.set(record.date, new Map());
      }
      const dateHourlyPerf = hourlyPerfMap.get(record.date)!;
      if (!dateHourlyPerf.has(record.provider)) {
        dateHourlyPerf.set(record.provider, new Map());
      }
      const providerHourlyPerf = dateHourlyPerf.get(record.provider)!;
      const perfModelKey = Array.isArray(record.model) ? record.model.join(',') : String(record.model);
      if (!providerHourlyPerf.has(perfModelKey)) {
        providerHourlyPerf.set(perfModelKey, new Map());
      }
      const modelHourlyPerf = providerHourlyPerf.get(perfModelKey)!;
      if (!modelHourlyPerf.has(hour)) {
        modelHourlyPerf.set(hour, createPerformanceAccumulator());
      }
      addRecordPerformance(modelHourlyPerf.get(hour)!, record);
    }

    // Calculate global performance metrics
    const globalPerformance = calculatePerformance(globalPerf);
    result.avgLatency = globalPerformance.avgLatency;
    result.avgTimeToFirstToken = globalPerformance.avgTimeToFirstToken;
    result.avgSpeed = globalPerformance.avgSpeed;

    // Calculate cache hit ratio
    const totalInput = result.totalInputTokens + result.totalCacheReadTokens;
    if (totalInput > 0) {
      result.cacheHitRatio = result.totalCacheReadTokens / totalInput;
    }

    // Set grouped results
    result.byProvider = Array.from(providerMap.values()).map(p => {
      const perf = calculatePerformance(p._perf);
      const { _perf, ...stats } = p;
      return { ...stats, ...perf };
    }).sort((a, b) => b.requests - a.requests);

    result.byModel = Array.from(modelMap.values()).map(m => {
      const perf = calculatePerformance(m._perf);
      const { _perf, ...stats } = m;
      return { ...stats, ...perf };
    }).sort((a, b) => b.requests - a.requests);

    // Flatten daily summaries
    const dailySummaries: DailyUsageSummary[] = [];
    for (const [, providerEntry] of dateMap) {
      for (const [, modelMap] of providerEntry) {
        for (const [, dailySummary] of modelMap) {
          const perf = calculatePerformance(dailySummary._perf);
          const { _perf, ...summary } = dailySummary;

          const dateHourlyPerf = hourlyPerfMap.get(summary.date);
          if (dateHourlyPerf) {
            const providerHourlyPerf = dateHourlyPerf.get(summary.provider);
            if (providerHourlyPerf) {
              const perfModelKey2 = Array.isArray(summary.model) ? summary.model.join(',') : String(summary.model);
              const modelHourlyPerf = providerHourlyPerf.get(perfModelKey2);
              if (modelHourlyPerf) {
                for (const hourlyStat of summary.hourlyBreakdown) {
                  const hourPerf = modelHourlyPerf.get(hourlyStat.hour);
                  if (hourPerf) {
                    const hourPerformance = calculatePerformance(hourPerf);
                    if (hourPerformance.avgLatency !== undefined) hourlyStat.avgLatency = hourPerformance.avgLatency;
                    if (hourPerformance.avgTimeToFirstToken !== undefined) hourlyStat.avgTimeToFirstToken = hourPerformance.avgTimeToFirstToken;
                    if (hourPerformance.avgSpeed !== undefined) hourlyStat.avgSpeed = hourPerformance.avgSpeed;
                  }
                }
              }
            }
          }

          dailySummaries.push({ ...summary, ...perf });
        }
      }
    }
    result.byDate = dailySummaries.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider);
      const aModel = Array.isArray(a.model) ? a.model.join(',') : String(a.model);
      const bModel = Array.isArray(b.model) ? b.model.join(',') : String(b.model);
      return aModel.localeCompare(bModel);
    });

    return result;
  }

  /**
   * Get today's usage summary
   */
  getTodaySummary(): AggregatedUsage {
    const today = getLocalDate();
    return this.aggregate({ startDate: today, endDate: today });
  }

  /**
   * Get available date range in the data
   */
  getAvailableDateRange(): { startDate: string; endDate: string } | null {
    const files = this.storage.listDailyFiles();
    if (files.length === 0) return null;

    let minDate = '';
    let maxDate = '';

    for (const file of files) {
      const match = path.basename(file).match(/^usage-(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (match) {
        const date = match[1];
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
      }
    }

    if (!minDate || !maxDate) return null;

    return { startDate: minDate, endDate: maxDate };
  }

  /**
   * Get daily totals
   */
  getDailyTotals(startDate: string, endDate: string): Array<{
    date: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }> {
    const dateTotals = new Map<string, {
      date: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    }>();

    const files = this.storage.listDailyFiles();

    for (const file of files) {
      const match = path.basename(file).match(/^usage-(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (!match) continue;

      const fileDate = match[1];
      if (fileDate < startDate || fileDate > endDate) continue;

      for (const record of this.storage.readDailyFile(file)) {
        let entry = dateTotals.get(record.date);
        if (!entry) {
          entry = { date: record.date, requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 };
          dateTotals.set(record.date, entry);
        }
        entry.requests++;
        entry.inputTokens += record.inputTokens || 0;
        entry.outputTokens += record.outputTokens || 0;
        entry.totalTokens += (record.inputTokens || 0) + (record.outputTokens || 0);
      }
    }

    return Array.from(dateTotals.values()).sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Get performance metrics time series
   */
  getPerformanceMetrics(
    startDate: string,
    endDate: string,
    groupBy: 'day' | 'hour' = 'day',
    provider?: string,
    model?: string
  ): PerformanceMetrics[] {
    const metrics: PerformanceMetrics[] = [];

    const currentDate = new Date(startDate);
    const end = new Date(endDate);

    while (currentDate <= end) {
      const dateStr = getLocalDate(currentDate);
      const aggregated = this.aggregate({ startDate: dateStr, endDate: dateStr, provider, model });

      if (groupBy === 'day') {
        for (const daily of aggregated.byDate || []) {
          metrics.push({
            timestamp: daily.date,
            date: daily.date,
            provider: daily.provider,
            model: Array.isArray(daily.model) ? daily.model.join(',') : String(daily.model),
            requests: daily.totalRequests,
            inputTokens: daily.totalInputTokens,
            outputTokens: daily.totalOutputTokens,
            avgLatency: daily.avgLatency,
            avgTimeToFirstToken: daily.avgTimeToFirstToken,
            avgSpeed: daily.avgSpeed,
          });
        }
      } else {
        for (const daily of aggregated.byDate || []) {
          for (const hourly of daily.hourlyBreakdown) {
            if (hourly.requests > 0) {
              const timestamp = `${daily.date}T${hourly.hour.toString().padStart(2, '0')}:00:00`;
              metrics.push({
                timestamp,
                date: daily.date,
                provider: daily.provider,
                model: Array.isArray(daily.model) ? daily.model.join(',') : String(daily.model),
                requests: hourly.requests,
                inputTokens: hourly.inputTokens,
                outputTokens: hourly.outputTokens,
                avgLatency: hourly.avgLatency,
                avgSpeed: hourly.avgSpeed,
              });
            }
          }
        }
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return metrics.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
}

// Create default aggregator instance
export const defaultAggregator = new Aggregator();

// Export convenience functions
export const aggregate = (queryParams: UsageQuery) => defaultAggregator.aggregate(queryParams);
export const getTodaySummary = () => defaultAggregator.getTodaySummary();
export const getAvailableDateRange = () => defaultAggregator.getAvailableDateRange();
export const getDailyTotals = (startDate: string, endDate: string) => defaultAggregator.getDailyTotals(startDate, endDate);
export const getPerformanceMetrics = (
  startDate: string,
  endDate: string,
  groupBy?: 'day' | 'hour',
  provider?: string,
  model?: string
) => defaultAggregator.getPerformanceMetrics(startDate, endDate, groupBy || 'day', provider, model);