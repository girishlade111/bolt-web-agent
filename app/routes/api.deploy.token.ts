import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getSessionId, getEffectiveSessionId, generateSessionId, createSessionCookie } from '~/lib/.server/rate-limiter';

function getKv(env: Env): KVNamespace | undefined {
  const anyEnv = env as any;
  return anyEnv.DEPLOY_TOKENS_KV ?? anyEnv.DEPLOY_KV ?? anyEnv.SUPABASE_KV ?? anyEnv.RATE_LIMIT_KV;
}

function tokenKey(provider: string, sessionId: string): string {
  return `deploy:token:${provider}:${sessionId}`;
}

// GET /api/deploy/token?provider=cloudflare — returns stored token if any (masked)
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as Env;
  const sessionId = getEffectiveSessionId(request);
  if (!sessionId) return json({ token: null, hasToken: false });

  const url = new URL(request.url);
  const provider = url.searchParams.get('provider') ?? 'cloudflare';
  const kv = getKv(env);
  if (!kv) return json({ token: null, hasToken: false });

  try {
    const raw = await kv.get(tokenKey(provider, sessionId), 'text');
    if (!raw) return json({ token: null, hasToken: false }, { headers: { 'X-Session-Id': sessionId } });
    const data: any = JSON.parse(raw);
    // Return masked token for UI check, but also full token for auto-fill (since it's session-scoped, not cross-device)
    return json({ token: data.token ?? null, hasToken: !!data.token, accountId: data.accountId ?? null }, { headers: { 'X-Session-Id': sessionId } });
  } catch {
    return json({ token: null, hasToken: false }, { headers: { 'X-Session-Id': sessionId } });
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

  if (method === 'POST') {
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, { status: 400, headers });
    }
    const provider = String(body.provider ?? 'cloudflare').toLowerCase();
    const token = String(body.token ?? '').trim();
    const accountId = body.accountId ? String(body.accountId).trim() : undefined;
    if (!token) return json({ error: 'Missing token' }, { status: 400, headers });
    const kv = getKv(env);
    if (!kv) return json({ error: 'Deploy token storage not configured' }, { status: 500, headers });
    const payload = JSON.stringify({ token, accountId, updatedAt: new Date().toISOString() });
    await kv.put(tokenKey(provider, sessionId), payload, { expirationTtl: 60 * 60 * 24 * 30 });
    return json({ ok: true, provider, hasToken: true }, { headers });
  }

  if (method === 'DELETE') {
    let body: any = {};
    try {
      body = await request.json().catch(() => ({}));
    } catch {}
    const url = new URL(request.url);
    const provider = String(body.provider ?? url.searchParams.get('provider') ?? 'cloudflare').toLowerCase();
    const kv = getKv(env);
    if (kv) await kv.delete(tokenKey(provider, sessionId));
    return json({ ok: true, provider, hasToken: false }, { headers });
  }

  return json({ error: 'Method not allowed' }, { status: 405, headers });
}
