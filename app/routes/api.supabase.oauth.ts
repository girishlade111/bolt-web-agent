import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createSessionCookie, generateSessionId, getEffectiveSessionId } from '~/lib/.server/rate-limiter';
import {
  getKv,
  getClientId,
  getClientSecret,
  readSupabaseAuth,
  supabaseTokenKey,
  supabaseProjectKey,
} from '~/lib/.server/supabase';

/**
 * Supabase Management API OAuth (authorization-code flow) — session-scoped.
 *
 * GET    /api/supabase/oauth              → status { connected, email }
 * GET    /api/supabase/oauth?connect=1    → 302 redirect to api.supabase.com/oauth/authorize
 * GET    /api/supabase/oauth?code&state   → OAuth callback: exchanges the code and stores the
 *                                           token server-side in KV under `supabase:token:{sid}`
 *                                           (bolt_session), then closes the popup via postMessage.
 * DELETE /api/supabase/oauth              → disconnect (removes token + linked project)
 *
 * Requires SUPABASE_CLIENT_ID + SUPABASE_CLIENT_SECRET (Supabase dashboard →
 * OAuth Apps). The access token never reaches the client — same pattern as the
 * GitHub device flow and /api/deploy/token.
 */

function callbackUrl(request: Request): string {
  return `${new URL(request.url).origin}/api/supabase/oauth`;
}

function popupResult(status: 'success' | 'error'): Response {
  return new Response(`<script>window.opener?.postMessage("supabase-oauth:${status}","*");window.close()</script>`, {
    status: status === 'success' ? 200 : 502,
    headers: { 'Content-Type': 'text/html' },
  });
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as Env;
  const url = new URL(request.url);
  const kv = getKv(env);

  // ---- step 1: start OAuth — store CSRF state keyed to the session, redirect ----
  if (url.searchParams.get('connect') === '1') {
    let sessionId = getEffectiveSessionId(request);
    let setCookie: string | undefined;

    if (!sessionId) {
      sessionId = generateSessionId();
      setCookie = createSessionCookie(sessionId, request);
    }

    const clientId = getClientId(env);

    if (!clientId) {
      return json(
        { error: 'Supabase OAuth not configured. Set SUPABASE_CLIENT_ID / SUPABASE_CLIENT_SECRET (server env).' },
        { status: 500 },
      );
    }

    if (!kv) {
      return json({ error: 'Token storage not configured (KV binding missing)' }, { status: 500 });
    }

    const state = generateSessionId();

    // CSRF state bound to this bolt_session, 15-minute TTL
    await kv.put(`supabase:oauth:${state}`, JSON.stringify({ sessionId, ts: Date.now() }), {
      expirationTtl: 15 * 60,
    });

    const authorizeUrl = new URL('https://api.supabase.com/oauth/authorize');
    authorizeUrl.searchParams.set('client_id', clientId);
    authorizeUrl.searchParams.set('redirect_uri', callbackUrl(request));
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('scope', 'projects:read projects:write database:read database:write');

    const headers: Record<string, string> = { Location: authorizeUrl.toString() };

    if (setCookie) {
      headers['Set-Cookie'] = setCookie;
    }

    return new Response(null, { status: 302, headers });
  }

  // ---- step 2: OAuth callback ----
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (code && state) {
    const clientId = getClientId(env);
    const clientSecret = getClientSecret(env);

    if (!clientId || !clientSecret || !kv) {
      return popupResult('error');
    }

    // validate + consume the CSRF state; it must map to a known session
    let sessionId: string | null = null;

    try {
      const raw = await kv.get(`supabase:oauth:${state}`, 'text');

      if (raw) {
        sessionId = (JSON.parse(raw) as any)?.sessionId ?? null;
        await kv.delete(`supabase:oauth:${state}`);
      }
    } catch {
      sessionId = null;
    }

    if (!sessionId) {
      return popupResult('error');
    }

    try {
      const tokenRes = await fetch('https://api.supabase.com/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: callbackUrl(request),
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });
      const data: any = await tokenRes.json().catch(() => ({}));

      if (!tokenRes.ok || !data.access_token) {
        console.error('[supabase-oauth] token exchange failed', tokenRes.status, data);
        return popupResult('error');
      }

      // best-effort identity lookup for UI display
      let email: string | null = null;

      try {
        const userRes = await fetch('https://api.supabase.com/v1/user', {
          headers: { Authorization: `Bearer ${data.access_token}` },
        });

        if (userRes.ok) {
          const user: any = await userRes.json();
          email = user?.email ?? user?.username ?? null;
        }
      } catch {}

      const payload = JSON.stringify({
        token: data.access_token,
        refreshToken: data.refresh_token ?? undefined,
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000).toISOString() : undefined,
        email,
        updatedAt: new Date().toISOString(),
      });
      await kv.put(supabaseTokenKey(sessionId), payload, { expirationTtl: 60 * 60 * 24 * 30 });

      const response = popupResult('success');
      response.headers.set('Set-Cookie', createSessionCookie(sessionId, request));

      return response;
    } catch (e) {
      console.error('[supabase-oauth] callback error', e);
      return popupResult('error');
    }
  }

  // ---- status ----
  const sessionId = getEffectiveSessionId(request);

  if (!sessionId || !kv) {
    return json({ connected: false, email: null });
  }

  try {
    const auth = await readSupabaseAuth(env, sessionId);

    return json({ connected: !!auth?.token, email: auth?.email ?? null });
  } catch {
    return json({ connected: false, email: null });
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as Env;
  const sessionId = getEffectiveSessionId(request);
  const kv = getKv(env);

  if (request.method.toUpperCase() !== 'DELETE') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  if (sessionId && kv) {
    await kv.delete(supabaseTokenKey(sessionId));
    await kv.delete(supabaseProjectKey(sessionId)).catch(() => undefined);
  }

  return json({ ok: true, connected: false });
}
