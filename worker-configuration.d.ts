interface Env {
  NVIDIA_API_KEY: string;
  NVIDIA_NIM_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  RATE_LIMIT_KV?: KVNamespace;
  RATE_LIMITER_DO?: DurableObjectNamespace;
  SUPABASE_KV?: KVNamespace;
  SUPABASE_PROJECTS_KV?: KVNamespace;
  CHAT_HISTORY_KV?: KVNamespace;
  CHATS_KV?: KVNamespace;
  SUPABASE_ACCESS_TOKEN?: string;
  SUPABASE_MANAGEMENT_TOKEN?: string;
  SUPABASE_ORG_ID?: string;
  SUPABASE_REGION?: string;
  CHAT_SUPABASE_URL?: string;
  CHAT_SUPABASE_SERVICE_KEY?: string;
  CHAT_SUPABASE_ANON_KEY?: string;
}
