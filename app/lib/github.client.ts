import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';
import { fetchWithSession } from '~/lib/session.client';

/**
 * GitHub OAuth Device Flow client (replaces the PAT-paste flow).
 * The access token is stored server-side in KV keyed by the bolt_session cookie
 * (same session util as the rest of the app — fetchWithSession injects X-Session-Id
 * and captures the bolt_session cookie). Never stored in localStorage/sessionStorage.
 */

export interface DeviceFlowStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type DeviceFlowPollResult =
  | { status: 'ok'; login: string | null }
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'expired' };

export interface GitHubConnection {
  hasToken: boolean;
  login: string | null;
  token: string | null;
}

/** Step 1: ask the server to start a device flow (server supplies GITHUB_CLIENT_ID). */
export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  const res = await fetchWithSession('/api/github/device', { method: 'POST' });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Device flow failed to start: ${res.status}`);
  return data as DeviceFlowStart;
}

/** Step 2: single poll attempt for the token (server handles GitHub error semantics). */
export async function pollDeviceFlow(deviceCode: string): Promise<DeviceFlowPollResult> {
  const res = await fetchWithSession('/api/github/device', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceCode }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Token poll failed: ${res.status}`);
  return data as DeviceFlowPollResult;
}

/**
 * Full connect loop: start flow, then poll at the GitHub-advised interval until
 * the user authorizes, the code expires, or the caller aborts via shouldAbort.
 */
export async function connectGitHub(opts: {
  onCode?: (userCode: string, verificationUri: string) => void;
  shouldAbort?: () => boolean;
  timeoutMs?: number;
} = {}): Promise<{ login: string | null }> {
  const flow = await startDeviceFlow();
  opts.onCode?.(flow.userCode, flow.verificationUri);

  let interval = Math.max(flow.interval, 5) * 1000;
  const deadline = Date.now() + (opts.timeoutMs ?? flow.expiresIn * 1000);

  while (Date.now() < deadline) {
    if (opts.shouldAbort?.()) throw new Error('Connect cancelled');
    const result = await pollDeviceFlow(flow.deviceCode);
    if (result.status === 'ok') return { login: result.login };
    if (result.status === 'slow_down') interval += 5000; // GitHub slow_down guidance
    if (result.status === 'expired') throw new Error('Device code expired — try connecting again');
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error('Timed out waiting for GitHub authorization');
}

/** Fetch current connection (session-scoped token stored server-side). */
export async function getGitHubConnection(): Promise<GitHubConnection> {
  try {
    const res = await fetchWithSession('/api/github/device');
    const data: any = await res.json().catch(() => ({}));
    return { hasToken: !!data.hasToken, login: data.login ?? null, token: data.token ?? null };
  } catch {
    return { hasToken: false, login: null, token: null };
  }
}

/** Disconnect: removes the session-scoped token server-side. */
export async function disconnectGitHub(): Promise<void> {
  await fetchWithSession('/api/github/device', { method: 'DELETE' });
}


/**
 * Collect WebContainer file tree as {relativePath: content}
 * Uses workbenchStore.files which is synced via watchPaths.
 * Strips WORK_DIR prefix, skips node_modules/.git/binary.
 */
export function collectFiles(): Record<string, string> {
  const files = workbenchStore.files.get();
  const out: Record<string, string> = {};

  for (const [absPath, dirent] of Object.entries(files)) {
    if (!dirent || dirent.type !== 'file') continue;
    if (dirent.isBinary) continue; // skip binary for now (isBinary content is '')

    // absPath is like "/home/project/src/App.tsx" or "/home/project/package.json"
    let rel = absPath;
    if (absPath.startsWith(WORK_DIR)) {
      rel = absPath.slice(WORK_DIR.length + 1); // remove "/home/project/"
    }
    rel = rel.replace(/^\/+/, '');
    if (!rel) continue;
    if (rel.startsWith('node_modules/') || rel.includes('/node_modules/')) continue;
    if (rel.startsWith('.git/') || rel === '.git') continue;
    if (rel.startsWith('.wrangler/')) continue;

    out[rel] = dirent.content;
  }

  return out;
}

export async function pushToGitHub(opts: {
  token?: string; // optional — server falls back to session-connected GitHub token
  repoName: string;
  description?: string;
  private?: boolean;
  files: Record<string, string>;
}): Promise<{ repoUrl: string; branch: string; filesPushed: number }> {
  const res = await fetchWithSession('/api/github/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? `GitHub push failed: ${res.status}`);
  }
  return data;
}

