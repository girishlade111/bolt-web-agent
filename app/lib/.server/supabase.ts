/**
 * Supabase project auto-provisioning — session-scoped, Management API backed.
 * - Detection: keyword heuristic on prompt + explicit user toggle.
 * - Storage: Cloudflare KV (SUPABASE_KV → RATE_LIMIT_KV fallback → in-memory) keyed by session ID.
 * - Future-proof schema: prompts instruct LLM to add nullable `user_id UUID` column.
 */

import { getSessionId, getEffectiveSessionId, generateSessionId } from '~/lib/.server/rate-limiter';

export interface SupabaseProject {
  id: string;
  name: string;
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  sessionId: string;
  createdAt: number;
  status: 'mock' | 'provisioned' | 'provisioning';
  region?: string;
}

const KV_KEY_PREFIX = 'supabase:project:';
const KV_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days session ownership

// Keywords that strongly indicate a DB is needed. Keep heuristic cheap — no LLM call.
const DATABASE_KEYWORDS = [
  'supabase',
  'postgres',
  'postgresql',
  'database',
  'db',
  'prisma',
  'drizzle',
  'auth',
  'authentication',
  'users table',
  'user table',
  'todo',
  'crud',
  'real-time',
  'realtime',
  'subscription',
  'storage',
  'bucket',
  'rls',
  'row level',
];

const EXPLICIT_DB_PHRASES = [
  'needs a database',
  'needs database',
  'with database',
  'use supabase',
  'with supabase',
  'persist',
  'save to db',
  'store in db',
];

export function needsDatabase(prompt: string): boolean {
  if (!prompt || typeof prompt !== 'string') return false;
  const lower = prompt.toLowerCase();
  // explicit phrases first
  if (EXPLICIT_DB_PHRASES.some((p) => lower.includes(p))) return true;
  // keyword match — require word boundaries for short terms
  return DATABASE_KEYWORDS.some((kw) => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // for 2-char keywords like 'db' require word boundary
    if (kw.length <= 3) {
      return new RegExp(`\\b${escaped}\\b`, 'i').test(prompt);
    }
    return lower.includes(kw);
  });
}

export function shouldProvisionSupabase(opts: { prompt?: string; explicitToggle?: boolean }): boolean {
  if (opts.explicitToggle) return true;
  if (opts.prompt && needsDatabase(opts.prompt)) return true;
  return false;
}

function getKvNamespace(env: Env): KVNamespace | undefined {
  // Prefer dedicated SUPABASE_KV, fallback to RATE_LIMIT_KV for dev, else undefined -> memory
  const anyEnv = env as any;
  return anyEnv.SUPABASE_KV ?? anyEnv.SUPABASE_PROJECTS_KV ?? anyEnv.RATE_LIMIT_KV;
}

// In-memory fallback (per-isolate)
type MemEntry = { project: SupabaseProject; expiresAt: number };
function getMemStore(): Map<string, MemEntry> {
  const g = globalThis as unknown as { __SUPABASE_MEM__?: Map<string, MemEntry> };
  if (!g.__SUPABASE_MEM__) g.__SUPABASE_MEM__ = new Map();
  return g.__SUPABASE_MEM__;
}

export function supabaseKvKey(sessionId: string): string {
  return `${KV_KEY_PREFIX}${sessionId}`;
}

export function formatSupabaseEnv(project: SupabaseProject): string {
  return [
    `# Supabase — auto-provisioned for session ${project.sessionId} (scoped, no auth yet)`,
    `# To add per-user ownership later, add nullable user_id UUID column (see prompt instructions)`,
    `VITE_SUPABASE_URL=${project.url}`,
    `VITE_SUPABASE_ANON_KEY=${project.anonKey}`,
    `SUPABASE_URL=${project.url}`,
    `SUPABASE_ANON_KEY=${project.anonKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${project.serviceRoleKey}`,
  ].join('\n');
}

export function getSupabaseEnvVars(project: SupabaseProject): Record<string, string> {
  return {
    VITE_SUPABASE_URL: project.url,
    VITE_SUPABASE_ANON_KEY: project.anonKey,
    SUPABASE_URL: project.url,
    SUPABASE_ANON_KEY: project.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: project.serviceRoleKey,
  };
}

function randomPassword(length = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let out = '';
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  for (let i = 0; i < length; i++) out += chars[arr[i] % chars.length];
  return out;
}

function mockProject(sessionId: string): SupabaseProject {
  const short = sessionId.slice(0, 8);
  // Use a deterministic mock URL so tests are stable
  const url = `https://${short}.supabase.co`;
  return {
    id: `mock-${short}-${Date.now()}`,
    name: `bolt-${short}`,
    url,
    anonKey: `mock-anon-key-${sessionId}`,
    serviceRoleKey: `mock-service-role-key-${sessionId}`,
    sessionId,
    createdAt: Date.now(),
    status: 'mock' as const,
    region: 'us-east-1',
  };
}

async function getCachedProject(sessionId: string, env: Env): Promise<SupabaseProject | null> {
  const kv = getKvNamespace(env);
  const key = supabaseKvKey(sessionId);
  if (kv) {
    try {
      const raw = await kv.get(key, 'text');
      if (raw) return JSON.parse(raw) as SupabaseProject;
    } catch (e) {
      console.warn('[supabase] KV get failed, falling back to memory', e);
    }
  }
  const mem = getMemStore().get(key);
  if (mem && mem.expiresAt > Date.now()) return mem.project;
  if (mem) getMemStore().delete(key);
  return null;
}

async function putCachedProject(sessionId: string, project: SupabaseProject, env: Env): Promise<void> {
  const kv = getKvNamespace(env);
  const key = supabaseKvKey(sessionId);
  const raw = JSON.stringify(project);
  if (kv) {
    try {
      await kv.put(key, raw, { expirationTtl: KV_TTL_SECONDS });
      return;
    } catch (e) {
      console.warn('[supabase] KV put failed, using memory', e);
    }
  }
  getMemStore().set(key, { project, expiresAt: Date.now() + KV_TTL_SECONDS * 1000 });
}

async function createViaManagementApi(sessionId: string, env: Env): Promise<SupabaseProject | null> {
  const token = (env as any).SUPABASE_ACCESS_TOKEN ?? (env as any).SUPABASE_MANAGEMENT_TOKEN;
  const orgId = (env as any).SUPABASE_ORG_ID;
  const region = (env as any).SUPABASE_REGION ?? 'us-east-1';

  if (!token || !orgId) {
    return null;
  }

  const name = `bolt-${sessionId.slice(0, 8)}-${Date.now().toString(36)}`;
  const dbPass = randomPassword(20);

  try {
    const res = await fetch('https://api.supabase.com/v1/projects', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        organization_id: orgId,
        region,
        plan: 'free',
        db_pass: dbPass,
        kps_enabled: false,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[supabase] Management API create failed', res.status, text);
      return null;
    }

    const data: any = await res.json().catch(() => ({}));
    // Supabase returns project with id, status; URL is https://<ref>.supabase.co where ref is id
    const projectId: string = data.id ?? data.project_ref ?? name;
    const url = data.endpoint ?? data.url ?? `https://${projectId}.supabase.co`;
    // anon/service keys require second call to /v1/projects/{ref}/api-keys, but we can attempt
    let anonKey = data.anon_key ?? '';
    let serviceRoleKey = data.service_role_key ?? '';

    // If keys not in create response, try fetch api keys
    if (!anonKey && projectId) {
      try {
        const keysRes = await fetch(`https://api.supabase.com/v1/projects/${projectId}/api-keys`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (keysRes.ok) {
          const keys: any[] = await keysRes.json();
          anonKey = keys.find((k: any) => k.name === 'anon')?.api_key ?? anonKey;
          serviceRoleKey = keys.find((k: any) => k.name === 'service_role')?.api_key ?? serviceRoleKey;
        }
      } catch {}
    }

    const project: SupabaseProject = {
      id: projectId,
      name,
      url,
      anonKey: anonKey || `pending-anon-${projectId}`,
      serviceRoleKey: serviceRoleKey || `pending-service-${projectId}`,
      sessionId,
      createdAt: Date.now(),
      status: anonKey ? 'provisioned' : 'provisioning',
      region,
    };
    return project;
  } catch (e) {
    console.error('[supabase] Management API exception', e);
    return null;
  }
}

/**
 * Main entry: ensure a Supabase project exists for this session if needed.
 * Returns project if provisioned/cached, null if not needed.
 * Scope is sessionId — no user auth yet. Store includes sessionId for ownership.
 */
export async function ensureSupabaseProject(opts: {
  sessionId: string;
  env: Env;
  prompt?: string;
  explicitToggle?: boolean;
  force?: boolean;
}): Promise<SupabaseProject | null> {
  const { sessionId, env, prompt, explicitToggle, force } = opts;

  if (!force && !shouldProvisionSupabase({ prompt, explicitToggle })) {
    return null;
  }

  const cached = await getCachedProject(sessionId, env);
  if (cached) return cached;

  // Try Management API, fallback to mock for dev / misconfig
  const created = await createViaManagementApi(sessionId, env);
  const project = created ?? mockProject(sessionId);

  await putCachedProject(sessionId, project, env);

  console.log('[supabase] provisioned project for session', {
    sessionId: sessionId.slice(0, 8) + '…',
    projectId: project.id,
    status: project.status,
    url: project.url,
    timestamp: new Date().toISOString(),
  });

  return project;
}

export async function getSupabaseProjectForSession(sessionId: string, env: Env): Promise<SupabaseProject | null> {
  return getCachedProject(sessionId, env);
}

// Helper to pull sessionId from request (prefers X-Session-Id header for fork-race safety)
export function getSessionIdFromRequest(request: Request): string | null {
  return getEffectiveSessionId(request);
}

// Ensure sessionId exists (generate if missing, but caller should set cookie via rate-limiter loader)
export function ensureSessionId(request: Request): string {
  return getEffectiveSessionId(request) ?? generateSessionId();
}
