import { env } from 'node:process';
import fs from 'node:fs';
import path from 'node:path';

function readKeyFromFile(): string | undefined {
  const files = ['.dev.vars', '.env.local', '.env'];
  for (const file of files) {
    try {
      const filePath = path.resolve(process.cwd(), file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const match = content.match(/^NVIDIA_API_KEY=["']?(.*?)["']?$/m) || content.match(/^NVIDIA_NIM_API_KEY=["']?(.*?)["']?$/m);
        if (match && match[1] && match[1].trim().length > 0) {
          return match[1].trim();
        }
      }
    } catch {
      // Ignore file read error in edge environments
    }
  }
  return undefined;
}

export function getAPIKey(cloudflareEnv: Env) {
  /**
   * The `cloudflareEnv` is only used when deployed or when previewing locally.
   * In development the environment variables are available through `env` or from local env files.
   */
  return (
    env.NVIDIA_API_KEY ||
    env.NVIDIA_NIM_API_KEY ||
    (cloudflareEnv as any)?.NVIDIA_API_KEY ||
    (cloudflareEnv as any)?.NVIDIA_NIM_API_KEY ||
    readKeyFromFile() ||
    env.ANTHROPIC_API_KEY ||
    (cloudflareEnv as any)?.ANTHROPIC_API_KEY
  );
}

