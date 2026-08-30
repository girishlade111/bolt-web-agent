import { useLoaderData, useNavigate } from '@remix-run/react';
import { useState, useEffect } from 'react';
import { atom } from 'nanostores';
import type { Message } from 'ai';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { getMessages, getNextId, getUrlId, openDatabase, setMessages } from './db';
import { webcontainer } from '~/lib/webcontainer';

export interface ChatHistoryItem {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  timestamp: string;
  /** file snapshot is server-side only; kept here for type parity with ServerChatItem */
  fileSnapshot?: Record<string, string> | null;
}

const persistenceEnabled = !import.meta.env.VITE_DISABLE_PERSISTENCE;

export const db = persistenceEnabled ? await openDatabase() : undefined;

export const chatId = atom<string | undefined>(undefined);
export const description = atom<string | undefined>(undefined);

function collectFileSnapshot(): Record<string, string> | null {
  try {
    const files = workbenchStore.files.get();
    const snapshot: Record<string, string> = {};
    let count = 0;
    for (const [path, dirent] of Object.entries(files)) {
      if (dirent?.type === 'file' && typeof dirent.content === 'string') {
        // Skip massive binary-ish or node_modules
        if (path.includes('node_modules') || path.includes('.git')) continue;
        // cap to avoid payload blow-up (~500 files or ~1MB)
        if (count > 500) break;
        if (dirent.content.length > 200_000) continue;
        snapshot[path] = dirent.content;
        count++;
      }
    }
    return Object.keys(snapshot).length > 0 ? snapshot : null;
  } catch {
    return null;
  }
}

async function restoreFileSnapshot(snapshot: Record<string, string> | null | undefined): Promise<void> {
  if (!snapshot || typeof snapshot !== 'object') return;
  try {
    const wc = await webcontainer;
    for (const [path, content] of Object.entries(snapshot)) {
      try {
        // ensure folder exists via writeFile which doesn't auto-mkdir for nested? Use wc.fs.mkdir then write
        const dir = path.substring(0, path.lastIndexOf('/'));
        if (dir && dir !== '.' && dir !== '/') {
          // best-effort mkdir
          try {
            await wc.fs.mkdir(dir, { recursive: true });
          } catch {}
        }
        await wc.fs.writeFile(path, content);
      } catch (e) {
        console.warn('[useChatHistory] failed to restore file', path, e);
      }
    }
  } catch (e) {
    console.warn('[useChatHistory] restore snapshot failed', e);
  }
}

async function fetchServerChat(lookupId: string): Promise<ChatHistoryItem | null> {
  try {
    const res = await fetch(`/api/chat-history?id=${encodeURIComponent(lookupId)}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (data?.chat) return data.chat as ChatHistoryItem;
    return null;
  } catch {
    return null;
  }
}

async function syncToServer(item: {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  fileSnapshot?: Record<string, string> | null;
}): Promise<void> {
  try {
    // Keep server in sync on each message — best-effort, no toast on failure (offline)
    await fetch('/api/chat-history', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
  } catch (e) {
    console.warn('[useChatHistory] server sync failed (offline?)', e);
  }
}

export function useChatHistory() {
  const navigate = useNavigate();
  const { id: mixedId } = useLoaderData<{ id?: string }>();

  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState<boolean>(false);
  const [urlId, setUrlId] = useState<string | undefined>();

  useEffect(() => {
    if (!mixedId) {
      setReady(true);
      return;
    }

    let cancelled = false;

    async function load() {
      // 1. Try server first (source of truth for cross-device)
      const serverChat = await fetchServerChat(mixedId!);

      if (cancelled) return;

      if (serverChat && serverChat.messages.length > 0) {
        setInitialMessages(serverChat.messages);
        setUrlId(serverChat.urlId);
        description.set(serverChat.description);
        chatId.set(serverChat.id);

        // Cache to IndexedDB for offline fallback
        if (db) {
          setMessages(db, serverChat.id, serverChat.messages, serverChat.urlId, serverChat.description).catch(() => {});
        }

        // Restore file snapshot to WebContainer so generated app survives device change
        if (serverChat.fileSnapshot) {
          // don't block ready on restore
          restoreFileSnapshot(serverChat.fileSnapshot).catch(() => {});
        }

        setReady(true);
        return;
      }

      // 2. Fallback to IndexedDB (offline or not yet synced)
      if (!db) {
        setReady(true);
        if (persistenceEnabled) {
          toast.error(`Chat persistence is unavailable`);
        }
        return;
      }

      try {
        const storedMessages = await getMessages(db, mixedId!);

        if (storedMessages && storedMessages.messages.length > 0) {
          setInitialMessages(storedMessages.messages);
          setUrlId(storedMessages.urlId);
          description.set(storedMessages.description);
          chatId.set(storedMessages.id);

          // Opportunistically sync IDB -> server for device migration
          syncToServer({
            id: storedMessages.id,
            urlId: storedMessages.urlId,
            description: storedMessages.description,
            messages: storedMessages.messages,
            fileSnapshot: collectFileSnapshot(),
          }).catch(() => {});

          setReady(true);
        } else {
          // Not found anywhere — redirect home. Check server list as last resort before 404?
          // If server has no chat, treat as invalid id.
          navigate(`/`, { replace: true });
          setReady(true);
        }
      } catch (error: any) {
        toast.error(error.message);
        setReady(true);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [mixedId]);

  return {
    ready: !mixedId || ready,
    initialMessages,
    storeMessageHistory: async (messages: Message[]) => {
      if (messages.length === 0) {
        return;
      }

      const { firstArtifact } = workbenchStore;

      let nextUrlId = urlId;
      if (!urlId && firstArtifact?.id) {
        // Prefer server-coordinated urlId if possible? Keep IDB logic for now, server will mirror
        const computed = db ? await getUrlId(db, firstArtifact.id) : firstArtifact.id;
        nextUrlId = computed;
        navigateChat(computed);
        setUrlId(computed);
      }

      if (!description.get() && firstArtifact?.title) {
        description.set(firstArtifact?.title);
      }

      let nextId = chatId.get();
      if (initialMessages.length === 0 && !nextId) {
        // For new chats, ask server for next? Keep IDB nextId for now, but server will upsert
        if (db) {
          nextId = await getNextId(db);
        } else {
          nextId = String(Date.now());
        }
        chatId.set(nextId);
        if (!nextUrlId) {
          navigateChat(nextId);
        }
      }

      const idToSave = chatId.get() as string;
      const descToSave = description.get();
      const fileSnapshot = collectFileSnapshot();

      // 1. Always update IndexedDB cache (fast, offline)
      if (db) {
        try {
          await setMessages(db, idToSave, messages, nextUrlId, descToSave);
        } catch (e) {
          console.warn('[useChatHistory] IDB set failed', e);
        }
      }

      // 2. Sync to server (source of truth for cross-device)
      await syncToServer({
        id: idToSave,
        urlId: nextUrlId,
        description: descToSave,
        messages,
        fileSnapshot,
      });
    },
  };
}

function navigateChat(nextId: string) {
  /**
   * FIXME: Using the intended navigate function causes a rerender for <Chat /> that breaks the app.
   *
   * `navigate(`/chat/${nextId}`, { replace: true });`
   */
  const url = new URL(window.location.href);
  url.pathname = `/chat/${nextId}`;

  window.history.replaceState({}, '', url);
}
