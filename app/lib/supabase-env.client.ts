// Client-side helper to inject Supabase env into WebContainer's .env
import { webcontainer } from '~/lib/webcontainer';
import { WORK_DIR } from '~/utils/constants';

export async function injectSupabaseEnv(envString: string): Promise<void> {
  const wc = await webcontainer;
  // Write to project root .env (relative to workdir). Also keep WORK_DIR absolute for compatibility.
  try {
    // Primary: relative .env at workdir root
    await wc.fs.writeFile('.env', envString);
  } catch (e) {
    // Fallback: absolute path
    try {
      await wc.fs.writeFile(`${WORK_DIR}/.env`, envString);
    } catch (e2) {
      console.error('[supabase] failed to write .env', e, e2);
      throw e2;
    }
  }
  console.log('[supabase] injected .env into WebContainer', { preview: envString.slice(0, 120) });
}

export async function ensureSupabaseProvisioned(prompt: string, enableSupabase: boolean): Promise<{ provisioned: boolean; envString?: string } | null> {
  try {
    const res = await fetch('/api/supabase', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, enableSupabase }),
    });
    if (!res.ok) {
      console.warn('[supabase] provision request failed', res.status);
      return null;
    }
    const data: any = await res.json();
    if (data.provisioned && data.envString) {
      await injectSupabaseEnv(data.envString);
      return { provisioned: true, envString: data.envString };
    }
    return { provisioned: false };
  } catch (e) {
    console.warn('[supabase] provision error', e);
    return null;
  }
}
