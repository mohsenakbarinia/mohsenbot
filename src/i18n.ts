export type Lang = 'fa' | 'en';

export type AdminSectionId =
  | 'dashboard'
  | 'users'
  | 'conversations'
  | 'gemini_center'
  | 'model_registry'
  | 'ai_router'
  | 'personality_studio'
  | 'memory_management'
  | 'voice_settings'
  | 'live_sessions'
  | 'usage_analytics'
  | 'billing_limits'
  | 'tool_management'
  | 'security_center'
  | 'system_logs'
  | 'background_jobs'
  | 'database_health'
  | 'backup_restore'
  | 'system_settings';

export interface NavGroup {
  id: string;
  labelFa: string;
  labelEn: string;
  items: Array<{ id: AdminSectionId; labelFa: string; labelEn: string }>;
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'core',
    labelFa: 'نمای کلی و کاربران',
    labelEn: 'Overview & Users',
    items: [
      { id: 'dashboard', labelFa: 'داشبورد', labelEn: 'Dashboard' },
      { id: 'users', labelFa: 'مدیریت کاربران', labelEn: 'Users' },
      { id: 'conversations', labelFa: 'گفتگوها', labelEn: 'Conversations' },
    ],
  },
  {
    id: 'ai',
    labelFa: 'هسته هوش مصنوعی و Gemini',
    labelEn: 'AI & Gemini Core',
    items: [
      { id: 'gemini_center', labelFa: 'مرکز Gemini', labelEn: 'Gemini Center' },
      { id: 'model_registry', labelFa: 'رجیستری مدل‌ها', labelEn: 'Model Registry' },
      { id: 'ai_router', labelFa: 'مسیریاب هوشمند', labelEn: 'AI Router' },
      { id: 'personality_studio', labelFa: 'استودیو شخصیت', labelEn: 'Personality Studio' },
      { id: 'memory_management', labelFa: 'حافظه بلندمدت', labelEn: 'Memory Engine' },
    ],
  },
  {
    id: 'voice_tools',
    labelFa: 'صوت، ابزار و مصرف',
    labelEn: 'Voice, Tools & Billing',
    items: [
      { id: 'voice_settings', labelFa: 'تنظیمات صوتی', labelEn: 'Voice Settings' },
      { id: 'live_sessions', labelFa: 'نشست‌های صوتی زنده', labelEn: 'Live Voice Sessions' },
      { id: 'usage_analytics', labelFa: 'تحلیل مصرف', labelEn: 'Usage Analytics' },
      { id: 'billing_limits', labelFa: 'مالی و سقف مصرف', labelEn: 'Billing & Limits' },
      { id: 'tool_management', labelFa: 'مدیریت ابزارها', labelEn: 'Tool Management' },
    ],
  },
  {
    id: 'ops',
    labelFa: 'امنیت و زیرساخت',
    labelEn: 'Security & Ops',
    items: [
      { id: 'security_center', labelFa: 'مرکز امنیت', labelEn: 'Security Center' },
      { id: 'system_logs', labelFa: 'گزارش‌های سیستم', labelEn: 'System Logs' },
      { id: 'background_jobs', labelFa: 'وظایف پس‌زمینه', labelEn: 'Background Jobs' },
      { id: 'database_health', labelFa: 'سلامت دیتابیس', labelEn: 'Database Health' },
      { id: 'backup_restore', labelFa: 'پشتیبان‌گیری', labelEn: 'Backup & Restore' },
      { id: 'system_settings', labelFa: 'تنظیمات سیستم', labelEn: 'System Settings' },
    ],
  },
];

export const TEXT = {
  fa: {
    brand: 'NEXORA AI',
    adminConsole: 'پنل مدیریت',
    miniAppBtn: 'مینی‌اپ تلگرام',
    backToAdmin: 'بازگشت به پنل مدیریت',
    searchUsers: 'جستجوی نام، نام کاربری یا شناسه تلگرام...',
    refresh: 'به‌روزرسانی',
    save: 'ذخیره تغییرات',
    create: 'ایجاد',
    cancel: 'انصراف',
    delete: 'حذف',
    active: 'فعال',
    inactive: 'غیرفعال',
    limited: 'محدودشده',
    banned: 'مسدود',
    loading: 'در حال بارگذاری داده‌ها...',
    noData: 'داده‌ای برای نمایش ثبت نشده است.',
    adminAuth: 'احراز هویت مدیر',
    signOut: 'خروج مدیر',
    totalUsers: 'کل کاربران',
    activeUsers: 'کاربران فعال',
    totalRequests: 'تعداد درخواست‌ها',
    totalMessages: 'کل پیام‌ها',
    geminiTokens: 'مصرف توکن',
    estimatedCost: 'هزینه تخمینی',
    errorCount: 'خطاهای ثبت‌شده',
    serviceHealth: 'وضعیت سرویس‌های زیرساخت',
    syncModels: 'همگام‌سازی زنده با Gemini API',
    send: 'ارسال',
    startLiveCall: 'شروع مکالمه صوتی زنده',
    endLiveCall: 'قطع مکالمه',
    memoryMode: 'حالت حافظه',
    personality: 'شخصیت دستیار',
  },
  en: {
    brand: 'NEXORA AI',
    adminConsole: 'Admin Console',
    miniAppBtn: 'Telegram Mini App',
    backToAdmin: 'Back to Admin',
    searchUsers: 'Search name, username, or Telegram ID...',
    refresh: 'Refresh',
    save: 'Save Changes',
    create: 'Create',
    cancel: 'Cancel',
    delete: 'Delete',
    active: 'Active',
    inactive: 'Inactive',
    limited: 'Limited',
    banned: 'Banned',
    loading: 'Loading data...',
    noData: 'No records available yet.',
    adminAuth: 'Admin Auth',
    signOut: 'Sign Out',
    totalUsers: 'Total Users',
    activeUsers: 'Active Users',
    totalRequests: 'AI Requests',
    totalMessages: 'Messages',
    geminiTokens: 'Token Usage',
    estimatedCost: 'Estimated Cost',
    errorCount: 'Errors Logged',
    serviceHealth: 'Infrastructure Service Health',
    syncModels: 'Sync Live Gemini Models',
    send: 'Send',
    startLiveCall: 'Start Live Voice',
    endLiveCall: 'End Call',
    memoryMode: 'Memory Mode',
    personality: 'Assistant Personality',
  },
} as const;
