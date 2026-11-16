import crypto from 'node:crypto';
import path from 'node:path';

let ephemeralSecret: string | null = null;

export function getSessionSecret(): string {
  const configured = process.env.JWT_SECRET || process.env.APP_SECRET;
  if (configured && configured.length >= 16 && !configured.startsWith('CHANGE_ME')) {
    return configured;
  }
  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(32).toString('hex');
  }
  return ephemeralSecret;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, originalHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) {
    return false;
  }
  return crypto.timingSafeEqual(derived, original);
}

export interface SessionPayload {
  adminId: number;
  email: string;
  role: 'super_admin' | 'admin';
  csrfToken: string;
  exp: number;
}

export function signSessionToken(payload: Omit<SessionPayload, 'exp'>, ttlSeconds = 43200): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function generateCsrfToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

export class SlidingWindowRateLimiter {
  private buckets = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  consume(key: string, now = Date.now()): { allowed: boolean; remaining: number; resetMs: number } {
    const cutoff = now - this.windowMs;
    const timestamps = (this.buckets.get(key) ?? []).filter((t) => t > cutoff);
    if (timestamps.length >= this.maxRequests) {
      const oldest = timestamps[0] ?? now;
      this.buckets.set(key, timestamps);
      return {
        allowed: false,
        remaining: 0,
        resetMs: Math.max(0, oldest + this.windowMs - now),
      };
    }
    timestamps.push(now);
    this.buckets.set(key, timestamps);
    return {
      allowed: true,
      remaining: this.maxRequests - timestamps.length,
      resetMs: this.windowMs,
    };
  }
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/gi,
  /reveal\s+(your\s+)?system\s+prompt/gi,
  /bypass\s+(safety|security|policy)/gi,
  /you\s+are\s+now\s+in\s+developer\s+mode/gi,
  /دستورالعمل‌های\s+قبلی\s+را\s+نادیده\s+بگیر/gi,
];

export function detectPromptInjection(text: string): { flagged: boolean; matches: string[] } {
  const matches: string[] = [];
  for (const pattern of INJECTION_PATTERNS) {
    const found = text.match(pattern);
    if (found) {
      matches.push(...found);
    }
  }
  return { flagged: matches.length > 0, matches };
}

export function wrapUntrustedContent(label: string, content: string): string {
  const cleanLabel = label.replace(/[^a-zA-Z0-9._-]/g, '_');
  const escaped = content.replace(/<\/untrusted_data>/gi, '[escaped_tag]');
  return `<untrusted_data source="${cleanLabel}">\n${escaped}\n</untrusted_data>`;
}

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/webm',
  'audio/mp4',
]);

export function validateUploadFile(
  originalName: string,
  mimeType: string,
  sizeBytes: number,
  maxBytes = Number(process.env.MAX_UPLOAD_SIZE || 20 * 1024 * 1024)
): { valid: boolean; safeName: string; reason?: string } {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { valid: false, safeName: '', reason: 'Empty or invalid file size' };
  }
  if (sizeBytes > maxBytes) {
    return { valid: false, safeName: '', reason: `File exceeds limit (${maxBytes} bytes)` };
  }
  const base = path.basename(originalName || 'upload.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!base || base.startsWith('.')) {
    return { valid: false, safeName: '', reason: 'Invalid filename' };
  }
  const normalizedMime = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
    return { valid: false, safeName: '', reason: `Unsupported MIME type: ${normalizedMime}` };
  }
  const ext = path.extname(base).toLowerCase();
  const dangerousExts = new Set(['.exe', '.sh', '.bat', '.cmd', '.ps1', '.js', '.mjs', '.py', '.php']);
  if (dangerousExts.has(ext)) {
    return { valid: false, safeName: '', reason: `Executable extension prohibited: ${ext}` };
  }
  const safeName = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}_${base}`;
  return { valid: true, safeName };
}

export function redactSecrets(input: string): string {
  return input
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED_GEMINI_KEY]')
    .replace(/\b\d{8,11}:[A-Za-z0-9_-]{30,}\b/g, '[REDACTED_TELEGRAM_TOKEN]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED_TOKEN]');
}

export function verifyTelegramWebAppInitData(initData: string, botToken: string): boolean {
  if (!initData || !botToken) return false;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;
    params.delete('hash');
    const dataCheckString = Array.from(params.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calculated = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    const a = Buffer.from(calculated, 'hex');
    const b = Buffer.from(hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
