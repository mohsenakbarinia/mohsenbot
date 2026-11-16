import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './security.ts';

let dbInstance: DatabaseSync | null = null;

export function getDbPath(): string {
  return process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), 'data', 'nexora.db');
}

export function getDb(): DatabaseSync {
  if (dbInstance) return dbInstance;
  const dbPath = getDbPath();
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  runMigrations(db);
  dbInstance = db;
  return db;
}

export function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set<string>(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>).map(
      (r) => r.version
    )
  );

  if (!applied.has('001_initial_schema')) {
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT UNIQUE,
        username TEXT NOT NULL,
        display_name TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'fa',
        status TEXT NOT NULL DEFAULT 'active',
        daily_token_limit INTEGER NOT NULL DEFAULT 150000,
        monthly_token_limit INTEGER NOT NULL DEFAULT 2500000,
        daily_request_limit INTEGER NOT NULL DEFAULT 250,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE user_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        active_personality_code TEXT NOT NULL DEFAULT 'AUTO',
        memory_mode TEXT NOT NULL DEFAULT 'auto',
        voice_reply_enabled INTEGER NOT NULL DEFAULT 1,
        tts_voice_name TEXT NOT NULL DEFAULT 'Kore',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE personalities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name_fa TEXT NOT NULL,
        name_en TEXT NOT NULL,
        description_fa TEXT NOT NULL,
        description_en TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        tone TEXT NOT NULL,
        humor_level INTEGER NOT NULL DEFAULT 30,
        seriousness_level INTEGER NOT NULL DEFAULT 60,
        warmth_level INTEGER NOT NULL DEFAULT 70,
        behavior_rules TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT 'both',
        is_public INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1,
        is_builtin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'telegram',
        personality_code TEXT NOT NULL DEFAULT 'AUTO',
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_conversations_user ON conversations(user_id);

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        modality TEXT NOT NULL DEFAULT 'text',
        model_used TEXT,
        tokens_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_messages_conv ON messages(conversation_id);

      CREATE TABLE memory_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        topic_key TEXT NOT NULL,
        content TEXT NOT NULL,
        importance INTEGER NOT NULL DEFAULT 5,
        source TEXT NOT NULL DEFAULT 'auto',
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_memory_user ON memory_records(user_id);

      CREATE TABLE memory_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id INTEGER NOT NULL UNIQUE REFERENCES memory_records(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        embedding_json TEXT NOT NULL,
        model_name TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_mem_embed_user ON memory_embeddings(user_id);

      CREATE TABLE conversation_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        summary_text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE ai_providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        provider_type TEXT NOT NULL,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        priority INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'configured',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE ai_models (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_name TEXT NOT NULL,
        model_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        task_category TEXT NOT NULL,
        supports_vision INTEGER NOT NULL DEFAULT 0,
        supports_audio INTEGER NOT NULL DEFAULT 0,
        supports_tools INTEGER NOT NULL DEFAULT 0,
        supports_live INTEGER NOT NULL DEFAULT 0,
        is_available INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1,
        input_cost_per_1m REAL NOT NULL DEFAULT 0,
        output_cost_per_1m REAL NOT NULL DEFAULT 0,
        fallback_model_id TEXT,
        last_checked_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE ai_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        request_hash TEXT NOT NULL,
        task_category TEXT NOT NULL,
        provider_name TEXT NOT NULL,
        model_id TEXT NOT NULL,
        fallback_used INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        error_message TEXT,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_ai_requests_user ON ai_requests(user_id);

      CREATE TABLE usage_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider_name TEXT NOT NULL,
        model_id TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        audio_seconds REAL NOT NULL DEFAULT 0,
        image_count INTEGER NOT NULL DEFAULT 0,
        estimated_cost_usd REAL NOT NULL DEFAULT 0,
        is_estimated INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_usage_user ON usage_records(user_id);

      CREATE TABLE billing_limits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL UNIQUE,
        daily_cost_cap_usd REAL NOT NULL DEFAULT 25.0,
        monthly_cost_cap_usd REAL NOT NULL DEFAULT 400.0,
        alert_threshold_pct INTEGER NOT NULL DEFAULT 80,
        hard_stop_enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE tool_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name TEXT NOT NULL UNIQUE,
        description_fa TEXT NOT NULL,
        description_en TEXT NOT NULL,
        is_enabled INTEGER NOT NULL DEFAULT 1,
        requires_auth INTEGER NOT NULL DEFAULT 0,
        timeout_ms INTEGER NOT NULL DEFAULT 5000,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE tool_executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        arguments_json TEXT NOT NULL,
        status TEXT NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE voice_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        direction TEXT NOT NULL,
        duration_seconds REAL NOT NULL DEFAULT 0,
        transcript TEXT,
        model_used TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE live_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_uuid TEXT NOT NULL UNIQUE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        voice_name TEXT NOT NULL DEFAULT 'Zephyr',
        status TEXT NOT NULL DEFAULT 'active',
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE admin_roles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        permissions_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role_name TEXT NOT NULL DEFAULT 'admin',
        is_active INTEGER NOT NULL DEFAULT 1,
        last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        details TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_audit_created ON audit_logs(created_at);

      CREATE TABLE system_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        is_secret INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE background_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        attempts INTEGER NOT NULL DEFAULT 1,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE file_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        original_name TEXT NOT NULL,
        safe_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'processed',
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run('001_initial_schema');
  }

  if (!applied.has('002_seed_defaults')) {
    seedDefaults(db);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run('002_seed_defaults');
  }
}

function seedDefaults(db: DatabaseSync): void {
  const personalities: Array<[string, string, string, string, string, string, string, number, number, number, string]> = [
    [
      'AUTO',
      'هوشمند تطبیقی',
      'Adaptive Auto',
      'انتخاب خودکار بهترین لحن متناسب با بافت گفتگو و زبان کاربر.',
      'Automatically adapts tone and depth to match user context and language.',
      'Adapt naturally to the user intent, responding clearly, accurately, and concisely in the user language.',
      'adaptive',
      35,
      65,
      75,
      'Match user formality; prioritize accuracy.',
    ],
    [
      'FRIENDLY',
      'صمیمی و همراه',
      'Friendly',
      'پاسخگویی گرم، محترمانه و انگیزه‌بخش برای مکالمات روزمره.',
      'Warm, supportive, and approachable conversational assistant.',
      'Speak with genuine warmth and encouragement while remaining helpful and concise.',
      'warm',
      45,
      40,
      95,
      'Be encouraging, empathetic, and clear.',
    ],
    [
      'PROFESSIONAL',
      'حرفه‌ای و اجرایی',
      'Professional',
      'ساختاریافته، دقیق و متمرکز بر تصمیم‌گیری و خروجی کاری.',
      'Structured, crisp, executive-grade communication focused on actionable output.',
      'Deliver structured, analytical, and precise answers suitable for engineering and business leadership.',
      'executive',
      10,
      90,
      45,
      'Use clear structure, bullet points when useful, and zero fluff.',
    ],
    [
      'SERIOUS',
      'جدی و تحلیلی',
      'Serious',
      'لحن مستقیم، بدون شوخی و متمرکز بر واقعیت‌ها و استدلال.',
      'Direct, factual, analytical tone without humor or filler.',
      'Maintain a strictly serious, matter-of-fact tone grounded in evidence and logic.',
      'serious',
      0,
      95,
      30,
      'Avoid jokes or casual filler; stay focused on facts.',
    ],
    [
      'FUNNY',
      'شوخ‌طبع و خلاق',
      'Funny',
      'دارای طنز هوشمندانه و مثال‌های سرگرم‌کننده بدون لطمه به دقت پاسخ.',
      'Witty and lighthearted responses with clever analogies while keeping facts accurate.',
      'Include tasteful wit and clever analogies while still answering the user question accurately.',
      'witty',
      90,
      30,
      80,
      'Never compromise factual accuracy for a joke; keep humor respectful.',
    ],
    [
      'GRUMPY',
      'غرغرو اما کارراه‌انداز',
      'Grumpy',
      'ظاهراً کم‌حوصله و منتقد اما پاسخ‌های دقیق و کامل ارائه می‌دهد.',
      'Reluctantly helpful with dry, mildly grumpy banter while solving the problem accurately.',
      'Respond with dry, theatrical grumpiness like a seasoned perfectionist engineer, yet always provide accurate help.',
      'grumpy',
      55,
      60,
      25,
      'Never be genuinely abusive or refuse safe requests; keep grumpiness playful.',
    ],
    [
      'ANGRY',
      'تند و قاطع',
      'Fierce & Blunt',
      'لحن تند و پرانرژی به سبک مربی سخت‌گیر بدون توهین شخصی.',
      'High-intensity, blunt drill-sergeant energy without personal insults or harm.',
      'Speak with high-intensity blunt urgency like a strict performance coach, pushing the user toward clarity while staying respectful and safe.',
      'intense',
      25,
      85,
      15,
      'Never use hate speech, profanity, or unsafe advice.',
    ],
  ];

  const insertPers = db.prepare(`
    INSERT INTO personalities (
      code, name_fa, name_en, description_fa, description_en, system_prompt,
      tone, humor_level, seriousness_level, warmth_level, behavior_rules, language, is_public, is_active, is_builtin
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'both', 1, 1, 1)
  `);
  for (const p of personalities) {
    insertPers.run(...p);
  }

  // Providers
  db.prepare(`INSERT INTO ai_providers (name, provider_type, is_enabled, priority, status) VALUES (?, ?, ?, ?, ?)`).run(
    'google_gemini',
    'cloud',
    1,
    1,
    process.env.GEMINI_API_KEY ? 'connected' : 'awaiting_key'
  );
  db.prepare(`INSERT INTO ai_providers (name, provider_type, is_enabled, priority, status) VALUES (?, ?, ?, ?, ?)`).run(
    'local_ai',
    'local',
    process.env.LOCAL_AI_ENABLED === 'true' ? 1 : 0,
    2,
    process.env.LOCAL_AI_ENABLED === 'true' ? 'configured' : 'disabled'
  );

  // Active verified Gemini models from current SDK guide
  const models: Array<[string, string, string, string, number, number, number, number, number, number, string | null]> = [
    ['google_gemini', 'gemini-4-hydrogen', 'Gemini 4 Hydrogen (Default Chat & Vision)', 'general_chat', 1, 1, 1, 0, 0.15, 0.60, 'gemini-3.1-flash-lite'],
    ['google_gemini', 'gemini-4-argon', 'Gemini 4 Argon (Complex Reasoning)', 'reasoning', 1, 1, 1, 0, 1.25, 5.00, 'gemini-4-hydrogen'],
    ['google_gemini', 'gemini-4-carbon', 'Gemini 4 Carbon (Deep Architecture & Audit)', 'deep_reasoning', 1, 0, 1, 0, 2.50, 10.00, 'gemini-4-argon'],
    ['google_gemini', 'gemini-3.1-flash-lite', 'Gemini 3.1 Flash Lite (Economy)', 'lite', 1, 0, 1, 0, 0.075, 0.30, 'gemini-4-hydrogen'],
    ['google_gemini', 'gemini-3.5-transcribe', 'Gemini 3.5 Transcribe (Audio STT)', 'audio_transcription', 0, 1, 0, 0, 0.10, 0.40, 'gemini-4-hydrogen'],
    ['google_gemini', 'gemini-3.8-live', 'Gemini 3.8 Live (Real-Time Voice)', 'live_voice', 0, 1, 1, 1, 0.35, 1.40, null],
    ['google_gemini', 'gemini-3.8-flash-lite-tts', 'Gemini 3.8 Flash Lite TTS', 'tts', 0, 1, 0, 0, 0.15, 0.60, null],
    ['google_gemini', 'gemini-3.8-flash-tts', 'Gemini 3.8 Flash TTS (Studio)', 'tts', 0, 1, 0, 0, 0.30, 1.20, 'gemini-3.8-flash-lite-tts'],
  ];
  const insertModel = db.prepare(`
    INSERT INTO ai_models (
      provider_name, model_id, display_name, task_category,
      supports_vision, supports_audio, supports_tools, supports_live,
      input_cost_per_1m, output_cost_per_1m, fallback_model_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const m of models) {
    insertModel.run(...m);
  }

  // Billing default
  db.prepare(`
    INSERT INTO billing_limits (scope, daily_cost_cap_usd, monthly_cost_cap_usd, alert_threshold_pct, hard_stop_enabled)
    VALUES ('system_global', 25.0, 500.0, 80, 1)
  `).run();

  // Tools
  const tools: Array<[string, string, string, number, number]> = [
    ['calculator', 'محاسبات ریاضی دقیق و ایمن', 'Safe mathematical expression evaluator', 1, 2000],
    ['datetime', 'دریافت تاریخ و زمان شمسی و میلادی', 'Current Gregorian and Persian Jalali date/time', 1, 2000],
    ['text_summarizer', 'خلاصه‌سازی متون طولانی و گزارش‌ها', 'Structured text summarization', 1, 5000],
    ['document_analyzer', 'تحلیل اسناد متنی، PDF، CSV و JSON', 'Document extraction and structured analysis', 1, 8000],
    ['image_analyzer', 'تحلیل تصاویر ارسال‌شده با بینایی ماشین', 'Vision-based image inspection', 1, 8000],
    ['memory_search', 'جستجو در حافظه بلندمدت اختصاصی کاربر', 'Scoped semantic search over user long-term memory', 1, 3000],
    ['user_profile', 'خواندن تنظیمات و ترجیحات کاربر فعلی', 'Read isolated user preferences and quota', 1, 2000],
    ['translator', 'ترجمه دقیق فارسی و انگلیسی و سایر زبان‌ها', 'Bilingual and multilingual translation', 1, 5000],
    ['web_search', 'جستجوی وب از طریق ارائه‌دهنده تنظیم‌شده', 'Configurable web search provider (Gemini Grounding)', 1, 8000],
  ];
  const insertTool = db.prepare(`
    INSERT INTO tool_permissions (tool_name, description_fa, description_en, is_enabled, timeout_ms)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const t of tools) {
    insertTool.run(...t);
  }

  // Admin roles
  db.prepare(`INSERT INTO admin_roles (name, permissions_json) VALUES (?, ?)`).run(
    'super_admin',
    JSON.stringify(['*'])
  );
  db.prepare(`INSERT INTO admin_roles (name, permissions_json) VALUES (?, ?)`).run(
    'admin',
    JSON.stringify(['dashboard:read', 'users:manage', 'personalities:manage', 'memories:manage', 'analytics:read'])
  );

  // Bootstrap Admin ONLY from environment variables (never hardcoded password)
  const bootstrapEmail = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const bootstrapPass = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (bootstrapEmail && bootstrapPass && bootstrapPass.length >= 8) {
    db.prepare(`
      INSERT INTO admin_users (email, display_name, password_hash, role_name, is_active)
      VALUES (?, 'NEXORA Super Admin', ?, 'super_admin', 1)
    `).run(bootstrapEmail.trim().toLowerCase(), hashPassword(bootstrapPass));
  }

  // System settings
  const settings: Array<[string, string, string]> = [
    ['default_chat_model', process.env.GEMINI_DEFAULT_MODEL || 'gemini-4-hydrogen', 'Primary general conversation model'],
    ['reasoning_model', process.env.GEMINI_REASONING_MODEL || 'gemini-4-argon', 'Reasoning and coding model'],
    ['deep_reasoning_model', process.env.GEMINI_DEEP_REASONING_MODEL || 'gemini-4-carbon', 'Deep architecture and audit model'],
    ['lite_model', process.env.GEMINI_LITE_MODEL || 'gemini-3.1-flash-lite', 'Low-cost high-throughput model'],
    ['audio_model', process.env.GEMINI_AUDIO_MODEL || 'gemini-3.5-transcribe', 'Pre-recorded audio transcription model'],
    ['live_model', process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live', 'Real-time Live Voice WebSocket model'],
    ['tts_model', process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-lite-tts', 'Text-to-Speech synthesis model'],
    ['vision_model', process.env.GEMINI_DEFAULT_MODEL || 'gemini-4-hydrogen', 'Multimodal image analysis model'],
    ['live_voice_enabled', 'true', 'Toggle Telegram Mini App Live Voice feature'],
    ['local_ai_enabled', process.env.LOCAL_AI_ENABLED === 'true' ? 'true' : 'false', 'Enable Ollama/GGUF local fallback'],
    ['telegram_mode', process.env.TELEGRAM_MODE || 'polling', 'Telegram transport mode: polling or webhook'],
    ['default_tts_voice', 'Kore', 'Default prebuilt Gemini TTS voice'],
    ['web_search_enabled', 'true', 'Allow web_search tool when Gemini key is available'],
    ['temp_file_ttl_minutes', '30', 'Automatic cleanup window for uploaded temporary files'],
  ];
  const insertSetting = db.prepare(`INSERT INTO system_settings (key, value, description) VALUES (?, ?, ?)`);
  for (const s of settings) {
    insertSetting.run(...s);
  }

  // Seed deterministic initial public users so workspace journeys are immediately testable
  const u1 = db.prepare(`
    INSERT INTO users (telegram_id, username, display_name, language, status, daily_token_limit, monthly_token_limit, daily_request_limit)
    VALUES ('tg_1001', 'sara_rahimi', 'سارا رحیمی', 'fa', 'active', 200000, 3000000, 300)
  `).run();
  const u2 = db.prepare(`
    INSERT INTO users (telegram_id, username, display_name, language, status, daily_token_limit, monthly_token_limit, daily_request_limit)
    VALUES ('tg_1002', 'alex_mercer', 'Alex Mercer', 'en', 'active', 150000, 2000000, 200)
  `).run();
  const u3 = db.prepare(`
    INSERT INTO users (telegram_id, username, display_name, language, status, daily_token_limit, monthly_token_limit, daily_request_limit)
    VALUES ('tg_1003', 'omid_karimi', 'امید کریمی', 'fa', 'limited', 50000, 800000, 80)
  `).run();

  const u1Id = Number(u1.lastInsertRowid);
  const u2Id = Number(u2.lastInsertRowid);
  const u3Id = Number(u3.lastInsertRowid);

  db.prepare(`INSERT INTO user_settings (user_id, active_personality_code, memory_mode, voice_reply_enabled, tts_voice_name) VALUES (?, 'AUTO', 'auto', 1, 'Kore')`).run(u1Id);
  db.prepare(`INSERT INTO user_settings (user_id, active_personality_code, memory_mode, voice_reply_enabled, tts_voice_name) VALUES (?, 'PROFESSIONAL', 'auto', 1, 'Zephyr')`).run(u2Id);
  db.prepare(`INSERT INTO user_settings (user_id, active_personality_code, memory_mode, voice_reply_enabled, tts_voice_name) VALUES (?, 'FRIENDLY', 'manual', 0, 'Puck')`).run(u3Id);

  const c1 = db.prepare(`INSERT INTO conversations (user_id, title, channel, personality_code) VALUES (?, 'برنامه‌ریزی معماری سیستم', 'telegram', 'PROFESSIONAL')`).run(u1Id);
  const c2 = db.prepare(`INSERT INTO conversations (user_id, title, channel, personality_code) VALUES (?, 'API Latency Investigation', 'miniapp', 'AUTO')`).run(u2Id);

  db.prepare(`INSERT INTO messages (conversation_id, user_id, role, content, modality, model_used, tokens_count) VALUES (?, ?, 'user', 'سلام! برای استقرار سرویس FastAPI با PostgreSQL و pgvector چه پیشنهادی داری؟', 'text', NULL, 24)`).run(Number(c1.lastInsertRowid), u1Id);
  db.prepare(`INSERT INTO messages (conversation_id, user_id, role, content, modality, model_used, tokens_count) VALUES (?, ?, 'assistant', 'برای استقرار پایدار توصیه می‌شود PostgreSQL با افزونه pgvector در یک کانتینر مجزا با Volume دائمی و Connection Pool تنظیم شود و Alembic پیش از راه‌اندازی سرویس اجرا گردد.', 'text', 'gemini-4-hydrogen', 142)`).run(Number(c1.lastInsertRowid), u1Id);
  db.prepare(`INSERT INTO messages (conversation_id, user_id, role, content, modality, model_used, tokens_count) VALUES (?, ?, 'user', 'Summarize the key considerations for 16kHz PCM audio streaming.', 'text', NULL, 18)`).run(Number(c2.lastInsertRowid), u2Id);

  db.prepare(`INSERT INTO memory_records (user_id, category, topic_key, content, importance, source) VALUES (?, 'preferences', 'response_format', 'کاربر پاسخ‌های ساختاریافته با مثال‌های عملی به زبان فارسی را ترجیح می‌دهد.', 8, 'auto')`).run(u1Id);
  db.prepare(`INSERT INTO memory_records (user_id, category, topic_key, content, importance, source) VALUES (?, 'user_profile', 'role', 'توسعه‌دهنده بک‌اند پایتون و علاقه‌مند به معماری میکروسرویس', 9, 'manual')`).run(u1Id);
  db.prepare(`INSERT INTO memory_records (user_id, category, topic_key, content, importance, source) VALUES (?, 'preferences', 'stack', 'Alex works primarily with TypeScript, Vite, and low-latency WebSocket audio pipelines.', 8, 'auto')`).run(u2Id);

  db.prepare(`INSERT INTO usage_records (user_id, provider_name, model_id, input_tokens, output_tokens, audio_seconds, image_count, estimated_cost_usd, is_estimated) VALUES (?, 'google_gemini', 'gemini-4-hydrogen', 1450, 3200, 0, 0, 0.00214, 1)`).run(u1Id);
  db.prepare(`INSERT INTO usage_records (user_id, provider_name, model_id, input_tokens, output_tokens, audio_seconds, image_count, estimated_cost_usd, is_estimated) VALUES (?, 'google_gemini', 'gemini-4-argon', 820, 1950, 0, 1, 0.01078, 1)`).run(u2Id);
  db.prepare(`INSERT INTO usage_records (user_id, provider_name, model_id, input_tokens, output_tokens, audio_seconds, image_count, estimated_cost_usd, is_estimated) VALUES (?, 'google_gemini', 'gemini-3.8-live', 400, 900, 42.5, 0, 0.0014, 1)`).run(u1Id);

  db.prepare(`INSERT INTO audit_logs (actor_type, actor_id, action, resource, details, severity) VALUES ('system', 'bootstrap', 'schema.migrated', 'database', 'Initial NEXORA AI schema and defaults initialized', 'info')`).run();
}

export function getDatabaseHealth(db: DatabaseSync): {
  ok: boolean;
  driver: string;
  migrationsApplied: number;
  tablesCount: number;
  totalRows: number;
} {
  try {
    const migrations = db.prepare('SELECT COUNT(*) as c FROM schema_migrations').get() as { c: number };
    const tables = db
      .prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .get() as { c: number };
    const users = db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number };
    const messages = db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number };
    return {
      ok: true,
      driver: 'sqlite (node:sqlite)',
      migrationsApplied: migrations.c,
      tablesCount: tables.c,
      totalRows: users.c + messages.c,
    };
  } catch {
    return { ok: false, driver: 'sqlite (node:sqlite)', migrationsApplied: 0, tablesCount: 0, totalRows: 0 };
  }
}
