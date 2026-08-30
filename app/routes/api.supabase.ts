import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import {
  ensureSupabaseProject,
  formatSupabaseEnv,
  getSupabaseProjectForSession,
  getSessionIdFromRequest,
  needsDatabase,
} from '~/lib/.server/supabase';
import { getSessionId, getEffectiveSessionId, generateSessionId, createSessionCookie } from '~/lib/.server/rate-limiter';

// GET → return current session's project if exists, else { provisioned: false }
// Query ?prompt=… can be used to check classification without provisioning
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as Env;
  const sessionId = getEffectiveSessionId(request);
  const url = new URL(request.url);
  const prompt = url.searchParams.get('prompt') ?? undefined;

  if (!sessionId) {
    return json({ provisioned: false, needsDatabase: prompt ? needsDatabase(prompt) : false });
  }

  const headers: Record<string, string> = { 'X-Session-Id': sessionId };
  const cookieSid = getSessionId(request);
  if (cookieSid !== sessionId) {
    headers['Set-Cookie'] = createSessionCookie(sessionId, request);
  }

  const project = await getSupabaseProjectForSession(sessionId, env);

  if (!project) {
    return json(
      {
        provisioned: false,
        needsDatabase: prompt ? needsDatabase(prompt) : false,
        sessionId,
      },
      { headers },
    );
  }

  return json(
    {
      provisioned: true,
      project: {
        id: project.id,
        url: project.url,
        anonKey: project.anonKey,
        status: project.status,
      },
      envString: formatSupabaseEnv(project),
      sessionId,
    },
    { headers },
  );
}

// POST → provision (or return cached) if needsDatabase or explicitToggle
// Body: { prompt?: string, enableSupabase?: boolean, force?: boolean }
export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as Env;
  let sessionId = getSessionIdFromRequest(request);
  let setCookie: string | undefined;

  if (!sessionId) {
    sessionId = generateSessionId();
    setCookie = createSessionCookie(sessionId, request);
  }

  let body: { prompt?: string; enableSupabase?: boolean; force?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    // empty body is fine
  }

  const explicitToggle = Boolean(body.enableSupabase);
  const prompt = body.prompt;
  const force = Boolean(body.force);

  const project = await ensureSupabaseProject({
    sessionId,
    env,
    prompt,
    explicitToggle,
    force,
  });

  // Not needed → no provisioning
  if (!project) {
    const headers: Record<string, string> = {};
    if (setCookie) headers['Set-Cookie'] = setCookie;
    return json(
      {
        provisioned: false,
        needsDatabase: prompt ? needsDatabase(prompt) : false,
        explicitToggle,
        sessionId,
        message: 'No database needed for this prompt. Toggle enableSupabase=true to force.',
      },
      { headers },
    );
  }

  const headers: Record<string, string> = {};
  if (setCookie) headers['Set-Cookie'] = setCookie;

  return json(
    {
      provisioned: true,
      project: {
        id: project.id,
        url: project.url,
        anonKey: project.anonKey,
        serviceRoleKey: project.serviceRoleKey,
        status: project.status,
      },
      envString: formatSupabaseEnv(project),
      envVars: {
        VITE_SUPABASE_URL: project.url,
        VITE_SUPABASE_ANON_KEY: project.anonKey,
        SUPABASE_URL: project.url,
        SUPABASE_ANON_KEY: project.anonKey,
      },
      sessionId,
    },
    { headers },
  );
}
