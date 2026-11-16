export interface HealthStatus {
  status: string;
  timestamp: string;
  services: {
    database: { ok: boolean; driver: string; migrationsApplied: number; tablesCount: number; totalRows: number };
    gemini: { configured: boolean; status: string };
    telegramBot: { configured: boolean; mode: string; status: string };
    localAi: { enabled: boolean; baseUrl: string };
    redis: { configured: boolean };
  };
}

export interface AdminAuthState {
  bootstrapped: boolean;
  authenticated: boolean;
  admin: { id: number; email: string; role: 'super_admin' | 'admin'; csrfToken: string } | null;
}

export interface Personality {
  id: number;
  code: string;
  name_fa: string;
  name_en: string;
  description_fa: string;
  description_en: string;
  system_prompt: string;
  tone: string;
  humor_level: number;
  seriousness_level: number;
  warmth_level: number;
  behavior_rules: string;
  language: 'fa' | 'en' | 'both';
  is_public: number;
  is_active: number;
  is_builtin: number;
}

export interface MemoryItem {
  id: number;
  user_id: number;
  user_name?: string;
  category: string;
  topic_key: string;
  content: string;
  importance: number;
  source: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  similarity?: number;
}

let currentCsrfToken = '';

export function setCsrfToken(token: string): void {
  currentCsrfToken = token;
}

export async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (currentCsrfToken && init.method && init.method !== 'GET') {
    headers.set('X-CSRF-Token', currentCsrfToken);
  }
  if (!(init.body instanceof FormData) && !headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...init, headers, credentials: 'same-origin' });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}
