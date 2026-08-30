import { env } from 'node:process';

export function getAPIKey(cloudflareEnv: Env) {
  /**
   * The `cloudflareEnv` is used when deployed or in Remix Cloudflare dev proxy (from .dev.vars).
   * In Node development, environment variables are also available through `env`.
   */
  return (
    (cloudflareEnv as any)?.NVIDIA_API_KEY ||
    (cloudflareEnv as any)?.NVIDIA_NIM_API_KEY ||
    env.NVIDIA_API_KEY ||
    env.NVIDIA_NIM_API_KEY ||
    (cloudflareEnv as any)?.ANTHROPIC_API_KEY ||
    env.ANTHROPIC_API_KEY
  );
}


