import { fetchWithSession } from '~/lib/session.client';
import { collectWebContainerFiles } from '~/lib/zip-export.client';

const TOKEN_PROVIDERS = ['vercel', 'netlify', 'cloudflare'] as const;
export type DeployProvider = (typeof TOKEN_PROVIDERS)[number];

export interface DeployResult {
  url: string;
  deploymentId?: string;
  projectName: string;
  status: 'initializing' | 'ready' | 'success' | 'error';
  provider: DeployProvider;
}

/**
 * Session-scoped token storage via bolt_session (KV on server).
 * Mirrors Supabase provisioning pattern: token is stored server-side keyed by session,
 * not just localStorage, so it survives page reload but not device change (consistent with chat history).
 */
export async function getDeployToken(provider: DeployProvider): Promise<string | null> {
  try {
    const res = await fetchWithSession(`/api/deploy/token?provider=${provider}`);
    if (!res.ok) return null;
    const data: any = await res.json();
    return data.token ?? null;
  } catch {
    return null;
  }
}

export async function setDeployToken(provider: DeployProvider, token: string, meta?: { accountId?: string }): Promise<void> {
  await fetchWithSession('/api/deploy/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, token, accountId: meta?.accountId }),
  });
}

export async function clearDeployToken(provider: DeployProvider): Promise<void> {
  await fetchWithSession('/api/deploy/token', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider }),
  });
}

/**
 * Reuses file-collection logic from zip-export.client.ts (webcontainer.fs walk, excludes node_modules/.git)
 */
export async function getDeployFiles(): Promise<Record<string, string>> {
  return collectWebContainerFiles();
}

export async function deployToCloudflare(opts: {
  projectName: string;
  accountId?: string;
  token?: string;
}): Promise<DeployResult> {
  const files = await getDeployFiles();
  if (Object.keys(files).length === 0) throw new Error('No files to deploy. Generate an app first.');

  const body: any = {
    provider: 'cloudflare',
    projectName: opts.projectName,
    accountId: opts.accountId,
    files,
  };
  // Prefer stored token via session, but allow override from dialog
  if (opts.token) body.token = opts.token;

  const res = await fetchWithSession('/api/deploy/cloudflare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Cloudflare deploy failed: ${res.status}`);
  return data as DeployResult;
}

export async function deployToVercel(opts: { projectName: string; token?: string }): Promise<DeployResult> {
  const files = await getDeployFiles();
  const res = await fetchWithSession('/api/deploy/vercel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'vercel', projectName: opts.projectName, token: opts.token, files }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Vercel deploy failed: ${res.status}`);
  return data;
}

export async function deployToNetlify(opts: { projectName: string; token?: string }): Promise<DeployResult> {
  const files = await getDeployFiles();
  const res = await fetchWithSession('/api/deploy/netlify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'netlify', projectName: opts.projectName, token: opts.token, files }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Netlify deploy failed: ${res.status}`);
  return data;
}

/**
 * Poll deployment status until ready. Cloudflare Pages Direct Upload is async;
 * Vercel/Netlify similarly poll. Reuses same session header via fetchWithSession.
 */
export async function pollDeploymentStatus(
  provider: DeployProvider,
  deploymentId: string,
  projectName: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<DeployResult> {
  const interval = opts.intervalMs ?? 2000;
  const timeout = opts.timeoutMs ?? 60000;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await fetchWithSession(`/api/deploy/${provider}?deploymentId=${encodeURIComponent(deploymentId)}&projectName=${encodeURIComponent(projectName)}`);
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? `Status check failed: ${res.status}`);
    if (data.status === 'ready' || data.status === 'success' || data.url) return data as DeployResult;
    if (data.status === 'error' || data.status === 'failed') throw new Error(data.error ?? 'Deployment failed');
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('Deployment polling timed out');
}
