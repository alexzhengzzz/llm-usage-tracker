import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface AliQuota {
  used: number;
  requests: number;
  limit: number;
  threshold: number;
  remaining: number;
  percent: number;
  breaker: boolean;
  blocked: boolean;
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function AliQuotaCard() {
  const [quota, setQuota] = useState<AliQuota | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await api.getAliQuota();
        if (active) setQuota(next);
      } catch {
        // Quota display is supplementary; do not interrupt the dashboard.
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!quota) return null;

  const color = quota.blocked ? 'text-red-400' : quota.percent >= 70 ? 'text-amber-400' : 'text-emerald-400';
  const barColor = quota.blocked ? 'bg-red-400' : quota.percent >= 70 ? 'bg-amber-400' : 'bg-emerald-400';

  const toggle = async () => {
    setBusy(true);
    try {
      const result = await api.toggleAliBreaker();
      setQuota(current => current ? { ...current, breaker: result.breaker, blocked: current.used >= current.threshold && result.breaker } : current);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed bottom-3 right-3 z-[9999] rounded-xl border border-white/10 bg-slate-950/90 px-4 py-3 text-xs text-slate-200 shadow-2xl backdrop-blur-md min-w-64">
      <div className="flex items-center justify-between gap-3">
        <span className={`font-semibold tracking-wide ${color}`}>ALI 当日配额</span>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          aria-pressed={quota.breaker}
          className={`h-5 w-9 rounded-full border transition ${quota.breaker ? 'bg-emerald-500 border-emerald-400' : 'bg-slate-700 border-slate-500'}`}
          title={quota.breaker ? '熔断已启用，点击关闭' : '熔断已关闭，点击启用'}
        >
          <span className={`block h-4 w-4 rounded-full bg-white transition ${quota.breaker ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>
      <div className="mt-1 font-mono">{formatNumber(quota.used)} / {formatNumber(quota.limit)} token</div>
      <div className="my-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${Math.min(100, quota.percent)}%` }} />
      </div>
      <div className="text-[11px] text-slate-400">
        {quota.percent.toFixed(2)}% · 剩余 {formatNumber(quota.remaining)} · {quota.requests} 请求 · {quota.blocked ? '已熔断' : quota.breaker ? '正常' : '熔断关闭'}
      </div>
    </div>
  );
}
