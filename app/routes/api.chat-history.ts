import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getSessionId, getEffectiveSessionId, generateSessionId, createSessionCookie } from '~/lib/.server/rate-limiter';
import {
  getChatsForSession,
  getChatForSession,
  saveChatForSession,
  deleteChatForSession,
} from '~/lib/.server/chat-persistence';

// GET /api/chat-history?id=xxx or /api/chat-history -> list
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as Env;
  let sessionId = getEffectiveSessionId(request);
  if (!sessionId) {
    // No session yet — return empty, client will use IndexedDB cache
    return json({ chats: [], sessionId: null });
  }

  const url = new URL(request.url);
  const lookupId = url.searchParams.get('id');

  // Always return X-Session-Id so client can capture atomic session
  const headers: Record<string, string> = { 'X-Session-Id': sessionId };
  const cookieSid = getSessionId(request);
  if (cookieSid !== sessionId) {
    headers['Set-Cookie'] = createSessionCookie(sessionId, request);
  }

  if (lookupId) {
    const chat = await getChatForSession(sessionId, lookupId, env);
    if (!chat) return json({ chat: null, sessionId }, { status: 404, headers });
    return json({ chat, sessionId }, { headers });
  }

  const chats = await getChatsForSession(sessionId, env);
  return json({ chats, sessionId }, { headers });
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

  const method = request.method.toUpperCase();

  if (method === 'POST' || method === 'PUT') {
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { id, urlId, description, messages, fileSnapshot } = body ?? {};

    if (!id || !Array.isArray(messages)) {
      return json({ error: 'Missing id or messages[]' }, { status: 400 });
    }

    let saved;
    try {
      saved = await saveChatForSession(
        sessionId,
        { id, urlId, description, messages, fileSnapshot: fileSnapshot ?? null },
        env,
      );
    } catch (e: any) {
      const headers: Record<string, string> = { 'X-Session-Id': sessionId };
      if (setCookie) headers['Set-Cookie'] = setCookie;
      // Real user impact: chat history + file snapshot must survive refresh/device change
      throw json({ error: e?.message ?? 'Failed to persist chat history', sessionId }, { status: 500, headers });
    }

    const headers: Record<string, string> = { 'X-Session-Id': sessionId };
    if (setCookie) headers['Set-Cookie'] = setCookie;

    return json({ ok: true, chat: saved, sessionId }, { headers });
  }

  if (method === 'DELETE') {
    let body: any = {};
    try {
      body = await request.json().catch(() => ({}));
    } catch {}
    const url = new URL(request.url);
    const id = body?.id ?? url.searchParams.get('id');
    if (!id) return json({ error: 'Missing id' }, { status: 400 });

    try {
      await deleteChatForSession(sessionId, id, env);
    } catch (e: any) {
      const headers: Record<string, string> = { 'X-Session-Id': sessionId };
      if (setCookie) headers['Set-Cookie'] = setCookie;
      throw json({ error: e?.message ?? 'Failed to delete chat history', sessionId }, { status: 500, headers });
    }
    const headers: Record<string, string> = { 'X-Session-Id': sessionId };
    if (setCookie) headers['Set-Cookie'] = setCookie;
    return json({ ok: true, sessionId }, { headers });
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
}
