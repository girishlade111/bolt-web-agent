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

    if (!res.ok) {
      return null;
    }

    const data: any = await res.json();

    return data.token ?? null;
  } catch {
    return null;
  }
}

export async function setDeployToken(
  provider: DeployProvider,
  token: string,
  meta?: { accountId?: string },
): Promise<void> {
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

// ---------- connector resource management (list / delete, session-scoped) ----------

export interface ConnectorResource {
  id: string;
  name: string;
  kind: 'repo' | 'project' | 'site';
  url: string | null;
  updatedAt: string | null;
  meta?: Record<string, string>;
}

export async function listConnectorResources(provider: 'github' | 'supabase' | DeployProvider): Promise<ConnectorResource[]> {
  const res = await fetchWithSession(`/api/connectors/resources?provider=${encodeURIComponent(provider)}`);
  const data: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error ?? `Failed to list ${provider} resources: ${res.status}`);
  }

  return Array.isArray(data.resources) ? data.resources : [];
}

/**
 * Destructive delete of an external resource. confirmName must exactly match the
 * resource name (the server enforces this too). Every delete is audit-logged
 * server-side (KV `audit:delete:*`) for accountability.
 */
export async function deleteConnectorResource(opts: {
  provider: 'github' | 'supabase' | DeployProvider;
  id: string;
  name: string;
  confirmName: string;
}): Promise<void> {
  const res = await fetchWithSession('/api/connectors/resources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', provider: opts.provider, id: opts.id, name: opts.name, confirmName: opts.confirmName }),
  });
  const data: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error ?? `Delete failed: ${res.status}`);
  }
}


export async function deployToCloudflare(opts: {
  projectName: string;
  accountId?: string;
  token?: string;
}): Promise<DeployResult> {
  const files = await getDeployFiles();

  if (Object.keys(files).length === 0) {
    throw new Error('No files to deploy. Generate an app first.');
  }

  const body: any = {
    provider: 'cloudflare',
    projectName: opts.projectName,
    accountId: opts.accountId,
    files,
  };

  // prefer stored token via session, but allow override from dialog
  if (opts.token) {
    body.token = opts.token;
  }

  const res = await fetchWithSession('/api/deploy/cloudflare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error ?? `Cloudflare deploy failed: ${res.status}`);
  }

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

  if (!res.ok) {
    throw new Error(data.error ?? `Vercel deploy failed: ${res.status}`);
  }

  return data;
}

export async function deployToNetlify(opts: { projectName: string; token?: string; siteId?: string }): Promise<DeployResult> {
  const files = await getDeployFiles();
  const res = await fetchWithSession('/api/deploy/netlify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'netlify', projectName: opts.projectName, token: opts.token, siteId: opts.siteId, files }),
  });
  const data: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error ?? `Netlify deploy failed: ${res.status}`);
  }

  return data;
}

/**
 * Vercel-specific polling that also streams build logs (from the /api/deploy/vercel
 * status endpoint, which proxies Vercel's v3 deployment events API).
 * Calls onLog with newly received log lines as they arrive.
 */
export async function pollVercelDeployment(
  deploymentId: string,
  projectName: string,
  opts: { intervalMs?: number; timeoutMs?: number; onLog?: (line: string) => void } = {},
): Promise<DeployResult> {
  const interval = opts.intervalMs ?? 3000;
  const timeout = opts.timeoutMs ?? 180000;
  const seen = new Set<string>();
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const res = await fetchWithSession(
      `/api/deploy/vercel?deploymentId=${encodeURIComponent(deploymentId)}&projectName=${encodeURIComponent(projectName)}`,
    );
    const data: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error ?? `Vercel status check failed: ${res.status}`);
    }

    if (Array.isArray(data.logs)) {
      for (const line of data.logs) {
        if (typeof line === 'string' && !seen.has(line)) {
          seen.add(line);
          opts.onLog?.(line);
        }
      }
    }

    if (data.status === 'ready' || data.status === 'success') {
      return data as DeployResult;
    }

    if (data.status === 'error' || data.status === 'failed') {
      throw new Error(data.error ?? 'Vercel deployment failed');
    }

    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('Vercel deployment polling timed out');
}

/**
 * Netlify-specific polling that also surfaces best-effort build logs (from the
 * /api/deploy/netlify status endpoint, which proxies Netlify's deploy log API).
 * deploymentId format: `${siteId}:${deployId}`. Calls onLog with new log lines.
 */
export async function pollNetlifyDeployment(
  deploymentId: string,
  projectName: string,
  opts: { intervalMs?: number; timeoutMs?: number; onLog?: (line: string) => void } = {},
): Promise<DeployResult> {
  const interval = opts.intervalMs ?? 3000;
  const timeout = opts.timeoutMs ?? 180000;
  const seen = new Set<string>();
  const start = Date.now();

  while (Date.now() - start < timeout) {
    const res = await fetchWithSession(
      `/api/deploy/netlify?deploymentId=${encodeURIComponent(deploymentId)}&projectName=${encodeURIComponent(projectName)}`,
    );
    const data: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error ?? `Netlify status check failed: ${res.status}`);
    }

    if (Array.isArray(data.logs)) {
      for (const line of data.logs) {
        if (typeof line === 'string' && !seen.has(line)) {
          seen.add(line);
          opts.onLog?.(line);
        }
      }
    }

    if (data.status === 'ready' || data.status === 'success') {
      return data as DeployResult;
    }

    if (data.status === 'error' || data.status === 'failed') {
      throw new Error(data.error ?? 'Netlify deployment failed');
    }

    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('Netlify deployment polling timed out');
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
    const res = await fetchWithSession(
      `/api/deploy/${provider}?deploymentId=${encodeURIComponent(deploymentId)}&projectName=${encodeURIComponent(projectName)}`,
    );
    const data: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error ?? `Status check failed: ${res.status}`);
    }

    if (data.status === 'ready' || data.status === 'success' || data.url) {
      return data as DeployResult;
    }

    if (data.status === 'error' || data.status === 'failed') {
      throw new Error(data.error ?? 'Deployment failed');
    }

    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('Deployment polling timed out');
}
