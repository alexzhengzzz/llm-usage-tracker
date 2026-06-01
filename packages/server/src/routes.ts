/**
 * REST API routes for usage tracking
 */

import type { FastifyPluginAsync } from 'fastify';
import type { Storage, Aggregator, LogReader } from '@llm-usage-tracker/core';
import type { UsageQuery, CleanupOptions } from '@llm-usage-tracker/core';
import { getLocalDate } from '@llm-usage-tracker/core';

interface RoutesOptions {
  storage: Storage;
  aggregator: Aggregator;
  logReader: LogReader;
  apiKey?: string;
}

export const createRoutes: FastifyPluginAsync<RoutesOptions> = async (fastify, options) => {
  const { storage, aggregator, logReader, apiKey } = options;

  // No authentication needed for UI API routes (the proxy handles its own auth)

  // Health check
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // API routes
  fastify.register(async (api) => {
    // Get usage records
    api.get('/usage', async (request) => {
      const query = request.query as UsageQuery;
      const records = storage.query(query);
      const total = storage.count(query);
      return { records, total };
    });

    // Get aggregated summary
    api.get('/usage/summary', async (request) => {
      const query = request.query as UsageQuery;
      return aggregator.aggregate(query);
    });

    // Get daily totals
    api.get('/usage/daily', async (request) => {
      const { startDate, endDate } = request.query as { startDate: string; endDate: string };
      const data = aggregator.getDailyTotals(startDate, endDate);
      return { data };
    });

    // Get hourly aggregation
    api.get('/usage/hourly', async (request) => {
      const { startDate, endDate, provider, model } = request.query as {
        startDate: string;
        endDate: string;
        provider?: string;
        model?: string;
      };
      const aggregated = aggregator.aggregate({ startDate, endDate, provider, model });
      // Flatten hourly data
      const hourlyData: Array<{
        hour: number;
        requests: number;
        inputTokens: number;
        outputTokens: number;
      }> = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
      }));

      for (const daily of aggregated.byDate || []) {
        for (const hourly of daily.hourlyBreakdown) {
          hourlyData[hourly.hour].requests += hourly.requests;
          hourlyData[hourly.hour].inputTokens += hourly.inputTokens;
          hourlyData[hourly.hour].outputTokens += hourly.outputTokens;
        }
      }

      return hourlyData;
    });

    // Get performance metrics
    api.get('/usage/performance', async (request) => {
      const { startDate, endDate, groupBy, provider, model } = request.query as {
        startDate: string;
        endDate: string;
        groupBy?: 'day' | 'hour';
        provider?: string;
        model?: string;
      };
      return aggregator.getPerformanceMetrics(startDate, endDate, groupBy || 'day', provider, model);
    });

    // Get available filters (providers/models)
    api.get('/usage/filters', async (request) => {
      const { startDate, endDate } = request.query as { startDate?: string; endDate?: string };
      const dateRange = aggregator.getAvailableDateRange();
      const effectiveStart = startDate || dateRange?.startDate;
      const effectiveEnd = endDate || dateRange?.endDate;

      if (!effectiveStart || !effectiveEnd) {
        return { providers: [], models: [], dates: [] };
      }

      return {
        providers: storage.getProviders(effectiveStart, effectiveEnd),
        models: storage.getModels(effectiveStart, effectiveEnd),
        dates: Array.from({ length: 30 }, (_, i) => {
          const d = new Date(effectiveEnd);
          d.setDate(d.getDate() - i);
          return getLocalDate(d);
        }).filter(d => d >= effectiveStart)
      };
    });

    // Get request log details
    api.get('/usage/logs', async (request) => {
      const { requestId } = request.query as { requestId: string };
      if (!requestId) {
        return { error: 'requestId required' };
      }
      const result = await logReader.searchRequestBodyFromLogs(requestId);
      return result || { error: 'Not found', requestId };
    });

    // Export usage data
    api.get('/usage/export', async (request, reply) => {
      const { format, startDate, endDate, provider, model } = request.query as {
        format?: 'json' | 'csv';
        startDate: string;
        endDate: string;
        provider?: string;
        model?: string;
      };

      const aggregated = aggregator.aggregate({ startDate, endDate, provider, model });

      if (format === 'csv') {
        // Generate CSV
        const headers = ['date', 'provider', 'model', 'requests', 'inputTokens', 'outputTokens', 'avgLatency'];
        const rows = (aggregated.byDate || []).map(d => [
          d.date,
          d.provider,
          Array.isArray(d.model) ? d.model.join(',') : d.model,
          d.totalRequests,
          d.totalInputTokens,
          d.totalOutputTokens,
          d.avgLatency || ''
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        reply.header('Content-Type', 'text/csv');
        reply.header('Content-Disposition', `attachment; filename="usage-${startDate}-${endDate}.csv"`);
        return csv;
      }

      reply.header('Content-Type', 'application/json');
      reply.header('Content-Disposition', `attachment; filename="usage-${startDate}-${endDate}.json"`);
      return aggregated;
    });

    // Cleanup old data
    api.post('/usage/cleanup', async (request) => {
      const options = request.body as CleanupOptions;
      return storage.cleanup(options);
    });

    // Get plugins status
    api.get('/plugins/status', async () => {
      return {
        plugins: [
          { name: 'usage-tracking', enabled: true, hasOptions: true },
          { name: 'token-speed', enabled: true, hasOptions: false }
        ]
      };
    });

  }, { prefix: '/api' });
};