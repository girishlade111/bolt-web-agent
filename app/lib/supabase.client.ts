import { fetchWithSession } from '~/lib/session.client';

/**
 * Supabase connector — client helpers.
 *
 * Same bolt_session pattern as github.client / deploy.client: session-scoped
 * server-side token storage via /api/supabase/oauth (Management API OAuth).
 * The access token never reaches the client.
 */

export type SupabaseLinkedProject = { ref: string; name: string };

export interface SupabaseTable {
  name: string;
  columns: Array<{ name: string; type: string; nullable: boolean; default: string | null }>;
}

export async function getSupabaseConnection(): Promise<{ connected: boolean; email: string | null }> {
  const res = await fetchWithSession('/api/supabase/oauth');
  const data: any = await res.json().catch(() => ({}));

  return { connected: !!data.connected, email: data.email ?? null };
}

/** Opens the Management API OAuth consent screen in a popup and waits for the result. */
export function connectSupabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const width = 600;
    const height = 720;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    const popup = window.open(
      '/api/supabase/oauth?connect=1',
      'supabase-oauth',
      `width=${width},height=${height},left=${left},top=${top}`,
    );

    if (!popup) {
      reject(new Error('Popup blocked — please allow popups for this site and try again'));
      return;
    }

    const onMessage = (event: MessageEvent) => {
      if (event.data === 'supabase-oauth:success') {
        cleanup();
        resolve();
      } else if (event.data === 'supabase-oauth:error') {
        cleanup();
        reject(new Error('Supabase connection failed or was cancelled'));
      }
    };

    const timer = window.setInterval(() => {
      // popup closed without posting a result (user dismissed it)
      if (popup?.closed) {
        cleanup();
        resolve();
      }
    }, 1000);

    const cleanup = () => {
      window.clearInterval(timer);
      window.removeEventListener('message', onMessage);
    };

    window.addEventListener('message', onMessage);
  });
}

export async function disconnectSupabase(): Promise<void> {
  const res = await fetchWithSession('/api/supabase/oauth', { method: 'DELETE' });

  if (!res.ok) {
    throw new Error('Failed to disconnect Supabase');
  }
}

export async function getLinkedSupabaseProject(): Promise<SupabaseLinkedProject | null> {
  const res = await fetchWithSession('/api/supabase/project');
  const data: any = await res.json().catch(() => ({}));

  return data.linked ?? null;
}

export async function linkSupabaseProject(projectId: string): Promise<SupabaseLinkedProject> {
  const res = await fetchWithSession('/api/supabase/project', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  });
  const data: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error ?? 'Failed to link project');
  }

  return data.linked;
}

export async function unlinkSupabaseProject(): Promise<void> {
  const res = await fetchWithSession('/api/supabase/project', { method: 'DELETE' });

  if (!res.ok) {
    throw new Error('Failed to unlink project');
  }
}

export async function getSupabaseSchema(): Promise<SupabaseTable[]> {
  const res = await fetchWithSession('/api/supabase/project?schema=1');
  const data: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error ?? 'Failed to load schema');
  }

  return Array.isArray(data.tables) ? data.tables : [];
}

export type SupabaseSchemaOp =
  | { op: 'add-column'; table: string; name: string; type: string; nullable?: boolean; default?: string }
  | { op: 'drop-column'; table: string; column: string }
  | { op: 'rename-column'; table: string; column: string; newName: string }
  | { op: 'set-type'; table: string; column: string; type: string }
  | { op: 'drop-table'; table: string };

export async function applySupabaseSchemaOp(payload: SupabaseSchemaOp): Promise<void> {
  const res = await fetchWithSession('/api/supabase/project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data: any = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error ?? 'Schema edit failed');
  }
}
