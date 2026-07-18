import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, Clock, Zap, Server, Cpu, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { UsageRecord } from '@/types/usage';
export type { UsageRecord };

// Local format tokens function
function formatTokens(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

interface RecordsTableProps {
  records: UsageRecord[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  loading?: boolean;
  onRowClick?: (record: UsageRecord) => void;
}

export function RecordsTable({
  records,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  loading,
  onRowClick,
}: RecordsTableProps) {
  const { t } = useTranslation();
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const totalPages = Math.ceil(total / pageSize);

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  };

  const formatLatency = (ms?: number) => {
    if (!ms) return '-';
    if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
    return `${Math.round(ms)}ms`;
  };

  const formatSpeed = (record: UsageRecord) => {
    // speed = outputTokens / outputDuration (where outputDuration = duration - timeToFirstToken)
    const outputDuration = (record.duration || 0) - (record.timeToFirstToken || 0);
    if (!record.duration || outputDuration <= 0) return '-';
    const tokensPerSec = (record.outputTokens || 0) / (outputDuration / 1000);
    if (tokensPerSec >= 1000) return `${(tokensPerSec / 1000).toFixed(1)}K/s`;
    return `${Math.round(tokensPerSec)}/s`;
  };

  // cacheReadInputTokens comes from LLM API's usage.cache_read_input_tokens field
  const formatCacheHit = (cacheRead?: number) => {
    if (!cacheRead || cacheRead === 0) return '-';
    return formatTokens(cacheRead);
  };

  const formatTotalTokens = (input: number, output: number) => {
    const total = input + output;
    return formatTokens(total);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Table */}
      <div className="overflow-x-auto -mx-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-700/50 bg-slate-800/30">
              <th className="py-3 px-2 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <div className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  {t('usage.time')}
                </div>
              </th>
              <th className="py-3 px-2 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <div className="flex items-center gap-1">
                  <Server className="w-3.5 h-3.5 text-indigo-400" />
                  {t('usage.provider')}
                </div>
              </th>
              <th className="py-3 px-2 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <div className="flex items-center gap-1">
                  <Cpu className="w-3.5 h-3.5 text-fuchsia-400" />
                  {t('usage.model')}
                </div>
              </th>
              <th className="py-3 px-2 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('usage.input_tokens')}</th>
              <th className="py-3 px-2 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('usage.cache_hit')}</th>
              <th className="py-3 px-2 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('usage.reasoning')}</th>
              <th className="py-3 px-2 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('usage.output_tokens')}</th>
              <th className="py-3 px-2 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('usage.consumed_tokens')}</th>
              <th className="py-3 px-2 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider" title={t('usage.codex_metric_hint')}>
                <span className="cursor-help border-b border-dotted border-slate-500">{t('usage.ttft')}</span>
              </th>
              <th className="py-3 px-2 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider" title={t('usage.codex_metric_hint')}>
                <span className="cursor-help border-b border-dotted border-slate-500">{t('usage.output_duration')}</span>
              </th>
              <th className="py-3 px-2 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">
                <div className="flex items-center gap-1 justify-end" title={t('usage.codex_metric_hint')}>
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  <span className="cursor-help border-b border-dotted border-slate-500">{t('usage.speed')}</span>
                </div>
              </th>
              <th className="py-3 px-2 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('usage.status')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/30">
            {records.map((record) => (
              <React.Fragment key={record.id}>
                <tr
                  className="group hover:bg-slate-800/60 transition-colors cursor-pointer"
                  onClick={() => {
                    onRowClick?.(record);
                    setExpandedRow(expandedRow === record.id ? null : record.id);
                  }}
                >
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center border border-slate-700/50">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                      </div>
                      <span className="font-mono text-xs text-slate-300">{formatTime(record.timestamp)}</span>
                    </div>
                  </td>
                  <td className="py-3 px-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                        <Server className="w-3.5 h-3.5 text-indigo-400" />
                      </div>
                      <span className="text-slate-200 font-medium">{record.provider}</span>
                    </div>
                  </td>
                  <td className="py-3 px-2">
                    <span className="text-slate-400 text-xs truncate max-w-32 block group-hover:text-cyan-300 transition-colors">
                      {Array.isArray(record.model) ? record.model.join(', ') : record.model}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-cyan-300">{formatTokens(record.inputTokens)}</td>
                  <td className="py-3 px-2 text-right font-mono text-xs text-emerald-400/80">{formatCacheHit(record.cacheReadInputTokens)}</td>
                  <td className="py-3 px-2 text-right">
                    <span className={(record.reasoningTokens ?? 0) > 0 ? 'text-amber-400 font-medium' : 'text-slate-500'}>
                      {(record.reasoningTokens ?? 0) > 0 ? formatTokens(record.reasoningTokens!) : '-'}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-right font-mono text-fuchsia-300">{formatTokens(record.outputTokens)}</td>
                  <td className="py-3 px-2 text-right font-mono">
                    <span className="font-semibold text-slate-100">{formatTotalTokens(record.inputTokens, record.outputTokens)}</span>
                  </td>
                  <td className="py-3 px-2 text-right">
                    <span className={record.timeToFirstToken && record.timeToFirstToken > 1000 ? 'text-amber-400 font-medium' : 'text-slate-300'}>
                      {formatLatency(record.timeToFirstToken)}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-right text-slate-400">
                    {formatLatency((record.duration || 0) - (record.timeToFirstToken || 0))}
                  </td>
                  <td className="py-3 px-2 text-right">
                    <span className={(() => {
                      const outputDuration = (record.duration || 0) - (record.timeToFirstToken || 0);
                      return outputDuration > 0 && record.outputTokens / (outputDuration / 1000) < 10;
                    })() ? 'text-red-400 font-medium' : 'text-emerald-400 font-medium'}>
                      {formatSpeed(record)}
                    </span>
                  </td>
                  <td className="py-3 px-2 text-center">
                    {record.success ? (
                      <div className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto border border-emerald-500/20">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      </div>
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-red-500/10 flex items-center justify-center mx-auto border border-red-500/20">
                        <XCircle className="w-4 h-4 text-red-400" />
                      </div>
                    )}
                  </td>
                </tr>

                {/* Expanded row with error message */}
                {expandedRow === record.id && record.errorMessage && (
                  <tr className="bg-red-500/10 border-l-2 border-l-red-500">
                    <td colSpan={12} className="py-3 px-4">
                      <div className="flex items-start gap-2">
                        <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-red-400 text-xs font-bold">!</span>
                        </div>
                        <div>
                          <span className="font-semibold text-red-400 text-sm">{t('usage.error')}</span>
                          <pre className="mt-1 text-xs text-red-300/80 whitespace-pre-wrap break-all bg-slate-900/50 p-3 rounded-md">{record.errorMessage}</pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-700/50">
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span>{t('usage.showing')}</span>
          <span className="font-semibold text-slate-200">{((page - 1) * pageSize) + 1}</span>
          <span>{t('usage.to')}</span>
          <span className="font-semibold text-slate-200">{Math.min(page * pageSize, total)}</span>
          <span>{t('usage.of')}</span>
          <span className="font-semibold text-slate-200">{total}</span>
          <span>{t('usage.records')}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Page size selector */}
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-9 px-3 text-sm border border-slate-700/50 rounded-lg bg-slate-800 text-slate-200 focus:border-cyan-500 focus:ring-cyan-500/20"
          >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>

          {/* Navigation buttons */}
          <div className="flex items-center gap-1 bg-slate-800/50 rounded-lg p-1 border border-slate-700/50">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="h-8 w-8 p-0 hover:bg-slate-700 hover:text-cyan-400 disabled:opacity-50 text-slate-300"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            <span className="text-sm px-3 font-medium text-slate-300">
              {t('usage.page')} {page} {t('usage.of')} {totalPages}
            </span>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="h-8 w-8 p-0 hover:bg-slate-700 hover:text-cyan-400 disabled:opacity-50 text-slate-300"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
