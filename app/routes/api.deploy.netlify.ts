import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import {
  getSessionId,
  getEffectiveSessionId,
  generateSessionId,
  createSessionCookie,
} from '~/lib/.server/rate-limiter';

function getKv(env: Env): KVNamespace | undefined {
  const anyEnv = env as any;
  return anyEnv.DEPLOY_TOKENS_KV ?? anyEnv.DEPLOY_KV ?? anyEnv.SUPABASE_KV ?? anyEnv.RATE_LIMIT_KV;
}

function tokenKey(provider: string, sessionId: string): string {
  return `deploy:token:${provider}:${sessionId}`;
}

async function getStoredToken(env: Env, provider: string, sessionId: string): Promise<string | null> {
  const kv = getKv(env);

  if (!kv) {
    return null;
  }

  try {
    const raw = await kv.get(tokenKey(provider, sessionId), 'text');

    if (!raw) {
      return null;
    }

    return (JSON.parse(raw) as any).token ?? null;
  } catch {
    return null;
  }
}

// GET status polling — hits the real Netlify deploy API and returns live state + best-effort logs
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as Env;
  const sessionId = getEffectiveSessionId(request);

  if (!sessionId) {
    return json({ error: 'Missing session' }, { status: 401 });
  }

  const url = new URL(request.url);
  const deploymentId = url.searchParams.get('deploymentId');
  const projectName = url.searchParams.get('projectName');

  if (!deploymentId || !projectName) {
    return json({ error: 'Missing deploymentId/projectName' }, { status: 400, headers: { 'X-Session-Id': sessionId } });
  }

  const headers: Record<string, string> = { 'X-Session-Id': sessionId };
  const cookieSid = getSessionId(request);

  if (cookieSid !== sessionId) {
    headers['Set-Cookie'] = createSessionCookie(sessionId, request);
  }

  const token = await getStoredToken(env, 'netlify', sessionId);

  if (!token) {
    return json({ error: 'Missing Netlify token' }, { status: 401, headers });
  }

  // deploymentId format: siteId:deployId (set by the action)
  const [siteId, deployId] = String(deploymentId).split(':');

  if (!siteId || !deployId) {
    return json({ error: 'Invalid deploymentId' }, { status: 400, headers });
  }

  try {
    const depRes = await fetch(`https://api.netlify.com/api/v1/deploys/${encodeURIComponent(deployId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const dep: any = await depRes.json().catch(() => ({}));

    if (!depRes.ok) {
      return json({ error: dep?.message ?? `Netlify status check failed: ${depRes.status}` }, { status: 502, headers });
    }

    const state = String(dep.state ?? 'processing');
    const liveUrl = dep.ssl_url ?? dep.deploy_ssl_url ?? dep.urls?.[0] ?? `https://${projectName}.netlify.app`;

    // normalize Netlify state → app status
    let status: 'initializing' | 'ready' | 'success' | 'error' = 'initializing';

    if (state === 'ready') {
      status = 'ready';
    } else if (state === 'error') {
      status = 'error';
    }

    // best-effort build logs (Netlify log endpoint requires auth context)
    const deployLogs: string[] = [];

    try {
      const logRes = await fetch(
        `https://api.netlify.com/api/v1/deploys/${encodeURIComponent(deployId)}/log?context=production`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (logRes.ok) {
        const logData: any = await logRes.json().catch(() => ({}));
        const msgs: any[] = Array.isArray(logData) ? logData : Array.isArray(logData?.logs) ? logData.logs : [];

        for (const ev of msgs) {
          const text = typeof ev === 'string' ? ev : ev?.message ?? '';

          if (typeof text === 'string' && text.trim()) {
            deployLogs.push(text.trimEnd());
          }
        }
      }
    } catch {
      // logs are best-effort only
    }

    return json(
      { status, url: liveUrl, deploymentId, projectName, provider: 'netlify', netlifyState: state, logs: deployLogs },
      { headers },
    );
  } catch (e: any) {
    return json({ error: e?.message ?? 'Netlify status check failed' }, { status: 500, headers });
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

    if (cookieSid !== sessionId) {
      setCookie = createSessionCookie(sessionId, request);
    }
  }

  let body: any = {};

  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400, headers: { 'X-Session-Id': sessionId! } });
  }

  const projectName =
    String(body.projectName ?? body.project ?? '')
      .trim()
      .replace(/[^a-z0-9-]/gi, '-')
      .slice(0, 63) || `bolt-${sessionId!.slice(0, 6)}`;
  let token: string | undefined = body.token ? String(body.token).trim() : undefined;
  const files: Record<string, string> = body.files ?? {};

  if (!files || Object.keys(files).length === 0) {
    return json(
      { error: 'No files to deploy. Generate an app first.' },
      { status: 400, headers: { 'X-Session-Id': sessionId! } },
    );
  }

  if (!token) {
    token = (await getStoredToken(env, 'netlify', sessionId!)) ?? undefined;
  }

  if (body.token) {
    const kv = getKv(env);

    if (kv) {
      await kv.put(
        tokenKey('netlify', sessionId!),
        JSON.stringify({ token: body.token, updatedAt: new Date().toISOString() }),
        { expirationTtl: 60 * 60 * 24 * 30 },
      );
    }
  }

  if (!token) {
    return json(
      {
        error:
          'Missing Netlify token. Create at https://app.netlify.com/user/applications#personal-access-tokens (scope: sites:write)',
      },
      { status: 401, headers: { 'X-Session-Id': sessionId!, ...(setCookie ? { 'Set-Cookie': setCookie } : {}) } },
    );
  }

  const headers: Record<string, string> = { 'X-Session-Id': sessionId! };

  if (setCookie) {
    headers['Set-Cookie'] = setCookie;
  }

  // validate token shape
  if (token.length < 20) {
    throw json({ error: 'Netlify token invalid: too short' }, { status: 401, headers });
  }

  try {
    const userRes = await fetch('https://api.netlify.com/api/v1/user', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!userRes.ok) {
      const txt = await userRes.text().catch(() => '');
      throw json({ error: `Netlify token invalid: ${userRes.status} ${txt.slice(0, 200)}` }, { status: 401, headers });
    }
  } catch (e: any) {
    if (e instanceof Response) {
      throw e;
    }

    throw json({ error: e.message ?? 'Netlify deployment failed' }, { status: 500, headers });
  }

  // real Netlify API: create-or-get site → digest deploy → upload required files
  try {
    // create site (fall back to a suffixed name if the desired one is taken)
    let site: any = undefined;
    const nameCandidates = [projectName, `${projectName}-${Date.now().toString(36).slice(-5)}`];
    let lastErr = '';

    for (const name of nameCandidates) {
      const siteRes = await fetch('https://api.netlify.com/api/v1/sites', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (siteRes.ok) {
        site = await siteRes.json();
        break;
      }

      const errData: any = await siteRes.json().catch(() => ({}));
      lastErr = errData?.message ?? String(siteRes.status);
    }

    if (!site) {
      throw json({ error: `Netlify site creation failed: ${lastErr}` }, { status: 502, headers });
    }

    const siteId: string = site.id;

    // compute SHA-1 digests for every file (Netlify digest deploy protocol)
    const digests: Record<string, string> = {};
    const byDigest: Record<string, string> = {};

    for (const [path, content] of Object.entries(files)) {
      const data = new TextEncoder().encode(content);
      const hashBuf = await crypto.subtle.digest('SHA-1', data);
      const sha = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      digests[path] = sha;
      byDigest[sha] = path;
    }

    // create the deploy with digests
    const deployRes = await fetch(`https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}/deploys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: digests, async: true }),
    });
    const deploy: any = await deployRes.json().catch(() => ({}));

    if (!deployRes.ok) {
      throw json(
        { error: deploy?.message ?? `Netlify deploy creation failed: ${deployRes.status}` },
        { status: 502, headers },
      );
    }

    const deployId: string = deploy.id;

    // upload any files Netlify doesn't already have
    const required: string[] = Array.isArray(deploy.required) ? deploy.required : [];

    for (const req of required) {
      const path = byDigest[req] ?? req;
      const content = files[path];

      if (content === undefined) {
        continue;
      }

      await fetch(
        `https://api.netlify.com/api/v1/deploys/${encodeURIComponent(deployId)}/files/${path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
          body: content,
        },
      );
    }

    const liveUrl = site.ssl_url ?? `https://${site.name}.netlify.app`;

    return json(
      {
        status: 'initializing',
        deploymentId: `${siteId}:${deployId}`,
        projectName,
        url: liveUrl,
        liveUrl,
        provider: 'netlify',
      },
      { headers },
    );
  } catch (e: any) {
    if (e instanceof Response) {
      throw e;
    }

    throw json({ error: e.message ?? 'Netlify deployment failed' }, { status: 500, headers });
  }
}
