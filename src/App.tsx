import { useEffect, useState } from 'react';
import {
  Globe,
  LogOut,
  Menu,
  Moon,
  Shield,
  Smartphone,
  Sun,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AdminAuthModal } from './components/AdminAuthModal';
import { AdminCoreViews } from './components/AdminCoreViews';
import { AdminOpsViews } from './components/AdminOpsViews';
import { MiniAppStudio } from './components/MiniAppStudio';
import { NAV_GROUPS, TEXT, type AdminSectionId, type Lang } from './i18n';
import { apiFetch, setCsrfToken, type AdminAuthState, type HealthStatus } from './types';

const CORE_SECTIONS = new Set<AdminSectionId>([
  'dashboard',
  'users',
  'conversations',
  'gemini_center',
  'model_registry',
  'ai_router',
  'personality_studio',
  'memory_management',
]);

export default function App() {
  const [lang, setLang] = useState<Lang>('fa');
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [workspaceMode, setWorkspaceMode] = useState<'admin' | 'miniapp'>('admin');
  const [activeSection, setActiveSection] = useState<AdminSectionId>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [authState, setAuthState] = useState<AdminAuthState>({
    bootstrapped: false,
    authenticated: false,
    admin: null,
  });
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' } | null>(null);

  const t = TEXT[lang];

  function showToast(msg: string, type: 'info' | 'error' = 'info') {
    setToast({ msg, type });
    window.setTimeout(() => {
      setToast((cur) => (cur?.msg === msg ? null : cur));
    }, 4500);
  }

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  async function refreshHealth() {
    try {
      const h = await apiFetch<HealthStatus>('/api/health');
      setHealth(h);
    } catch {
      // Ignore transient health fetch error
    }
  }

  async function refreshAuth() {
    try {
      const st = await apiFetch<AdminAuthState>('/api/auth/status');
      setAuthState(st);
      if (st.admin?.csrfToken) {
        setCsrfToken(st.admin.csrfToken);
      }
    } catch {
      // Ignore
    }
  }

  useEffect(() => {
    refreshHealth();
    refreshAuth();
  }, []);

  const currentNavLabel =
    NAV_GROUPS.flatMap((g) => g.items).find((i) => i.id === activeSection)?.[
      lang === 'fa' ? 'labelFa' : 'labelEn'
    ] || activeSection;

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900 dark:bg-[#07090F] dark:text-slate-100">
      {/* Desktop Sidebar */}
      {workspaceMode === 'admin' && (
        <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:h-screen lg:sticky lg:top-0 border-e border-slate-200 dark:border-slate-800/80 bg-white dark:bg-[#0D1424] shrink-0">
          <div className="h-14 px-5 flex items-center gap-3 border-b border-slate-200 dark:border-slate-800/80 shrink-0">
            <img
              src="/src/assets/images/nexora_brand_mark_1794858831625.jpg"
              alt="NEXORA AI"
              referrerPolicy="no-referrer"
              className="w-7 h-7 rounded-lg object-cover border border-[#D4AF37]/40 shrink-0"
            />
            <span className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap">
              {t.brand}
            </span>
          </div>

          <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-3" aria-label="Admin Navigation">
            {NAV_GROUPS.map((group) => (
              <div key={group.id}>
                <div className="px-3 mb-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {lang === 'fa' ? group.labelFa : group.labelEn}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = activeSection === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setActiveSection(item.id)}
                        className={`w-full text-start px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap truncate ${
                          active
                            ? 'bg-[#2563EB]/12 text-[#2563EB] dark:text-[#D4AF37] dark:bg-[#D4AF37]/10'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        {lang === 'fa' ? item.labelFa : item.labelEn}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="p-4 border-t border-slate-200 dark:border-slate-800/80 flex items-center gap-3">
            <img
              src="/src/assets/images/avatar_admin_nexora_1794858835754.jpg"
              alt="Admin Profile"
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-full object-cover border border-slate-300 dark:border-slate-700 shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                {authState.admin ? authState.admin.email : lang === 'fa' ? 'مدیر سیستم' : 'System Admin'}
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                {authState.authenticated
                  ? authState.admin?.role
                  : authState.bootstrapped
                  ? lang === 'fa'
                    ? 'نیازمند ورود'
                    : 'Sign in required'
                  : lang === 'fa'
                  ? 'آماده راه‌اندازی اولیه'
                  : 'Bootstrap ready'}
              </div>
            </div>
          </div>
        </aside>
      )}

      {/* Mobile Drawer */}
      {mobileMenuOpen && workspaceMode === 'admin' && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div className="fixed inset-0 bg-black/60" onClick={() => setMobileMenuOpen(false)} />
          <aside className="relative z-50 w-72 max-w-[85vw] bg-white dark:bg-[#0D1424] h-full overflow-y-auto p-4 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <span className="font-bold text-sm">{t.brand}</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close Menu"
                className="p-1.5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {NAV_GROUPS.map((group) => (
              <div key={group.id} className="space-y-1">
                <div className="text-[11px] text-slate-500 px-2">{lang === 'fa' ? group.labelFa : group.labelEn}</div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveSection(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full text-start px-3 py-2 rounded-lg text-xs ${
                      activeSection === item.id
                        ? 'bg-[#2563EB]/15 text-[#2563EB] dark:text-[#D4AF37]'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {lang === 'fa' ? item.labelFa : item.labelEn}
                  </button>
                ))}
              </div>
            ))}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: Breadcrumb + Single-Line Actions */}
        <header className="h-16 px-4 sm:px-6 border-b border-slate-200 dark:border-slate-800/80 bg-white/80 dark:bg-[#0D1424]/80 backdrop-blur-md flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {workspaceMode === 'admin' && (
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open Navigation"
                className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-800"
              >
                <Menu className="w-4 h-4" />
              </button>
            )}
            <div className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 truncate">
              <span className="font-semibold text-slate-900 dark:text-slate-100">{t.brand}</span>
              <span className="mx-2">/</span>
              <span>
                {workspaceMode === 'miniapp'
                  ? t.miniAppBtn
                  : `${t.adminConsole} / ${currentNavLabel}`}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setLang((l) => (l === 'fa' ? 'en' : 'fa'))}
              aria-label="Toggle Language"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:border-[#2563EB] whitespace-nowrap shrink-0"
            >
              <Globe className="w-3.5 h-3.5" />
              <span>{lang === 'fa' ? 'EN' : 'فا'}</span>
            </button>

            <button
              type="button"
              onClick={() => setTheme((th) => (th === 'dark' ? 'light' : 'dark'))}
              aria-label="Toggle Theme"
              className="p-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:border-[#D4AF37] shrink-0"
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-[#D4AF37]" /> : <Moon className="w-3.5 h-3.5" />}
            </button>

            {authState.authenticated ? (
              <button
                type="button"
                onClick={async () => {
                  await apiFetch('/api/auth/logout', { method: 'POST' });
                  setCsrfToken('');
                  refreshAuth();
                  showToast(lang === 'fa' ? 'خروج انجام شد' : 'Signed out');
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{t.signOut}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-medium hover:border-[#D4AF37] whitespace-nowrap shrink-0"
              >
                <Shield className="w-3.5 h-3.5 text-[#D4AF37]" />
                <span className="hidden sm:inline">{t.adminAuth}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setWorkspaceMode((m) => (m === 'admin' ? 'miniapp' : 'admin'))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D4AF37] text-[#07090F] text-xs font-semibold hover:bg-[#E5C158] whitespace-nowrap shrink-0"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{workspaceMode === 'admin' ? t.miniAppBtn : t.backToAdmin}</span>
              <span className="sm:hidden">{workspaceMode === 'admin' ? (lang === 'fa' ? 'مینی‌اپ' : 'Mini App') : (lang === 'fa' ? 'پنل' : 'Admin')}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${workspaceMode}-${activeSection}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {workspaceMode === 'miniapp' ? (
                <MiniAppStudio lang={lang} onToast={showToast} />
              ) : CORE_SECTIONS.has(activeSection) ? (
                <AdminCoreViews
                  section={activeSection}
                  lang={lang}
                  health={health}
                  onToast={showToast}
                  onRefreshHealth={refreshHealth}
                />
              ) : (
                <AdminOpsViews section={activeSection} lang={lang} onToast={showToast} />
              )}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <AdminAuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        authState={authState}
        onAuthenticated={refreshAuth}
        lang={lang}
      />

      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 end-5 z-50 rounded-xl border px-4 py-2.5 text-xs shadow-xl backdrop-blur-md ${
            toast.type === 'error'
              ? 'border-red-500/40 bg-red-950/90 text-red-100'
              : 'border-[#D4AF37]/40 bg-[#0D1424]/95 text-slate-100'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
