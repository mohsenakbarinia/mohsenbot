import { useEffect, useState } from 'react';
import { Download, Volume2 } from 'lucide-react';
import type { AdminSectionId, Lang } from '../i18n';
import { apiFetch } from '../types';

interface OpsProps {
  section: AdminSectionId;
  lang: Lang;
  onToast: (msg: string, type?: 'info' | 'error') => void;
}

export function AdminOpsViews({ section, lang, onToast }: OpsProps) {
  const [voiceData, setVoiceData] = useState<{
    voiceSessions: Array<Record<string, unknown>>;
    liveSessions: Array<Record<string, unknown>>;
    settings: Array<{ key: string; value: string }>;
  } | null>(null);
  const [ttsSampleText, setTtsSampleText] = useState('سلام! دستیار هوشمند نکسورا آماده پاسخگویی است.');
  const [ttsAudioSrc, setTtsAudioSrc] = useState('');

  const [analytics, setAnalytics] = useState<{
    byModel: Array<Record<string, unknown>>;
    billingLimits: Array<Record<string, unknown>>;
    recentUsage: Array<Record<string, unknown>>;
  } | null>(null);
  const [billingEdit, setBillingEdit] = useState({ daily: 25, monthly: 500, alert: 80, hardStop: 1 });

  const [toolsData, setToolsData] = useState<{
    tools: Array<Record<string, unknown>>;
    executions: Array<Record<string, unknown>>;
  } | null>(null);

  const [secLogs, setSecLogs] = useState<{
    auditLogs: Array<Record<string, unknown>>;
    aiRequests: Array<Record<string, unknown>>;
    jobs: Array<Record<string, unknown>>;
    files: Array<Record<string, unknown>>;
    dbHealth: Record<string, unknown>;
  } | null>(null);

  const [sysSettings, setSysSettings] = useState<Array<{ key: string; value: string; description: string }>>([]);

  async function loadData() {
    try {
      if (section === 'voice_settings' || section === 'live_sessions') {
        const res = await apiFetch<typeof voiceData>('/api/admin/voice');
        setVoiceData(res);
      } else if (section === 'usage_analytics' || section === 'billing_limits') {
        const res = await apiFetch<typeof analytics>('/api/admin/analytics');
        setAnalytics(res);
        const cap = res?.billingLimits?.[0];
        if (cap) {
          setBillingEdit({
            daily: Number(cap.daily_cost_cap_usd),
            monthly: Number(cap.monthly_cost_cap_usd),
            alert: Number(cap.alert_threshold_pct),
            hardStop: Number(cap.hard_stop_enabled),
          });
        }
      } else if (section === 'tool_management') {
        const res = await apiFetch<typeof toolsData>('/api/admin/tools');
        setToolsData(res);
      } else if (
        section === 'security_center' ||
        section === 'system_logs' ||
        section === 'background_jobs' ||
        section === 'database_health' ||
        section === 'backup_restore'
      ) {
        const res = await apiFetch<typeof secLogs>('/api/admin/security-logs');
        setSecLogs(res);
      } else if (section === 'system_settings') {
        const res = await apiFetch<{ settings: Array<{ key: string; value: string; description: string }> }>(
          '/api/admin/models'
        );
        setSysSettings(res.settings);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Load failed', 'error');
    }
  }

  useEffect(() => {
    loadData();
  }, [section]);

  if (section === 'voice_settings') {
    const liveEnabled =
      voiceData?.settings.find((s) => s.key === 'live_voice_enabled')?.value !== 'false';
    const defaultVoice =
      voiceData?.settings.find((s) => s.key === 'default_tts_voice')?.value || 'Kore';

    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">{lang === 'fa' ? 'تنظیمات سیستم صوتی و TTS' : 'Voice & Live Audio Settings'}</h3>
              <p className="text-xs text-slate-500 mt-1">
                {lang === 'fa' ? 'کنترل قابلیت Live Voice و تست موتور تبدیل متن به گفتار Gemini' : 'Manage Live Voice availability and Gemini TTS playback'}
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                await apiFetch('/api/admin/settings', {
                  method: 'PATCH',
                  body: JSON.stringify({ live_voice_enabled: liveEnabled ? 'false' : 'true' }),
                });
                loadData();
                onToast(lang === 'fa' ? 'وضعیت Live Voice تغییر یافت' : 'Live Voice setting updated');
              }}
              className={`px-3.5 py-2 rounded-lg text-xs font-semibold ${
                liveEnabled ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-200'
              }`}
            >
              {liveEnabled
                ? lang === 'fa'
                  ? 'Live Voice: فعال'
                  : 'Live Voice: Enabled'
                : lang === 'fa'
                ? 'Live Voice: غیرفعال'
                : 'Live Voice: Disabled'}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <input
              type="text"
              value={ttsSampleText}
              onChange={(e) => setTtsSampleText(e.target.value)}
              className="flex-1 min-w-[240px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 text-xs"
            />
            <button
              type="button"
              onClick={async () => {
                try {
                  const res = await apiFetch<{ audioBase64: string }>('/api/voice/tts', {
                    method: 'POST',
                    body: JSON.stringify({ text: ttsSampleText, voiceName: defaultVoice }),
                  });
                  setTtsAudioSrc(`data:audio/wav;base64,${res.audioBase64}`);
                } catch (err) {
                  onToast(err instanceof Error ? err.message : 'TTS failed', 'error');
                }
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#2563EB] text-white text-xs font-semibold"
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>{lang === 'fa' ? 'تست پخش TTS' : 'Test TTS'}</span>
            </button>
          </div>
          {ttsAudioSrc && <audio controls autoPlay src={ttsAudioSrc} className="w-full max-w-md h-9" />}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5">
          <h4 className="text-xs font-semibold mb-3">{lang === 'fa' ? 'تاریخچه پردازش‌های صوتی' : 'Voice Message Sessions'}</h4>
          {voiceData?.voiceSessions.length ? (
            <div className="space-y-2 text-xs">
              {voiceData.voiceSessions.map((v) => (
                <div key={String(v.id)} className="flex justify-between border-b border-slate-200 dark:border-slate-800 py-2">
                  <span>{String(v.user_name)} · {String(v.direction)} · {String(v.model_used)}</span>
                  <span className="font-mono tabular-nums">{String(v.duration_seconds)}s</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-500">{lang === 'fa' ? 'هنوز نشست صوتی ثبت نشده است.' : 'No voice sessions recorded.'}</div>
          )}
        </div>
      </div>
    );
  }

  if (section === 'live_sessions') {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5">
        <h3 className="text-sm font-semibold mb-4">{lang === 'fa' ? 'نشست‌های صوتی زنده (Live Voice)' : 'Live Voice Sessions'}</h3>
        {voiceData?.liveSessions.length ? (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 text-start">Session UUID</th>
                <th className="py-2 text-start">{lang === 'fa' ? 'کاربر' : 'User'}</th>
                <th className="py-2 text-start">Model</th>
                <th className="py-2 text-start">{lang === 'fa' ? 'وضعیت' : 'Status'}</th>
                <th className="py-2 text-end">{lang === 'fa' ? 'مدت' : 'Duration'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {voiceData.liveSessions.map((l) => (
                <tr key={String(l.id)}>
                  <td className="py-2 font-mono">{String(l.session_uuid).slice(0, 12)}...</td>
                  <td className="py-2">{String(l.user_name)}</td>
                  <td className="py-2 font-mono">{String(l.model_id)}</td>
                  <td className="py-2">{String(l.status)}</td>
                  <td className="py-2 text-end font-mono tabular-nums">{String(l.duration_seconds)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="py-10 text-center text-xs text-slate-500">
            {lang === 'fa' ? 'هیچ تماس صوتی زنده‌ای ثبت نشده است.' : 'No live voice sessions recorded yet.'}
          </div>
        )}
      </div>
    );
  }

  if (section === 'usage_analytics') {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5 overflow-x-auto">
          <h3 className="text-sm font-semibold mb-4">{lang === 'fa' ? 'گزارش مصرف به تفکیک مدل' : 'Usage Analytics by Model'}</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th className="py-2 text-start">Model</th>
                <th className="py-2 text-end">Calls</th>
                <th className="py-2 text-end">Input Tokens</th>
                <th className="py-2 text-end">Output Tokens</th>
                <th className="py-2 text-end">Audio (s)</th>
                <th className="py-2 text-end">Est. Cost (USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {analytics?.byModel.map((r) => (
                <tr key={String(r.model_id)}>
                  <td className="py-2 font-mono font-medium">{String(r.model_id)}</td>
                  <td className="py-2 text-end font-mono tabular-nums">{Number(r.calls).toLocaleString()}</td>
                  <td className="py-2 text-end font-mono tabular-nums">{Number(r.input_tokens).toLocaleString()}</td>
                  <td className="py-2 text-end font-mono tabular-nums">{Number(r.output_tokens).toLocaleString()}</td>
                  <td className="py-2 text-end font-mono tabular-nums">{Number(r.audio_seconds).toFixed(1)}</td>
                  <td className="py-2 text-end font-mono tabular-nums text-[#D4AF37]">
                    ${Number(r.estimated_cost_usd).toFixed(5)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (section === 'billing_limits') {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-6 space-y-4 max-w-2xl">
        <h3 className="text-sm font-semibold">{lang === 'fa' ? 'سقف مصرف مالی و محدودیت کل سیستم' : 'Global Billing Caps & Hard-Stop'}</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block text-slate-500 mb-1">{lang === 'fa' ? 'سقف روزانه (USD)' : 'Daily Cap (USD)'}</label>
            <input
              type="number"
              step="0.5"
              value={billingEdit.daily}
              onChange={(e) => setBillingEdit((b) => ({ ...b, daily: Number(e.target.value) }))}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1">{lang === 'fa' ? 'سقف ماهانه (USD)' : 'Monthly Cap (USD)'}</label>
            <input
              type="number"
              step="5"
              value={billingEdit.monthly}
              onChange={(e) => setBillingEdit((b) => ({ ...b, monthly: Number(e.target.value) }))}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 font-mono"
            />
          </div>
          <div>
            <label className="block text-slate-500 mb-1">{lang === 'fa' ? 'آستانه هشدار (%)' : 'Alert Threshold (%)'}</label>
            <input
              type="number"
              min={10}
              max={99}
              value={billingEdit.alert}
              onChange={(e) => setBillingEdit((b) => ({ ...b, alert: Number(e.target.value) }))}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 font-mono"
            />
          </div>
        </div>
        <div className="flex items-center justify-between pt-3">
          <label className="inline-flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={billingEdit.hardStop === 1}
              onChange={(e) => setBillingEdit((b) => ({ ...b, hardStop: e.target.checked ? 1 : 0 }))}
            />
            <span>{lang === 'fa' ? 'توقف خودکار درخواست‌ها هنگام عبور از سقف' : 'Enforce hard-stop on cap breach'}</span>
          </label>
          <button
            type="button"
            onClick={async () => {
              await apiFetch('/api/admin/billing', {
                method: 'PATCH',
                body: JSON.stringify({
                  daily_cost_cap_usd: billingEdit.daily,
                  monthly_cost_cap_usd: billingEdit.monthly,
                  alert_threshold_pct: billingEdit.alert,
                  hard_stop_enabled: billingEdit.hardStop,
                }),
              });
              onToast(lang === 'fa' ? 'محدودیت‌های مالی ذخیره شد' : 'Billing caps updated');
            }}
            className="px-4 py-2 rounded-lg bg-[#D4AF37] text-[#07090F] text-xs font-semibold"
          >
            {lang === 'fa' ? 'ذخیره محدودیت' : 'Save Limits'}
          </button>
        </div>
      </div>
    );
  }

  if (section === 'tool_management') {
    return (
      <div className="space-y-5">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5">
          <h3 className="text-sm font-semibold mb-4">{lang === 'fa' ? 'ابزارهای مجاز Function Calling' : 'Registered AI Tools & Permissions'}</h3>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {toolsData?.tools.map((t) => (
              <div key={String(t.id)} className="py-3 flex items-center justify-between gap-4 text-xs">
                <div>
                  <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">{String(t.tool_name)}</div>
                  <div className="text-slate-500 mt-0.5">{lang === 'fa' ? String(t.description_fa) : String(t.description_en)}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-slate-500">{String(t.timeout_ms)}ms</span>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/admin/tools/${t.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ is_enabled: t.is_enabled ? 0 : 1 }),
                      });
                      loadData();
                    }}
                    className={`px-3 py-1 rounded border ${
                      t.is_enabled ? 'border-emerald-500/40 text-emerald-500' : 'border-slate-500/40 text-slate-400'
                    }`}
                  >
                    {t.is_enabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (section === 'security_center') {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-6 space-y-4">
        <h3 className="text-sm font-semibold">{lang === 'fa' ? 'مرکز امنیت و حفاظت نشست' : 'Security Center & Hardening Policy'}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          {[
            ['Password Hashing', 'scrypt + 16-byte random salt + timingSafeEqual'],
            ['Session & CSRF', 'HttpOnly HMAC-SHA256 cookie + X-CSRF-Token validation'],
            ['Prompt Injection Guard', 'Pattern detection + <untrusted_data> boundary wrapping'],
            ['File Upload Defense', 'MIME whitelist, dangerous extension block, path traversal strip, TTL purge'],
            ['User Data Isolation', 'Strict user_id filtering across conversations and vector memory'],
            ['Tool Sandboxing', 'Zero shell/eval execution; recursive-descent math parser only'],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5">
              <div className="font-semibold text-slate-900 dark:text-slate-100">{title}</div>
              <div className="text-slate-500 mt-1">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (section === 'system_logs') {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5 space-y-3">
        <h3 className="text-sm font-semibold">{lang === 'fa' ? 'گزارش ممیزی و رویدادهای سیستم' : 'System & Audit Logs'}</h3>
        <div className="space-y-2 max-h-[480px] overflow-y-auto text-xs">
          {secLogs?.auditLogs.map((log) => (
            <div key={String(log.id)} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 flex justify-between gap-4">
              <div>
                <span className="font-mono font-semibold text-[#D4AF37]">{String(log.action)}</span>
                <span className="text-slate-500 mx-2">·</span>
                <span className="text-slate-700 dark:text-slate-300">{String(log.details)}</span>
              </div>
              <span className="font-mono text-[11px] text-slate-500 whitespace-nowrap">{String(log.created_at)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (section === 'background_jobs') {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5 space-y-4">
        <h3 className="text-sm font-semibold">{lang === 'fa' ? 'صف وظایف پس‌زمینه و فایل‌های موقت' : 'Background Jobs & Temporary Files'}</h3>
        <div className="text-xs text-slate-500">
          {lang === 'fa'
            ? `تعداد فایل‌های آپلودی ثبت‌شده: ${secLogs?.files.length ?? 0} · وظایف صف: ${secLogs?.jobs.length ?? 0}`
            : `Tracked uploads: ${secLogs?.files.length ?? 0} · Background jobs: ${secLogs?.jobs.length ?? 0}`}
        </div>
        {secLogs?.files.length ? (
          <div className="space-y-2 text-xs">
            {secLogs.files.map((f) => (
              <div key={String(f.id)} className="flex justify-between border-b border-slate-200 dark:border-slate-800 py-2">
                <span className="font-mono">{String(f.original_name)} ({String(f.mime_type)})</span>
                <span className="font-mono text-slate-500">{String(f.status)} · expires {String(f.expires_at)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-500 py-6">{lang === 'fa' ? 'هیچ فایل موقتی در صف پاکسازی نیست.' : 'No temporary files queued.'}</div>
        )}
      </div>
    );
  }

  if (section === 'database_health') {
    const h = secLogs?.dbHealth;
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-6 space-y-3 text-xs">
        <h3 className="text-sm font-semibold">{lang === 'fa' ? 'سلامت دیتابیس و وضعیت Migration' : 'Database Health & Schema Migrations'}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <div className="text-slate-500">Driver</div>
            <div className="font-mono font-semibold mt-1">{String(h?.driver || 'sqlite')}</div>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <div className="text-slate-500">Migrations</div>
            <div className="font-mono font-semibold mt-1 tabular-nums">{String(h?.migrationsApplied ?? 0)}</div>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <div className="text-slate-500">Tables</div>
            <div className="font-mono font-semibold mt-1 tabular-nums">{String(h?.tablesCount ?? 0)}</div>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <div className="text-slate-500">Status</div>
            <div className="font-mono font-semibold mt-1 text-emerald-500">{h?.ok ? 'Healthy' : 'Degraded'}</div>
          </div>
        </div>
      </div>
    );
  }

  if (section === 'backup_restore') {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-6 space-y-4">
        <h3 className="text-sm font-semibold">{lang === 'fa' ? 'پشتیبان‌گیری و بازیابی تنظیمات' : 'Backup & Restore'}</h3>
        <p className="text-xs text-slate-600 dark:text-slate-400">
          {lang === 'fa'
            ? 'خروجی JSON شامل شخصیت‌ها، محدودیت‌ها، مجوز ابزارها و تنظیمات غیرمحرمانه تولید می‌شود (کلیدهای API هرگز صادر نمی‌شوند). برای بازیابی کامل دیتابیس در محیط Docker از اسکریپت‌های scripts/backup.sh و scripts/restore.sh استفاده کنید.'
            : 'Exports personalities, billing caps, tool permissions, and non-secret settings (API keys excluded). Use scripts/backup.sh and scripts/restore.sh for full encrypted PostgreSQL volume backups.'}
        </p>
        <button
          type="button"
          onClick={async () => {
            const data = await apiFetch<Record<string, unknown>>('/api/admin/backup', { method: 'POST' });
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `nexora-backup-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            onToast(lang === 'fa' ? 'فایل پشتیبان دانلود شد' : 'Backup downloaded');
          }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#D4AF37] text-[#07090F] text-xs font-semibold"
        >
          <Download className="w-4 h-4" />
          <span>{lang === 'fa' ? 'دریافت فایل پشتیبان (JSON)' : 'Download Configuration Backup'}</span>
        </button>
      </div>
    );
  }

  // system_settings
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{lang === 'fa' ? 'تنظیمات عمومی سیستم' : 'System Settings'}</h3>
        <button
          type="button"
          onClick={async () => {
            const payload: Record<string, string> = {};
            for (const s of sysSettings) payload[s.key] = s.value;
            await apiFetch('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(payload) });
            onToast(lang === 'fa' ? 'تنظیمات سیستم ذخیره شد' : 'System settings saved');
          }}
          className="px-4 py-2 rounded-lg bg-[#D4AF37] text-[#07090F] text-xs font-semibold"
        >
          {lang === 'fa' ? 'ذخیره همه' : 'Save All'}
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        {sysSettings.map((s) => (
          <div key={s.key}>
            <label className="block font-mono text-slate-600 dark:text-slate-400 mb-1">{s.key}</label>
            <input
              type="text"
              value={s.value}
              onChange={(e) =>
                setSysSettings((prev) =>
                  prev.map((item) => (item.key === s.key ? { ...item, value: e.target.value } : item))
                )
              }
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 font-mono"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
