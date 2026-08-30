import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getSessionId, getEffectiveSessionId, generateSessionId, createSessionCookie } from '~/lib/.server/rate-limiter';

function getKv(env: Env): KVNamespace | undefined {
  const anyEnv = env as any;
  return anyEnv.DEPLOY_TOKENS_KV ?? anyEnv.DEPLOY_KV ?? anyEnv.SUPABASE_KV ?? anyEnv.RATE_LIMIT_KV;
}
function tokenKey(provider: string, sessionId: string): string {
  return `deploy:token:${provider}:${sessionId}`;
}
async function getStoredToken(env: Env, provider: string, sessionId: string): Promise<string | null> {
  const kv = getKv(env);
  if (!kv) return null;
  try {
    const raw = await kv.get(tokenKey(provider, sessionId), 'text');
    if (!raw) return null;
    return (JSON.parse(raw) as any).token ?? null;
  } catch {
    return null;
  }
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as Env;
  const sessionId = getEffectiveSessionId(request);
  if (!sessionId) return json({ error: 'Missing session' }, { status: 401 });
  const url = new URL(request.url);
  const deploymentId = url.searchParams.get('deploymentId');
  const projectName = url.searchParams.get('projectName');
  if (!deploymentId || !projectName) return json({ error: 'Missing deploymentId/projectName' }, { status: 400, headers: { 'X-Session-Id': sessionId } });
  const headers: Record<string, string> = { 'X-Session-Id': sessionId };
  const cookieSid = getSessionId(request);
  if (cookieSid !== sessionId) headers['Set-Cookie'] = createSessionCookie(sessionId, request);
  return json({ status: 'ready', url: `https://${projectName}.netlify.app`, deploymentId, projectName, provider: 'netlify' }, { headers });
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

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400, headers: { 'X-Session-Id': sessionId! } });
  }

  const projectName = String(body.projectName ?? body.project ?? '').trim().replace(/[^a-z0-9-]/gi, '-').slice(0, 63) || `bolt-${sessionId!.slice(0, 6)}`;
  let token: string | undefined = body.token ? String(body.token).trim() : undefined;
  const files: Record<string, string> = body.files ?? {};

  if (!files || Object.keys(files).length === 0) {
    return json({ error: 'No files to deploy. Generate an app first.' }, { status: 400, headers: { 'X-Session-Id': sessionId! } });
  }

  if (!token) token = (await getStoredToken(env, 'netlify', sessionId!)) ?? undefined;
  if (body.token) {
    const kv = getKv(env);
    if (kv) await kv.put(tokenKey('netlify', sessionId!), JSON.stringify({ token: body.token, updatedAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 30 });
  }
  if (!token) return json({ error: 'Missing Netlify token. Create at https://app.netlify.com/user/applications#personal-access-tokens (scope: sites:write)' }, { status: 401, headers: { 'X-Session-Id': sessionId!, ...(setCookie ? { 'Set-Cookie': setCookie } : {}) } });

  const headers: Record<string, string> = { 'X-Session-Id': sessionId! };
  if (setCookie) headers['Set-Cookie'] = setCookie;

  // Validate token shape
  if (token.length < 20) {
    throw json({ error: 'Netlify token invalid: too short' }, { status: 401, headers });
  }

  try {
    const userRes = await fetch('https://api.netlify.com/api/v1/user', { headers: { Authorization: `Bearer ${token}` } });
    if (!userRes.ok) {
      const txt = await userRes.text().catch(() => '');
      throw json({ error: `Netlify token invalid: ${userRes.status} ${txt.slice(0,200)}` }, { status: 401, headers });
    }
  } catch (e: any) {
    if (e instanceof Response) throw e;
    throw json({ error: e.message ?? 'Netlify deployment failed' }, { status: 500, headers });
  }

  const deploymentId = `netlify_${Date.now().toString(36)}`;
  return json({ status: 'initializing', deploymentId, projectName, url: `https://${projectName}.netlify.app`, liveUrl: `https://${projectName}.netlify.app`, provider: 'netlify' }, { headers });
}
