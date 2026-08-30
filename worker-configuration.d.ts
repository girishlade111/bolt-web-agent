interface Env {
  NVIDIA_API_KEY: string;
  NVIDIA_NIM_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  RATE_LIMIT_KV?: KVNamespace;
  RATE_LIMITER_DO?: DurableObjectNamespace;
}
