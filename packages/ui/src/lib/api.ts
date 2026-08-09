import type { UsageRecord, AggregatedUsage, PerformanceMetrics } from '../types/usage';

// Helper to filter out undefined values from params
function buildQuery(params: Record<string, string | number | undefined>): string {
  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      filtered[key] = String(value);
    }
  }
  return new URLSearchParams(filtered).toString();
}

class ApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string = '/api', apiKey: string = '') {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey || localStorage.getItem('apiKey') || '';
  }

  setApiKey(apiKey: string) {
    this.apiKey = apiKey;
    if (apiKey) {
      localStorage.setItem('apiKey', apiKey);
    } else {
      localStorage.removeItem('apiKey');
    }
  }

  private createHeaders(): HeadersInit {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }
    return headers;
  }

  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: { ...this.createHeaders(), ...options?.headers },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return response.json();
  }

  // Usage APIs
  async getUsageRecords(params: {
    startDate?: string;
    endDate?: string;
    provider?: string;
    model?: string;
    limit?: number;
    offset?: number;
  }) {
    const query = buildQuery(params);
    return this.fetch<{ records: UsageRecord[]; total: number }>(`/usage?${query}`);
  }

  async getUsageSummary(params: { startDate?: string; endDate?: string; provider?: string; model?: string }) {
    const query = buildQuery(params);
    return this.fetch<AggregatedUsage>(`/usage/summary?${query}`);
  }

  async getUsageDaily(params: { startDate: string; endDate: string }) {
    const query = buildQuery(params);
    return this.fetch(`/usage/daily?${query}`);
  }

  async getUsageFilters(params?: { startDate?: string; endDate?: string }) {
    const query = params ? buildQuery(params) : '';
    return this.fetch<{ providers: string[]; models: string[]; dates: string[] }>(`/usage/filters?${query}`);
  }

  async getUsagePerformance(params: {
    startDate: string;
    endDate: string;
    groupBy?: 'day' | 'hour';
    provider?: string;
    model?: string;
  }) {
    const query = buildQuery(params);
    return this.fetch<PerformanceMetrics[]>(`/usage/performance?${query}`);
  }

  async getUsageRequestLog(requestId: string) {
    return this.fetch(`/usage/logs?requestId=${requestId}`);
  }

  async cleanupUsage(params: { beforeDate?: string; retentionDays?: number; dryRun?: boolean }) {
    return this.fetch('/usage/cleanup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  }

  async exportUsage(params: {
    format?: 'json' | 'csv';
    startDate: string;
    endDate: string;
    provider?: string;
    model?: string;
  }) {
    const query = buildQuery(params);
    const response = await fetch(`${this.baseUrl}/usage/export?${query}`, {
      headers: this.createHeaders(),
    });
    return response;
  }

  async getUsageHourly(params: { startDate: string; endDate: string; provider?: string; model?: string }) {
    const query = buildQuery(params);
    return this.fetch(`/usage/hourly?${query}`);
  }

  async getPluginsStatus() {
    return { plugins: [] };
  }

  async getAliQuota() {
    return this.fetch<{
      date: string;
      provider: string;
      used: number;
      requests: number;
      limit: number;
      threshold: number;
      remaining: number;
      percent: number;
      breaker: boolean;
      blocked: boolean;
    }>('/quota');
  }

  async toggleAliBreaker() {
    return this.fetch<{ breaker: boolean }>('/quota/breaker/toggle', { method: 'POST' });
  }
}

const apiClient = new ApiClient();
export const api = apiClient;
export default apiClient;
