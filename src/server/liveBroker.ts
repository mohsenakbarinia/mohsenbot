import crypto from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { Modality, type LiveServerMessage } from '@google/genai';
import { WebSocketServer, type WebSocket } from 'ws';
import { classifyGeminiError, createGeminiClient, selectModelForTask } from './gemini.ts';

export function attachLiveVoiceBroker(server: HttpServer, db: DatabaseSync): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws/live' });

  wss.on('connection', async (clientWs: WebSocket, req) => {
    const url = new URL(req.url || '/ws/live', 'http://localhost:3000');
    const userId = Number(url.searchParams.get('userId') || 1);
    const voiceName = url.searchParams.get('voice') || 'Zephyr';
    const personalityCode = url.searchParams.get('personality') || 'AUTO';
    const language = url.searchParams.get('lang') === 'en' ? 'en' : 'fa';

    const enabledRow = db
      .prepare("SELECT value FROM system_settings WHERE key = 'live_voice_enabled'")
      .get() as { value: string } | undefined;

    if (enabledRow?.value === 'false') {
      clientWs.send(
        JSON.stringify({
          type: 'error',
          code: 'LIVE_VOICE_DISABLED',
          message:
            language === 'en'
              ? 'Live Voice is currently disabled by administrator.'
              : 'قابلیت گفتگوی صوتی زنده توسط مدیر غیرفعال شده است.',
        })
      );
      clientWs.close(1008, 'Disabled');
      return;
    }

    const ai = createGeminiClient();
    if (!ai) {
      clientWs.send(
        JSON.stringify({
          type: 'error',
          code: 'CONFIGURATION_REQUIRED',
          message:
            language === 'en'
              ? 'GEMINI_API_KEY is required on the server for Live Voice sessions.'
              : 'برای برقراری تماس صوتی زنده، کلید GEMINI_API_KEY باید در سرور تنظیم شده باشد.',
        })
      );
      clientWs.close(1008, 'Missing API Key');
      return;
    }

    const modelRec = selectModelForTask(db, 'live_voice');
    const modelId = modelRec?.model_id || 'gemini-3.8-live';
    const sessionUuid = crypto.randomUUID();
    const startedAtMs = Date.now();

    db.prepare(
      `INSERT INTO live_sessions (session_uuid, user_id, model_id, voice_name, status)
       VALUES (?, ?, ?, ?, 'active')`
    ).run(sessionUuid, userId, modelId, voiceName);

    const personality = db
      .prepare('SELECT system_prompt FROM personalities WHERE code = ?')
      .get(personalityCode) as { system_prompt: string } | undefined;

    const systemInstruction = [
      'You are NEXORA AI in a real-time spoken conversation.',
      personality?.system_prompt || 'Be concise, warm, and clear.',
      language === 'fa' ? 'Speak naturally in Persian (فارسی).' : 'Speak naturally in English.',
    ].join('\n');

    let geminiSession: Awaited<ReturnType<typeof ai.live.connect>> | null = null;

    try {
      geminiSession = await ai.live.connect({
        model: modelId,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction,
        },
        callbacks: {
          onopen: () => {
            if (clientWs.readyState === clientWs.OPEN) {
              clientWs.send(
                JSON.stringify({
                  type: 'ready',
                  sessionId: sessionUuid,
                  model: modelId,
                  voice: voiceName,
                })
              );
            }
          },
          onmessage: (message: LiveServerMessage) => {
            if (clientWs.readyState !== clientWs.OPEN) return;
            const content = message.serverContent;
            if (content?.inputTranscription?.text) {
              clientWs.send(JSON.stringify({ type: 'input_transcript', text: content.inputTranscription.text }));
            }
            if (content?.outputTranscription?.text) {
              clientWs.send(JSON.stringify({ type: 'output_transcript', text: content.outputTranscription.text }));
            }
            for (const part of content?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                clientWs.send(JSON.stringify({ type: 'audio', data: part.inlineData.data }));
              }
            }
            if (content?.interrupted) {
              clientWs.send(JSON.stringify({ type: 'interrupted' }));
            }
            if (content?.turnComplete) {
              clientWs.send(JSON.stringify({ type: 'turn_complete' }));
            }
          },
          onerror: (err) => {
            const classified = classifyGeminiError(err);
            if (clientWs.readyState === clientWs.OPEN) {
              clientWs.send(
                JSON.stringify({
                  type: 'error',
                  code: classified.status,
                  message: language === 'en' ? classified.userMessageEn : classified.userMessageFa,
                })
              );
            }
          },
          onclose: () => {
            if (clientWs.readyState === clientWs.OPEN) {
              clientWs.send(JSON.stringify({ type: 'closed', sessionId: sessionUuid }));
            }
          },
        },
      });
    } catch (err) {
      const classified = classifyGeminiError(err);
      clientWs.send(
        JSON.stringify({
          type: 'error',
          code: classified.status,
          message: language === 'en' ? classified.userMessageEn : classified.userMessageFa,
        })
      );
      db.prepare(
        `UPDATE live_sessions SET status = 'error', ended_at = datetime('now') WHERE session_uuid = ?`
      ).run(sessionUuid);
      clientWs.close(1011, 'Gemini Live error');
      return;
    }

    clientWs.on('message', (raw) => {
      if (!geminiSession) return;
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; audio?: string; text?: string };
        if (msg.audio) {
          geminiSession.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.text) {
          geminiSession.sendRealtimeInput({ text: msg.text });
        }
      } catch {
        // Ignore malformed client frame
      }
    });

    clientWs.on('close', () => {
      const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtMs) / 1000));
      db.prepare(
        `UPDATE live_sessions
         SET status = 'ended', duration_seconds = ?, ended_at = datetime('now'), updated_at = datetime('now')
         WHERE session_uuid = ?`
      ).run(durationSeconds, sessionUuid);

      db.prepare(
        `INSERT INTO usage_records (user_id, provider_name, model_id, audio_seconds, estimated_cost_usd, is_estimated)
         VALUES (?, 'google_gemini', ?, ?, ?, 1)`
      ).run(userId, modelId, durationSeconds, Number((durationSeconds * 0.00015).toFixed(6)));

      try {
        geminiSession?.close();
      } catch {
        // Already closed
      }
    });
  });

  return wss;
}
