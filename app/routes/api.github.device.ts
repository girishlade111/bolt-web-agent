import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getSessionId, getEffectiveSessionId, generateSessionId, createSessionCookie } from '~/lib/.server/rate-limiter';

function getKv(env: Env): KVNamespace | undefined {
  const anyEnv = env as any;
  return anyEnv.DEPLOY_TOKENS_KV ?? anyEnv.DEPLOY_KV ?? anyEnv.SUPABASE_KV ?? anyEnv.RATE_LIMIT_KV;
}

function tokenKey(sessionId: string): string {
  return `github:token:${sessionId}`;
}

function getClientId(env: Env): string | undefined {
  return (env as any).GITHUB_CLIENT_ID ?? (import.meta.env as any).VITE_GITHUB_CLIENT_ID ?? undefined;
}

/**
 * GitHub OAuth Device Flow (no client_secret needed server-side — device flow only
 * requires client_id). All calls are proxied through this route so the access token
 * is stored server-side in KV keyed by the bolt_session cookie (same pattern as
 * /api/deploy/token), never exposed to long-lived localStorage.
 */

// GET /api/github/device — return the connected GitHub account for this session
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as Env;
  const sessionId = getEffectiveSessionId(request);
  if (!sessionId) return json({ token: null, hasToken: false, login: null });

  const kv = getKv(env);
  if (!kv) return json({ token: null, hasToken: false, login: null }, { headers: { 'X-Session-Id': sessionId } });

  try {
    const raw = await kv.get(tokenKey(sessionId), 'text');
    if (!raw) return json({ token: null, hasToken: false, login: null }, { headers: { 'X-Session-Id': sessionId } });
    const data: any = JSON.parse(raw);
    return json(
      { token: data.token ?? null, hasToken: !!data.token, login: data.login ?? null },
      { headers: { 'X-Session-Id': sessionId } },
    );
  } catch {
    return json({ token: null, hasToken: false, login: null }, { headers: { 'X-Session-Id': sessionId } });
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as Env;
  let sessionId = getEffectiveSessionId(request);
  let setCookie: string | undefined;
  if (!sessionId) {
    sessionId = generateSessionId();
    setCookie = createSessionCookie(sessionId, request);
  } else {
    const cookieSid = getSessionId(request);
    if (cookieSid !== sessionId) setCookie = createSessionCookie(sessionId, request);
  }

  const method = request.method.toUpperCase();
  const headers: Record<string, string> = { 'X-Session-Id': sessionId };
  if (setCookie) headers['Set-Cookie'] = setCookie;

  // POST = start device flow: request device + user code from GitHub
  if (method === 'POST') {
    const clientId = getClientId(env);
    if (!clientId) {
      return json(
        { error: 'GitHub device flow not configured. Set GITHUB_CLIENT_ID (server) or VITE_GITHUB_CLIENT_ID and restart.' },
        { status: 500, headers },
      );
    }
    try {
      const res = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ client_id: clientId, scope: 'repo' }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok || !data.device_code) {
        return json({ error: data.error_description ?? `Device flow start failed: ${res.status}` }, { status: 502, headers });
      }
      return json(
        {
          deviceCode: data.device_code,
          userCode: data.user_code,
          verificationUri: data.verification_uri,
          expiresIn: data.expires_in ?? 900,
          interval: data.interval ?? 5,
        },
        { headers },
      );
    } catch (e: any) {
      return json({ error: e?.message ?? 'Device flow start failed' }, { status: 502, headers });
    }
  }


  // PUT = poll for token. On success, validate + store in KV keyed by session.
  if (method === 'PUT') {
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, { status: 400, headers });
    }
    const deviceCode = String(body.deviceCode ?? '').trim();
    if (!deviceCode) return json({ error: 'Missing deviceCode' }, { status: 400, headers });
    const clientId = getClientId(env);
    if (!clientId) return json({ error: 'GitHub device flow not configured (GITHUB_CLIENT_ID)' }, { status: 500, headers });

    let res: Response;
    try {
      res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
    } catch (e: any) {
      return json({ error: e?.message ?? 'Token poll failed' }, { status: 502, headers });
    }

    const data: any = await res.json().catch(() => ({}));

    if (res.ok && data.access_token) {
      // Validate token + capture login for UI display
      let login: string | null = null;
      try {
        const userRes = await fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${data.access_token}`, Accept: 'application/vnd.github+json' },
        });
        if (userRes.ok) login = ((await userRes.json()) as any)?.login ?? null;
      } catch {}

      const kv = getKv(env);
      if (!kv) return json({ error: 'Token storage not configured (KV binding missing)' }, { status: 500, headers });
      const payload = JSON.stringify({ token: data.access_token, login, updatedAt: new Date().toISOString() });
      await kv.put(tokenKey(sessionId), payload, { expirationTtl: 60 * 60 * 24 * 30 });
      return json({ status: 'ok', hasToken: true, login }, { headers });
    }

    // Standard device-flow polling responses (GitHub returns 400 with error codes)
    const ghError = data.error as string | undefined;
    if (ghError === 'authorization_pending') return json({ status: 'pending' }, { headers });
    if (ghError === 'slow_down') return json({ status: 'slow_down' }, { headers });
    if (ghError === 'expired_token') return json({ status: 'expired' }, { headers });
    return json({ error: data.error_description ?? ghError ?? `Token poll failed: ${res.status}` }, { status: 502, headers });
  }

  // DELETE = disconnect: remove stored token for this session
  if (method === 'DELETE') {
    const kv = getKv(env);
    if (kv) await kv.delete(tokenKey(sessionId));
    return json({ ok: true, hasToken: false }, { headers });
  }

  return json({ error: 'Method not allowed' }, { status: 405, headers });
}
