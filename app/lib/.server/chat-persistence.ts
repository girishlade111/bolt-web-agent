/**
 * Server-side chat persistence — Postgres/Supabase primary, KV/memory fallback.
 * Keyed by session ID cookie (no user auth yet), table designed with nullable user_id
 * for future migration to real auth without disruptive migration.
 *
 * Postgres schema (see supabase/migrations/*):
 *   chats (
 *     id text primary key,
 *     session_id text not null,
 *     user_id uuid null references auth.users(id) on delete set null,
 *     url_id text,
 *     description text,
 *     messages jsonb not null default '[]',
 *     file_snapshot jsonb null, -- generated file snapshots for WebContainer restore
 *     created_at timestamptz default now(),
 *     updated_at timestamptz default now()
 *   )
 *   create index idx_chats_session_id on chats(session_id);
 *   create index idx_chats_user_id on chats(user_id) where user_id is not null;
 *   RLS: enable, policies allow anon with session_id = current_setting('app.session_id') or service_role bypass.
 *
 * Runtime: tries Supabase REST (CHAT_SUPABASE_URL + SERVICE_KEY) if configured,
 * otherwise falls back to Cloudflare KV (CHAT_HISTORY_KV → SUPABASE_KV → RATE_LIMIT_KV) → memory.
 */

import type { Message } from 'ai';
import type { ChatHistoryItem } from '~/lib/persistence/useChatHistory';

export interface ServerChatItem extends ChatHistoryItem {
  sessionId: string;
  userId: string | null; // nullable for future auth migration
  fileSnapshot?: Record<string, string> | null;
}

const INDEX_PREFIX = 'chat:index:';
const CHAT_PREFIX = 'chat:';
const KV_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

function getKvNamespace(env: Env): KVNamespace | undefined {
  const anyEnv = env as any;
  return anyEnv.CHAT_HISTORY_KV ?? anyEnv.CHATS_KV ?? anyEnv.SUPABASE_KV ?? anyEnv.RATE_LIMIT_KV;
}

type MemEntry = { value: any; expiresAt: number };
function getMemStore(): Map<string, MemEntry> {
  const g = globalThis as unknown as { __CHAT_MEM__?: Map<string, MemEntry> };
  if (!g.__CHAT_MEM__) g.__CHAT_MEM__ = new Map();
  return g.__CHAT_MEM__;
}

function chatKvKey(sessionId: string, id: string): string {
  return `${CHAT_PREFIX}${sessionId}:${id}`;
}
function indexKvKey(sessionId: string): string {
  return `${INDEX_PREFIX}${sessionId}`;
}

// ---- Supabase REST helpers (optional) ----
function getSupabaseConfig(env: Env): { url: string; serviceKey: string } | null {
  const anyEnv = env as any;
  // Central builder DB — not per-session provisioned project. Use explicit builder vars if present.
  const url = anyEnv.CHAT_SUPABASE_URL ?? anyEnv.SUPABASE_URL ?? anyEnv.VITE_SUPABASE_URL;
  const serviceKey = anyEnv.CHAT_SUPABASE_SERVICE_KEY ?? anyEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey) return { url: url.replace(/\/$/, ''), serviceKey };
  return null;
}

async function supabaseFetch(
  env: Env,
  path: string,
  opts: RequestInit = {},
): Promise<Response | null> {
  const cfg = getSupabaseConfig(env);
  if (!cfg) return null;
  const headers: Record<string, string> = {
    apikey: cfg.serviceKey,
    Authorization: `Bearer ${cfg.serviceKey}`,
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string>),
  };
  try {
    const res = await fetch(`${cfg.url}/rest/v1/${path}`, { ...opts, headers });
    return res;
  } catch (e) {
    console.warn('[chat-persistence] supabase fetch failed, falling back to KV', e);
    return null;
  }
}

// ---- KV / Memory helpers ----

async function kvGet<T>(env: Env, key: string): Promise<T | null> {
  const kv = getKvNamespace(env);
  if (kv) {
    try {
      const raw = await kv.get(key, 'text');
      if (raw) return JSON.parse(raw) as T;
    } catch (e) {
      console.warn('[chat-persistence] KV get failed', e);
    }
  }
  const mem = getMemStore().get(key);
  if (mem && mem.expiresAt > Date.now()) return mem.value as T;
  if (mem) getMemStore().delete(key);
  return null;
}

async function kvPut(env: Env, key: string, value: any): Promise<void> {
  const kv = getKvNamespace(env);
  const raw = JSON.stringify(value);
  if (kv) {
    try {
      await kv.put(key, raw, { expirationTtl: KV_TTL_SECONDS });
      return;
    } catch (e) {
      console.warn('[chat-persistence] KV put failed', e);
    }
  }
  getMemStore().set(key, { value, expiresAt: Date.now() + KV_TTL_SECONDS * 1000 });
}

async function kvDelete(env: Env, key: string): Promise<void> {
  const kv = getKvNamespace(env);
  if (kv) {
    try {
      await kv.delete(key);
    } catch {}
  }
  getMemStore().delete(key);
}

async function getIndex(env: Env, sessionId: string): Promise<string[]> {
  const data = await kvGet<string[]>(env, indexKvKey(sessionId));
  return data ?? [];
}
async function putIndex(env: Env, sessionId: string, ids: string[]): Promise<void> {
  await kvPut(env, indexKvKey(sessionId), ids);
}

// ---- Public API ----

export async function getChatsForSession(sessionId: string, env: Env): Promise<ServerChatItem[]> {
  // Try Supabase first
  const sb = await supabaseFetch(env, `chats?session_id=eq.${encodeURIComponent(sessionId)}&select=*&order=updated_at.desc`);
  if (sb && sb.ok) {
    try {
      const rows = (await sb.json()) as any[];
      return rows.map((r) => ({
        id: r.id,
        urlId: r.url_id,
        description: r.description,
        messages: r.messages ?? [],
        timestamp: r.updated_at ?? r.created_at,
        sessionId: r.session_id,
        userId: r.user_id ?? null,
        fileSnapshot: r.file_snapshot ?? null,
      }));
    } catch {}
  }

  // Fallback KV
  const ids = await getIndex(env, sessionId);
  const items: ServerChatItem[] = [];
  for (const id of ids) {
    const item = await kvGet<ServerChatItem>(env, chatKvKey(sessionId, id));
    if (item) items.push(item);
  }
  // sort by timestamp desc (most recent first)
  items.sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''));
  return items;
}

export async function getChatForSession(sessionId: string, lookupId: string, env: Env): Promise<ServerChatItem | null> {
  // Try Supabase: lookup by id OR url_id for this session
  const sb = await supabaseFetch(
    env,
    `chats?session_id=eq.${encodeURIComponent(sessionId)}&or=(id.eq.${encodeURIComponent(lookupId)},url_id.eq.${encodeURIComponent(lookupId)})&select=*&limit=1`,
  );
  if (sb && sb.ok) {
    try {
      const rows = (await sb.json()) as any[];
      if (rows.length > 0) {
        const r = rows[0];
        return {
          id: r.id,
          urlId: r.url_id,
          description: r.description,
          messages: r.messages ?? [],
          timestamp: r.updated_at ?? r.created_at,
          sessionId: r.session_id,
          userId: r.user_id ?? null,
          fileSnapshot: r.file_snapshot ?? null,
        };
      }
    } catch {}
  }

  // KV fallback: check direct id, then urlId scan
  const direct = await kvGet<ServerChatItem>(env, chatKvKey(sessionId, lookupId));
  if (direct) return direct;

  // scan index for urlId match
  const ids = await getIndex(env, sessionId);
  for (const id of ids) {
    const item = await kvGet<ServerChatItem>(env, chatKvKey(sessionId, id));
    if (item && item.urlId === lookupId) return item;
  }
  return null;
}

export async function saveChatForSession(
  sessionId: string,
  input: { id: string; urlId?: string; description?: string; messages: Message[]; fileSnapshot?: Record<string, string> | null },
  env: Env,
): Promise<ServerChatItem> {
  const now = new Date().toISOString();
  const item: ServerChatItem = {
    id: input.id,
    urlId: input.urlId,
    description: input.description,
    messages: input.messages,
    timestamp: now,
    sessionId,
    userId: null, // nullable for future auth migration — no user auth yet
    fileSnapshot: input.fileSnapshot ?? null,
  };

  // Try Supabase upsert
  const sb = await supabaseFetch(env, 'chats', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      id: item.id,
      session_id: sessionId,
      user_id: null,
      url_id: item.urlId,
      description: item.description,
      messages: item.messages,
      file_snapshot: item.fileSnapshot,
      updated_at: now,
    }),
  });
  if (sb && (sb.ok || sb.status === 201)) {
    // also maintain KV index for fallback reads (optional)
    const ids = await getIndex(env, sessionId);
    if (!ids.includes(item.id)) {
      ids.unshift(item.id);
      await putIndex(env, sessionId, ids);
    }
    return item;
  }

  // KV fallback
  await kvPut(env, chatKvKey(sessionId, item.id), item);
  const ids = await getIndex(env, sessionId);
  if (!ids.includes(item.id)) {
    ids.unshift(item.id);
    await putIndex(env, sessionId, ids);
  }
  return item;
}

export async function deleteChatForSession(sessionId: string, id: string, env: Env): Promise<void> {
  const sb = await supabaseFetch(env, `chats?id=eq.${encodeURIComponent(id)}&session_id=eq.${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
  // Always clean KV as well
  await kvDelete(env, chatKvKey(sessionId, id));
  const ids = await getIndex(env, sessionId);
  const next = ids.filter((x) => x !== id);
  if (next.length !== ids.length) await putIndex(env, sessionId, next);

  // Also try urlId variant if id was urlId
  if (sb && !sb.ok) {
    // ignore
  }
}
