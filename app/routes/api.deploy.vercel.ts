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

// GET status polling — hits the real Vercel deployment API and returns live status + build logs
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

  const token = await getStoredToken(env, 'vercel', sessionId);
  if (!token) return json({ error: 'Missing Vercel token' }, { status: 401, headers });

  try {
    const [depRes, logs] = await Promise.all([
      fetch(`https://api.vercel.com/v13/deployments/${encodeURIComponent(deploymentId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch(`https://api.vercel.com/v3/deployments/${encodeURIComponent(deploymentId)}/events?limit=100&builds=1`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined),
    ]);

    const dep: any = await depRes.json().catch(() => ({}));
    if (!depRes.ok) {
      return json({ error: dep?.error?.message ?? `Vercel status check failed: ${depRes.status}` }, { status: 502, headers });
    }

    const readyState = String(dep.readyState ?? dep.state ?? 'QUEUED');
    const vercelUrl = dep.url ? (String(dep.url).startsWith('http') ? dep.url : `https://${dep.url}`) : `https://${projectName}.vercel.app`;

    // Normalize Vercel readyState → app status
    let status: 'initializing' | 'ready' | 'success' | 'error' = 'initializing';
    if (readyState === 'READY') status = 'ready';
    else if (readyState === 'ERROR' || readyState === 'CANCELED') status = 'error';

    // Collect build logs from events
    const deployLogs: string[] = [];
    if (logs && logs.ok) {
      const events = (await logs.json().catch(() => [])) as any[];
      if (Array.isArray(events)) {
        for (const ev of events) {
          const text = ev?.payload?.text ?? ev?.payload?.info?.name ?? '';
          if (typeof text === 'string' && text.trim()) deployLogs.push(text.trimEnd());
        }
      }
    }

    return json(
      { status, url: vercelUrl, deploymentId: dep.id ?? deploymentId, projectName, provider: 'vercel', readyState, logs: deployLogs },
      { headers },
    );
  } catch (e: any) {
    return json({ error: e?.message ?? 'Vercel status check failed' }, { status: 500, headers });
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

  if (!token) token = (await getStoredToken(env, 'vercel', sessionId!)) ?? undefined;
  if (body.token) {
    const kv = getKv(env);
    if (kv) await kv.put(tokenKey('vercel', sessionId!), JSON.stringify({ token: body.token, updatedAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 24 * 30 });
  }
  if (!token) return json({ error: 'Missing Vercel token. Create at https://vercel.com/account/tokens (scope: deployment)' }, { status: 401, headers: { 'X-Session-Id': sessionId!, ...(setCookie ? { 'Set-Cookie': setCookie } : {}) } });

  const headers: Record<string, string> = { 'X-Session-Id': sessionId! };
  if (setCookie) headers['Set-Cookie'] = setCookie;

  // Validate token shape (basic)
  if (!token.startsWith('vercel_') && token.length < 20) {
    throw json({ error: 'Vercel token invalid: should start with vercel_ or be a valid PAT' }, { status: 401, headers });
  }

  // Real Vercel API: POST /v13/deployments with inlined files (v13 supports inline data payloads)
  try {
    // Validate token first via GET /v2/user for a clear error message
    const userRes = await fetch('https://api.vercel.com/v2/user', { headers: { Authorization: `Bearer ${token}` } });
    if (!userRes.ok) {
      const txt = await userRes.text().catch(() => '');
      throw json({ error: `Vercel token invalid: ${userRes.status} ${txt.slice(0,200)}` }, { status: 401, headers });
    }

    const inlineFiles = Object.entries(files).map(([file, data]) => ({ file, data, encoding: 'utf-8' as const }));
    const vercelRes = await fetch('https://api.vercel.com/v13/deployments?skipAutoDetectionConfirmation=1', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: projectName,
        target: 'production',
        projectSettings: { framework: null },
        files: inlineFiles,
      }),
    });
    const vercelData: any = await vercelRes.json().catch(() => ({}));
    if (!vercelRes.ok) {
      throw json(
        { error: vercelData?.error?.message ?? `Vercel deployment failed: ${vercelRes.status}` },
        { status: 502, headers },
      );
    }

    const readyState = String(vercelData.readyState ?? vercelData.state ?? 'INITIALIZING');
    const vercelUrl = vercelData.url ? (String(vercelData.url).startsWith('http') ? vercelData.url : `https://${vercelData.url}`) : `https://${projectName}.vercel.app`;
    const status = readyState === 'READY' ? 'ready' : readyState === 'ERROR' || readyState === 'CANCELED' ? 'error' : 'initializing';

    return json(
      { status, deploymentId: vercelData.id, projectName, url: vercelUrl, liveUrl: vercelUrl, provider: 'vercel' },
      { headers },
    );
  } catch (e: any) {
    if (e instanceof Response) throw e;
    throw json({ error: e.message ?? 'Vercel deployment failed' }, { status: 500, headers });
  }
}
