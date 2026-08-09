import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { Calendar, Download, Trash2, RefreshCw, TrendingUp, Zap, Clock, AlertCircle, Layers, Timer, Filter, BarChart3, Activity, Database } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Toast } from '@/components/ui/toast';

// Format functions
function formatTokens(num: number | undefined | null): string {
  if (num == null || isNaN(num)) return '-';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function formatNumber(num: number | undefined | null): string {
  if (num == null || isNaN(num)) return '0';
  return num.toLocaleString();
}

// Import new components
import { DateSidebar } from '@/components/usage/DateSidebar';
import { StatsTable } from '@/components/usage/StatsTable';
import { PerformanceChart } from '@/components/usage/PerformanceChart';
import { HourlyTable } from '@/components/usage/HourlyTable';
import { RecordsTable, type UsageRecord } from '@/components/usage/RecordsTable';
import { RequestDetailDrawer } from '@/components/usage/RequestDetailDrawer';
import { AliQuotaCard } from '@/components/AliQuotaCard';

// Types
interface UsageSummary {
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
  avgSpeed?: number;
  cacheHitRatio?: number;
  byProvider?: ProviderStats[];
  byModel?: ModelStats[];
  byDate?: DailyUsageSummary[];
}

interface ProviderStats {
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
  avgSpeed?: number;
  models: ModelStats[];
}

interface ModelStats {
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
  avgSpeed?: number;
}

interface DailyUsageSummary {
  date: string;
  provider: string;
  model: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  avgLatency?: number;
  avgSpeed?: number;
  hourlyBreakdown: HourlyBreakdown[];
}

interface HourlyBreakdown {
  hour: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  reasoningTokens?: number;
  avgLatency?: number;
  avgSpeed?: number;
}

interface UsageFilters {
  providers: string[];
  models: string[];
  dateRange: { startDate: string; endDate: string } | null;
}

interface HourlyData {
  hour: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  avgLatency?: number;
  avgSpeed?: number;
  reasoningTokens?: number;
}

interface PerformanceData {
  timestamp: string;
  date: string;
  provider: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  avgLatency?: number;
  avgTimeToFirstToken?: number;
  avgSpeed?: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function UsagePage() {
  const { t } = useTranslation();

  // Plugin status state
  const [pluginEnabled, setPluginEnabled] = useState<boolean>(true);
  const [pluginChecked, setPluginChecked] = useState<boolean>(false);

  // State
  const [startDate, setStartDate] = useState<string>('');
  const [provider, setProvider] = useState<string>('ali总计');
  const [model, setModel] = useState<string>('');
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [filters, setFilters] = useState<UsageFilters | null>(null);
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [performanceData, setPerformanceData] = useState<PerformanceData[]>([]);
  const [dateHistory, setDateHistory] = useState<{ date: string; requests: number; tokens: number }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'warning' } | null>(null);

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // Auto-refresh state
  const [autoRefreshInterval, setAutoRefreshInterval] = useState<number>(0); // 0 = off
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Cleanup dialog state
  const [isCleanupDialogOpen, setIsCleanupDialogOpen] = useState(false);

  // Request detail drawer state
  const [selectedRequest, setSelectedRequest] = useState<UsageRecord | null>(null);

  const [cleanupRetentionDays, setCleanupRetentionDays] = useState(90);
  const [cleanupDryRun, setCleanupDryRun] = useState(true);
  const [cleanupResult, setCleanupResult] = useState<any>(null);

  // Fetch filters and date history on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch initial data
        const [filtersData, dateRangeData] = await Promise.all([
          api.getUsageFilters(),
          api.getUsageDaily({ startDate: '2000-01-01', endDate: '2099-12-31' }),
        ]);
        setFilters(filtersData);

        // Build date history
        const history = (dateRangeData as any).data?.map((d: any) => ({
          date: d.date,
          requests: d.requests,
          tokens: d.totalTokens,
        })).sort((a: any, b: any) => b.date.localeCompare(a.date)) || [];

        // Always include today's date even if no data exists yet
        const todayDate = new Date();
        const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
        if (!history.find((d: any) => d.date === today)) {
          history.unshift({ date: today, requests: 0, tokens: 0 });
        }

        setDateHistory(history);
        setStartDate(today);
        setPluginEnabled(true);
        setPluginChecked(true);
      } catch (error) {
        console.error('Failed to fetch initial data:', error);
        setPluginEnabled(true);
        setPluginChecked(true);
      }
    };

    fetchData();
  }, []);

  // Fetch usage data
  const fetchUsage = useCallback(async () => {
    if (!startDate) return;

    setIsLoading(true);
    try {
      const [summaryData, recordsData, hourlyResponse, performanceResponse] = await Promise.all([
        api.getUsageSummary({ startDate, endDate: startDate, provider: provider && provider !== 'all' ? provider : undefined, model: model && model !== 'all' ? model : undefined }),
        api.getUsageRecords({ startDate, endDate: startDate, provider: provider && provider !== 'all' ? provider : undefined, model: model && model !== 'all' ? model : undefined, limit: pageSize, offset: (page - 1) * pageSize }),
        api.getUsageHourly({ startDate, endDate: startDate, provider: provider && provider !== 'all' ? provider : undefined, model: model && model !== 'all' ? model : undefined }),
        api.getUsagePerformance({ startDate, endDate: startDate, groupBy: 'hour', provider: provider && provider !== 'all' ? provider : undefined, model: model && model !== 'all' ? model : undefined }),
      ]);

      setSummary(summaryData);
      setRecords(recordsData.records);
      setRecordsTotal(recordsData.total);
      setHourlyData(hourlyResponse);
      setPerformanceData(performanceResponse);
    } catch (error) {
      console.error('Failed to fetch usage:', error);
      setToast({ message: t('usage.load_failed'), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  }, [startDate, provider, model, page, pageSize, t]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  // Auto-refresh effect
  useEffect(() => {
    if (autoRefreshInterval <= 0) return;

    const intervalId = setInterval(() => {
      setIsRefreshing(true);
      fetchUsage().finally(() => setIsRefreshing(false));
    }, autoRefreshInterval * 1000);

    return () => clearInterval(intervalId);
  }, [autoRefreshInterval, fetchUsage]);

  // Export handler
  const handleExport = async (format: 'json' | 'csv') => {
    try {
      const content = await api.exportUsage({
        format,
        startDate,
        endDate: startDate,
        provider: provider && provider !== 'all' ? provider : undefined,
        model: model && model !== 'all' ? model : undefined,
      });

      // Download file
      const blob = new Blob([content], { type: format === 'csv' ? 'text/csv' : 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const d = new Date();
      const localDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      a.download = `usage-export-${localDate}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setToast({ message: t('usage.export_success'), type: 'success' });
    } catch (error) {
      console.error('Failed to export:', error);
      setToast({ message: t('usage.export_failed'), type: 'error' });
    }
  };

  // Cleanup handler
  const handleCleanup = async () => {
    try {
      const result = await api.cleanupUsage({
        retentionDays: cleanupRetentionDays,
        dryRun: cleanupDryRun,
      });

      setCleanupResult(result);

      if (!cleanupDryRun && result.success) {
        setToast({ message: t('usage.cleanup_success', { count: result.deletedCount }), type: 'success' });
        setIsCleanupDialogOpen(false);
        fetchUsage();
      }
    } catch (error) {
      console.error('Failed to cleanup:', error);
      setToast({ message: t('usage.cleanup_failed'), type: 'error' });
    }
  };

  // Date selection from sidebar
  const handleDateSelect = (date: string) => {
    setStartDate(date);
    setProvider('');
    setModel('');
    setPage(1);
  };

  // Prepare stats data for table
  const statsData = useMemo(() => {
    if (!summary?.byModel) return [];
    return summary.byModel.map(m => ({
      provider: m.provider,
      model: Array.isArray(m.model) ? m.model.join(', ') : m.model,
      requests: m.requests,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      cacheCreationTokens: m.cacheCreationTokens,
      cacheReadTokens: m.cacheReadTokens,
      avgLatency: m.avgLatency,
      avgSpeed: m.avgSpeed,
      reasoningTokens: m.reasoningTokens,
    }));
  }, [summary]);

  const totalTokens = (summary?.totalInputTokens || 0) + (summary?.totalOutputTokens || 0);

  // Available providers for the selected date (from summary data)
  const availableProviders = useMemo(() => {
    if (summary?.byProvider) {
      return summary.byProvider.map(p => p.provider);
    }
    return filters?.providers || [];
  }, [summary, filters]);

  // Filter models based on selected provider, using date-filtered summary data
  const filteredModels = useMemo(() => {
    if (!provider || provider === 'all') {
      // When no provider selected, use all models from summary for this date
      if (summary?.byModel) {
        const models = summary.byModel.map(m => Array.isArray(m.model) ? m.model.join(', ') : m.model);
        return Array.from(new Set(models));
      }
      return filters?.models || [];
    }

    // Get models for the selected provider from summary data
    const providerData = summary?.byProvider?.find(p => p.provider === provider);
    if (providerData?.models) {
      const models = providerData.models.map(m => Array.isArray(m.model) ? m.model.join(', ') : m.model);
      return Array.from(new Set(models));
    }

    // Fallback to filters
    return filters?.models || [];
  }, [filters, provider, summary]);

  // Show loading state while checking plugin
  if (!pluginChecked) {
    return (
      <div className="h-screen bg-background font-sans flex items-center justify-center">
        <div className="text-muted-foreground">{t('usage.loading')}</div>
      </div>
    );
  }

  // Show disabled state if plugin is not enabled
  if (!pluginEnabled) {
    return (
      <div className="h-screen bg-background font-sans flex flex-col items-center justify-center space-y-6 p-8">
        <AlertCircle className="h-16 w-16 text-muted-foreground" />
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-semibold text-foreground">{t('usage.disabled_title')}</h2>
          <p className="text-muted-foreground max-w-md">
            {t('usage.disabled_description')}
          </p>
        </div>
        <div className="glass-panel p-6 rounded-lg max-w-lg shadow-xl">
          <p className="text-sm font-medium mb-2 text-primary">{t('usage.config_example')}</p>
          <pre className="text-xs bg-black/50 text-emerald-400 p-4 rounded-lg overflow-x-auto border border-white/5">
{`{
  "Plugins": [{
    "name": "usage-tracking",
    "enabled": true,
    "options": { "retentionDays": 90 }
  }]
}`}
          </pre>
        </div>
        <p className="text-xs text-muted-foreground">
          {t('usage.restart_hint')}
        </p>
      </div>
    );
  }

  if (isLoading && !summary) {
    return (
      <div className="h-screen bg-background font-sans flex items-center justify-center">
        <div className="text-muted-foreground flex flex-col items-center gap-4">
          <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          <span>{t('usage.loading')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background text-foreground font-sans flex">
      <AliQuotaCard />
      {/* Left Sidebar - Date History */}
      <DateSidebar
        dates={dateHistory}
        selectedDate={startDate}
        onSelect={handleDateSelect}
        onSelectToday={() => {
          const todayDate = new Date();
          const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
          handleDateSelect(today);
        }}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex h-16 items-center justify-between border-b border-border/40 glass-panel px-6 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center neon-glow">
              <BarChart3 className="h-5 w-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">{t('usage.title')}</h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Auto-refresh selector */}
            <div className="flex items-center gap-2 bg-slate-800/50 border border-white/5 rounded-lg px-3 py-1.5 shadow-inner">
              <Timer className="h-4 w-4 text-cyan-400" />
              <Select
                value={autoRefreshInterval.toString()}
                onValueChange={(v) => setAutoRefreshInterval(parseInt(v))}
              >
                <SelectTrigger className="w-24 border-0 bg-transparent focus:ring-0 text-sm text-foreground">
                  <SelectValue placeholder={t('usage.auto_refresh')} />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-white/10">
                  <SelectItem value="0" className="hover:bg-slate-800">{t('usage.auto_refresh_off')}</SelectItem>
                  <SelectItem value="5" className="hover:bg-slate-800">{t('usage.auto_refresh_5s')}</SelectItem>
                  <SelectItem value="10" className="hover:bg-slate-800">{t('usage.auto_refresh_10s')}</SelectItem>
                  <SelectItem value="30" className="hover:bg-slate-800">{t('usage.auto_refresh_30s')}</SelectItem>
                  <SelectItem value="60" className="hover:bg-slate-800">{t('usage.auto_refresh_1m')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setIsRefreshing(true); fetchUsage().finally(() => setIsRefreshing(false)); }} disabled={isRefreshing} className="gap-1.5 border-white/10 bg-slate-800/50 hover:bg-slate-700 hover:text-white transition-colors">
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? t('usage.refreshing') : t('usage.refresh')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport('csv')} className="gap-1.5 border-white/10 bg-slate-800/50 hover:bg-slate-700 hover:text-white transition-colors">
              <Download className="h-4 w-4" />
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport('json')} className="gap-1.5 border-white/10 bg-slate-800/50 hover:bg-slate-700 hover:text-white transition-colors">
              <Download className="h-4 w-4" />
              JSON
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsCleanupDialogOpen(true)} className="gap-1.5 border-white/10 bg-slate-800/50 hover:bg-red-500/20 hover:text-red-400 hover:border-red-500/30 transition-colors">
              <Trash2 className="h-4 w-4" />
              {t('usage.cleanup')}
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          {/* Filters */}
          <div className="mb-6 glass-panel rounded-2xl shadow-lg p-5">
            <div className="flex items-center gap-2 mb-4 text-cyan-400">
              <Filter className="h-4 w-4" />
              <span className="font-semibold text-sm uppercase tracking-wider">{t('usage.filters')}</span>
            </div>
            <div className="flex gap-4 flex-wrap">
              <div className="space-y-2">
                <Label className="text-xs font-medium text-slate-400">{t('usage.select_date')}</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setProvider('');
                    setModel('');
                    setPage(1);
                  }}
                  className="w-44 h-10 border-white/10 bg-slate-900/50 text-foreground focus:border-cyan-500 focus:ring-cyan-500/20 rounded-lg color-scheme-dark"
                  style={{ colorScheme: 'dark' }}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-slate-400">{t('usage.provider')}</Label>
                <Select value={provider} onValueChange={(v) => { setProvider(v); setPage(1); }}>
                  <SelectTrigger className="w-44 h-10 border-white/10 bg-slate-900/50 text-foreground focus:border-cyan-500 focus:ring-cyan-500/20 rounded-lg">
                    <SelectValue placeholder={t('usage.all_providers')} />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-white/10">
                    <SelectItem value="all" className="hover:bg-slate-800">{t('usage.all_providers')}</SelectItem>
                    {availableProviders.map((p) => (
                      <SelectItem key={p} value={p} className="hover:bg-slate-800">{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium text-slate-400">{t('usage.model')}</Label>
                <Select value={model} onValueChange={(v) => { setModel(v); setPage(1); }}>
                  <SelectTrigger className="w-44 h-10 border-white/10 bg-slate-900/50 text-foreground focus:border-cyan-500 focus:ring-cyan-500/20 rounded-lg">
                    <SelectValue placeholder={t('usage.all_models')} />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-white/10">
                    <SelectItem value="all" className="hover:bg-slate-800">{t('usage.all_models')}</SelectItem>
                    {filteredModels.map((m) => (
                      <SelectItem key={m} value={m} className="hover:bg-slate-800">{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {summary && summary.totalRequests > 0 ? (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-5 mb-6">
                {/* Total Requests Card */}
                <div className="relative overflow-hidden rounded-2xl glass-panel p-5 text-white hover:-translate-y-1 transition-transform duration-300 hover:neon-glow group border border-slate-700/50">
                  <div className="absolute right-3 top-3 opacity-20 text-cyan-400 group-hover:opacity-40 transition-opacity">
                    <Zap className="h-10 w-10" />
                  </div>
                  <div className="text-sm font-medium text-slate-400 mb-1">{t('usage.total_requests')}</div>
                  <div className="text-3xl font-bold mb-3 neon-text text-white">{formatNumber(summary.totalRequests)}</div>
                  <div className="flex gap-2">
                    <span className="inline-flex items-center rounded-full bg-cyan-500/20 px-2 py-0.5 text-xs font-medium text-cyan-300 border border-cyan-500/30">
                      {summary.successRequests} {t('usage.success')}
                    </span>
                    {summary.failedRequests > 0 && (
                      <span className="inline-flex items-center rounded-full bg-fuchsia-500/20 px-2 py-0.5 text-xs font-medium text-fuchsia-300 border border-fuchsia-500/30">
                        {summary.failedRequests} {t('usage.failed')}
                    </span>
                    )}
                  </div>
                </div>

                {/* Consumed Tokens Card */}
                <div className="relative overflow-hidden rounded-2xl glass-panel p-5 text-white hover:-translate-y-1 transition-transform duration-300 hover:shadow-[0_0_15px_rgba(217,70,239,0.3)] group border border-slate-700/50">
                  <div className="absolute right-3 top-3 opacity-20 text-fuchsia-400 group-hover:opacity-40 transition-opacity">
                    <Layers className="h-10 w-10" />
                  </div>
                  <div className="text-sm font-medium text-slate-400 mb-1">{t('usage.consumed_tokens')}</div>
                  <div className="text-3xl font-bold mb-3 text-white" style={{ textShadow: '0 0 10px rgba(217,70,239,0.5)' }}>{formatTokens(totalTokens)}</div>
                  <div className="flex items-center gap-3 text-xs text-slate-300">
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-fuchsia-400 shadow-[0_0_5px_rgba(217,70,239,0.8)]"></div>
                      <span>{t('usage.input')}: {formatTokens(summary.totalInputTokens)}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_5px_rgba(6,182,212,0.8)]"></div>
                      <span>{t('usage.output')}: {formatTokens(summary.totalOutputTokens)}</span>
                    </div>
                  </div>
                </div>

                {/* Avg Latency Card */}
                <div className="relative overflow-hidden rounded-2xl glass-panel p-5 text-white hover:-translate-y-1 transition-transform duration-300 hover:shadow-[0_0_15px_rgba(139,92,246,0.3)] group border border-slate-700/50">
                  <div className="absolute right-3 top-3 opacity-20 text-violet-400 group-hover:opacity-40 transition-opacity">
                    <Clock className="h-10 w-10" />
                  </div>
                  <div className="text-sm font-medium text-slate-400 mb-1">{t('usage.avg_latency')}</div>
                  <div className="text-3xl font-bold mb-3 text-white" style={{ textShadow: '0 0 10px rgba(139,92,246,0.5)' }}>
                    {summary.avgLatency ? (summary.avgLatency >= 1000 ? `${(summary.avgLatency / 1000).toFixed(2)}s` : `${Math.round(summary.avgLatency)}ms`) : '-'}
                  </div>
                  <div className="text-xs text-slate-300 flex items-center gap-1">
                    <Activity className="h-3 w-3 text-violet-400" />
                    {t('usage.avg_speed')}: {summary.avgSpeed ? formatTokens(summary.avgSpeed) : '-'}
                  </div>
                </div>

                {/* Cache Hit Ratio Card */}
                <div className="relative overflow-hidden rounded-2xl glass-panel p-5 text-white hover:-translate-y-1 transition-transform duration-300 hover:shadow-[0_0_15px_rgba(245,158,11,0.3)] group border border-slate-700/50">
                  <div className="absolute right-3 top-3 opacity-20 text-amber-400 group-hover:opacity-40 transition-opacity">
                    <TrendingUp className="h-10 w-10" />
                  </div>
                  <div className="text-sm font-medium text-slate-400 mb-1">{t('usage.cache_hit_ratio')}</div>
                  <div className="text-3xl font-bold mb-3 text-white" style={{ textShadow: '0 0 10px rgba(245,158,11,0.5)' }}>
                    {summary.cacheHitRatio ? `${(summary.cacheHitRatio * 100).toFixed(1)}%` : '-'}
                  </div>
                  <div className="text-xs text-slate-300 flex items-center gap-1">
                    <Database className="h-3 w-3 text-amber-400" />
                    {formatTokens(summary.totalCacheReadTokens)} / {formatTokens(totalTokens)}
                  </div>
                </div>
              </div>

              {/* Statistics Table */}
              <div className="mb-6 glass-panel rounded-2xl overflow-hidden shadow-lg border-white/5 border">
                <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2 bg-slate-800/30">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center border border-cyan-500/30">
                    <Zap className="h-4 w-4 text-cyan-400" />
                  </div>
                  <span className="font-semibold text-slate-200">{t('usage.by_provider_model')}</span>
                </div>
                <div className="p-5">
                  <StatsTable
                    data={statsData}
                    groupBy="provider"
                    loading={isLoading}
                  />
                </div>
              </div>

              {/* Performance Chart */}
              <div className="mb-6 glass-panel rounded-2xl overflow-hidden shadow-lg border-white/5 border">
                <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2 bg-slate-800/30">
                  <div className="w-8 h-8 rounded-lg bg-fuchsia-500/20 flex items-center justify-center border border-fuchsia-500/30">
                    <TrendingUp className="h-4 w-4 text-fuchsia-400" />
                  </div>
                  <span className="font-semibold text-slate-200">{t('usage.performance_chart')}</span>
                </div>
                <div className="p-5">
                  <PerformanceChart
                    data={performanceData}
                    providers={availableProviders}
                    loading={isLoading}
                  />
                </div>
              </div>

              {/* Hourly Breakdown */}
              <div className="mb-6 glass-panel rounded-2xl overflow-hidden shadow-lg border-white/5 border">
                <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2 bg-slate-800/30">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center border border-cyan-500/30">
                    <Clock className="h-4 w-4 text-cyan-400" />
                  </div>
                  <span className="font-semibold text-slate-200">{t('usage.hourly_breakdown')}</span>
                </div>
                <div className="p-5">
                  <HourlyTable
                    data={hourlyData}
                    detailedData={summary?.byDate?.flatMap(daily =>
                      daily.hourlyBreakdown.map(hourly => ({
                        hour: hourly.hour,
                        requests: hourly.requests,
                        inputTokens: hourly.inputTokens,
                        outputTokens: hourly.outputTokens,
                        cacheCreationTokens: hourly.cacheCreationTokens,
                        cacheReadTokens: hourly.cacheReadTokens,
                        provider: daily.provider,
                        model: Array.isArray(daily.model) ? daily.model.join(', ') : daily.model,
                        avgLatency: hourly.avgLatency,
                        avgSpeed: hourly.avgSpeed,
                        reasoningTokens: hourly.reasoningTokens,
                      }))
                    )}
                    loading={isLoading}
                    pageFilter={model && model !== 'all' ? 'model' : provider && provider !== 'all' ? 'provider' : 'none'}
                  />
                </div>
              </div>

              {/* Records Table */}
              <div className="glass-panel rounded-2xl overflow-hidden shadow-lg border-white/5 border">
                <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2 bg-slate-800/30">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                    <Layers className="h-4 w-4 text-indigo-400" />
                  </div>
                  <span className="font-semibold text-slate-200">{t('usage.request_records')}</span>
                </div>
                <div className="p-5">
                  <RecordsTable
                    records={records}
                    total={recordsTotal}
                    page={page}
                    pageSize={pageSize}
                    onPageChange={setPage}
                    onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
                    loading={isLoading}
                    onRowClick={setSelectedRequest}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="glass-panel rounded-2xl shadow-lg border-white/5 border py-16">
              <div className="flex flex-col items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-slate-800/50 border border-white/10 flex items-center justify-center mb-4">
                  <AlertCircle className="h-8 w-8 text-slate-400" />
                </div>
                <p className="text-slate-200 text-lg font-medium">{t('usage.no_data')}</p>
                <p className="text-slate-500 text-sm mt-1">{t('usage.no_data_hint')}</p>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Cleanup Dialog */}
      <Dialog open={isCleanupDialogOpen} onOpenChange={setIsCleanupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('usage.cleanup_title')}</DialogTitle>
            <DialogDescription>{t('usage.cleanup_description')}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('usage.retention_days')}</Label>
              <Input
                type="number"
                value={cleanupRetentionDays}
                onChange={(e) => setCleanupRetentionDays(parseInt(e.target.value) || 90)}
              />
              <p className="text-sm text-muted-foreground">{t('usage.retention_days_hint')}</p>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="dryRun"
                checked={cleanupDryRun}
                onChange={(e) => setCleanupDryRun(e.target.checked)}
                className="rounded"
              />
              <Label htmlFor="dryRun">{t('usage.dry_run')}</Label>
            </div>

            {cleanupResult && (
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="font-medium mb-2">
                  {cleanupDryRun ? t('usage.dry_run_result') : t('usage.cleanup_result')}
                </p>
                <p>{t('usage.records_deleted', { count: cleanupResult.deletedCount })}</p>
                <p>{t('usage.space_freed', { size: formatBytes(cleanupResult.freedBytes) })}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCleanupDialogOpen(false)}>
              {t('usage.cancel')}
            </Button>
            <Button onClick={handleCleanup}>
              {cleanupDryRun ? t('usage.preview') : t('usage.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {/* Request Detail Drawer */}
      <RequestDetailDrawer
        record={selectedRequest}
        onClose={() => setSelectedRequest(null)}
      />
    </div>
  );
}
