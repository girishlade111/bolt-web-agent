import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getSessionId, getEffectiveSessionId, createSessionCookie } from '~/lib/.server/rate-limiter';

/**
 * Connectors resource management API.
 *
 * GET  /api/connectors/resources?provider=github|vercel|netlify|cloudflare
 *      → lists the connected account's existing resources via each provider's
 *        list-API, scoped to the bolt_session token stored server-side in KV.
 *
 * POST /api/connectors/resources  { action: 'delete', provider, id, name, confirmName }
 *      → destructive delete of a real external resource. Requires confirmName to
 *        match name (defense in depth; UI also type-confirms). Every delete is
 *        logged server-side to KV under `audit:delete:*` (provider, resource
 *        type, id, name, timestamp, sessionId) for accountability even without
 *        user auth.
 *
 * Token reuse only — same bolt_session-scoped KV keys the connect flow writes
 * (github:token:{sid}, deploy:token:{provider}:{sid}). No new session logic.
 */

type ResourceItem = {
  id: string;
  name: string;
  kind: 'repo' | 'project' | 'site';
  url: string | null;
  updatedAt: string | null;
  meta?: Record<string, string>;
};

function getKv(env: Env): KVNamespace | undefined {
  const anyEnv = env as any;
  return anyEnv.DEPLOY_TOKENS_KV ?? anyEnv.DEPLOY_KV ?? anyEnv.SUPABASE_KV ?? anyEnv.RATE_LIMIT_KV;
}

function tokenKey(provider: string, sessionId: string): string {
  return `deploy:token:${provider}:${sessionId}`;
}

async function getStoredToken(
  env: Env,
  provider: string,
  sessionId: string,
): Promise<{ token: string; accountId?: string } | null> {
  const kv = getKv(env);

  if (!kv) {
    return null;
  }

  try {
    const raw = await kv.get(tokenKey(provider, sessionId), 'text');

    if (!raw) {
      return null;
    }

    const data = JSON.parse(raw);

    if (typeof data?.token === 'string') {
      return { token: data.token, accountId: typeof data.accountId === 'string' ? data.accountId : undefined };
    }

    return null;
  } catch {
    return null;
  }
}

async function getGithubToken(env: Env, sessionId: string): Promise<string | null> {
  const kv = getKv(env);

  if (!kv) {
    return null;
  }

  try {
    const raw = await kv.get(`github:token:${sessionId}`, 'text');

    if (!raw) {
      return null;
    }

    return (JSON.parse(raw) as any)?.token ?? null;
  } catch {
    return null;
  }
}

function sessionHeaders(sessionId: string, request: Request): Record<string, string> {
  const headers: Record<string, string> = { 'X-Session-Id': sessionId };
  const cookieSid = getSessionId(request);

  if (cookieSid !== sessionId) {
    headers['Set-Cookie'] = createSessionCookie(sessionId, request);
  }

  return headers;
}

// ---------------- list helpers (each provider's list-API) ----------------

async function listGithubRepos(token: string): Promise<ResourceItem[]> {
  const res = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const data: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.message ?? `GitHub repo list failed: ${res.status}`);
  }

  return (Array.isArray(data) ? data : []).map((r: any) => ({
    id: String(r.id ?? r.full_name),
    name: String(r.full_name ?? r.name),
    kind: 'repo' as const,
    url: r.html_url ?? null,
    updatedAt: r.updated_at ?? r.pushed_at ?? null,
    meta: { private: r.private ? 'private' : 'public', defaultBranch: r.default_branch ?? 'main', owner: r.owner?.login ?? '' },
  }));
}

async function listVercelProjects(token: string): Promise<ResourceItem[]> {
  const res = await fetch('https://api.vercel.com/v9/projects?limit=100', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.error?.message ?? `Vercel project list failed: ${res.status}`);
  }

  return (Array.isArray(data.projects) ? data.projects : []).map((p: any) => ({
    id: String(p.id ?? p.name),
    name: String(p.name),
    kind: 'project' as const,
    url: p.latestDeployments?.[0]?.url ? `https://${p.latestDeployments[0].url}` : null,
    updatedAt: p.latestDeployments?.[0]?.created_at ?? p.updatedAt ?? null,
  }));
}

async function listNetlifySites(token: string): Promise<ResourceItem[]> {
  const res = await fetch('https://api.netlify.com/api/v1/sites?per_page=100', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.message ?? `Netlify site list failed: ${res.status}`);
  }

  return (Array.isArray(data) ? data : []).map((s: any) => ({
    id: String(s.id),
    name: String(s.name),
    kind: 'site' as const,
    url: s.ssl_url ?? s.url ?? null,
    updatedAt: s.updated_at ?? s.published_deploy?.published_at ?? null,
  }));
}

async function listCloudflareProjects(token: string, accountId: string): Promise<ResourceItem[]> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.errors?.[0]?.message ?? `Cloudflare project list failed: ${res.status}`);
  }

  return (Array.isArray(data.result) ? data.result : []).map((p: any) => ({
    id: String(p.name),
    name: String(p.name),
    kind: 'project' as const,
    url: p.domains?.[0] ?? (p.subdomain ? `https://${p.subdomain}` : null),
    updatedAt: p.modified_on ?? null,
  }));
}

async function resolveCloudflareAccountId(token: string, storedAccountId?: string): Promise<string | null> {
  let accountId = storedAccountId;

  if (!accountId) {
    const accRes = await fetch('https://api.cloudflare.com/client/v4/accounts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const accData: any = await accRes.json().catch(() => ({}));
    accountId = accData.result?.[0]?.id ?? accData.result?.id;
  }

  return accountId ?? null;
}

// GET — list resources for the connected account
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as Env;
  const sessionId = getEffectiveSessionId(request);

  if (!sessionId) {
    return json({ error: 'Missing session' }, { status: 401 });
  }

  const headers = sessionHeaders(sessionId, request);
  const provider = (new URL(request.url).searchParams.get('provider') ?? '').toLowerCase();

  try {
    if (provider === 'github') {
      const token = await getGithubToken(env, sessionId);

      if (!token) {
        return json({ error: 'GitHub not connected' }, { status: 401, headers });
      }

      return json({ provider, resources: await listGithubRepos(token) }, { headers });
    }

    if (provider === 'vercel' || provider === 'netlify') {
      const stored = await getStoredToken(env, provider, sessionId);

      if (!stored) {
        return json({ error: `${provider} not connected` }, { status: 401, headers });
      }

      const resources =
        provider === 'vercel' ? await listVercelProjects(stored.token) : await listNetlifySites(stored.token);

      return json({ provider, resources }, { headers });
    }

    if (provider === 'cloudflare') {
      const stored = await getStoredToken(env, 'cloudflare', sessionId);

      if (!stored) {
        return json({ error: 'Cloudflare not connected' }, { status: 401, headers });
      }

      const accountId = await resolveCloudflareAccountId(stored.token, stored.accountId);

      if (!accountId) {
        return json({ error: 'Missing Cloudflare Account ID' }, { status: 400, headers });
      }

      return json({ provider, resources: await listCloudflareProjects(stored.token, accountId) }, { headers });
    }

    return json({ error: 'Unknown provider' }, { status: 400, headers });
  } catch (e: any) {
    return json({ error: e?.message ?? 'Failed to list resources' }, { status: 502, headers });
  }
}

// POST — destructive delete (type-to-confirm enforced server-side too) + audit log
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as Env;
  const sessionId = getEffectiveSessionId(request);

  if (!sessionId) {
    return json({ error: 'Missing session' }, { status: 401 });
  }

  const headers = sessionHeaders(sessionId, request);

  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405, headers });
  }

  let body: { action?: string; provider?: string; id?: string; name?: string; confirmName?: string };

  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  if (body.action !== 'delete') {
    return json({ error: 'Unsupported action' }, { status: 400, headers });
  }

  const provider = String(body.provider ?? '').toLowerCase();
  const id = String(body.id ?? '').trim();
  const name = String(body.name ?? '').trim();

  if (!id || !name) {
    return json({ error: 'Missing resource id/name' }, { status: 400, headers });
  }

  // server-side echo of the UI's type-to-confirm (defense in depth)
  if (String(body.confirmName ?? '') !== name) {
    return json({ error: 'Confirmation does not match resource name' }, { status: 400, headers });
  }

  const startedAt = Date.now();

  try {
    if (provider === 'github') {
      const token = await getGithubToken(env, sessionId);

      if (!token) {
        return json({ error: 'GitHub not connected' }, { status: 401, headers });
      }

      // name is expected as "owner/repo" (from the list API's full_name)
      const res = await fetch(`https://api.github.com/repos/${name}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!res.ok && res.status !== 404) {
        const txt = await res.text().catch(() => '');

        if (res.status === 403) {
          return json(
            {
              error:
                'GitHub denied repo deletion — the connected token lacks the delete_repo scope. Reconnect GitHub with delete_repo authorized, or delete from github.com.',
            },
            { status: 403, headers },
          );
        }

        return json({ error: `GitHub delete failed: ${res.status} ${txt.slice(0, 200)}` }, { status: 502, headers });
      }
    } else if (provider === 'vercel') {
      const stored = await getStoredToken(env, 'vercel', sessionId);

      if (!stored) {
        return json({ error: 'Vercel not connected' }, { status: 401, headers });
      }

      const res = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${stored.token}` },
      });

      if (!res.ok && res.status !== 404) {
        const data: any = await res.json().catch(() => ({}));
        return json({ error: data?.error?.message ?? `Vercel delete failed: ${res.status}` }, { status: 502, headers });
      }
    } else if (provider === 'netlify') {
      const stored = await getStoredToken(env, 'netlify', sessionId);

      if (!stored) {
        return json({ error: 'Netlify not connected' }, { status: 401, headers });
      }

      const res = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${stored.token}` },
      });

      if (!res.ok && res.status !== 404) {
        const data: any = await res.json().catch(() => ({}));
        return json({ error: data?.message ?? `Netlify delete failed: ${res.status}` }, { status: 502, headers });
      }
    } else if (provider === 'cloudflare') {
      const stored = await getStoredToken(env, 'cloudflare', sessionId);

      if (!stored) {
        return json({ error: 'Cloudflare not connected' }, { status: 401, headers });
      }

      const accountId = await resolveCloudflareAccountId(stored.token, stored.accountId);

      if (!accountId) {
        return json({ error: 'Missing Cloudflare Account ID' }, { status: 400, headers });
      }

      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${encodeURIComponent(id)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${stored.token}` } },
      );

      if (!res.ok && res.status !== 404) {
        const data: any = await res.json().catch(() => ({}));
        return json(
          { error: data?.errors?.[0]?.message ?? `Cloudflare delete failed: ${res.status}` },
          { status: 502, headers },
        );
      }
    } else {
      return json({ error: 'Unknown provider' }, { status: 400, headers });
    }

    // ---- accountability audit log (server-side, survives even without user auth) ----
    try {
      const kv = getKv(env);

      if (kv) {
        const entry = {
          action: 'delete',
          provider,
          resourceType: provider === 'github' ? 'repo' : 'project',
          resourceId: id,
          resourceName: name,
          sessionId,
          timestamp: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          result: 'ok',
        };
        const key = `audit:delete:${Date.now()}:${sessionId.slice(0, 12)}:${Math.random().toString(36).slice(2, 8)}`;
        await kv.put(key, JSON.stringify(entry), { expirationTtl: 60 * 60 * 24 * 365 });
      }
    } catch {
      // audit logging must never block the delete response
    }

    return json({ ok: true, provider, id, name }, { headers });
  } catch (e: any) {
    return json({ error: e?.message ?? 'Delete failed' }, { status: 500, headers });
  }
}



