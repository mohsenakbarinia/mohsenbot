import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { runOrchestratedChat } from './orchestrator.ts';
import type { LanguageCode, UserRecord } from './types.ts';

export function isTelegramConfigured(): boolean {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  return Boolean(token && token.includes(':') && token.length > 25);
}

export function getTelegramMenuKeyboard(lang: LanguageCode) {
  if (lang === 'en') {
    return {
      keyboard: [
        [{ text: '💬 New Chat' }, { text: '🎭 Select Personality' }],
        [{ text: '🧠 My Memory' }, { text: '🎙 Live Voice' }],
        [{ text: '📁 Send File' }, { text: '📊 Usage & Quota' }],
        [{ text: '⚙️ Settings' }, { text: '❓ Help' }],
      ],
      resize_keyboard: true,
    };
  }
  return {
    keyboard: [
      [{ text: '💬 گفتگوی جدید' }, { text: '🎭 انتخاب شخصیت' }],
      [{ text: '🧠 حافظه من' }, { text: '🎙 گفتگوی صوتی' }],
      [{ text: '📁 ارسال فایل' }, { text: '📊 میزان مصرف' }],
      [{ text: '⚙️ تنظیمات' }, { text: '❓ راهنما' }],
    ],
    resize_keyboard: true,
  };
}

async function callTelegramApi(method: string, body: Record<string, unknown>): Promise<unknown> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not configured');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export function verifyWebhookSecretHeader(headerToken: string | undefined): boolean {
  const configured = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!configured) return false;
  if (!headerToken) return false;
  const a = Buffer.from(headerToken);
  const b = Buffer.from(configured);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function findOrCreateTelegramUser(
  db: DatabaseSync,
  tgUser: { id: number | string; username?: string; first_name?: string; language_code?: string }
): UserRecord {
  const tgId = String(tgUser.id);
  const existing = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(tgId) as UserRecord | undefined;
  if (existing) return existing;

  const lang: LanguageCode = tgUser.language_code?.startsWith('en') ? 'en' : 'fa';
  const res = db
    .prepare(
      `INSERT INTO users (telegram_id, username, display_name, language, status)
       VALUES (?, ?, ?, ?, 'active')`
    )
    .run(tgId, tgUser.username || `tg_${tgId}`, tgUser.first_name || `User ${tgId}`, lang);

  const userId = Number(res.lastInsertRowid);
  db.prepare(
    `INSERT INTO user_settings (user_id, active_personality_code, memory_mode, voice_reply_enabled, tts_voice_name)
     VALUES (?, 'AUTO', 'auto', 1, 'Kore')`
  ).run(userId);

  return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as UserRecord;
}

export async function handleTelegramUpdate(db: DatabaseSync, update: Record<string, unknown>): Promise<{ ok: boolean }> {
  const message = update.message as
    | {
        chat: { id: number };
        from?: { id: number; username?: string; first_name?: string; language_code?: string };
        text?: string;
      }
    | undefined;

  if (!message?.from || !message.chat) {
    return { ok: true };
  }

  const user = findOrCreateTelegramUser(db, message.from);
  const text = (message.text || '').trim();
  const chatId = message.chat.id;

  if (text === '/start' || text === '💬 گفتگوی جدید' || text === '💬 New Chat') {
    const conv = db
      .prepare('INSERT INTO conversations (user_id, title, channel, personality_code) VALUES (?, ?, ?, ?)')
      .run(user.id, text === '/start' ? 'Telegram Start' : 'New Chat', 'telegram', 'AUTO');

    const welcome =
      user.language === 'en'
        ? `Welcome to NEXORA AI! Conversation #${conv.lastInsertRowid} started. Send text, voice, images, or PDFs.`
        : `به NEXORA AI خوش آمدید! گفتگوی جدید (#${conv.lastInsertRowid}) آماده است. پیام متنی، تصویر، فایل PDF یا ویس ارسال کنید.`;

    if (isTelegramConfigured()) {
      await callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: welcome,
        reply_markup: getTelegramMenuKeyboard(user.language),
      });
    }
    return { ok: true };
  }

  if (text === '/help' || text === '❓ راهنما' || text === '❓ Help') {
    const helpText =
      user.language === 'en'
        ? 'NEXORA AI supports multimodal chat, long-term memory, custom personalities, document summarization, and Live Voice Mini App.'
        : 'دستیار NEXORA AI از گفتگوی متنی، تحلیل تصویر و PDF، ویس، حافظه بلندمدت اختصاصی، شخصیت‌های متنوع و مکالمه صوتی زنده پشتیبانی می‌کند.';
    if (isTelegramConfigured()) {
      await callTelegramApi('sendMessage', { chat_id: chatId, text: helpText });
    }
    return { ok: true };
  }

  if (!text) return { ok: true };

  const activeConv = db
    .prepare('SELECT id FROM conversations WHERE user_id = ? ORDER BY id DESC LIMIT 1')
    .get(user.id) as { id: number } | undefined;

  try {
    const result = await runOrchestratedChat(db, {
      userId: user.id,
      conversationId: activeConv?.id,
      message: text,
      language: user.language,
    });
    if (isTelegramConfigured()) {
      await callTelegramApi('sendMessage', { chat_id: chatId, text: result.reply });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Service temporarily unavailable';
    if (isTelegramConfigured()) {
      await callTelegramApi('sendMessage', { chat_id: chatId, text: errMsg });
    }
  }
  return { ok: true };
}
