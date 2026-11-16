import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Brain,
  FileUp,
  HelpCircle,
  MessageSquarePlus,
  Mic,
  MicOff,
  Paperclip,
  PhoneCall,
  PhoneOff,
  Send,
  Settings2,
  Trash2,
  Volume2,
} from 'lucide-react';
import type { Lang } from '../i18n';
import { apiFetch, type MemoryItem, type Personality } from '../types';

interface MiniAppProps {
  lang: Lang;
  onToast: (msg: string, type?: 'info' | 'error') => void;
}

interface ChatMsg {
  id: number | string;
  role: 'user' | 'assistant';
  content: string;
  model_used?: string;
  audioBase64?: string;
  toolsExecuted?: Array<{ name: string; status: string }>;
}

function pcmFloat32ToBase64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToPcmFloat32(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 0x8000;
  }
  return float32;
}

export function MiniAppStudio({ lang, onToast }: MiniAppProps) {
  const [selectedUserId, setSelectedUserId] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<'chat' | 'live' | 'memory' | 'settings'>('chat');
  const [personalities, setPersonalities] = useState<Personality[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [conversations, setConversations] = useState<Array<{ id: number; title: string }>>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [activePersonality, setActivePersonality] = useState<string>('AUTO');
  const [memoryMode, setMemoryMode] = useState<'off' | 'manual' | 'auto'>('auto');
  const [ttsVoice, setTtsVoice] = useState<string>('Kore');
  const [requestTts, setRequestTts] = useState<boolean>(false);
  const [geminiConfigured, setGeminiConfigured] = useState<boolean>(false);
  const [liveVoiceEnabled, setLiveVoiceEnabled] = useState<boolean>(true);
  const [userUsage, setUserUsage] = useState<{ tokens: number; cost: number }>({ tokens: 0, cost: 0 });

  const [inputText, setInputText] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState('');

  // Manual Memory Form
  const [newMemTopic, setNewMemTopic] = useState('');
  const [newMemContent, setNewMemContent] = useState('');

  // Voice Note Recording
  const [recordingVoiceNote, setRecordingVoiceNote] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Live Voice WebSocket State
  const [liveState, setLiveState] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [liveTranscripts, setLiveTranscripts] = useState<Array<{ who: 'user' | 'ai'; text: string }>>([]);
  const [liveError, setLiveError] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const inputAudioCtxRef = useRef<AudioContext | null>(null);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const nextStartTimeRef = useRef<number>(0);

  async function loadBootstrap(uid = selectedUserId) {
    try {
      const data = await apiFetch<{
        settings: { active_personality_code: string; memory_mode: 'off' | 'manual' | 'auto'; tts_voice_name: string };
        personalities: Personality[];
        memories: MemoryItem[];
        conversations: Array<{ id: number; title: string }>;
        usage: { tokens: number; cost: number };
        liveVoiceEnabled: boolean;
        geminiConfigured: boolean;
      }>(`/api/miniapp/bootstrap?userId=${uid}`);

      setPersonalities(data.personalities || []);
      setMemories(data.memories || []);
      setConversations(data.conversations || []);
      setUserUsage(data.usage || { tokens: 0, cost: 0 });
      setLiveVoiceEnabled(data.liveVoiceEnabled);
      setGeminiConfigured(data.geminiConfigured);
      if (data.settings) {
        setActivePersonality(data.settings.active_personality_code);
        setMemoryMode(data.settings.memory_mode);
        setTtsVoice(data.settings.tts_voice_name || 'Kore');
      }
      if (data.conversations?.[0]?.id) {
        setActiveConversationId(data.conversations[0].id);
        const msgData = await apiFetch<{ messages: ChatMsg[] }>(
          `/api/miniapp/conversations/${data.conversations[0].id}/messages?userId=${uid}`
        );
        setMessages(msgData.messages || []);
      } else {
        setActiveConversationId(undefined);
        setMessages([]);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to load Mini App', 'error');
    }
  }

  useEffect(() => {
    loadBootstrap(selectedUserId);
    return () => {
      stopLiveCall();
    };
  }, [selectedUserId]);

  async function handleSelectConversation(convId: number) {
    setActiveConversationId(convId);
    try {
      const res = await apiFetch<{ messages: ChatMsg[] }>(
        `/api/miniapp/conversations/${convId}/messages?userId=${selectedUserId}`
      );
      setMessages(res.messages || []);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Error loading messages', 'error');
    }
  }

  async function handleSendChat(e?: FormEvent) {
    if (e) e.preventDefault();
    if (!inputText.trim() && !attachedFile) return;

    setChatError('');
    setSending(true);
    const pendingText = inputText.trim() || (attachedFile ? `📎 ${attachedFile.name}` : '');
    setMessages((prev) => [...prev, { id: `tmp-${Date.now()}`, role: 'user', content: pendingText }]);
    setInputText('');

    try {
      const form = new FormData();
      form.append('userId', String(selectedUserId));
      if (activeConversationId) form.append('conversationId', String(activeConversationId));
      form.append('message', pendingText);
      form.append('personalityCode', activePersonality);
      form.append('language', lang);
      form.append('requestTts', String(requestTts));
      if (attachedFile) form.append('file', attachedFile);

      const res = await apiFetch<{
        conversationId: number;
        messageId: number;
        reply: string;
        model: string;
        audioBase64?: string;
        toolsExecuted?: Array<{ name: string; status: string }>;
        memoriesSaved: number;
      }>('/api/chat', { method: 'POST', body: form });

      setActiveConversationId(res.conversationId);
      setAttachedFile(null);
      setMessages((prev) => [
        ...prev,
        {
          id: res.messageId,
          role: 'assistant',
          content: res.reply,
          model_used: res.model,
          audioBase64: res.audioBase64,
          toolsExecuted: res.toolsExecuted,
        },
      ]);
      if (res.memoriesSaved > 0) {
        onToast(
          lang === 'fa'
            ? `${res.memoriesSaved} مورد جدید در حافظه بلندمدت ذخیره شد`
            : `Saved ${res.memoriesSaved} memory item(s)`
        );
      }
      loadBootstrap(selectedUserId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send message';
      setChatError(msg);
      onToast(msg, 'error');
    } finally {
      setSending(false);
    }
  }

  async function toggleVoiceNote() {
    if (recordingVoiceNote && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecordingVoiceNote(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const form = new FormData();
        form.append('userId', String(selectedUserId));
        form.append('language', lang);
        form.append('audio', blob, 'voice_note.webm');
        setSending(true);
        try {
          const res = await apiFetch<{
            transcript: string;
            reply: string;
            model: string;
            audioBase64?: string;
          }>('/api/voice/message', { method: 'POST', body: form });
          setMessages((prev) => [
            ...prev,
            { id: `v-u-${Date.now()}`, role: 'user', content: `🎙 ${res.transcript}` },
            {
              id: `v-a-${Date.now()}`,
              role: 'assistant',
              content: res.reply,
              model_used: res.model,
              audioBase64: res.audioBase64,
            },
          ]);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Voice processing failed';
          setChatError(msg);
          onToast(msg, 'error');
        } finally {
          setSending(false);
        }
      };
      mediaRecorderRef.current = rec;
      rec.start();
      setRecordingVoiceNote(true);
    } catch {
      onToast(lang === 'fa' ? 'دسترسی به میکروفون برقرار نشد.' : 'Microphone access unavailable.', 'error');
    }
  }

  async function startLiveCall() {
    if (!liveVoiceEnabled) {
      setLiveError(lang === 'fa' ? 'گفتگوی صوتی زنده غیرفعال است.' : 'Live Voice is disabled.');
      return;
    }
    setLiveError('');
    setLiveState('connecting');
    setLiveTranscripts([]);

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${proto}//${location.host}/ws/live?userId=${selectedUserId}&voice=${encodeURIComponent(
        ttsVoice
      )}&personality=${encodeURIComponent(activePersonality)}&lang=${lang}`
    );
    wsRef.current = ws;

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data) as {
          type: string;
          data?: string;
          text?: string;
          message?: string;
        };
        if (msg.type === 'ready') {
          setLiveState('connected');
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
            const inCtx = new AudioContext({ sampleRate: 16000 });
            const outCtx = new AudioContext({ sampleRate: 24000 });
            inputAudioCtxRef.current = inCtx;
            outputAudioCtxRef.current = outCtx;
            nextStartTimeRef.current = outCtx.currentTime;

            const src = inCtx.createMediaStreamSource(stream);
            const proc = inCtx.createScriptProcessor(4096, 1, 1);
            src.connect(proc);
            proc.connect(inCtx.destination);
            proc.onaudioprocess = (e) => {
              if (ws.readyState === WebSocket.OPEN) {
                const b64 = pcmFloat32ToBase64(e.inputBuffer.getChannelData(0));
                ws.send(JSON.stringify({ audio: b64 }));
              }
            };
          } catch {
            setLiveError(lang === 'fa' ? 'میکروفون مرورگر در دسترس نیست.' : 'Microphone unavailable.');
            stopLiveCall();
          }
        } else if (msg.type === 'audio' && msg.data && outputAudioCtxRef.current) {
          const ctx = outputAudioCtxRef.current;
          const samples = base64ToPcmFloat32(msg.data);
          const buffer = ctx.createBuffer(1, samples.length, 24000);
          buffer.getChannelData(0).set(samples);
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          const startAt = Math.max(ctx.currentTime, nextStartTimeRef.current);
          source.start(startAt);
          nextStartTimeRef.current = startAt + buffer.duration;
        } else if (msg.type === 'input_transcript' && msg.text) {
          setLiveTranscripts((p) => [...p, { who: 'user', text: msg.text! }]);
        } else if (msg.type === 'output_transcript' && msg.text) {
          setLiveTranscripts((p) => [...p, { who: 'ai', text: msg.text! }]);
        } else if (msg.type === 'error') {
          setLiveError(msg.message || 'Live Voice error');
          setLiveState('error');
        }
      } catch {
        // Ignore parse error
      }
    };

    ws.onclose = () => {
      if (liveState !== 'error') setLiveState('idle');
    };
  }

  function stopLiveCall() {
    try {
      wsRef.current?.close();
    } catch {
      // Ignore
    }
    wsRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    inputAudioCtxRef.current?.close().catch(() => {});
    inputAudioCtxRef.current = null;
    outputAudioCtxRef.current?.close().catch(() => {});
    outputAudioCtxRef.current = null;
    setLiveState('idle');
  }

  async function handleSaveUserSettings(patch: Record<string, unknown>) {
    try {
      await apiFetch('/api/miniapp/settings', {
        method: 'PATCH',
        body: JSON.stringify({ userId: selectedUserId, ...patch }),
      });
      onToast(lang === 'fa' ? 'تنظیمات ذخیره شد' : 'Preferences updated');
      loadBootstrap(selectedUserId);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Save failed', 'error');
    }
  }

  async function handleAddMemory(e: FormEvent) {
    e.preventDefault();
    if (!newMemContent.trim()) return;
    try {
      await apiFetch('/api/miniapp/memories', {
        method: 'POST',
        body: JSON.stringify({
          userId: selectedUserId,
          category: 'long_term',
          topicKey: newMemTopic.trim() || 'manual',
          content: newMemContent.trim(),
          importance: 8,
        }),
      });
      setNewMemTopic('');
      setNewMemContent('');
      loadBootstrap(selectedUserId);
      onToast(lang === 'fa' ? 'در حافظه ذخیره شد' : 'Memory saved');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Memory save failed', 'error');
    }
  }

  async function handleDeleteMemory(id: number) {
    try {
      await apiFetch(`/api/miniapp/memories/${id}?userId=${selectedUserId}`, { method: 'DELETE' });
      loadBootstrap(selectedUserId);
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  }

  const tgMenuItems =
    lang === 'fa'
      ? [
          { icon: MessageSquarePlus, label: 'گفتگوی جدید', action: () => { setActiveConversationId(undefined); setMessages([]); setActiveTab('chat'); } },
          { icon: Settings2, label: 'انتخاب شخصیت', action: () => setActiveTab('settings') },
          { icon: Brain, label: 'حافظه من', action: () => setActiveTab('memory') },
          { icon: PhoneCall, label: 'گفتگوی صوتی', action: () => setActiveTab('live') },
          { icon: FileUp, label: 'ارسال فایل', action: () => setActiveTab('chat') },
          { icon: HelpCircle, label: 'راهنما', action: () => onToast('NEXORA AI: دستیار متنی، صوتی زنده، تحلیل تصویر/PDF و حافظه اختصاصی.') },
        ]
      : [
          { icon: MessageSquarePlus, label: 'New Chat', action: () => { setActiveConversationId(undefined); setMessages([]); setActiveTab('chat'); } },
          { icon: Settings2, label: 'Personality', action: () => setActiveTab('settings') },
          { icon: Brain, label: 'My Memory', action: () => setActiveTab('memory') },
          { icon: PhoneCall, label: 'Live Voice', action: () => setActiveTab('live') },
          { icon: FileUp, label: 'Send File', action: () => setActiveTab('chat') },
          { icon: HelpCircle, label: 'Help', action: () => onToast('NEXORA AI supports multimodal chat, PDF/Image vision, memory, and Live Voice.') },
        ];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Telegram Bot Menu & User Isolation Switcher */}
      <aside className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] p-5 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {lang === 'fa' ? 'شبیه‌ساز ربات و مینی‌اپ تلگرام' : 'Telegram Bot & Mini App'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {lang === 'fa' ? 'جداسازی کامل نشست و حافظه هر کاربر' : 'Isolated user session & memory context'}
            </p>
          </div>
          <span dir="ltr" className="text-xs font-mono tabular-nums text-[#D4AF37] shrink-0">
            {userUsage.tokens.toLocaleString()} tok
          </span>
        </div>

        <div>
          <label htmlFor="miniapp-user-select" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
            {lang === 'fa' ? 'کاربر فعال تلگرام' : 'Active Telegram User'}
          </label>
          <select
            id="miniapp-user-select"
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
          >
            <option value={1}>سارا رحیمی (@sara_rahimi)</option>
            <option value={2}>Alex Mercer (@alex_mercer)</option>
            <option value={3}>امید کریمی (@omid_karimi)</option>
          </select>
        </div>

        {/* Telegram Reply Keyboard Grid */}
        <div>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
            {lang === 'fa' ? 'منوی ربات تلگرام' : 'Telegram Bot Keyboard'}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {tgMenuItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={item.action}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#07090F] px-3 py-2.5 text-xs font-medium text-slate-800 dark:text-slate-200 hover:border-[#2563EB] transition-colors whitespace-nowrap truncate"
                >
                  <Icon className="w-3.5 h-3.5 text-[#D4AF37] shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Recent Conversations for Selected User */}
        <div>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
            {lang === 'fa' ? 'تاریخچه گفتگوهای این کاربر' : 'User Conversations'}
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="text-xs text-slate-500 py-2">{lang === 'fa' ? 'گفتگویی ثبت نشده' : 'No conversations yet'}</div>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    handleSelectConversation(c.id);
                    setActiveTab('chat');
                  }}
                  className={`w-full text-start px-3 py-2 rounded-lg text-xs transition-colors truncate ${
                    activeConversationId === c.id
                      ? 'bg-[#2563EB]/15 text-[#2563EB] dark:text-blue-300 border border-[#2563EB]/40'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/50'
                  }`}
                >
                  {c.title}
                </button>
              ))
            )}
          </div>
        </div>
      </aside>

      {/* Mini App Main Viewport */}
      <section className="lg:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0D1424] overflow-hidden flex flex-col min-h-[580px]">
        {/* Mode Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 px-4 sm:px-5 py-3">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-[#07090F] overflow-x-auto max-w-full">
            {(
              [
                ['chat', lang === 'fa' ? 'گفتگو و فایل' : 'Multimodal Chat'],
                ['live', lang === 'fa' ? 'صوت زنده (Live)' : 'Live Voice'],
                ['memory', lang === 'fa' ? 'حافظه من' : 'My Memory'],
                ['settings', lang === 'fa' ? 'شخصیت و تنظیمات' : 'Preferences'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === key
                    ? 'bg-white dark:bg-[#111827] text-slate-900 dark:text-[#D4AF37] shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
            {geminiConfigured
              ? lang === 'fa'
                ? 'Gemini API متصل'
                : 'Gemini Connected'
              : lang === 'fa'
              ? 'نیازمند GEMINI_API_KEY'
              : 'GEMINI_API_KEY Required'}
          </div>
        </div>

        {activeTab === 'chat' && (
          <div className="flex-1 flex flex-col justify-between p-5 space-y-4">
            <div className="flex-1 space-y-3 max-h-[380px] overflow-y-auto pe-1">
              {messages.length === 0 ? (
                <div className="py-16 text-center space-y-2">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {lang === 'fa'
                      ? 'گفتگوی جدید را با NEXORA AI آغاز کنید'
                      : 'Start a conversation with NEXORA AI'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {lang === 'fa'
                      ? 'پشتیبانی از متن، تصویر، PDF، ویس و ابزارهای هوشمند'
                      : 'Supports text, images, PDFs, voice notes, and safe tool execution'}
                  </p>
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-[#2563EB] text-white'
                          : 'bg-slate-100 dark:bg-[#07090F] text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="whitespace-pre-wrap">{m.content}</div>
                      {m.audioBase64 && (
                        <audio
                          controls
                          className="mt-2 h-8 w-full max-w-xs"
                          src={`data:audio/wav;base64,${m.audioBase64}`}
                        />
                      )}
                    </div>
                    {m.role === 'assistant' && m.model_used && (
                      <div className="mt-1 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {m.model_used}
                        {m.toolsExecuted && m.toolsExecuted.length > 0
                          ? ` · tools: ${m.toolsExecuted.map((t) => t.name).join(', ')}`
                          : ''}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {chatError && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {chatError}
              </div>
            )}

            <form onSubmit={handleSendChat} className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Personality"
                    value={activePersonality}
                    onChange={(e) => setActivePersonality(e.target.value)}
                    className="rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-2.5 py-1 text-xs"
                  >
                    {personalities.map((p) => (
                      <option key={p.code} value={p.code}>
                        {lang === 'fa' ? p.name_fa : p.name_en}
                      </option>
                    ))}
                  </select>

                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={requestTts}
                      onChange={(e) => setRequestTts(e.target.checked)}
                    />
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>{lang === 'fa' ? 'پاسخ صوتی' : 'TTS Reply'}</span>
                  </label>
                </div>

                {attachedFile && (
                  <span className="text-xs font-mono text-[#D4AF37]">
                    {attachedFile.name} ({Math.round(attachedFile.size / 1024)} KB)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <label className="p-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-[#2563EB] cursor-pointer shrink-0">
                  <Paperclip className="w-4 h-4" />
                  <input
                    type="file"
                    className="hidden"
                    accept="image/*,.pdf,.txt,.csv,.json,.docx,.xlsx"
                    onChange={(e) => setAttachedFile(e.target.files?.[0] || null)}
                  />
                </label>

                <button
                  type="button"
                  onClick={toggleVoiceNote}
                  aria-label={lang === 'fa' ? 'ضبط ویس' : 'Record Voice Note'}
                  className={`p-2.5 rounded-lg border transition-colors shrink-0 ${
                    recordingVoiceNote
                      ? 'border-red-500 bg-red-500/15 text-red-500'
                      : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-[#2563EB]'
                  }`}
                >
                  {recordingVoiceNote ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>

                <input
                  type="text"
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder={lang === 'fa' ? 'پیام خود را بنویسید...' : 'Write a message...'}
                  className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#2563EB]"
                />

                <button
                  type="submit"
                  disabled={sending}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#D4AF37] text-[#07090F] text-xs font-semibold hover:bg-[#E5C158] disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{sending ? '...' : lang === 'fa' ? 'ارسال' : 'Send'}</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'live' && (
          <div className="flex-1 p-6 flex flex-col justify-between space-y-6">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {lang === 'fa' ? 'مینی‌اپ گفتگوی صوتی زنده (Gemini Live)' : 'Live Voice Studio (Gemini Live API)'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {lang === 'fa'
                    ? 'ارتباط امن WebSocket (16kHz PCM ورودی / 24kHz خروجی) بدون افشای کلید در مرورگر'
                    : 'Server-brokered WebSocket 16kHz/24kHz PCM streaming with zero client key exposure'}
                </p>
              </div>
              <div className="text-xs font-mono text-slate-500 dark:text-slate-300">
                State: {liveState}
              </div>
            </div>

            {liveError && (
              <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-600 dark:text-red-300">
                {liveError}
              </div>
            )}

            <div className="flex-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#07090F] p-4 space-y-2 max-h-64 overflow-y-auto">
              {liveTranscripts.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500 dark:text-slate-400">
                  {lang === 'fa'
                    ? 'برای شروع مکالمه صوتی هم‌زمان، دکمه زیر را فشار دهید.'
                    : 'Press Start Live Voice below to open a real-time duplex audio session.'}
                </div>
              ) : (
                liveTranscripts.map((t, i) => (
                  <div key={i} className="text-xs leading-relaxed">
                    <span className="font-semibold text-[#D4AF37] me-2">
                      {t.who === 'user' ? (lang === 'fa' ? 'شما:' : 'You:') : 'NEXORA:'}
                    </span>
                    <span className="text-slate-800 dark:text-slate-200">{t.text}</span>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center justify-center gap-4">
              {liveState === 'connected' || liveState === 'connecting' ? (
                <button
                  type="button"
                  onClick={stopLiveCall}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700"
                >
                  <PhoneOff className="w-4 h-4" />
                  <span>{lang === 'fa' ? 'قطع مکالمه' : 'End Call'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startLiveCall}
                  disabled={!liveVoiceEnabled}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-[#2563EB] text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
                >
                  <PhoneCall className="w-4 h-4" />
                  <span>{lang === 'fa' ? 'شروع مکالمه صوتی زنده' : 'Start Live Voice'}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'memory' && (
          <div className="flex-1 p-5 space-y-5">
            <form onSubmit={handleAddMemory} className="grid grid-cols-1 md:grid-cols-12 gap-2">
              <input
                type="text"
                value={newMemTopic}
                onChange={(e) => setNewMemTopic(e.target.value)}
                placeholder={lang === 'fa' ? 'موضوع (مثلاً: زبان_کدنویسی)' : 'Topic key (e.g. stack)'}
                className="md:col-span-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 text-xs"
              />
              <input
                type="text"
                required
                value={newMemContent}
                onChange={(e) => setNewMemContent(e.target.value)}
                placeholder={lang === 'fa' ? 'اطلاعاتی که دستیار باید به خاطر بسپارد...' : 'Fact or preference to remember...'}
                className="md:col-span-7 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 text-xs"
              />
              <button
                type="submit"
                className="md:col-span-2 px-3 py-2 rounded-lg bg-[#D4AF37] text-[#07090F] text-xs font-semibold hover:bg-[#E5C158]"
              >
                {lang === 'fa' ? 'ذخیره حافظه' : 'Save'}
              </button>
            </form>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {memories.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500">
                  {lang === 'fa' ? 'هیچ حافظه‌ای برای این کاربر ثبت نشده است.' : 'No memory items for this user.'}
                </div>
              ) : (
                memories.map((mem) => (
                  <div
                    key={mem.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#07090F] p-3"
                  >
                    <div className="space-y-1">
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        {mem.category} · {mem.topic_key} · importance {mem.importance}/10 · {mem.source}
                      </div>
                      <div className="text-xs text-slate-800 dark:text-slate-200">{mem.content}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteMemory(mem.id)}
                      aria-label={`Delete memory ${mem.topic_key}`}
                      className="p-1.5 text-slate-400 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="flex-1 p-6 space-y-5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {lang === 'fa' ? 'تنظیمات شخصی کاربر در ربات' : 'User Assistant Preferences'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1.5">
                  {lang === 'fa' ? 'حالت حافظه بلندمدت' : 'Long-Term Memory Mode'}
                </label>
                <select
                  value={memoryMode}
                  onChange={(e) => {
                    const val = e.target.value as 'off' | 'manual' | 'auto';
                    setMemoryMode(val);
                    handleSaveUserSettings({ memory_mode: val });
                  }}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 text-xs"
                >
                  <option value="off">{lang === 'fa' ? 'خاموش' : 'Off'}</option>
                  <option value="manual">{lang === 'fa' ? 'ذخیره دستی' : 'Manual Only'}</option>
                  <option value="auto">{lang === 'fa' ? 'ذخیره خودکار هوشمند' : 'Auto Extraction'}</option>
                </select>
              </div>

              <div>
                <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1.5">
                  {lang === 'fa' ? 'صدای پیش‌فرض (TTS / Live)' : 'Default Voice Persona'}
                </label>
                <select
                  value={ttsVoice}
                  onChange={(e) => {
                    setTtsVoice(e.target.value);
                    handleSaveUserSettings({ tts_voice_name: e.target.value });
                  }}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-[#07090F] px-3 py-2 text-xs"
                >
                  {['Kore', 'Zephyr', 'Puck', 'Charon', 'Fenrir'].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
