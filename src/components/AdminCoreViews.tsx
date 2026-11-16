import { useEffect, useState, type FormEvent } from 'react';
import { RefreshCw, Search, Plus, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { AdminSectionId, Lang } from '../i18n';
import { apiFetch, type HealthStatus, type MemoryItem, type Personality } from '../types';
import { UsageChart } from './UsageChart';

interface CoreProps {
  section: AdminSectionId;
  lang: Lang;
  health: HealthStatus | null;
  onToast: (msg: string, type?: 'info' | 'error') => void;
  onRefreshHealth: () => void;
}

export function AdminCoreViews({ section, lang, health, onToast, onRefreshHealth }: CoreProps) {
  const [overview, setOverview] = useState<{
    kpis: Record<string, number>;
    modelBreakdown: Array<{ model_id: string; requests: number; tokens: number; cost: number }>;
    recentRequests: Array<Record<string, unknown>>;
  } | null>(null);

  const [users, setUsers] = useState<Array<Record<string, unknown>>>([]);
  const [userSearch, setUserSearch] = useState('');

  const [conversations, setConversations] = useState<Array<Record<string, unknown>>>([]);
  const [selectedConvMsgs, setSelectedConvMsgs] = useState<Array<Record<string, unknown>>>([]);
  const [activeConvId, setActiveConvId] = useState<number | null>(null);

  const [models, setModels] = useState<Array<Record<string, unknown>>>([]);
  const [providers, setProviders] = useState<Array<Record<string, unknown>>>([]);
  const [routerSettings, setRouterSettings] = useState<Record<string, string>>({});
  const [syncingModels, setSyncingModels] = useState(false);

  const [personalities, setPersonalities] = useState<Personality[]>([]);
  const [newPers, setNewPers] = useState({
    code: '',
    name_fa: '',
    name_en: '',
    system_prompt: '',
    humor_level: 30,
    seriousness_level: 70,
    warmth_level: 65,
  });

  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [memUserFilter, setMemUserFilter] = useState<string>('');
  const [memQuery, setMemQuery] = useState('');
  const [newMem, setNewMem] = useState({ userId: 1, category: 'long_term', topicKey: '', content: '', importance: 7 });

  async function loadSectionData() {
    try {
      if (section === 'dashboard') {
        const res = await apiFetch<typeof overview>('/api/admin/overview');
        setOverview(res);
      } else if (section === 'users') {
        const res = await apiFetch<{ users: Array<Record<string, unknown>> }>(
          `/api/admin/users?q=${encodeURIComponent(userSearch)}`
        );
        setUsers(res.users);
      } else if (section === 'conversations') {
        const res = await apiFetch<{ conversations: Array<Record<string, unknown>> }>('/api/admin/conversations');
        setConversations(res.conversations);
      } else if (section === 'gemini_center' || section === 'model_registry' || section === 'ai_router') {
        const res = await apiFetch<{
          models: Array<Record<string, unknown>>;
          providers: Array<Record<string, unknown>>;
          settings: Array<{ key: string; value: string }>;
        }>('/api/admin/models');
        setModels(res.models);
        setProviders(res.providers);
        const map: Record<string, string> = {};
        for (const s of res.settings) map[s.key] = s.value;
        setRouterSettings(map);
      } else if (section === 'personality_studio') {
        const res = await apiFetch<{ personalities: Personality[] }>('/api/personalities');
        setPersonalities(res.personalities);
      } else if (section === 'memory_management') {
        const qs = new URLSearchParams();
        if (memUserFilter) qs.set('userId', memUserFilter);
        if (memQuery) qs.set('q', memQuery);
        const res = await apiFetch<{ memories: MemoryItem[] }>(`/api/admin/memories?${qs.toString()}`);
        setMemories(res.memories);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to load data', 'error');
    }
  }

  useEffect(() => {
    loadSectionData();
  }, [section]);

  if (section === 'dashboard') {
    const kpis = overview?.kpis;
    const cards = [
      { label: lang === 'fa' ? 'کل کاربران' : 'Total Users', value: kpis?.totalUsers ?? 0 },
      { label: lang === 'fa' ? 'کاربران فعال' : 'Active Users', value: kpis?.activeUsers ?? 0 },
      { label: lang === 'fa' ? 'تعداد درخواست‌ها' : 'AI Requests', value: kpis?.totalRequests ?? 0 },
      { label: lang === 'fa' ? 'کل پیام‌ها' : 'Messages', value: kpis?.totalMessages ?? 0 },
      { label: lang === 'fa' ? 'مصرف توکن' : 'Gemini Tokens', value: (kpis?.totalTokens ?? 0).toLocaleString() },
      {
        label: lang === 'fa' ? 'هزینه تخمینی (USD)' : 'Est. Cost (USD)',
        value: `$${Number(kpis?.estimatedCostUsd ?? 0).toFixed(4)}`,
      },
      { label: lang === 'fa' ? 'خطاهای ثبت‌شده' : 'Errors Logged', value: kpis?.errorCount ?? 0 },
    ];

    const serviceRows = [
      {
        name: 'PostgreSQL / SQLite Engine',
        ok: Boolean(health?.services.database.ok),
        detail: `${health?.services.database.tablesCount ?? 0} tables · ${health?.services.database.migrationsApplied ?? 0} migrations`,
      },
      {
        name: 'Google Gemini API',
        ok: Boolean(health?.services.gemini.configured),
        detail: health?.services.gemini.configured ? 'Connected (Server-side)' : 'Awaiting GEMINI_API_KEY',
      },
      {
        name: 'Telegram Bot Transport',
        ok: Boolean(health?.services.telegramBot.configured),
        detail: `${health?.services.telegramBot.mode || 'polling'} · ${health?.services.telegramBot.status || 'awaiting_token'}`,
      },
      {
        name: 'Redis Queue / Cache',
        ok: Boolean(health?.services.redis.configured),
        detail: health?.services.redis.configured ? 'Configured' : 'Local in-memory fallback active',
      },
      {
        name: 'Local AI (Ollama)',
        ok: Boolean(health?.services.localAi.enabled),
        detail: health?.services.localAi.enabled ? health.services.localAi.baseUrl : 'Optional profile disabled',
      },
    ];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {cards.map((c) => (
            <div
              key={c.label}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-4"
            >
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{c.label}</div>
              <div className="mt-2 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {c.value}
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {lang === 'fa' ? 'توزیع مصرف مدل‌های Gemini' : 'Model Token & Cost Breakdown'}
              </h3>
              <button
                type="button"
                onClick={loadSectionData}
                className="inline-flex items-center gap-1.5 text-xs text-[#2563EB] hover:underline"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{lang === 'fa' ? 'به‌روزرسانی' : 'Refresh'}</span>
              </button>
            </div>
            <UsageChart data={overview?.modelBreakdown || []} lang={lang} />
          </div>

          <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {lang === 'fa' ? 'وضعیت سرویس‌های زیرساخت' : 'Infrastructure Service Health'}
              </h3>
              <button
                type="button"
                onClick={onRefreshHealth}
                className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-200"
              >
                {lang === 'fa' ? 'بررسی مجدد' : 'Recheck'}
              </button>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {serviceRows.map((s) => (
                <div key={s.name} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    {s.ok ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                    )}
                    <span className="font-medium text-slate-800 dark:text-slate-200">{s.name}</span>
                  </div>
                  <span dir="ltr" className="font-mono text-slate-500 dark:text-slate-400 text-end">{s.detail}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">
            {lang === 'fa' ? 'آخرین درخواست‌های هوش مصنوعی' : 'Recent AI Requests'}
          </h3>
          {!overview?.recentRequests?.length ? (
            <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              {lang === 'fa'
                ? 'هنوز درخواستی از ربات یا مینی‌اپ ثبت نشده است.'
                : 'No live AI requests recorded yet.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="py-2 text-start">{lang === 'fa' ? 'کاربر' : 'User'}</th>
                    <th className="py-2 text-start">Model</th>
                    <th className="py-2 text-start">{lang === 'fa' ? 'وضعیت' : 'Status'}</th>
                    <th className="py-2 text-end">{lang === 'fa' ? 'زمان پاسخ' : 'Latency'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
                  {overview.recentRequests.map((req) => (
                    <tr key={String(req.id)}>
                      <td className="py-2">{String(req.user_name || `User #${req.user_id}`)}</td>
                      <td className="py-2 font-mono">{String(req.model_id)}</td>
                      <td className="py-2">
                        <span className={req.status === 'success' ? 'text-emerald-500' : 'text-red-500'}>
                          {String(req.status)}
                        </span>
                      </td>
                      <td className="py-2 text-end font-mono tabular-nums">
                        <span dir="ltr">{String(req.latency_ms)} ms</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (section === 'users') {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {lang === 'fa' ? 'مدیریت کاربران و سهمیه‌ها' : 'Users & Quota Control'}
          </h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              loadSectionData();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="search"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder={lang === 'fa' ? 'جستجوی کاربر...' : 'Search users...'}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-1.5 text-xs"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-medium"
            >
              <Search className="w-3.5 h-3.5" />
              <span>{lang === 'fa' ? 'جستجو' : 'Search'}</span>
            </button>
          </form>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <th className="py-2.5 text-start font-medium">{lang === 'fa' ? 'کاربر' : 'User'}</th>
                <th className="py-2.5 text-start font-medium">{lang === 'fa' ? 'تلگرام' : 'Telegram'}</th>
                <th className="py-2.5 text-start font-medium">{lang === 'fa' ? 'وضعیت' : 'Status'}</th>
                <th className="py-2.5 text-end font-medium">{lang === 'fa' ? 'مصرف توکن' : 'Tokens'}</th>
                <th className="py-2.5 text-end font-medium">{lang === 'fa' ? 'سهمیه روزانه' : 'Daily Cap'}</th>
                <th className="py-2.5 text-end font-medium">{lang === 'fa' ? 'عملیات' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
              {users.map((u) => (
                <tr key={String(u.id)} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                  <td className="py-2.5">
                    <div className="font-medium text-slate-900 dark:text-slate-100">{String(u.display_name)}</div>
                    <div className="text-[11px] font-mono text-slate-500">@{String(u.username)} · {String(u.language)}</div>
                  </td>
                  <td className="py-2.5 font-mono text-slate-600 dark:text-slate-400">{String(u.telegram_id || '-')}</td>
                  <td className="py-2.5">
                    <span className={u.status === 'active' ? 'text-emerald-500' : u.status === 'banned' ? 'text-red-500' : 'text-amber-500'}>
                      {String(u.status)}
                    </span>
                  </td>
                  <td className="py-2.5 text-end font-mono tabular-nums">
                    {Number(u.total_tokens || 0).toLocaleString()}
                  </td>
                  <td className="py-2.5 text-end font-mono tabular-nums">
                    {Number(u.daily_token_limit || 0).toLocaleString()}
                  </td>
                  <td className="py-2.5 text-end space-x-2 space-x-reverse">
                    <button
                      type="button"
                      onClick={async () => {
                        const next = u.status === 'active' ? 'banned' : 'active';
                        await apiFetch(`/api/admin/users/${u.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ status: next }),
                        });
                        onToast(lang === 'fa' ? 'وضعیت کاربر تغییر یافت' : 'User status updated');
                        loadSectionData();
                      }}
                      className="px-2.5 py-1 rounded border border-slate-300 dark:border-slate-700 hover:border-[#D4AF37]"
                    >
                      {u.status === 'active' ? (lang === 'fa' ? 'مسدود' : 'Ban') : lang === 'fa' ? 'فعالسازی' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (section === 'conversations') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-4 space-y-2">
          <h3 className="text-sm font-semibold mb-3">{lang === 'fa' ? 'فهرست گفتگوها' : 'Conversations'}</h3>
          {conversations.map((c) => (
            <button
              key={String(c.id)}
              type="button"
              onClick={async () => {
                setActiveConvId(Number(c.id));
                const res = await apiFetch<{ messages: Array<Record<string, unknown>> }>(
                  `/api/admin/conversations/${c.id}/messages`
                );
                setSelectedConvMsgs(res.messages);
              }}
              className={`w-full text-start p-3 rounded-lg border text-xs transition-colors ${
                activeConvId === Number(c.id)
                  ? 'border-[#2563EB] bg-[#2563EB]/10'
                  : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
              }`}
            >
              <div className="font-medium text-slate-900 dark:text-slate-100">{String(c.title)}</div>
              <div className="text-[11px] text-slate-500 mt-1">
                {String(c.user_name)} · {String(c.personality_code)} · {String(c.message_count)} msgs
              </div>
            </button>
          ))}
        </div>
        <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5 space-y-3">
          <h3 className="text-sm font-semibold">{lang === 'fa' ? 'متن گفتگو' : 'Conversation Transcript'}</h3>
          {selectedConvMsgs.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              {lang === 'fa' ? 'یک گفتگو را برای مشاهده پیام‌ها انتخاب کنید.' : 'Select a conversation to inspect messages.'}
            </div>
          ) : (
            <div className="space-y-3 max-h-[460px] overflow-y-auto">
              {selectedConvMsgs.map((m) => (
                <div key={String(m.id)} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-xs">
                  <div className="font-mono text-[11px] text-[#D4AF37] mb-1">
                    {String(m.role)} {m.model_used ? `· ${String(m.model_used)}` : ''} · {String(m.tokens_count)} tok
                  </div>
                  <div className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{String(m.content)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (section === 'gemini_center' || section === 'model_registry') {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {section === 'gemini_center'
                ? lang === 'fa'
                  ? 'مرکز کنترل اتصال Google Gemini'
                  : 'Google Gemini Integration Center'
                : lang === 'fa'
                ? 'رجیستری پویای مدل‌های هوش مصنوعی'
                : 'Dynamic Model Registry'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {lang === 'fa'
                ? 'بررسی دسترسی زنده مدل‌ها از API رسمی و مدیریت زنجیره Fallback'
                : 'Live model capability verification from Gemini API and fallback chain'}
            </p>
          </div>
          <button
            type="button"
            disabled={syncingModels}
            onClick={async () => {
              setSyncingModels(true);
              try {
                const res = await apiFetch<{ synced: boolean; discoveredCount: number; error?: string }>(
                  '/api/admin/models/sync',
                  { method: 'POST' }
                );
                if (res.synced) {
                  onToast(
                    lang === 'fa'
                      ? `${res.discoveredCount} مدل زنده از Gemini همگام‌سازی شد`
                      : `Synced ${res.discoveredCount} live models from Gemini`
                  );
                } else {
                  onToast(res.error || 'Sync failed', 'error');
                }
                loadSectionData();
                onRefreshHealth();
              } finally {
                setSyncingModels(false);
              }
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#D4AF37] text-[#07090F] text-xs font-semibold hover:bg-[#E5C158] disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingModels ? 'animate-spin' : ''}`} />
            <span>{lang === 'fa' ? 'همگام‌سازی زنده با Gemini API' : 'Sync Live Gemini Models'}</span>
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 text-start">Model ID</th>
                <th className="py-2 text-start">{lang === 'fa' ? 'نقش' : 'Task'}</th>
                <th className="py-2 text-start">{lang === 'fa' ? 'قابلیت‌ها' : 'Capabilities'}</th>
                <th className="py-2 text-start">{lang === 'fa' ? 'جایگزین' : 'Fallback'}</th>
                <th className="py-2 text-end">{lang === 'fa' ? 'هزینه / 1M' : 'Cost / 1M'}</th>
                <th className="py-2 text-end">{lang === 'fa' ? 'وضعیت' : 'Active'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/70">
              {models.map((m) => (
                <tr key={String(m.id)}>
                  <td className="py-2.5 font-mono font-medium text-slate-900 dark:text-slate-100">{String(m.model_id)}</td>
                  <td className="py-2.5 font-mono text-slate-500">{String(m.task_category)}</td>
                  <td className="py-2.5 text-slate-600 dark:text-slate-400">
                    {[
                      m.supports_vision ? 'Vision' : null,
                      m.supports_audio ? 'Audio' : null,
                      m.supports_tools ? 'Tools' : null,
                      m.supports_live ? 'Live' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Text'}
                  </td>
                  <td className="py-2.5 font-mono text-slate-500">{String(m.fallback_model_id || '-')}</td>
                  <td className="py-2.5 text-end font-mono tabular-nums">
                    ${Number(m.input_cost_per_1m).toFixed(3)} / ${Number(m.output_cost_per_1m).toFixed(2)}
                  </td>
                  <td className="py-2.5 text-end">
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/admin/models/${m.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ is_active: m.is_active ? 0 : 1 }),
                        });
                        loadSectionData();
                      }}
                      className={`px-2.5 py-1 rounded border text-xs ${
                        m.is_active
                          ? 'border-emerald-500/40 text-emerald-500'
                          : 'border-slate-500/40 text-slate-400'
                      }`}
                    >
                      {m.is_active ? 'Active' : 'Disabled'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (section === 'ai_router') {
    const taskRows: Array<[string, string, string]> = [
      ['default_chat_model', 'مکالمه عمومی', 'General Conversation'],
      ['reasoning_model', 'تحلیل و استدلال', 'Reasoning & Coding'],
      ['deep_reasoning_model', 'استدلال عمیق و ممیزی', 'Deep Reasoning'],
      ['lite_model', 'سبک و اقتصادی', 'Lite & Economy'],
      ['vision_model', 'تحلیل تصویر و سند', 'Vision & Multimodal'],
      ['audio_model', 'پردازش و رونویسی صوت', 'Audio Transcription'],
      ['live_model', 'صوت زنده (Live Voice)', 'Live Voice'],
      ['tts_model', 'تولید گفتار (TTS)', 'Text-to-Speech'],
    ];
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{lang === 'fa' ? 'مسیریاب هوشمند وظایف هوش مصنوعی' : 'AI Task Router & Fallback'}</h3>
          <span className="text-xs text-slate-500">
            Providers: {providers.map((p) => `${String(p.name)} (${String(p.status)})`).join(' · ')}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {taskRows.map(([key, faLabel, enLabel]) => (
            <div key={key}>
              <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1.5">
                {lang === 'fa' ? faLabel : enLabel}
              </label>
              <select
                value={routerSettings[key] || ''}
                onChange={(e) => setRouterSettings((s) => ({ ...s, [key]: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 text-xs font-mono"
              >
                {models.map((m) => (
                  <option key={String(m.model_id)} value={String(m.model_id)}>
                    {String(m.model_id)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-800">
          <label className="inline-flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={routerSettings.local_ai_enabled === 'true'}
              onChange={(e) =>
                setRouterSettings((s) => ({ ...s, local_ai_enabled: e.target.checked ? 'true' : 'false' }))
              }
            />
            <span>{lang === 'fa' ? 'فعال‌سازی موتور پشتیبان Local AI (Ollama/GGUF)' : 'Enable Local AI Fallback (Ollama/GGUF)'}</span>
          </label>
          <button
            type="button"
            onClick={async () => {
              await apiFetch('/api/admin/router', {
                method: 'PATCH',
                body: JSON.stringify(routerSettings),
              });
              onToast(lang === 'fa' ? 'مسیریابی مدل‌ها ذخیره شد' : 'AI Router saved');
            }}
            className="px-4 py-2 rounded-lg bg-[#D4AF37] text-[#07090F] text-xs font-semibold"
          >
            {lang === 'fa' ? 'ذخیره مسیریابی' : 'Save Routing'}
          </button>
        </div>
      </div>
    );
  }

  if (section === 'personality_studio') {
    async function handleCreatePers(e: FormEvent) {
      e.preventDefault();
      try {
        await apiFetch('/api/admin/personalities', {
          method: 'POST',
          body: JSON.stringify(newPers),
        });
        setNewPers({ code: '', name_fa: '', name_en: '', system_prompt: '', humor_level: 30, seriousness_level: 70, warmth_level: 65 });
        loadSectionData();
        onToast(lang === 'fa' ? 'شخصیت جدید ساخته شد' : 'Custom personality created');
      } catch (err) {
        onToast(err instanceof Error ? err.message : 'Creation failed', 'error');
      }
    }

    return (
      <div className="space-y-6">
        <form
          onSubmit={handleCreatePers}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5 space-y-4"
        >
          <h3 className="text-sm font-semibold">{lang === 'fa' ? 'ساخت شخصیت اختصاصی جدید' : 'Create Custom Personality'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="text"
              required
              placeholder="CODE (e.g. MENTOR)"
              value={newPers.code}
              onChange={(e) => setNewPers((p) => ({ ...p, code: e.target.value }))}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 text-xs font-mono"
            />
            <input
              type="text"
              required
              placeholder="نام فارسی"
              value={newPers.name_fa}
              onChange={(e) => setNewPers((p) => ({ ...p, name_fa: e.target.value }))}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 text-xs"
            />
            <input
              type="text"
              required
              placeholder="English Name"
              value={newPers.name_en}
              onChange={(e) => setNewPers((p) => ({ ...p, name_en: e.target.value }))}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 text-xs"
            />
          </div>
          <textarea
            required
            rows={2}
            placeholder={lang === 'fa' ? 'System Prompt و لحن رفتاری...' : 'System prompt & behavioral directives...'}
            value={newPers.system_prompt}
            onChange={(e) => setNewPers((p) => ({ ...p, system_prompt: e.target.value }))}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 text-xs"
          />
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2">
                <span>{lang === 'fa' ? 'شوخ‌طبعی' : 'Humor'}: {newPers.humor_level}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={newPers.humor_level}
                  onChange={(e) => setNewPers((p) => ({ ...p, humor_level: Number(e.target.value) }))}
                />
              </label>
              <label className="flex items-center gap-2">
                <span>{lang === 'fa' ? 'جدیت' : 'Seriousness'}: {newPers.seriousness_level}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={newPers.seriousness_level}
                  onChange={(e) => setNewPers((p) => ({ ...p, seriousness_level: Number(e.target.value) }))}
                />
              </label>
              <label className="flex items-center gap-2">
                <span>{lang === 'fa' ? 'صمیمیت' : 'Warmth'}: {newPers.warmth_level}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={newPers.warmth_level}
                  onChange={(e) => setNewPers((p) => ({ ...p, warmth_level: Number(e.target.value) }))}
                />
              </label>
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#D4AF37] text-[#07090F] font-semibold"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{lang === 'fa' ? 'افزودن شخصیت' : 'Add Personality'}</span>
            </button>
          </div>
        </form>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {personalities.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-4 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {lang === 'fa' ? p.name_fa : p.name_en}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500">
                    {p.code} · {p.tone}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/admin/personalities/${p.id}`, {
                      method: 'PATCH',
                      body: JSON.stringify({ is_active: p.is_active ? 0 : 1 }),
                    });
                    loadSectionData();
                  }}
                  className={`px-2.5 py-1 rounded border text-xs ${
                    p.is_active ? 'border-emerald-500/40 text-emerald-500' : 'border-slate-500/40 text-slate-400'
                  }`}
                >
                  {p.is_active ? (lang === 'fa' ? 'فعال' : 'Active') : lang === 'fa' ? 'غیرفعال' : 'Off'}
                </button>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                {lang === 'fa' ? p.description_fa || p.system_prompt : p.description_en || p.system_prompt}
              </p>
              <div className="text-[11px] font-mono tabular-nums text-slate-500">
                humor {p.humor_level} · serious {p.seriousness_level} · warmth {p.warmth_level}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // memory_management
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{lang === 'fa' ? 'موتور حافظه بلندمدت (جستجوی معنایی و ایزوله‌سازی)' : 'Long-Term Memory Engine'}</h3>
          <div className="flex items-center gap-2">
            <select
              value={memUserFilter}
              onChange={(e) => setMemUserFilter(e.target.value)}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-1.5 text-xs"
            >
              <option value="">{lang === 'fa' ? 'همه کاربران' : 'All Users'}</option>
              <option value="1">سارا رحیمی (#1)</option>
              <option value="2">Alex Mercer (#2)</option>
              <option value="3">امید کریمی (#3)</option>
            </select>
            <input
              type="text"
              value={memQuery}
              onChange={(e) => setMemQuery(e.target.value)}
              placeholder={lang === 'fa' ? 'جستجوی معنایی...' : 'Semantic search...'}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-1.5 text-xs"
            />
            <button
              type="button"
              onClick={loadSectionData}
              className="px-3 py-1.5 rounded-lg bg-[#2563EB] text-white text-xs font-medium"
            >
              {lang === 'fa' ? 'اعمال فیلتر' : 'Filter'}
            </button>
          </div>
        </div>

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await apiFetch('/api/admin/memories', { method: 'POST', body: JSON.stringify(newMem) });
            setNewMem((m) => ({ ...m, topicKey: '', content: '' }));
            loadSectionData();
            onToast(lang === 'fa' ? 'حافظه ثبت شد' : 'Memory saved');
          }}
          className="grid grid-cols-1 md:grid-cols-12 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800"
        >
          <select
            value={newMem.userId}
            onChange={(e) => setNewMem((m) => ({ ...m, userId: Number(e.target.value) }))}
            className="md:col-span-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-2.5 py-2 text-xs"
          >
            <option value={1}>User #1</option>
            <option value={2}>User #2</option>
            <option value={3}>User #3</option>
          </select>
          <input
            type="text"
            placeholder="topic_key"
            value={newMem.topicKey}
            onChange={(e) => setNewMem((m) => ({ ...m, topicKey: e.target.value }))}
            className="md:col-span-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-2.5 py-2 text-xs"
          />
          <input
            type="text"
            required
            placeholder={lang === 'fa' ? 'محتوای حافظه...' : 'Memory content...'}
            value={newMem.content}
            onChange={(e) => setNewMem((m) => ({ ...m, content: e.target.value }))}
            className="md:col-span-6 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 text-xs"
          />
          <button type="submit" className="md:col-span-2 rounded-lg bg-[#D4AF37] text-[#07090F] text-xs font-semibold">
            {lang === 'fa' ? 'ثبت حافظه' : 'Add Memory'}
          </button>
        </form>
      </div>

      <div className="space-y-2">
        {memories.map((mem) => (
          <div
            key={mem.id}
            className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-4"
          >
            <div className="space-y-1">
              <div className="text-[11px] font-mono text-slate-500">
                User #{mem.user_id} {mem.user_name ? `(${mem.user_name})` : ''} · {mem.category} · {mem.topic_key} · importance {mem.importance}
                {mem.similarity !== undefined ? ` · score ${mem.similarity}` : ''}
              </div>
              <div className="text-xs text-slate-900 dark:text-slate-100">{mem.content}</div>
            </div>
            <button
              type="button"
              onClick={async () => {
                await apiFetch(`/api/admin/memories/${mem.id}`, { method: 'DELETE' });
                loadSectionData();
              }}
              aria-label={`Delete memory ${mem.id}`}
              className="p-1.5 text-slate-400 hover:text-red-500"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
