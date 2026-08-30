/**
 * Client-side session cache for fork-race fix.
 * Stores X-Session-Id from first api/chat response and replays it as
 * X-Session-Id header on all subsequent /api/* calls in the same turn,
 * so concurrent requests (api/chat, api/chat-history, api/supabase) share
 * the same atomic session identity instead of each generating a new one
 * while Set-Cookie is still in flight.
 */

function isValidSessionId(v: string | null | undefined): boolean {
  if (!v) return false;
  return /^[a-zA-Z0-9-_]{8,128}$/.test(v) || v.length >= 20;
}

let cachedSessionId: string | null = null;

export function getCachedSessionId(): string | null {
  return cachedSessionId;
}

export function setCachedSessionId(id: string | null): void {
  if (isValidSessionId(id)) {
    cachedSessionId = id!;
  }
}

export function captureSessionIdFromResponse(res: Response): void {
  const sid = res.headers.get('X-Session-Id') || res.headers.get('X-RateLimit-Session');
  if (isValidSessionId(sid)) {
    cachedSessionId = sid!;
  }
  // Also try to capture from JSON body if server echoed sessionId (for non-streaming)
  // This is handled separately where needed (clone + json), but headers are primary.
}

export function getSessionHeaders(): Record<string, string> {
  return cachedSessionId ? { 'X-Session-Id': cachedSessionId } : {};
}

/**
 * Wrapped fetch that:
 * 1) injects X-Session-Id from cache
 * 2) captures X-Session-Id from response to populate cache
 * Ensures HttpOnly bolt_session cookie is still sent via credentials: 'include'.
 */
export async function fetchWithSession(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers as HeadersInit);
  if (cachedSessionId) {
    headers.set('X-Session-Id', cachedSessionId);
  }
  const res = await fetch(url, { ...init, headers, credentials: 'include' as RequestCredentials });
  captureSessionIdFromResponse(res);
  // For JSON responses that include sessionId in body (e.g., /api/supabase), also capture
  // We clone to avoid consuming body for the caller, but only if res is JSON and not already captured
  if (!cachedSessionId) {
    try {
      const clone = res.clone();
      const ct = clone.headers.get('Content-Type') || '';
      if (ct.includes('application/json')) {
        const data: any = await clone.json().catch(() => null);
        if (data?.sessionId && isValidSessionId(data.sessionId)) {
          cachedSessionId = data.sessionId;
        }
      }
    } catch {}
  }
  return res;
}
