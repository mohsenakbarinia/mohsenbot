import type { Lang } from '../i18n';

interface ModelUsageRow {
  model_id: string;
  requests: number;
  tokens: number;
  cost: number;
}

export function UsageChart({ data, lang }: { data: ModelUsageRow[]; lang: Lang }) {
  if (!data || data.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
        {lang === 'fa' ? 'هنوز مصرف مدلی ثبت نشده است.' : 'No model usage recorded yet.'}
      </div>
    );
  }

  const maxTokens = Math.max(...data.map((d) => d.tokens), 1);

  return (
    <div className="space-y-3" data-testid="usage-chart">
      {data.map((row) => {
        const pct = Math.max(4, Math.round((row.tokens / maxTokens) * 100));
        return (
          <div key={row.model_id} className="space-y-1.5">
            <div className="flex items-center justify-between gap-4 text-xs">
              <span className="font-mono font-medium text-slate-800 dark:text-slate-200 truncate">
                {row.model_id}
              </span>
              <span dir="ltr" className="font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                {row.tokens.toLocaleString()} tok · ${Number(row.cost || 0).toFixed(4)}
              </span>
            </div>
            <div className="h-2.5 w-full rounded-sm bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[#2563EB] to-[#D4AF37] transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
