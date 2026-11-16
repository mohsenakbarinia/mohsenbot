export type LanguageCode = 'fa' | 'en';
export type MemoryMode = 'off' | 'manual' | 'auto';
export type MemoryCategory =
  | 'user_profile'
  | 'preferences'
  | 'semantic'
  | 'episodic'
  | 'long_term'
  | 'conversation_summary';

export type TaskCategory =
  | 'general_chat'
  | 'reasoning'
  | 'deep_reasoning'
  | 'lite'
  | 'vision'
  | 'audio_transcription'
  | 'live_voice'
  | 'tts';

export type AdminRoleName = 'super_admin' | 'admin';

export interface UserRecord {
  id: number;
  telegram_id: string | null;
  username: string;
  display_name: string;
  language: LanguageCode;
  status: 'active' | 'limited' | 'banned';
  daily_token_limit: number;
  monthly_token_limit: number;
  daily_request_limit: number;
  created_at: string;
  updated_at: string;
}

export interface PersonalityRecord {
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
  created_at: string;
  updated_at: string;
}

export interface MemoryRecord {
  id: number;
  user_id: number;
  category: MemoryCategory;
  topic_key: string;
  content: string;
  importance: number;
  source: 'manual' | 'auto' | 'system';
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  similarity?: number;
}

export interface AIModelRecord {
  id: number;
  provider_name: string;
  model_id: string;
  display_name: string;
  task_category: TaskCategory;
  supports_vision: number;
  supports_audio: number;
  supports_tools: number;
  supports_live: number;
  is_available: number;
  is_active: number;
  input_cost_per_1m: number;
  output_cost_per_1m: number;
  fallback_model_id: string | null;
  last_checked_at: string | null;
}

export interface ChatTurnInput {
  userId: number;
  conversationId?: number;
  message: string;
  personalityCode?: string;
  language?: LanguageCode;
  taskHint?: TaskCategory;
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    base64Data: string;
    extractedText?: string;
    sizeBytes: number;
  }>;
  requestTts?: boolean;
}

export interface ChatTurnResult {
  conversationId: number;
  messageId: number;
  reply: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  costIsEstimated: boolean;
  latencyMs: number;
  memoriesUsed: number;
  memoriesSaved: number;
  toolsExecuted: Array<{ name: string; status: string; durationMs: number }>;
  audioBase64?: string;
  audioMimeType?: string;
}
