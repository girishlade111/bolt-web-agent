import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { getEffectiveSessionId } from '~/lib/.server/rate-limiter';

type GithubPushBody = {
  token?: string; // optional — falls back to session-connected GitHub token (device flow)
  repoName: string;
  description?: string;
  private?: boolean;
  existingRepo?: boolean; // push to an existing repo instead of creating a new one
  owner?: string; // repo owner when existingRepo is true
  files: Record<string, string>;
};

function getKv(env: Env): KVNamespace | undefined {
  const anyEnv = env as any;
  return anyEnv.DEPLOY_TOKENS_KV ?? anyEnv.DEPLOY_KV ?? anyEnv.SUPABASE_KV ?? anyEnv.RATE_LIMIT_KV;
}

async function getSessionToken(request: Request, env: Env): Promise<string | null> {
  const sessionId = getEffectiveSessionId(request);

  if (!sessionId) {
    return null;
  }

  const kv = getKv(env);

  if (!kv) {
    return null;
  }

  try {
    const raw = await kv.get(`github:token:${sessionId}`, 'text');

    if (!raw) {
      return null;
    }

    return (JSON.parse(raw) as any)?.token ?? null;
  } catch {
    return null;
  }
}

function sanitizeRepoName(name: string): string {
  // repo name rules: 1-100 chars, alphanumeric, ., -, _
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || `bolt-export-${Date.now()}`
  );
}

function toBase64(content: string): string {
  // cloudflare workers with nodejs_compat expose Buffer; fall back to btoa
  try {
    // @ts-ignore Buffer may not be typed in the workers runtime
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(content, 'utf-8').toString('base64');
    }
  } catch {}
  return btoa(unescape(encodeURIComponent(content)));
}

async function githubFetch(url: string, token: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };
  return fetch(url, { ...init, headers });
}

export async function action({ request, context }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body: GithubPushBody;

  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // prefer an explicitly supplied token, otherwise use the session-connected (device flow) token
  const token = body.token?.trim() || (await getSessionToken(request, context.cloudflare.env as Env));
  const repoNameRaw = body.repoName?.trim();
  const files = body.files;

  if (!token) {
    return json(
      { error: 'No GitHub account connected. Click "Connect GitHub Account" first (requires GITHUB_CLIENT_ID).' },
      { status: 401 },
    );
  }

  if (!repoNameRaw) {
    return json({ error: 'Missing repoName' }, { status: 400 });
  }

  if (!files || typeof files !== 'object' || Object.keys(files).length === 0) {
    return json({ error: 'No files to push. WebContainer file tree is empty.' }, { status: 400 });
  }

  // existing-repo push: repoName may be "owner/repo" or owner supplied separately
  const isExistingRepo = Boolean(body.existingRepo);
  let ownerFromName: string | undefined;
  let repoNameForExisting = repoNameRaw ?? '';

  if (isExistingRepo && repoNameForExisting.includes('/')) {
    const [o, ...rest] = repoNameForExisting.split('/');
    ownerFromName = o.trim();
    repoNameForExisting = rest.join('/');
  }

  const repoName = isExistingRepo ? repoNameForExisting : sanitizeRepoName(repoNameRaw);
  const description = body.description?.slice(0, 350) ?? 'Exported from LS Build — AI Application Builder';
  const isPrivate = Boolean(body.private);

  // validate token and get user — invalid token beyond first attempt blocks core flow → throw to ErrorBoundary
  const userRes = await githubFetch('https://api.github.com/user', token);

  if (!userRes.ok) {
    const errText = await userRes.text().catch(() => '');
    throw json({ error: `GitHub token invalid: ${userRes.status} ${errText.slice(0, 300)}` }, { status: 401 });
  }

  const user: any = await userRes.json();
  const owner: string = isExistingRepo ? (body.owner?.trim() || ownerFromName || user.login) : user.login;

  // create repo (skipped entirely when pushing to an existing repo)
  let repo: any = null;
  let repoHtmlUrl = '';

  if (isExistingRepo) {
    // verify the existing repo exists and is accessible with this token
    const existingRes = await githubFetch(`https://api.github.com/repos/${owner}/${repoName}`, token);

    if (!existingRes.ok) {
      throw json(
        { error: `Existing repo "${owner}/${repoName}" not found or not accessible with the connected token.` },
        { status: 404 },
      );
    }

    repo = await existingRes.json();
    repoHtmlUrl = repo.html_url;
  } else {
    const createRes = await githubFetch('https://api.github.com/user/repos', token, {
      method: 'POST',
      body: JSON.stringify({
        name: repoName,
        description,
        private: isPrivate,
        auto_init: false,
      }),
    });

    if (createRes.ok) {
      repo = await createRes.json();
      repoHtmlUrl = repo.html_url;
    } else if (createRes.status === 422) {
      const errBody = await createRes.text().catch(() => '');

      // repo already exists — try to use the existing repo (push will update)
      if (errBody.includes('already exists') || errBody.includes('name already exists')) {
        // fetch existing repo to get html_url
        const existingRes = await githubFetch(`https://api.github.com/repos/${owner}/${repoName}`, token);

        if (existingRes.ok) {
          repo = await existingRes.json();
          repoHtmlUrl = repo.html_url;
        } else {
          throw json(
            { error: `Repo "${repoName}" already exists and could not be fetched. Try a different name.` },
            { status: 409 },
          );
        }
      } else {
        throw json({ error: `Failed to create repo: ${createRes.status} ${errBody.slice(0, 500)}` }, { status: 400 });
      }
    } else {
      const errBody = await createRes.text().catch(() => '');
      throw json({ error: `Failed to create repo: ${createRes.status} ${errBody.slice(0, 500)}` }, { status: 400 });
    }
  }

  // filter files: skip node_modules, .git, and huge files
  const filteredEntries = Object.entries(files).filter(([path]) => {
    const p = path.replace(/^\//, '');

    if (p.startsWith('node_modules/') || p.includes('/node_modules/')) {
      return false;
    }

    if (p.startsWith('.git/') || p === '.git') {
      return false;
    }

    if (p.includes('.wrangler/')) {
      return false;
    }

    return true;
  });

  // after filtering there must still be files to push
  if (filteredEntries.length === 0) {
    return json({ error: 'No exportable files after filtering.' }, { status: 400 });
  }

  // use the git data api single-commit flow (scalable for large repos)
  try {
    // 1. create blobs
    const blobResults = await Promise.all(
      filteredEntries.map(async ([path, content]) => {
        const b64 = toBase64(content);
        const blobRes = await githubFetch(`https://api.github.com/repos/${owner}/${repoName}/git/blobs`, token, {
          method: 'POST',
          body: JSON.stringify({ content: b64, encoding: 'base64' }),
        });

        if (!blobRes.ok) {
          const t = await blobRes.text().catch(() => '');
          throw new Error(`Blob failed for ${path}: ${blobRes.status} ${t.slice(0, 200)}`);
        }

        const blob = (await blobRes.json()) as any;

        return { path: path.replace(/^\//, '').replace(/^home\/project\//, ''), sha: blob.sha };
      }),
    );

    // normalize paths: strip leading work dir
    const treeItems = blobResults.map(({ path, sha }) => ({
      path,
      mode: '100644' as const,
      type: 'blob' as const,
      sha,
    }));

    // 2. Create tree
    const treeRes = await githubFetch(`https://api.github.com/repos/${owner}/${repoName}/git/trees`, token, {
      method: 'POST',
      body: JSON.stringify({ tree: treeItems }),
    });

    if (!treeRes.ok) {
      const t = await treeRes.text().catch(() => '');
      throw new Error(`Create tree failed: ${treeRes.status} ${t.slice(0, 500)}`);
    }

    const tree = (await treeRes.json()) as any;

    // 3. Get current commit sha if repo had prior commits (for existing repo case)
    let parents: string[] = [];
    const refRes = await githubFetch(`https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/main`, token);

    if (refRes.ok) {
      const refData = (await refRes.json()) as any;

      if (refData.object?.sha) {
        parents = [refData.object.sha];
      }
    } else {
      // try master
      const masterRes = await githubFetch(
        `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/master`,
        token,
      );

      if (masterRes.ok) {
        const refData = (await masterRes.json()) as any;

        if (refData.object?.sha) {
          parents = [refData.object.sha];
        }
      }
    }

    // 4. Create commit
    const commitRes = await githubFetch(`https://api.github.com/repos/${owner}/${repoName}/git/commits`, token, {
      method: 'POST',
      body: JSON.stringify({
        message: isExistingRepo
          ? `Update from LS Build — pushed to existing repo ${owner}/${repoName}`
          : 'Initial commit from LS Build (WebContainer export)',
        tree: tree.sha,
        parents,
      }),
    });

    if (!commitRes.ok) {
      const t = await commitRes.text().catch(() => '');
      throw new Error(`Create commit failed: ${commitRes.status} ${t.slice(0, 500)}`);
    }

    const commit = (await commitRes.json()) as any;

    // 5. Update ref (create or patch)
    const branch = 'main';

    // try patch first if a parent existed, else post
    let refUpdateRes: Response;

    if (parents.length > 0) {
      refUpdateRes = await githubFetch(
        `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/${branch}`,
        token,
        {
          method: 'PATCH',
          body: JSON.stringify({ sha: commit.sha, force: true }),
        },
      );

      if (!refUpdateRes.ok && refUpdateRes.status === 404) {
        // fallback to POST
        refUpdateRes = await githubFetch(`https://api.github.com/repos/${owner}/${repoName}/git/refs`, token, {
          method: 'POST',
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
        });
      }
    } else {
      refUpdateRes = await githubFetch(`https://api.github.com/repos/${owner}/${repoName}/git/refs`, token, {
        method: 'POST',
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
      });
    }

    if (!refUpdateRes.ok) {
      const t = await refUpdateRes.text().catch(() => '');
      throw new Error(`Update ref failed: ${refUpdateRes.status} ${t.slice(0, 500)}`);
    }

    /**
     * Ensure the default branch is main (empty repos may not have one yet);
     * patching default_branch is optional and not required here.
     */

    return json({
      ok: true,
      repoUrl: repoHtmlUrl,
      repoName,
      owner,
      branch,
      filesPushed: treeItems.length,
      commitSha: commit.sha,
    });
  } catch (e: any) {
    console.error('[github.push] failed', e);

    // real user impact: pushing the file tree as the initial commit failed (network, quota, github outage) — block core flow
    throw json({ error: e.message?.slice(0, 800) ?? 'Push failed' }, { status: 500 });
  }
}
