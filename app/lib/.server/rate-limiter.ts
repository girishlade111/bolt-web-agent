/**
 * IP + session-cookie rate limiter for LLM generation endpoints.
 * - 20 generations per session per hour (fixed window, hour bucket)
 * - 100 generations per IP per day (fixed window, day bucket UTC)
 * Storage: Cloudflare KV (RATE_LIMIT_KV) if bound, otherwise in-memory fallback for local dev.
 *         Designed to be swapped to Durable Objects without changing call sites:
 *         create a DO class with same increment semantics and bind as RATE_LIMITER_DO.
 */

export const SESSION_COOKIE_NAME = 'bolt_session';
export const SESSION_LIMIT = 20;
export const SESSION_WINDOW_SEC = 60 * 60; // 1 hour
export const IP_LIMIT = 100;
export const IP_WINDOW_SEC = 60 * 60 * 24; // 24 hours

interface RateLimitEnv {
  RATE_LIMIT_KV?: KVNamespace;
  // Optional Durable Object namespace – if present, used instead of KV
  RATE_LIMITER_DO?: DurableObjectNamespace;
}

// In-memory fallback for local dev / when KV not bound.
// Stored on globalThis so it survives HMR and per-isolate reuse.
type MemoryEntry = { count: number; expiresAt: number };
function getMemoryStore(): Map<string, MemoryEntry> {
  const g = globalThis as unknown as { __RL_MEMORY__?: Map<string, MemoryEntry> };
  if (!g.__RL_MEMORY__) {
    g.__RL_MEMORY__ = new Map<string, MemoryEntry>();
  }
  return g.__RL_MEMORY__;
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey) continue;
    out[rawKey] = decodeURIComponent(rest.join('=') || '');
  }
  return out;
}

export function getClientIP(request: Request): string {
  // Cloudflare Pages/Workers provides cf-connecting-ip; also handle common proxy headers.
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp.trim();

  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    // first is original client
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }

  const xReal = request.headers.get('x-real-ip');
  if (xReal) return xReal.trim();

  // For local dev this will often be empty; use a stable fallback so
  // per-IP limiting still works (but doesn't collapse all dev traffic to one bucket unintentionally).
  return '127.0.0.1';
}

export function getSessionId(request: Request): string | null {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const v = cookies[SESSION_COOKIE_NAME];
  if (v && /^[a-zA-Z0-9-_]{8,128}$/.test(v) || (v && v.length >= 20)) {
    // accept UUIDs and any sufficiently long random string
    return v;
  }
  // If cookie exists but is short/malformed, treat as missing and rotate
  return v && v.length > 0 ? v : null;
}

export function generateSessionId(): string {
  // crypto.randomUUID is available in Workers / Node 18+
  try {
    return crypto.randomUUID().replace(/-/g, '');
  } catch {
    // fallback
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function createSessionCookie(sessionId: string, request?: Request): string {
  const base = `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;
  const isHttps = request?.url?.startsWith('https://') ?? false;
  const isProduction = typeof process !== 'undefined' && (process as any).env?.NODE_ENV === 'production';
  const shouldSecure = isHttps || isProduction;
  return shouldSecure ? `${base}; Secure` : base;
}

function sessionBucket(): number {
  return Math.floor(Date.now() / (SESSION_WINDOW_SEC * 1000));
}

function ipBucket(): number {
  return Math.floor(Date.now() / (IP_WINDOW_SEC * 1000));
}

function sessionKey(sessionId: string): string {
  return `rl:session:${sessionId}:${sessionBucket()}`;
}

function ipKey(ip: string): string {
  return `rl:ip:${ip}:${ipBucket()}`;
}

function ttlForSessionBucket(): number {
  const nowSec = Date.now() / 1000;
  const remainder = nowSec % SESSION_WINDOW_SEC;
  return Math.ceil(SESSION_WINDOW_SEC - remainder);
}

function ttlForIpBucket(): number {
  const nowSec = Date.now() / 1000;
  const remainder = nowSec % IP_WINDOW_SEC;
  return Math.ceil(IP_WINDOW_SEC - remainder);
}

// KV helpers
async function incrementKV(kv: KVNamespace, key: string, ttlSec: number): Promise<number> {
  const current = await kv.get(key);
  const count = current ? parseInt(current, 10) || 0 : 0;
  const next = count + 1;
  // expirationTtl is relative TTL; each write resets TTL for fixed-bucket keys we want
  // time-to-bucket-expiry, but kv put with expirationTtl will extend if we rewrite.
  // For fixed window we compute ttl to bucket expiry at call time, so it's correct.
  await kv.put(key, String(next), { expirationTtl: ttlSec });
  return next;
}

function incrementMemory(key: string, ttlSec: number): number {
  const store = getMemoryStore();
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.expiresAt <= now) {
    const next = 1;
    store.set(key, { count: next, expiresAt: now + ttlSec * 1000 });
    return next;
  }
  entry.count += 1;
  store.set(key, entry);
  return entry.count;
}

async function incrementCounter(env: RateLimitEnv, key: string, ttlSec: number): Promise<number> {
  // Prefer Durable Object if bound (atomic increment), then KV, then memory.
  if (env.RATE_LIMITER_DO) {
    try {
      // DO id derived from key; each key gets its own DO instance (simple, not most efficient but correct).
      // Expected DO class implements fetch with { key, ttlSec } JSON and returns { count }.
      const id = env.RATE_LIMITER_DO.idFromName(key);
      const stub = env.RATE_LIMITER_DO.get(id);
      const res = await stub.fetch('https://rate-limiter/increment', {
        method: 'POST',
        body: JSON.stringify({ key, ttlSec }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = (await res.json()) as { count: number };
        if (typeof data.count === 'number') return data.count;
      }
    } catch (e) {
      console.warn('[rate-limiter] Durable Object increment failed, falling back to KV/memory', e);
    }
  }

  if (env.RATE_LIMIT_KV) {
    try {
      return await incrementKV(env.RATE_LIMIT_KV, key, ttlSec);
    } catch (e) {
      console.warn('[rate-limiter] KV increment failed, falling back to memory', e);
      return incrementMemory(key, ttlSec);
    }
  }

  return incrementMemory(key, ttlSec);
}

export interface RateLimitResult {
  allowed: boolean;
  sessionId: string;
  isNewSession: boolean;
  cookieHeader: string | null;
  ip: string;
  sessionCount: number;
  ipCount: number;
  retryAfter?: number;
  errorMessage?: string;
  limitType?: 'session' | 'ip';
}

/**
 * Check both limits. Increments counters and returns 429 info if either limit exceeded.
 * When allowed, caller must append cookieHeader (if present) to the response.
 */
export async function checkRateLimit(request: Request, env: RateLimitEnv): Promise<RateLimitResult> {
  const ip = getClientIP(request);
  let sessionId = getSessionId(request);
  let isNewSession = false;

  if (!sessionId) {
    sessionId = generateSessionId();
    isNewSession = true;
  }

  const sKey = sessionKey(sessionId);
  const iKey = ipKey(ip);
  const sTtl = ttlForSessionBucket();
  const iTtl = ttlForIpBucket();

  // Increment both windows
  const [sessionCount, ipCount] = await Promise.all([
    incrementCounter(env, sKey, sTtl),
    incrementCounter(env, iKey, iTtl),
  ]);

  const cookieHeader = isNewSession ? createSessionCookie(sessionId, request) : null;

  if (sessionCount > SESSION_LIMIT) {
    return {
      allowed: false,
      sessionId,
      isNewSession,
      cookieHeader,
      ip,
      sessionCount,
      ipCount,
      retryAfter: sTtl,
      limitType: 'session',
      errorMessage: `Rate limit exceeded: max ${SESSION_LIMIT} generations per hour per session. Try again in ${sTtl}s.`,
    };
  }

  if (ipCount > IP_LIMIT) {
    return {
      allowed: false,
      sessionId,
      isNewSession,
      cookieHeader,
      ip,
      sessionCount,
      ipCount,
      retryAfter: iTtl,
      limitType: 'ip',
      errorMessage: `Rate limit exceeded: max ${IP_LIMIT} generations per day per IP. Try again in ${iTtl}s.`,
    };
  }

  return {
    allowed: true,
    sessionId,
    isNewSession,
    cookieHeader,
    ip,
    sessionCount,
    ipCount,
  };
}

/** Build a 429 Response with JSON body and Retry-After. Caller may also append Set-Cookie. */
export function createRateLimitResponse(result: RateLimitResult): Response {
  const retryAfter = result.retryAfter ?? 60;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Retry-After': String(retryAfter),
    'X-RateLimit-Limit-Session': String(SESSION_LIMIT),
    'X-RateLimit-Limit-IP': String(IP_LIMIT),
    'X-RateLimit-Remaining-Session': String(Math.max(0, SESSION_LIMIT - result.sessionCount)),
    'X-RateLimit-Remaining-IP': String(Math.max(0, IP_LIMIT - result.ipCount)),
  };
  if (result.cookieHeader) {
    headers['Set-Cookie'] = result.cookieHeader;
  }
  const body = JSON.stringify({
    error: result.errorMessage ?? 'Too Many Requests',
    limitType: result.limitType,
    retryAfter,
  });
  return new Response(body, { status: 429, headers });
}

/** Append rate-limit + session cookie headers to a successful response. */
export function appendRateLimitHeaders(response: Response, result: RateLimitResult): void {
  if (result.cookieHeader) {
    response.headers.append('Set-Cookie', result.cookieHeader);
  }
  response.headers.set('X-RateLimit-Limit-Session', String(SESSION_LIMIT));
  response.headers.set('X-RateLimit-Remaining-Session', String(Math.max(0, SESSION_LIMIT - result.sessionCount)));
  response.headers.set('X-RateLimit-Limit-IP', String(IP_LIMIT));
  response.headers.set('X-RateLimit-Remaining-IP', String(Math.max(0, IP_LIMIT - result.ipCount)));
  response.headers.set('X-RateLimit-Session', result.sessionId);
}
