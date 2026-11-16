import { useState, type FormEvent } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import type { Lang } from '../i18n';
import { apiFetch, setCsrfToken, type AdminAuthState } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  authState: AdminAuthState;
  onAuthenticated: () => void;
  lang: Lang;
}

export function AdminAuthModal({ open, onClose, authState, onAuthenticated, lang }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const isBootstrap = !authState.bootstrapped;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const endpoint = isBootstrap ? '/api/auth/bootstrap' : '/api/auth/login';
      const res = await apiFetch<{ ok: boolean; admin: { csrfToken: string } }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(
          isBootstrap ? { email, password, displayName } : { email, password }
        ),
      });
      if (res.admin?.csrfToken) {
        setCsrfToken(res.admin.csrfToken);
      }
      onAuthenticated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isBootstrap ? 'Super Admin Bootstrap' : 'Admin Login'}
        className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-5 h-5 text-[#D4AF37]" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {isBootstrap
                ? lang === 'fa'
                  ? 'ایجاد حساب مدیر ارشد اولیه'
                  : 'Initialize Super Admin Account'
                : lang === 'fa'
                ? 'ورود به پنل مدیریت'
                : 'Admin Console Sign In'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={lang === 'fa' ? 'بستن' : 'Close'}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-400 mb-5 leading-relaxed">
          {isBootstrap
            ? lang === 'fa'
              ? 'هنوز هیچ مدیر ارشدی ثبت نشده است. با ثبت این فرم، رمز عبور با الگوریتم scrypt هش شده و نشست امن با محافظت CSRF فعال می‌شود.'
              : 'No super admin exists yet. Credentials are hashed with scrypt and protected via HttpOnly signed session cookies and CSRF tokens.'
            : lang === 'fa'
            ? 'برای انجام تغییرات مدیریتی با حساب مدیر وارد شوید.'
            : 'Authenticate with your administrator credentials to authorize mutations.'}
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isBootstrap && (
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                {lang === 'fa' ? 'نام نمایشی' : 'Display Name'}
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="NEXORA Super Admin"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {lang === 'fa' ? 'ایمیل مدیر' : 'Admin Email'}
            </label>
            <input
              type="email"
              required
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@nexora.example.com"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#2563EB]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              {lang === 'fa' ? 'رمز عبور (حداقل ۸ کاراکتر)' : 'Password (min 8 characters)'}
            </label>
            <input
              type="password"
              required
              minLength={8}
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#2563EB]"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              {lang === 'fa' ? 'انصراف' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#D4AF37] text-[#07090F] hover:bg-[#E5C158] disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              {submitting
                ? '...'
                : isBootstrap
                ? lang === 'fa'
                  ? 'ایجاد و ورود'
                  : 'Bootstrap & Sign In'
                : lang === 'fa'
                ? 'ورود ایمن'
                : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
