import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getSessionId, getEffectiveSessionId, createSessionCookie } from '~/lib/.server/rate-limiter';
import { getKv, getSupabaseToken, runSupabaseQuery, supabaseHeaders, supabaseProjectKey } from '~/lib/.server/supabase';

/**
 * Supabase linked-project + basic schema management (session-scoped).
 *
 * GET    /api/supabase/project                  → { linked: { ref, name } | null }
 * GET    /api/supabase/project?schema=1         → introspect linked project's tables/columns
 * PUT    /api/supabase/project { projectId }    → link an existing project to this session
 * DELETE /api/supabase/project                  → unlink (does NOT delete the project)
 * POST   /api/supabase/project { op, ... }      → whitelisted schema edit (add-column, drop-column,
 *                                                 rename-column, set-type, drop-table); SQL built
 *                                                 server-side from validated identifiers; destructive
 *                                                 ops audit-logged under `audit:supabase-schema:*`.
 */

type LinkedProject = { ref: string; name: string };

function getLinked(env: Env, sessionId: string): Promise<LinkedProject | null> {
  const kv = getKv(env);

  if (!kv) {
    return Promise.resolve(null);
  }

  return kv
    .get(supabaseProjectKey(sessionId), 'text')
    .then((raw) => (raw ? (JSON.parse(raw) as LinkedProject) : null))
    .catch(() => null);
}

function sessionHeaders(sessionId: string, request: Request): Record<string, string> {
  const headers: Record<string, string> = { 'X-Session-Id': sessionId };
  const cookieSid = getSessionId(request);

  if (cookieSid !== sessionId) {
    headers['Set-Cookie'] = createSessionCookie(sessionId, request);
  }

  return headers;
}

// identifiers must be plain SQL identifiers; they are double-quoted when embedded
function safeIdent(name: string): string | null {
  return /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name) ? name : null;
}

// basic type whitelist for column DDL
function safeType(type: string): string | null {
  const t = type.trim();
  return /^[a-zA-Z][a-zA-Z0-9_ ]{0,30}(\(\d+(,\s?\d+)?\))?$/.test(t) ? t.toLowerCase() : null;
}

// literal defaults must be simple strings/numbers/booleans, NOW(), or NULL
function safeDefault(value: string): string {
  const v = value.trim();

  if (v === '' || v.toUpperCase() === 'NULL') {
    return 'NULL';
  }

  if (/^-?\d+(\.\d+)?$/.test(v)) {
    return v;
  }

  if (v.toUpperCase() === 'TRUE' || v.toUpperCase() === 'FALSE') {
    return v.toUpperCase();
  }

  if (v.toUpperCase() === 'NOW()') {
    return 'NOW()';
  }

  // quoted string literal — escape internal quotes
  return `'${v.replace(/'/g, "''")}'`;
}


// __RESOLVE__

async function introspectSchema(token: string, ref: string) {
  const tables = (await runSupabaseQuery(
    token,
    ref,
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
  )) as Array<{ table_name: string }>;

  const columns = (await runSupabaseQuery(
    token,
    ref,
    `SELECT table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position`,
  )) as Array<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>;

  return tables.map((t) => ({
    name: t.table_name,
    columns: columns
      .filter((c) => c.table_name === t.table_name)
      .map((c) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
        default: c.column_default,
      })),
  }));
}


export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.cloudflare.env as Env;
  const sessionId = getEffectiveSessionId(request);

  if (!sessionId) {
    return json({ linked: null });
  }

  const headers = sessionHeaders(sessionId, request);
  const url = new URL(request.url);
  const linked = await getLinked(env, sessionId);

  if (url.searchParams.get('schema') !== '1') {
    return json({ linked }, { headers });
  }

  const token = await getSupabaseToken(env, sessionId);

  if (!token) {
    return json({ error: 'Supabase not connected' }, { status: 401, headers });
  }

  const ref = url.searchParams.get('projectId') ?? linked?.ref;

  if (!ref) {
    return json({ error: 'No project linked to this session' }, { status: 400, headers });
  }

  try {
    const tables = await introspectSchema(token, ref);
    return json({ linked, tables }, { headers });
  } catch (e: any) {
    return json({ error: e?.message ?? 'Schema introspection failed' }, { status: 502, headers });
  }
}

export async function action({ request, context }: ActionFunctionArgs) {
  const env = context.cloudflare.env as Env;
  const sessionId = getEffectiveSessionId(request);

  if (!sessionId) {
    return json({ error: 'Missing session' }, { status: 401 });
  }

  const headers = sessionHeaders(sessionId, request);
  const method = request.method.toUpperCase();
  const kv = getKv(env);

  let body: any = {};

  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  // PUT — link an existing project to this session
  if (method === 'PUT') {
    const projectId = String(body.projectId ?? '').trim();

    if (!projectId || !/^[a-z0-9]{10,40}$/i.test(projectId)) {
      return json({ error: 'Invalid projectId (expected a Supabase project ref)' }, { status: 400, headers });
    }

    const token = await getSupabaseToken(env, sessionId);

    if (!token) {
      return json({ error: 'Supabase not connected' }, { status: 401, headers });
    }

    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectId)}`, {
        headers: supabaseHeaders(token),
      });
      const data: any = await res.json().catch(() => ({}));

      if (!res.ok) {
        return json({ error: data?.message ?? `Project lookup failed: ${res.status}` }, { status: 502, headers });
      }

      const linked: LinkedProject = { ref: String(data.ref ?? projectId), name: String(data.name ?? projectId) };
      await kv?.put(supabaseProjectKey(sessionId), JSON.stringify(linked), { expirationTtl: 60 * 60 * 24 * 30 });

      return json({ ok: true, linked }, { headers });
    } catch (e: any) {
      return json({ error: e?.message ?? 'Failed to link project' }, { status: 502, headers });
    }
  }

  // DELETE — unlink only (project deletes go through /api/connectors/resources)
  if (method === 'DELETE') {
    await kv?.delete(supabaseProjectKey(sessionId)).catch(() => undefined);
    return json({ ok: true, linked: null }, { headers });
  }

  // POST — whitelisted schema edit ops
  if (method === 'POST') {
    const token = await getSupabaseToken(env, sessionId);

    if (!token) {
      return json({ error: 'Supabase not connected' }, { status: 401, headers });
    }

    const linked = await getLinked(env, sessionId);
    const ref = String(body.projectId ?? '') || linked?.ref;

    if (!ref) {
      return json({ error: 'No project linked to this session' }, { status: 400, headers });
    }

    const q = (name: string) => `"${name}"`; // identifiers pre-validated by safeIdent
    let sql = '';
    let auditOp = '';
    const op = String(body.op ?? '');

    if (op === 'add-column') {
      const table = safeIdent(String(body.table ?? ''));
      const name = safeIdent(String(body.name ?? ''));
      const type = safeType(String(body.type ?? 'text'));

      if (!table || !name || !type) {
        return json({ error: 'Invalid table, column name, or type' }, { status: 400, headers });
      }

      const nullable = body.nullable !== false;
      const def = safeDefault(String(body.default ?? 'NULL'));
      sql = `ALTER TABLE ${q(table)} ADD COLUMN ${q(name)} ${type}${nullable ? '' : ' NOT NULL'}${
        def !== 'NULL' ? ` DEFAULT ${def}` : ''
      }`;
      auditOp = 'add-column';
    } else if (op === 'drop-column') {
      const table = safeIdent(String(body.table ?? ''));
      const column = safeIdent(String(body.column ?? ''));

      if (!table || !column) {
        return json({ error: 'Invalid table or column' }, { status: 400, headers });
      }

      sql = `ALTER TABLE ${q(table)} DROP COLUMN ${q(column)}`;
      auditOp = 'drop-column';
    } else if (op === 'rename-column') {
      const table = safeIdent(String(body.table ?? ''));
      const column = safeIdent(String(body.column ?? ''));
      const newName = safeIdent(String(body.newName ?? ''));

      if (!table || !column || !newName) {
        return json({ error: 'Invalid table or column names' }, { status: 400, headers });
      }

      sql = `ALTER TABLE ${q(table)} RENAME COLUMN ${q(column)} TO ${q(newName)}`;
      auditOp = 'rename-column';
    } else if (op === 'set-type') {
      const table = safeIdent(String(body.table ?? ''));
      const column = safeIdent(String(body.column ?? ''));
      const type = safeType(String(body.type ?? ''));

      if (!table || !column || !type) {
        return json({ error: 'Invalid table, column, or type' }, { status: 400, headers });
      }

      sql = `ALTER TABLE ${q(table)} ALTER COLUMN ${q(column)} TYPE ${type}`;
      auditOp = 'set-type';
    } else if (op === 'drop-table') {
      const table = safeIdent(String(body.table ?? ''));

      if (!table) {
        return json({ error: 'Invalid table' }, { status: 400, headers });
      }

      sql = `DROP TABLE ${q(table)}`;
      auditOp = 'drop-table';
    } else {
      return json({ error: `Unknown op: ${op}` }, { status: 400, headers });
    }

    try {
      await runSupabaseQuery(token, ref, sql);

      // audit log for destructive schema edits (accountability without user auth)
      if (auditOp === 'drop-column' || auditOp === 'drop-table') {
        try {
          await kv?.put(
            `audit:supabase-schema:${Date.now()}:${sessionId.slice(0, 12)}`,
            JSON.stringify({
              action: 'schema-edit',
              op: auditOp,
              projectRef: ref,
              sql,
              sessionId,
              timestamp: new Date().toISOString(),
            }),
            { expirationTtl: 60 * 60 * 24 * 30 },
          );
        } catch {}
      }

      return json({ ok: true, op: auditOp, sql }, { headers });
    } catch (e: any) {
      return json({ error: e?.message ?? 'Schema edit failed' }, { status: 502, headers });
    }
  }

  return json({ error: 'Method not allowed' }, { status: 405, headers });
}

