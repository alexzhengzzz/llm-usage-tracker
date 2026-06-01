import { useTranslation } from 'react-i18next';
import { Calendar, ChevronRight, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DateItem {
  date: string;
  requests: number;
  tokens: number;
}

interface DateSidebarProps {
  dates: DateItem[];
  selectedDate?: string;
  onSelect: (date: string) => void;
  onSelectToday: () => void;
}

export function DateSidebar({ dates, selectedDate, onSelect, onSelectToday }: DateSidebarProps) {
  const { t, i18n } = useTranslation();

  // Always compute today's date in local time
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  // Ensure today's date always appears in the list (even with 0 requests if not already present)
  const allDates: DateItem[] = [
    ...(dates.some(d => d.date === todayStr) ? [] : [{ date: todayStr, requests: 0, tokens: 0 }]),
    ...dates,
  ];

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

    if (dateStr === todayStr) return t('usage.today');
    if (dateStr === yesterdayStr) return t('usage.yesterday');

    return date.toLocaleDateString(i18n.language || 'zh-CN', {
      month: 'long',
      day: 'numeric',
    });
  };

  const formatDayOfWeek = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(i18n.language || 'zh-CN', { weekday: 'short' });
  };

  return (
    <div className="w-56 flex flex-col bg-slate-900/50 border-r border-slate-700/50 h-full backdrop-blur-md">
      {/* Header */}
      <div className="p-4 border-b border-slate-700/50 bg-slate-900/80">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/20 flex items-center justify-center border border-cyan-500/30 neon-glow">
            <BarChart3 className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="font-semibold text-slate-200">{t('usage.date_history')}</div>
        </div>
      </div>

      {/* Today button — always shown so user can quickly jump to today */}
      <div className="p-3 bg-slate-900/30">
        <Button
          variant="outline"
          size="sm"
          className="w-full border-slate-700/50 bg-slate-800/50 hover:bg-slate-700 hover:border-cyan-500/50 hover:text-cyan-400 transition-all text-slate-300"
          onClick={onSelectToday}
        >
          <Calendar className="w-4 h-4 mr-2" />
          {t('usage.today')}
        </Button>
      </div>

      {/* Date list */}
      <div className="flex-1 overflow-y-auto bg-slate-900/20 custom-scrollbar">
        <div className="p-2 space-y-1">
          {allDates.map((item) => {
            const isSelected = selectedDate === item.date;
            return (
              <button
                key={item.date}
                onClick={() => onSelect(item.date)}
                className={`
                  w-full text-left p-3 rounded-xl transition-all duration-200
                  flex items-center justify-between group
                  ${isSelected
                    ? 'bg-slate-800/80 border border-cyan-500/30 shadow-[0_0_15px_rgba(6,182,212,0.15)]'
                    : 'hover:bg-slate-800/50 border border-transparent hover:border-slate-700/50'
                  }
                `}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold text-sm ${isSelected ? 'text-cyan-400' : 'text-slate-300'}`}>
                      {formatDate(item.date)}
                    </span>
                    <span className={`text-xs ${isSelected ? 'text-cyan-500/70' : 'text-slate-500'}`}>
                      {formatDayOfWeek(item.date)}
                    </span>
                  </div>
                  <div className={`text-xs mt-1 ${isSelected ? 'text-slate-400' : 'text-slate-500'}`}>
                    <span className="font-medium">{(item.requests ?? 0).toLocaleString()}</span>
                    <span className="ml-1">{t('usage.requests')}</span>
                  </div>
                </div>
                <ChevronRight className={`
                  w-4 h-4 flex-shrink-0 transition-all duration-200
                  ${isSelected ? 'text-cyan-500 opacity-100 translate-x-0' : 'text-slate-600 opacity-0 -translate-x-1 group-hover:opacity-50 group-hover:translate-x-0'}
                `} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
