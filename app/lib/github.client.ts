import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';

const TOKEN_KEY = 'github_token';
const TOKEN_SESSION_KEY = 'github_token_session';

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_SESSION_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setStoredToken(token: string, persist: boolean = true): void {
  try {
    if (persist) {
      localStorage.setItem(TOKEN_KEY, token);
      sessionStorage.removeItem(TOKEN_SESSION_KEY);
    } else {
      sessionStorage.setItem(TOKEN_SESSION_KEY, token);
      // keep localStorage as fallback? clear to avoid confusion
    }
  } catch {}
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_SESSION_KEY);
  } catch {}
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
  token: string;
  repoName: string;
  description?: string;
  private?: boolean;
  files: Record<string, string>;
}): Promise<{ repoUrl: string; branch: string; filesPushed: number }> {
  const res = await fetch('/api/github/push', {
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

// Optional: GitHub OAuth Device Flow helpers (no client_secret needed server-side if proxied)
// For now we expose a helper that starts device flow if env var is set.
// If VITE_GITHUB_CLIENT_ID is not configured, UI falls back to PAT.
export async function startDeviceFlow(clientId?: string) {
  const cid = clientId ?? (import.meta.env as any).VITE_GITHUB_CLIENT_ID;
  if (!cid) throw new Error('Device flow not configured — use PAT instead');
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: cid, scope: 'repo' }),
  });
  return res.json();
}
