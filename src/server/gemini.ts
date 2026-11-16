import { GoogleGenAI } from '@google/genai';
import type { DatabaseSync } from 'node:sqlite';
import type { AIModelRecord, TaskCategory } from './types.ts';
import { redactSecrets } from './security.ts';

export interface ClassifiedGeminiError {
  code: number;
  status: string;
  transient: boolean;
  configurationRequired: boolean;
  userMessageFa: string;
  userMessageEn: string;
  rawMessage: string;
}

export function isGeminiConfigured(): boolean {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(key && key.trim().length > 10 && !key.startsWith('MY_GEMINI'));
}

export function createGeminiClient(): GoogleGenAI | null {
  if (!isGeminiConfigured()) return null;
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function classifyGeminiError(err: unknown): ClassifiedGeminiError {
  const msg = redactSecrets(err instanceof Error ? err.message : String(err));
  const lower = msg.toLowerCase();

  if (!isGeminiConfigured() || lower.includes('api_key_invalid') || lower.includes('api key not valid')) {
    return {
      code: 401,
      status: 'CONFIGURATION_REQUIRED',
      transient: false,
      configurationRequired: true,
      userMessageFa: 'کلید واقعی GEMINI_API_KEY در سرور تنظیم نشده یا نامعتبر است.',
      userMessageEn: 'GEMINI_API_KEY is not configured or invalid on the server.',
      rawMessage: msg,
    };
  }
  if (lower.includes('permission_denied') || lower.includes('403')) {
    return {
      code: 403,
      status: 'PERMISSION_DENIED',
      transient: false,
      configurationRequired: true,
      userMessageFa: 'دسترسی به این مدل Gemini مجاز نیست. لطفاً سطح دسترسی کلید API را بررسی کنید.',
      userMessageEn: 'Permission denied for this Gemini model. Check API key tier.',
      rawMessage: msg,
    };
  }
  if (lower.includes('resource_exhausted') || lower.includes('429') || lower.includes('quota')) {
    return {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      transient: true,
      configurationRequired: false,
      userMessageFa: 'سهمیه درخواست لحظه‌ای Gemini تکمیل شده است؛ در حال بررسی مدل جایگزین.',
      userMessageEn: 'Gemini rate limit or quota reached; evaluating fallback model.',
      rawMessage: msg,
    };
  }
  if (lower.includes('not_found') || lower.includes('404')) {
    return {
      code: 404,
      status: 'MODEL_NOT_FOUND',
      transient: false,
      configurationRequired: false,
      userMessageFa: 'مدل انتخاب‌شده در رجیستری فعلی Gemini یافت نشد.',
      userMessageEn: 'Selected model was not found in active Gemini registry.',
      rawMessage: msg,
    };
  }
  if (lower.includes('timeout') || lower.includes('503') || lower.includes('500') || lower.includes('econnreset')) {
    return {
      code: 503,
      status: 'TRANSIENT_UPSTREAM',
      transient: true,
      configurationRequired: false,
      userMessageFa: 'اختلال موقت در ارتباط با سرویس Gemini رخ داد.',
      userMessageEn: 'Temporary upstream issue connecting to Gemini.',
      rawMessage: msg,
    };
  }
  return {
    code: 502,
    status: 'UPSTREAM_ERROR',
    transient: false,
    configurationRequired: false,
    userMessageFa: 'خطا در پردازش درخواست هوش مصنوعی.',
    userMessageEn: 'Error processing AI request.',
    rawMessage: msg,
  };
}

export function selectModelForTask(db: DatabaseSync, task: TaskCategory): AIModelRecord | null {
  const settingMap: Record<TaskCategory, string> = {
    general_chat: 'default_chat_model',
    reasoning: 'reasoning_model',
    deep_reasoning: 'deep_reasoning_model',
    lite: 'lite_model',
    audio_transcription: 'audio_model',
    live_voice: 'live_model',
    tts: 'tts_model',
    vision: 'vision_model',
  };
  const settingKey = settingMap[task];
  const settingRow = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(settingKey) as
    | { value: string }
    | undefined;

  if (settingRow?.value) {
    const preferred = db
      .prepare('SELECT * FROM ai_models WHERE model_id = ? AND is_active = 1 AND is_available = 1')
      .get(settingRow.value) as AIModelRecord | undefined;
    if (preferred) return preferred;
  }

  const byTask = db
    .prepare(
      'SELECT * FROM ai_models WHERE task_category = ? AND is_active = 1 AND is_available = 1 ORDER BY id ASC LIMIT 1'
    )
    .get(task) as AIModelRecord | undefined;
  if (byTask) return byTask;

  return (
    (db
      .prepare('SELECT * FROM ai_models WHERE is_active = 1 AND is_available = 1 ORDER BY id ASC LIMIT 1')
      .get() as AIModelRecord | undefined) ?? null
  );
}

export async function syncGeminiModelRegistry(db: DatabaseSync): Promise<{
  synced: boolean;
  discoveredCount: number;
  liveApiModels: string[];
  error?: string;
}> {
  const ai = createGeminiClient();
  if (!ai) {
    return {
      synced: false,
      discoveredCount: 0,
      liveApiModels: [],
      error: 'GEMINI_API_KEY is not configured in environment.',
    };
  }

  try {
    const pager = await ai.models.list({ config: { pageSize: 50 } });
    const liveIds: string[] = [];
    for await (const model of pager) {
      if (model.name) {
        const cleanId = model.name.replace(/^models\//, '');
        liveIds.push(cleanId);
      }
    }

    const now = new Date().toISOString();
    const existing = db.prepare('SELECT model_id FROM ai_models').all() as Array<{ model_id: string }>;
    const liveSet = new Set(liveIds);

    for (const row of existing) {
      const available = liveSet.size === 0 || liveSet.has(row.model_id) ? 1 : 0;
      db.prepare('UPDATE ai_models SET is_available = ?, last_checked_at = ?, updated_at = ? WHERE model_id = ?').run(
        available,
        now,
        now,
        row.model_id
      );
    }

    db.prepare("UPDATE ai_providers SET status = 'connected', updated_at = ? WHERE name = 'google_gemini'").run(now);
    return { synced: true, discoveredCount: liveIds.length, liveApiModels: liveIds };
  } catch (err) {
    const classified = classifyGeminiError(err);
    db.prepare("UPDATE ai_providers SET status = ?, updated_at = ? WHERE name = 'google_gemini'").run(
      classified.configurationRequired ? 'error' : 'degraded',
      new Date().toISOString()
    );
    return {
      synced: false,
      discoveredCount: 0,
      liveApiModels: [],
      error: classified.rawMessage,
    };
  }
}

export function estimateCostUsd(
  db: DatabaseSync,
  modelId: string,
  inputTokens: number,
  outputTokens: number
): { costUsd: number; isEstimated: boolean } {
  const row = db
    .prepare('SELECT input_cost_per_1m, output_cost_per_1m FROM ai_models WHERE model_id = ?')
    .get(modelId) as { input_cost_per_1m: number; output_cost_per_1m: number } | undefined;

  if (!row || (row.input_cost_per_1m === 0 && row.output_cost_per_1m === 0)) {
    return { costUsd: 0, isEstimated: true };
  }

  const cost =
    (inputTokens / 1_000_000) * row.input_cost_per_1m +
    (outputTokens / 1_000_000) * row.output_cost_per_1m;
  return { costUsd: Number(cost.toFixed(6)), isEstimated: true };
}

export async function generateSpeechWavBase64(
  db: DatabaseSync,
  text: string,
  voiceName = 'Kore'
): Promise<{ audioBase64: string; mimeType: string; modelUsed: string }> {
  const ai = createGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured for TTS.');
  }
  const modelRec = selectModelForTask(db, 'tts');
  const modelId = modelRec?.model_id || 'gemini-3.8-flash-lite-tts';

  const response = await ai.models.generateContent({
    model: modelId,
    contents: [
      {
        role: 'user',
        parts: [{ text: text.slice(0, 1800) }],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error('Gemini TTS returned no audio payload.');
  }
  return { audioBase64: base64Audio, mimeType: 'audio/wav', modelUsed: modelId };
}

export async function transcribeAudioBase64(
  db: DatabaseSync,
  base64Data: string,
  mimeType: string
): Promise<{ transcript: string; modelUsed: string }> {
  const ai = createGeminiClient();
  if (!ai) {
    throw new Error('GEMINI_API_KEY is not configured for audio transcription.');
  }
  const modelRec = selectModelForTask(db, 'audio_transcription');
  const modelId = modelRec?.model_id || 'gemini-3.5-transcribe';

  const response = await ai.models.generateContent({
    model: modelId,
    contents: {
      parts: [
        { inlineData: { mimeType, data: base64Data } },
        { text: 'Transcribe this audio accurately in its original spoken language (Persian or English).' },
      ],
    },
  });

  return {
    transcript: (response.text || '').trim(),
    modelUsed: modelId,
  };
}

export async function computeEmbedding(text: string): Promise<{ vector: number[]; modelName: string }> {
  const ai = createGeminiClient();
  if (ai) {
    try {
      const res = await ai.models.embedContent({
        model: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
        contents: [text],
      });
      const values = res.embeddings?.[0]?.values;
      if (values && values.length > 0) {
        return { vector: values, modelName: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2' };
      }
    } catch {
      // Fall back to deterministic local lexical vector when embeddings endpoint unavailable
    }
  }
  return { vector: computeDeterministicLexicalVector(text, 64), modelName: 'lexical-hash-64' };
}

export function computeDeterministicLexicalVector(text: string, dims = 64): number[] {
  const vec = new Array<number>(dims).fill(0);
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);

  for (const token of tokens) {
    let hash = 2166136261;
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    const idx = Math.abs(hash) % dims;
    vec[idx] += 1;
  }

  const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
