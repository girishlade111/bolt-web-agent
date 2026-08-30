interface Env {
  NVIDIA_API_KEY: string;
  NVIDIA_NIM_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  RATE_LIMIT_KV?: KVNamespace;
  RATE_LIMITER_DO?: DurableObjectNamespace;
  SUPABASE_KV?: KVNamespace;
  SUPABASE_PROJECTS_KV?: KVNamespace;
  SUPABASE_ACCESS_TOKEN?: string;
  SUPABASE_MANAGEMENT_TOKEN?: string;
  SUPABASE_ORG_ID?: string;
  SUPABASE_REGION?: string;
}
