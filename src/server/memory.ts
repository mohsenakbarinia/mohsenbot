import type { DatabaseSync } from 'node:sqlite';
import { Type } from '@google/genai';
import type { MemoryCategory, MemoryMode, MemoryRecord } from './types.ts';
import { computeDeterministicLexicalVector, computeEmbedding, cosineSimilarity, createGeminiClient } from './gemini.ts';

export function purgeExpiredMemories(db: DatabaseSync): number {
  const res = db
    .prepare("DELETE FROM memory_records WHERE expires_at IS NOT NULL AND datetime(expires_at) <= datetime('now')")
    .run();
  return Number(res.changes || 0);
}

export async function saveUserMemory(
  db: DatabaseSync,
  input: {
    userId: number;
    category: MemoryCategory;
    topicKey: string;
    content: string;
    importance?: number;
    source?: 'manual' | 'auto' | 'system';
    expiresAt?: string | null;
  }
): Promise<{ memory: MemoryRecord; action: 'created' | 'updated_duplicate' | 'updated_contradiction' }> {
  purgeExpiredMemories(db);

  const cleanTopic = input.topicKey.trim().toLowerCase().slice(0, 80) || 'general';
  const cleanContent = input.content.trim().slice(0, 1200);
  const importance = Math.min(10, Math.max(1, Math.round(input.importance ?? 5)));
  const source = input.source ?? 'manual';

  // Ensure embedding vector exists for similarity check strictly scoped to userId
  const { vector, modelName } = await computeEmbedding(cleanContent);
  const existingRows = db
    .prepare(
      `SELECT m.*, e.embedding_json, e.model_name
       FROM memory_records m
       LEFT JOIN memory_embeddings e ON e.memory_id = m.id
       WHERE m.user_id = ?`
    )
    .all(input.userId) as unknown as Array<
    MemoryRecord & { embedding_json: string | null; model_name: string | null }
  >;

  // 1. Check same topicKey (contradiction or update) or high semantic similarity (duplicate)
  let matchedRow: (MemoryRecord & { embedding_json: string | null }) | null = null;
  let matchAction: 'updated_duplicate' | 'updated_contradiction' = 'updated_duplicate';

  for (const row of existingRows) {
    if (row.topic_key === cleanTopic && cleanTopic !== 'general') {
      matchedRow = row;
      matchAction = row.content.toLowerCase() === cleanContent.toLowerCase() ? 'updated_duplicate' : 'updated_contradiction';
      break;
    }
    if (row.embedding_json && row.model_name === modelName) {
      try {
        const existingVec = JSON.parse(row.embedding_json) as number[];
        const sim = cosineSimilarity(vector, existingVec);
        if (sim >= 0.88) {
          matchedRow = row;
          matchAction = 'updated_duplicate';
          break;
        }
      } catch {
        // Ignore malformed vector
      }
    }
  }

  const now = new Date().toISOString();
  if (matchedRow) {
    db.prepare(
      `UPDATE memory_records
       SET category = ?, content = ?, importance = ?, source = ?, expires_at = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      input.category,
      cleanContent,
      Math.max(matchedRow.importance, importance),
      source,
      input.expiresAt ?? null,
      now,
      matchedRow.id,
      input.userId
    );
    db.prepare(
      `INSERT INTO memory_embeddings (memory_id, user_id, embedding_json, model_name, dimensions, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(memory_id) DO UPDATE SET
         embedding_json = excluded.embedding_json,
         model_name = excluded.model_name,
         dimensions = excluded.dimensions,
         updated_at = excluded.updated_at`
    ).run(matchedRow.id, input.userId, JSON.stringify(vector), modelName, vector.length, now);

    const updated = db
      .prepare('SELECT * FROM memory_records WHERE id = ? AND user_id = ?')
      .get(matchedRow.id, input.userId) as unknown as MemoryRecord;
    return { memory: updated, action: matchAction };
  }

  const inserted = db
    .prepare(
      `INSERT INTO memory_records (user_id, category, topic_key, content, importance, source, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(input.userId, input.category, cleanTopic, cleanContent, importance, source, input.expiresAt ?? null, now, now);
  const memoryId = Number(inserted.lastInsertRowid);

  db.prepare(
    `INSERT INTO memory_embeddings (memory_id, user_id, embedding_json, model_name, dimensions, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(memoryId, input.userId, JSON.stringify(vector), modelName, vector.length, now, now);

  const created = db
    .prepare('SELECT * FROM memory_records WHERE id = ? AND user_id = ?')
    .get(memoryId, input.userId) as unknown as MemoryRecord;
  return { memory: created, action: 'created' };
}

export function retrieveRelevantMemories(
  db: DatabaseSync,
  userId: number,
  query: string,
  limit = 5
): MemoryRecord[] {
  purgeExpiredMemories(db);
  const rows = db
    .prepare(
      `SELECT m.*, e.embedding_json, e.model_name
       FROM memory_records m
       LEFT JOIN memory_embeddings e ON e.memory_id = m.id
       WHERE m.user_id = ?`
    )
    .all(userId) as unknown as Array<
    MemoryRecord & { embedding_json: string | null; model_name: string | null }
  >;

  if (rows.length === 0) return [];

  const queryVec = computeDeterministicLexicalVector(query, 64);
  const queryTerms = new Set(
    query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2)
  );

  const scored = rows.map((row) => {
    let score = 0;
    if (row.embedding_json && row.model_name === 'lexical-hash-64') {
      try {
        score = cosineSimilarity(queryVec, JSON.parse(row.embedding_json) as number[]);
      } catch {
        score = 0;
      }
    }
    const contentLower = `${row.topic_key} ${row.content}`.toLowerCase();
    let keywordHits = 0;
    for (const term of queryTerms) {
      if (contentLower.includes(term)) keywordHits++;
    }
    const keywordScore = queryTerms.size > 0 ? keywordHits / queryTerms.size : 0;
    const importanceBoost = (row.importance / 10) * 0.25;
    const combined = score * 0.5 + keywordScore * 0.4 + importanceBoost;
    return {
      id: row.id,
      user_id: row.user_id,
      category: row.category,
      topic_key: row.topic_key,
      content: row.content,
      importance: row.importance,
      source: row.source,
      expires_at: row.expires_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      similarity: Number(combined.toFixed(3)),
    } satisfies MemoryRecord;
  });

  scored.sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0));
  return scored.slice(0, Math.max(1, Math.min(limit, 8)));
}

export async function extractAndSaveMemoriesIfAuto(
  db: DatabaseSync,
  userId: number,
  memoryMode: MemoryMode,
  userMessage: string,
  assistantReply: string
): Promise<number> {
  if (memoryMode !== 'auto') return 0;
  if (userMessage.trim().length < 12) return 0;

  const ai = createGeminiClient();
  if (!ai) return 0;

  try {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_LITE_MODEL || 'gemini-3.1-flash-lite',
      contents: `Extract durable user facts, preferences, or goals from this user turn only if genuinely worth remembering long-term. Return empty array if trivial.\nUser: ${userMessage}\nAssistant: ${assistantReply.slice(0, 400)}`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              category: { type: Type.STRING },
              topicKey: { type: Type.STRING },
              content: { type: Type.STRING },
              importance: { type: Type.INTEGER },
            },
            required: ['category', 'topicKey', 'content', 'importance'],
          },
        },
      },
    });

    const parsed = JSON.parse((response.text || '[]').trim()) as Array<{
      category: string;
      topicKey: string;
      content: string;
      importance: number;
    }>;

    const validCategories = new Set<MemoryCategory>([
      'user_profile',
      'preferences',
      'semantic',
      'episodic',
      'long_term',
      'conversation_summary',
    ]);

    let count = 0;
    for (const item of parsed.slice(0, 3)) {
      if (!item.content || item.content.length < 5) continue;
      const cat = validCategories.has(item.category as MemoryCategory)
        ? (item.category as MemoryCategory)
        : 'long_term';
      await saveUserMemory(db, {
        userId,
        category: cat,
        topicKey: item.topicKey || 'general',
        content: item.content,
        importance: item.importance || 6,
        source: 'auto',
      });
      count++;
    }
    return count;
  } catch {
    return 0;
  }
}
