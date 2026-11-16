import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import type { DatabaseSync } from 'node:sqlite';
import { getDatabaseHealth } from './db.ts';
import {
  generateSpeechWavBase64,
  isGeminiConfigured,
  syncGeminiModelRegistry,
  transcribeAudioBase64,
} from './gemini.ts';
import { retrieveRelevantMemories, saveUserMemory } from './memory.ts';
import { runOrchestratedChat } from './orchestrator.ts';
import {
  SlidingWindowRateLimiter,
  generateCsrfToken,
  hashPassword,
  signSessionToken,
  validateUploadFile,
  verifyPassword,
  verifySessionToken,
  verifyTelegramWebAppInitData,
  type SessionPayload,
} from './security.ts';
import { handleTelegramUpdate, isTelegramConfigured, verifyWebhookSecretHeader } from './telegram.ts';
import type { MemoryCategory, MemoryMode, TaskCategory } from './types.ts';

const apiLimiter = new SlidingWindowRateLimiter(120, 60_000);
const authLimiter = new SlidingWindowRateLimiter(15, 60_000);

const uploadStorage = multer.memoryStorage();
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: Number(process.env.MAX_UPLOAD_SIZE || 20 * 1024 * 1024) },
});

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return out;
}

export function createApiRouter(db: DatabaseSync): express.Router {
  const router = express.Router();

  // Global rate limit middleware
  router.use((req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || 'local';
    const check = apiLimiter.consume(ip);
    res.setHeader('X-RateLimit-Remaining', String(check.remaining));
    if (!check.allowed) {
      res.status(429).json({ error: 'Rate limit exceeded. Please retry shortly.' });
      return;
    }
    next();
  });

  // Helper to resolve optional admin session
  function getAdminSession(req: Request): SessionPayload | null {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.nexora_admin_session || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    return verifySessionToken(token);
  }

  function requireAdminIfConfigured(req: Request, res: Response, next: NextFunction): void {
    const adminCount = (db.prepare('SELECT COUNT(*) as c FROM admin_users').get() as { c: number }).c;
    if (adminCount === 0) {
      // No admin bootstrapped yet — allow initial workspace inspection but record notice
      next();
      return;
    }
    const session = getAdminSession(req);
    if (!session) {
      res.status(401).json({ error: 'Admin authentication required' });
      return;
    }
    if (req.method !== 'GET' && req.headers['x-csrf-token'] !== session.csrfToken) {
      res.status(403).json({ error: 'Invalid CSRF token' });
      return;
    }
    (req as Request & { adminSession?: SessionPayload }).adminSession = session;
    next();
  }

  // --- Health & Status ---
  router.get('/health', (_req, res) => {
    const dbHealth = getDatabaseHealth(db);
    const geminiReady = isGeminiConfigured();
    const telegramReady = isTelegramConfigured();
    const localAiSetting = db
      .prepare("SELECT value FROM system_settings WHERE key = 'local_ai_enabled'")
      .get() as { value: string } | undefined;

    res.json({
      status: dbHealth.ok ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealth,
        gemini: {
          configured: geminiReady,
          status: geminiReady ? 'ready' : 'configuration_required',
        },
        telegramBot: {
          configured: telegramReady,
          mode: process.env.TELEGRAM_MODE || 'polling',
          status: telegramReady ? 'ready' : 'awaiting_token',
        },
        localAi: {
          enabled: localAiSetting?.value === 'true' || process.env.LOCAL_AI_ENABLED === 'true',
          baseUrl: process.env.LOCAL_AI_BASE_URL || 'http://ollama:11434',
        },
        redis: {
          configured: Boolean(process.env.REDIS_URL && !process.env.REDIS_URL.includes('CHANGE_ME')),
        },
      },
    });
  });

  // --- Admin Auth & Bootstrap ---
  router.get('/auth/status', (req, res) => {
    const adminCount = (db.prepare('SELECT COUNT(*) as c FROM admin_users').get() as { c: number }).c;
    const session = getAdminSession(req);
    res.json({
      bootstrapped: adminCount > 0,
      authenticated: Boolean(session),
      admin: session
        ? { id: session.adminId, email: session.email, role: session.role, csrfToken: session.csrfToken }
        : null,
    });
  });

  router.post('/auth/bootstrap', (req, res) => {
    const adminCount = (db.prepare('SELECT COUNT(*) as c FROM admin_users').get() as { c: number }).c;
    if (adminCount > 0) {
      res.status(409).json({ error: 'Admin already bootstrapped' });
      return;
    }
    const { email, password, displayName } = req.body as {
      email?: string;
      password?: string;
      displayName?: string;
    };
    if (!email || !password || password.length < 8) {
      res.status(400).json({ error: 'Valid email and password (min 8 chars) required' });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const inserted = db
      .prepare(
        `INSERT INTO admin_users (email, display_name, password_hash, role_name, is_active)
         VALUES (?, ?, ?, 'super_admin', 1)`
      )
      .run(cleanEmail, displayName?.trim() || 'Super Admin', hashPassword(password));

    const csrfToken = generateCsrfToken();
    const token = signSessionToken({
      adminId: Number(inserted.lastInsertRowid),
      email: cleanEmail,
      role: 'super_admin',
      csrfToken,
    });

    db.prepare(
      `INSERT INTO audit_logs (actor_type, actor_id, action, resource, details, severity)
       VALUES ('admin', ?, 'admin.bootstrapped', 'admin_users', 'Initial super_admin account created', 'info')`
    ).run(cleanEmail);

    res.setHeader(
      'Set-Cookie',
      `nexora_admin_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200`
    );
    res.json({ ok: true, admin: { email: cleanEmail, role: 'super_admin', csrfToken } });
  });

  router.post('/auth/login', (req, res) => {
    const ip = req.ip || 'local';
    if (!authLimiter.consume(`login:${ip}`).allowed) {
      res.status(429).json({ error: 'Too many login attempts' });
      return;
    }
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      res.status(400).json({ error: 'Email and password required' });
      return;
    }
    const admin = db
      .prepare('SELECT * FROM admin_users WHERE email = ? AND is_active = 1')
      .get(email.trim().toLowerCase()) as
      | { id: number; email: string; display_name: string; password_hash: string; role_name: 'super_admin' | 'admin' }
      | undefined;

    if (!admin || !verifyPassword(password, admin.password_hash)) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const csrfToken = generateCsrfToken();
    const token = signSessionToken({
      adminId: admin.id,
      email: admin.email,
      role: admin.role_name,
      csrfToken,
    });
    db.prepare("UPDATE admin_users SET last_login_at = datetime('now') WHERE id = ?").run(admin.id);
    res.setHeader(
      'Set-Cookie',
      `nexora_admin_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200`
    );
    res.json({ ok: true, admin: { id: admin.id, email: admin.email, role: admin.role_name, csrfToken } });
  });

  router.post('/auth/logout', (_req, res) => {
    res.setHeader('Set-Cookie', 'nexora_admin_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
    res.json({ ok: true });
  });

  // --- Admin Dashboard Overview ---
  router.get('/admin/overview', requireAdminIfConfigured, (_req, res) => {
    const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
    const activeUsers = (db.prepare("SELECT COUNT(*) as c FROM users WHERE status = 'active'").get() as { c: number }).c;
    const totalConversations = (db.prepare('SELECT COUNT(*) as c FROM conversations').get() as { c: number }).c;
    const totalMessages = (db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number }).c;
    const totalRequests = (db.prepare('SELECT COUNT(*) as c FROM ai_requests').get() as { c: number }).c;
    const errorCount = (db.prepare("SELECT COUNT(*) as c FROM ai_requests WHERE status = 'error'").get() as { c: number }).c;
    const usageTotals = db
      .prepare(
        `SELECT COALESCE(SUM(input_tokens), 0) as inputTokens,
                COALESCE(SUM(output_tokens), 0) as outputTokens,
                COALESCE(SUM(estimated_cost_usd), 0) as totalCost,
                COALESCE(SUM(audio_seconds), 0) as audioSeconds
         FROM usage_records`
      )
      .get() as { inputTokens: number; outputTokens: number; totalCost: number; audioSeconds: number };

    const modelBreakdown = db
      .prepare(
        `SELECT model_id, COUNT(*) as requests, COALESCE(SUM(input_tokens + output_tokens), 0) as tokens,
                COALESCE(SUM(estimated_cost_usd), 0) as cost
         FROM usage_records
         GROUP BY model_id
         ORDER BY tokens DESC`
      )
      .all();

    const recentRequests = db
      .prepare(
        `SELECT r.*, u.display_name as user_name
         FROM ai_requests r
         LEFT JOIN users u ON u.id = r.user_id
         ORDER BY r.id DESC LIMIT 8`
      )
      .all();

    res.json({
      kpis: {
        totalUsers,
        activeUsers,
        totalConversations,
        totalMessages,
        totalRequests,
        errorCount,
        totalTokens: usageTotals.inputTokens + usageTotals.outputTokens,
        inputTokens: usageTotals.inputTokens,
        outputTokens: usageTotals.outputTokens,
        estimatedCostUsd: Number(usageTotals.totalCost.toFixed(5)),
        audioSeconds: Number(usageTotals.audioSeconds.toFixed(1)),
      },
      modelBreakdown,
      recentRequests,
    });
  });

  // --- Users Management ---
  router.get('/admin/users', requireAdminIfConfigured, (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = db
      .prepare(
        `SELECT u.*, s.active_personality_code, s.memory_mode, s.voice_reply_enabled,
                (SELECT COUNT(*) FROM memory_records m WHERE m.user_id = u.id) as memory_count,
                (SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM usage_records r WHERE r.user_id = u.id) as total_tokens,
                (SELECT COALESCE(SUM(estimated_cost_usd), 0) FROM usage_records r WHERE r.user_id = u.id) as total_cost
         FROM users u
         LEFT JOIN user_settings s ON s.user_id = u.id
         ORDER BY u.id DESC`
      )
      .all() as Array<Record<string, unknown>>;

    const filtered = q
      ? rows.filter(
          (r) =>
            String(r.display_name || '').toLowerCase().includes(q) ||
            String(r.username || '').toLowerCase().includes(q) ||
            String(r.telegram_id || '').toLowerCase().includes(q)
        )
      : rows;
    res.json({ users: filtered });
  });

  router.patch('/admin/users/:id', requireAdminIfConfigured, (req, res) => {
    const id = Number(req.params.id);
    const { status, daily_token_limit, monthly_token_limit, daily_request_limit, language } = req.body as {
      status?: 'active' | 'limited' | 'banned';
      daily_token_limit?: number;
      monthly_token_limit?: number;
      daily_request_limit?: number;
      language?: 'fa' | 'en';
    };
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    db.prepare(
      `UPDATE users
       SET status = COALESCE(?, status),
           daily_token_limit = COALESCE(?, daily_token_limit),
           monthly_token_limit = COALESCE(?, monthly_token_limit),
           daily_request_limit = COALESCE(?, daily_request_limit),
           language = COALESCE(?, language),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      status ?? null,
      daily_token_limit ?? null,
      monthly_token_limit ?? null,
      daily_request_limit ?? null,
      language ?? null,
      id
    );
    db.prepare(
      `INSERT INTO audit_logs (actor_type, actor_id, action, resource, details, severity)
       VALUES ('admin', 'console', 'user.updated', ?, ?, 'info')`
    ).run(`user:${id}`, `Updated status/quota for user ${id}`);
    res.json({ user: db.prepare('SELECT * FROM users WHERE id = ?').get(id) });
  });

  // --- Conversations ---
  router.get('/admin/conversations', requireAdminIfConfigured, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT c.*, u.display_name as user_name, u.username,
                (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) as message_count
         FROM conversations c
         JOIN users u ON u.id = c.user_id
         ORDER BY c.updated_at DESC LIMIT 100`
      )
      .all();
    res.json({ conversations: rows });
  });

  router.get('/admin/conversations/:id/messages', requireAdminIfConfigured, (req, res) => {
    const convId = Number(req.params.id);
    const messages = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC')
      .all(convId);
    res.json({ messages });
  });

  // --- Model Registry & AI Router ---
  router.get('/admin/models', requireAdminIfConfigured, (_req, res) => {
    const models = db.prepare('SELECT * FROM ai_models ORDER BY id ASC').all();
    const providers = db.prepare('SELECT * FROM ai_providers ORDER BY priority ASC').all();
    const settings = db.prepare('SELECT * FROM system_settings').all();
    res.json({ models, providers, settings });
  });

  router.post('/admin/models/sync', requireAdminIfConfigured, async (_req, res) => {
    const result = await syncGeminiModelRegistry(db);
    res.json(result);
  });

  router.patch('/admin/models/:id', requireAdminIfConfigured, (req, res) => {
    const id = Number(req.params.id);
    const { is_active, fallback_model_id, input_cost_per_1m, output_cost_per_1m } = req.body as {
      is_active?: number;
      fallback_model_id?: string | null;
      input_cost_per_1m?: number;
      output_cost_per_1m?: number;
    };
    db.prepare(
      `UPDATE ai_models
       SET is_active = COALESCE(?, is_active),
           fallback_model_id = COALESCE(?, fallback_model_id),
           input_cost_per_1m = COALESCE(?, input_cost_per_1m),
           output_cost_per_1m = COALESCE(?, output_cost_per_1m),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(is_active ?? null, fallback_model_id ?? null, input_cost_per_1m ?? null, output_cost_per_1m ?? null, id);
    res.json({ model: db.prepare('SELECT * FROM ai_models WHERE id = ?').get(id) });
  });

  router.patch('/admin/router', requireAdminIfConfigured, (req, res) => {
    const updates = req.body as Record<string, string>;
    const allowedKeys = new Set([
      'default_chat_model',
      'reasoning_model',
      'deep_reasoning_model',
      'lite_model',
      'audio_model',
      'live_model',
      'tts_model',
      'vision_model',
      'local_ai_enabled',
    ]);
    for (const [k, v] of Object.entries(updates)) {
      if (allowedKeys.has(k) && typeof v === 'string') {
        db.prepare("UPDATE system_settings SET value = ?, updated_at = datetime('now') WHERE key = ?").run(v, k);
      }
    }
    res.json({ ok: true });
  });

  // --- Personalities Studio ---
  router.get('/personalities', (_req, res) => {
    const rows = db.prepare('SELECT * FROM personalities ORDER BY is_builtin DESC, id ASC').all();
    res.json({ personalities: rows });
  });

  router.post('/admin/personalities', requireAdminIfConfigured, (req, res) => {
    const b = req.body as {
      code: string;
      name_fa: string;
      name_en: string;
      description_fa?: string;
      description_en?: string;
      system_prompt: string;
      tone?: string;
      humor_level?: number;
      seriousness_level?: number;
      warmth_level?: number;
      behavior_rules?: string;
      language?: 'fa' | 'en' | 'both';
      is_public?: number;
    };
    if (!b.code || !b.name_fa || !b.name_en || !b.system_prompt) {
      res.status(400).json({ error: 'code, name_fa, name_en, and system_prompt are required' });
      return;
    }
    const cleanCode = b.code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const ins = db
      .prepare(
        `INSERT INTO personalities (
          code, name_fa, name_en, description_fa, description_en, system_prompt,
          tone, humor_level, seriousness_level, warmth_level, behavior_rules, language, is_public, is_active, is_builtin
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`
      )
      .run(
        cleanCode,
        b.name_fa.trim(),
        b.name_en.trim(),
        b.description_fa?.trim() || '',
        b.description_en?.trim() || '',
        b.system_prompt.trim(),
        b.tone?.trim() || 'custom',
        Math.min(100, Math.max(0, b.humor_level ?? 30)),
        Math.min(100, Math.max(0, b.seriousness_level ?? 60)),
        Math.min(100, Math.max(0, b.warmth_level ?? 70)),
        b.behavior_rules?.trim() || '',
        b.language || 'both',
        b.is_public ?? 1
      );
    res.status(201).json({ personality: db.prepare('SELECT * FROM personalities WHERE id = ?').get(Number(ins.lastInsertRowid)) });
  });

  router.patch('/admin/personalities/:id', requireAdminIfConfigured, (req, res) => {
    const id = Number(req.params.id);
    const b = req.body as {
      name_fa?: string;
      name_en?: string;
      description_fa?: string;
      description_en?: string;
      system_prompt?: string;
      humor_level?: number;
      seriousness_level?: number;
      warmth_level?: number;
      is_active?: number;
      is_public?: number;
    };
    db.prepare(
      `UPDATE personalities
       SET name_fa = COALESCE(?, name_fa),
           name_en = COALESCE(?, name_en),
           description_fa = COALESCE(?, description_fa),
           description_en = COALESCE(?, description_en),
           system_prompt = COALESCE(?, system_prompt),
           humor_level = COALESCE(?, humor_level),
           seriousness_level = COALESCE(?, seriousness_level),
           warmth_level = COALESCE(?, warmth_level),
           is_active = COALESCE(?, is_active),
           is_public = COALESCE(?, is_public),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      b.name_fa ?? null,
      b.name_en ?? null,
      b.description_fa ?? null,
      b.description_en ?? null,
      b.system_prompt ?? null,
      b.humor_level ?? null,
      b.seriousness_level ?? null,
      b.warmth_level ?? null,
      b.is_active ?? null,
      b.is_public ?? null,
      id
    );
    res.json({ personality: db.prepare('SELECT * FROM personalities WHERE id = ?').get(id) });
  });

  // --- Long-Term Memory Management ---
  router.get('/admin/memories', requireAdminIfConfigured, (req, res) => {
    const userId = req.query.userId ? Number(req.query.userId) : null;
    const query = String(req.query.q || '').trim();
    if (userId && query) {
      const results = retrieveRelevantMemories(db, userId, query, 12);
      res.json({ memories: results });
      return;
    }
    const rows = userId
      ? db
          .prepare(
            `SELECT m.*, u.display_name as user_name
             FROM memory_records m
             JOIN users u ON u.id = m.user_id
             WHERE m.user_id = ?
             ORDER BY m.updated_at DESC`
          )
          .all(userId)
      : db
          .prepare(
            `SELECT m.*, u.display_name as user_name
             FROM memory_records m
             JOIN users u ON u.id = m.user_id
             ORDER BY m.updated_at DESC LIMIT 100`
          )
          .all();
    res.json({ memories: rows });
  });

  router.post('/admin/memories', requireAdminIfConfigured, async (req, res) => {
    const b = req.body as {
      userId: number;
      category: MemoryCategory;
      topicKey: string;
      content: string;
      importance?: number;
      expiresAt?: string | null;
    };
    if (!b.userId || !b.content) {
      res.status(400).json({ error: 'userId and content are required' });
      return;
    }
    const saved = await saveUserMemory(db, {
      userId: Number(b.userId),
      category: b.category || 'long_term',
      topicKey: b.topicKey || 'general',
      content: b.content,
      importance: b.importance ?? 6,
      source: 'manual',
      expiresAt: b.expiresAt ?? null,
    });
    res.status(201).json(saved);
  });

  router.delete('/admin/memories/:id', requireAdminIfConfigured, (req, res) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM memory_records WHERE id = ?').run(id);
    res.json({ ok: true });
  });

  // --- Voice & Live Sessions ---
  router.get('/admin/voice', requireAdminIfConfigured, (_req, res) => {
    const voiceSessions = db
      .prepare(
        `SELECT v.*, u.display_name as user_name
         FROM voice_sessions v
         JOIN users u ON u.id = v.user_id
         ORDER BY v.id DESC LIMIT 50`
      )
      .all();
    const liveSessions = db
      .prepare(
        `SELECT l.*, u.display_name as user_name
         FROM live_sessions l
         JOIN users u ON u.id = l.user_id
         ORDER BY l.id DESC LIMIT 50`
      )
      .all();
    const settings = db
      .prepare("SELECT key, value FROM system_settings WHERE key IN ('live_voice_enabled', 'default_tts_voice', 'tts_model', 'audio_model', 'live_model')")
      .all();
    res.json({ voiceSessions, liveSessions, settings });
  });

  // --- Usage Analytics & Billing ---
  router.get('/admin/analytics', requireAdminIfConfigured, (_req, res) => {
    const byModel = db
      .prepare(
        `SELECT model_id, provider_name,
                COUNT(*) as calls,
                COALESCE(SUM(input_tokens), 0) as input_tokens,
                COALESCE(SUM(output_tokens), 0) as output_tokens,
                COALESCE(SUM(audio_seconds), 0) as audio_seconds,
                COALESCE(SUM(image_count), 0) as image_count,
                COALESCE(SUM(estimated_cost_usd), 0) as estimated_cost_usd
         FROM usage_records
         GROUP BY model_id, provider_name`
      )
      .all();
    const billingLimits = db.prepare('SELECT * FROM billing_limits').all();
    const recentUsage = db
      .prepare(
        `SELECT r.*, u.display_name as user_name
         FROM usage_records r
         JOIN users u ON u.id = r.user_id
         ORDER BY r.id DESC LIMIT 50`
      )
      .all();
    res.json({ byModel, billingLimits, recentUsage });
  });

  router.patch('/admin/billing', requireAdminIfConfigured, (req, res) => {
    const { daily_cost_cap_usd, monthly_cost_cap_usd, alert_threshold_pct, hard_stop_enabled } = req.body as {
      daily_cost_cap_usd?: number;
      monthly_cost_cap_usd?: number;
      alert_threshold_pct?: number;
      hard_stop_enabled?: number;
    };
    db.prepare(
      `UPDATE billing_limits
       SET daily_cost_cap_usd = COALESCE(?, daily_cost_cap_usd),
           monthly_cost_cap_usd = COALESCE(?, monthly_cost_cap_usd),
           alert_threshold_pct = COALESCE(?, alert_threshold_pct),
           hard_stop_enabled = COALESCE(?, hard_stop_enabled),
           updated_at = datetime('now')
       WHERE scope = 'system_global'`
    ).run(
      daily_cost_cap_usd ?? null,
      monthly_cost_cap_usd ?? null,
      alert_threshold_pct ?? null,
      hard_stop_enabled ?? null
    );
    res.json({ limit: db.prepare("SELECT * FROM billing_limits WHERE scope = 'system_global'").get() });
  });

  // --- Tools Management ---
  router.get('/admin/tools', requireAdminIfConfigured, (_req, res) => {
    const tools = db.prepare('SELECT * FROM tool_permissions ORDER BY id ASC').all();
    const executions = db
      .prepare(
        `SELECT e.*, u.display_name as user_name
         FROM tool_executions e
         JOIN users u ON u.id = e.user_id
         ORDER BY e.id DESC LIMIT 40`
      )
      .all();
    res.json({ tools, executions });
  });

  router.patch('/admin/tools/:id', requireAdminIfConfigured, (req, res) => {
    const id = Number(req.params.id);
    const { is_enabled, timeout_ms } = req.body as { is_enabled?: number; timeout_ms?: number };
    db.prepare(
      `UPDATE tool_permissions
       SET is_enabled = COALESCE(?, is_enabled),
           timeout_ms = COALESCE(?, timeout_ms),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(is_enabled ?? null, timeout_ms ?? null, id);
    res.json({ tool: db.prepare('SELECT * FROM tool_permissions WHERE id = ?').get(id) });
  });

  // --- Security, Audit Logs, Jobs, Database, Backup/Restore, Settings ---
  router.get('/admin/security-logs', requireAdminIfConfigured, (_req, res) => {
    const auditLogs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 80').all();
    const aiRequests = db.prepare('SELECT * FROM ai_requests ORDER BY id DESC LIMIT 50').all();
    const jobs = db.prepare('SELECT * FROM background_jobs ORDER BY id DESC LIMIT 30').all();
    const files = db.prepare('SELECT * FROM file_records ORDER BY id DESC LIMIT 30').all();
    const dbHealth = getDatabaseHealth(db);
    res.json({ auditLogs, aiRequests, jobs, files, dbHealth });
  });

  router.post('/admin/backup', requireAdminIfConfigured, (_req, res) => {
    const snapshot = {
      exportedAt: new Date().toISOString(),
      personalities: db.prepare('SELECT * FROM personalities').all(),
      systemSettings: db.prepare('SELECT * FROM system_settings WHERE is_secret = 0').all(),
      billingLimits: db.prepare('SELECT * FROM billing_limits').all(),
      toolPermissions: db.prepare('SELECT * FROM tool_permissions').all(),
      usersCount: (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c,
      memoriesCount: (db.prepare('SELECT COUNT(*) as c FROM memory_records').get() as { c: number }).c,
    };
    db.prepare(
      `INSERT INTO audit_logs (actor_type, actor_id, action, resource, details, severity)
       VALUES ('admin', 'console', 'backup.exported', 'database', 'Configuration & metadata backup generated', 'info')`
    ).run();
    res.json(snapshot);
  });

  router.patch('/admin/settings', requireAdminIfConfigured, (req, res) => {
    const updates = req.body as Record<string, string>;
    for (const [k, v] of Object.entries(updates)) {
      if (typeof v === 'string') {
        db.prepare(
          `INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        ).run(k, v);
      }
    }
    db.prepare(
      `INSERT INTO audit_logs (actor_type, actor_id, action, resource, details, severity)
       VALUES ('admin', 'console', 'settings.updated', 'system_settings', ?, 'info')`
    ).run(`Updated keys: ${Object.keys(updates).join(', ')}`);
    res.json({ ok: true });
  });

  // --- Public / Mini App Endpoints ---
  router.get('/miniapp/bootstrap', (req, res) => {
    const userId = Number(req.query.userId || 1);
    const initData = String(req.headers['x-telegram-init-data'] || '');
    const tgValidated =
      initData && process.env.TELEGRAM_BOT_TOKEN
        ? verifyTelegramWebAppInitData(initData, process.env.TELEGRAM_BOT_TOKEN)
        : false;

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const settings = db.prepare('SELECT * FROM user_settings WHERE user_id = ?').get(userId);
    const personalities = db.prepare('SELECT * FROM personalities WHERE is_active = 1 AND is_public = 1').all();
    const memories = db
      .prepare('SELECT * FROM memory_records WHERE user_id = ? ORDER BY updated_at DESC LIMIT 30')
      .all(userId);
    const conversations = db
      .prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20')
      .all(userId);
    const usage = db
      .prepare(
        `SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as tokens,
                COALESCE(SUM(estimated_cost_usd), 0) as cost
         FROM usage_records WHERE user_id = ?`
      )
      .get(userId);
    const liveEnabled =
      (
        db.prepare("SELECT value FROM system_settings WHERE key = 'live_voice_enabled'").get() as
          | { value: string }
          | undefined
      )?.value !== 'false';

    res.json({
      telegramValidated: tgValidated,
      user,
      settings,
      personalities,
      memories,
      conversations,
      usage,
      liveVoiceEnabled: liveEnabled,
      geminiConfigured: isGeminiConfigured(),
    });
  });

  router.patch('/miniapp/settings', (req, res) => {
    const { userId, active_personality_code, memory_mode, voice_reply_enabled, tts_voice_name, language } =
      req.body as {
        userId: number;
        active_personality_code?: string;
        memory_mode?: MemoryMode;
        voice_reply_enabled?: number;
        tts_voice_name?: string;
        language?: 'fa' | 'en';
      };
    if (!userId) {
      res.status(400).json({ error: 'userId required' });
      return;
    }
    db.prepare(
      `UPDATE user_settings
       SET active_personality_code = COALESCE(?, active_personality_code),
           memory_mode = COALESCE(?, memory_mode),
           voice_reply_enabled = COALESCE(?, voice_reply_enabled),
           tts_voice_name = COALESCE(?, tts_voice_name),
           updated_at = datetime('now')
       WHERE user_id = ?`
    ).run(
      active_personality_code ?? null,
      memory_mode ?? null,
      voice_reply_enabled ?? null,
      tts_voice_name ?? null,
      userId
    );
    if (language) {
      db.prepare("UPDATE users SET language = ?, updated_at = datetime('now') WHERE id = ?").run(language, userId);
    }
    res.json({ ok: true });
  });

  router.post('/miniapp/memories', async (req, res) => {
    const { userId, category, topicKey, content, importance } = req.body as {
      userId: number;
      category?: MemoryCategory;
      topicKey?: string;
      content: string;
      importance?: number;
    };
    if (!userId || !content) {
      res.status(400).json({ error: 'userId and content are required' });
      return;
    }
    const result = await saveUserMemory(db, {
      userId: Number(userId),
      category: category || 'long_term',
      topicKey: topicKey || 'manual_note',
      content,
      importance: importance ?? 7,
      source: 'manual',
    });
    res.status(201).json(result);
  });

  router.delete('/miniapp/memories/:id', (req, res) => {
    const id = Number(req.params.id);
    const userId = Number(req.query.userId || 1);
    db.prepare('DELETE FROM memory_records WHERE id = ? AND user_id = ?').run(id, userId);
    res.json({ ok: true });
  });

  router.get('/miniapp/conversations/:id/messages', (req, res) => {
    const convId = Number(req.params.id);
    const userId = Number(req.query.userId || 1);
    const messages = db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY id ASC')
      .all(convId, userId);
    res.json({ messages });
  });

  // Multimodal Chat Endpoint (text + optional image/PDF/TXT/CSV/JSON upload + optional TTS)
  router.post('/chat', upload.single('file'), async (req, res) => {
    try {
      const userId = Number(req.body.userId || 1);
      const conversationId = req.body.conversationId ? Number(req.body.conversationId) : undefined;
      const message = String(req.body.message || '').trim();
      const personalityCode = req.body.personalityCode ? String(req.body.personalityCode) : undefined;
      const language = req.body.language === 'en' ? 'en' : 'fa';
      const taskHint = req.body.taskHint ? (String(req.body.taskHint) as TaskCategory) : undefined;
      const requestTts = req.body.requestTts === 'true' || req.body.requestTts === true;

      const attachments: Array<{
        fileName: string;
        mimeType: string;
        base64Data: string;
        extractedText?: string;
        sizeBytes: number;
      }> = [];

      if (req.file) {
        const check = validateUploadFile(req.file.originalname, req.file.mimetype, req.file.size);
        if (!check.valid) {
          res.status(400).json({ error: check.reason });
          return;
        }
        const storageDir = path.resolve(process.cwd(), process.env.STORAGE_PATH || 'storage/uploads');
        fs.mkdirSync(storageDir, { recursive: true });
        const safePath = path.join(storageDir, check.safeName);
        fs.writeFileSync(safePath, req.file.buffer);

        const ttlMinutes = Number(process.env.TEMP_FILE_TTL_MINUTES || 30);
        const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
        db.prepare(
          `INSERT INTO file_records (user_id, original_name, safe_name, mime_type, size_bytes, status, expires_at)
           VALUES (?, ?, ?, ?, ?, 'processed', ?)`
        ).run(userId, req.file.originalname, check.safeName, req.file.mimetype, req.file.size, expiresAt);

        const isText =
          req.file.mimetype.startsWith('text/') ||
          req.file.mimetype === 'application/json';
        attachments.push({
          fileName: req.file.originalname,
          mimeType: req.file.mimetype,
          base64Data: req.file.buffer.toString('base64'),
          extractedText: isText ? req.file.buffer.toString('utf8') : undefined,
          sizeBytes: req.file.size,
        });
      }

      if (!message && attachments.length === 0) {
        res.status(400).json({ error: 'Message or valid attachment is required' });
        return;
      }

      const result = await runOrchestratedChat(db, {
        userId,
        conversationId,
        message: message || 'Analyze the attached file.',
        personalityCode,
        language,
        taskHint,
        attachments,
        requestTts,
      });

      res.json(result);
    } catch (err) {
      const status = (err as Error & { statusCode?: number }).statusCode || 500;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Chat execution failed' });
    }
  });

  // Voice Message Upload (Transcribe + AI Orchestrate + TTS reply)
  router.post('/voice/message', upload.single('audio'), async (req, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'Audio file is required' });
        return;
      }
      const userId = Number(req.body.userId || 1);
      const language = req.body.language === 'en' ? 'en' : 'fa';
      const check = validateUploadFile(req.file.originalname, req.file.mimetype, req.file.size);
      if (!check.valid) {
        res.status(400).json({ error: check.reason });
        return;
      }
      const { transcript, modelUsed } = await transcribeAudioBase64(
        db,
        req.file.buffer.toString('base64'),
        req.file.mimetype
      );
      db.prepare(
        `INSERT INTO voice_sessions (user_id, direction, duration_seconds, transcript, model_used, status)
         VALUES (?, 'inbound', ?, ?, ?, 'completed')`
      ).run(userId, Number((req.file.size / 16000).toFixed(1)), transcript, modelUsed);

      const chatResult = await runOrchestratedChat(db, {
        userId,
        message: transcript || '[Unintelligible audio]',
        language,
        requestTts: true,
      });

      res.json({ transcript, ...chatResult });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Voice processing failed' });
    }
  });

  // Standalone TTS preview
  router.post('/voice/tts', async (req, res) => {
    try {
      const { text, voiceName } = req.body as { text?: string; voiceName?: string };
      if (!text) {
        res.status(400).json({ error: 'Text is required' });
        return;
      }
      const tts = await generateSpeechWavBase64(db, text, voiceName || 'Kore');
      res.json(tts);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'TTS synthesis failed' });
    }
  });

  // Telegram Bot Webhook Endpoint
  router.post('/telegram/webhook', async (req, res) => {
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
    if (process.env.TELEGRAM_WEBHOOK_SECRET && !verifyWebhookSecretHeader(String(secretHeader || ''))) {
      res.status(403).json({ error: 'Invalid Telegram webhook secret' });
      return;
    }
    const result = await handleTelegramUpdate(db, req.body as Record<string, unknown>);
    res.json(result);
  });

  return router;
}
