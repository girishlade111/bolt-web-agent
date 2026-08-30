import { useStore } from '@nanostores/react';
import { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { Dialog, DialogRoot, DialogTitle, DialogDescription, DialogButton } from '~/components/ui/Dialog';
import { getStoredToken, setStoredToken, clearStoredToken, collectFiles, pushToGitHub } from '~/lib/github.client';
import { downloadProjectZip } from '~/lib/zip-export.client';
import { getDeployToken, setDeployToken, deployToCloudflare, deployToVercel, deployToNetlify, pollDeploymentStatus, type DeployProvider } from '~/lib/deploy.client';

interface HeaderActionButtonsProps {}

export function HeaderActionButtons({}: HeaderActionButtonsProps) {
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const { showChat } = useStore(chatStore);

  const canHideChat = showWorkbench || !showChat;

  const [githubOpen, setGithubOpen] = useState(false);
  const [token, setToken] = useState('');
  const [repoName, setRepoName] = useState('');
  const [description, setDescription] = useState('Exported from LS Build');
  const [isPrivate, setIsPrivate] = useState(false);
  const [rememberToken, setRememberToken] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successUrl, setSuccessUrl] = useState<string | null>(null);
  const [zipLoading, setZipLoading] = useState(false);

  // Deploy states
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployProvider, setDeployProvider] = useState<DeployProvider>('cloudflare');
  const [deployToken, setDeployToken] = useState('');
  const [deployAccountId, setDeployAccountId] = useState('');
  const [deployProjectName, setDeployProjectName] = useState('');
  const [deployLoading, setDeployLoading] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);
  const [deployStatus, setDeployStatus] = useState<string | null>(null);

  useEffect(() => {
    const stored = getStoredToken();
    if (stored) setToken(stored);
    // suggest repo name from first artifact or timestamp
    const artifact = workbenchStore.firstArtifact;
    if (artifact?.title) {
      const slug = artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
      setRepoName(slug || `bolt-export-${Date.now()}`);
      setDeployProjectName(slug || `bolt-${Date.now().toString(36)}`);
    } else if (!repoName) {
      const fallback = `bolt-export-${Date.now().toString(36)}`;
      setRepoName(fallback);
      setDeployProjectName(fallback);
    }
  }, [githubOpen]);

  useEffect(() => {
    if (deployOpen) {
      // Suggest project name and try to restore session-scoped token
      const artifact = workbenchStore.firstArtifact;
      if (artifact?.title) {
        const slug = artifact.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63);
        setDeployProjectName((prev) => prev || slug || `bolt-${Date.now().toString(36)}`);
      }
      // Try to load stored token for current provider (session-scoped via bolt_session)
      getDeployToken(deployProvider).then((t) => {
        if (t) setDeployToken(t);
      });
    }
  }, [deployOpen, deployProvider]);

  const handleExport = async () => {
    setError(null);
    setSuccessUrl(null);
    const trimmedToken = token.trim();
    const trimmedRepo = repoName.trim();
    if (!trimmedToken) {
      setError('GitHub token required. Create a PAT with `repo` scope at github.com/settings/tokens/new');
      return;
    }
    if (!trimmedRepo) {
      setError('Repository name is required');
      return;
    }
    const files = collectFiles();
    if (Object.keys(files).length === 0) {
      setError('No files to push. Generate an app first.');
      return;
    }
    setLoading(true);
    try {
      if (rememberToken) setStoredToken(trimmedToken, true);
      else setStoredToken(trimmedToken, false);

      const result = await pushToGitHub({
        token: trimmedToken,
        repoName: trimmedRepo,
        description,
        private: isPrivate,
        files,
      });
      setSuccessUrl(result.repoUrl);
      toast.success(`Pushed ${result.filesPushed} files to ${result.repoUrl}`);
    } catch (e: any) {
      setError(e.message ?? 'Push failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadZip = async () => {
    if (zipLoading) return;
    setZipLoading(true);
    try {
      const filename = await downloadProjectZip();
      toast.success(`Downloaded ${filename}`);
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to create ZIP');
    } finally {
      setZipLoading(false);
    }
  };

  const handleDeploy = async () => {
    setDeployError(null);
    setDeployUrl(null);
    setDeployStatus(null);
    const projectName = deployProjectName.trim().replace(/[^a-z0-9-]/gi, '-').slice(0, 63) || `bolt-${Date.now().toString(36)}`;
    if (!projectName) {
      setDeployError('Project name is required');
      return;
    }
    const filesCheck = await import('~/lib/zip-export.client').then(m => m.collectWebContainerFiles()).catch(() => ({} as Record<string, string>));
    // Fallback to github collect if zip fails
    const hasFiles = Object.keys(filesCheck).length > 0;
    if (!hasFiles) {
      // Try alternative collection
      const altFiles = collectFiles();
      if (Object.keys(altFiles).length === 0) {
        setDeployError('No files to deploy. Generate an app first.');
        return;
      }
    }

    setDeployLoading(true);
    setDeployStatus('initializing');
    try {
      // Persist token session-scoped if provided
      if (deployToken.trim()) {
        await setDeployToken(deployProvider, deployToken.trim(), deployAccountId ? { accountId: deployAccountId.trim() } : undefined);
      }

      let result: any;
      if (deployProvider === 'cloudflare') {
        result = await deployToCloudflare({
          projectName,
          accountId: deployAccountId.trim() || undefined,
          token: deployToken.trim() || undefined,
        });
      } else if (deployProvider === 'vercel') {
        result = await deployToVercel({ projectName, token: deployToken.trim() || undefined });
      } else {
        result = await deployToNetlify({ projectName, token: deployToken.trim() || undefined });
      }

      // If deployment is initializing, poll for live URL
      let finalUrl = result.url || result.liveUrl;
      let deploymentId = result.deploymentId;
      let status = result.status;

      if (status === 'initializing' && deploymentId) {
        setDeployStatus('polling');
        try {
          const polled = await pollDeploymentStatus(deployProvider, deploymentId, projectName, { intervalMs: 2000, timeoutMs: 30000 });
          finalUrl = polled.url || finalUrl;
          status = polled.status;
        } catch (pollErr: any) {
          // Polling failed but deployment may still be initializing - show URL anyway
          console.warn('[deploy] polling failed', pollErr);
        }
      }

      setDeployUrl(finalUrl);
      setDeployStatus(status === 'initializing' ? 'ready' : status);
      toast.success(`Deployed to ${deployProvider}: ${finalUrl}`);
    } catch (e: any) {
      setDeployError(e.message ?? 'Deploy failed');
    } finally {
      setDeployLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
      <div className="flex border border-bolt-elements-borderColor rounded-md overflow-hidden shrink-0">
        <Button
          active={showChat}
          disabled={!canHideChat}
          onClick={() => {
            if (canHideChat) {
              chatStore.setKey('showChat', !showChat);
            }
          }}
        >
          <div className="i-bolt:chat text-sm" />
        </Button>
        <div className="w-[1px] bg-bolt-elements-borderColor" />
        <Button
          active={showWorkbench}
          onClick={() => {
            if (showWorkbench && !showChat) {
              chatStore.setKey('showChat', true);
            }

            workbenchStore.showWorkbench.set(!showWorkbench);
          }}
        >
          <div className="i-ph:code-bold" />
        </Button>
      </div>

      <button
        onClick={handleDownloadZip}
        disabled={zipLoading}
        className="inline-flex items-center gap-1 sm:gap-1.5 rounded-md border border-bolt-elements-borderColor bg-[#1c1c1c] hover:bg-[#242424] disabled:opacity-50 disabled:cursor-not-allowed px-2 sm:px-3 py-1.5 text-xs font-medium text-[#e8e8e8] transition-colors shrink-0"
        title="Download as ZIP: Export the entire in-memory WebContainer project as a .zip archive for local development (excludes node_modules, .git)"
      >
        <div className={zipLoading ? 'i-svg-spinners:90-ring-with-bg text-sm' : 'i-ph:download-simple text-sm'} />
        <span className="hidden sm:inline">{zipLoading ? 'Zipping…' : 'Download ZIP'}</span>
      </button>

      <button
        onClick={() => {
          setError(null);
          setSuccessUrl(null);
          setGithubOpen(true);
        }}
        className="inline-flex items-center gap-1 sm:gap-1.5 rounded-md border border-bolt-elements-borderColor bg-[#1c1c1c] hover:bg-[#242424] px-2 sm:px-3 py-1.5 text-xs font-medium text-[#e8e8e8] transition-colors shrink-0"
        title="Export current WebContainer files to a new GitHub repo"
      >
        <div className="i-ph:github-logo text-sm" />
        <span className="hidden sm:inline">Export to GitHub</span>
      </button>

      {/* Deploy Dropdown — Vercel / Netlify / Cloudflare Pages (Cloudflare uses Direct Upload, separate from builder's own wrangler.toml) */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="inline-flex items-center gap-1 sm:gap-1.5 rounded-md border border-bolt-elements-borderColor bg-[#1c1c1c] hover:bg-[#242424] px-2 sm:px-3 py-1.5 text-xs font-medium text-[#e8e8e8] transition-colors shrink-0">
            <div className="i-ph:rocket-launch text-sm" />
            <span className="hidden sm:inline">Deploy</span>
            <div className="i-ph:caret-down text-xs opacity-60 hidden sm:block" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className="min-w-[200px] bg-[#161616] border border-[#2a2a2a] rounded-md p-1.5 shadow-lg z-50"
            sideOffset={5}
            align="end"
          >
            <DropdownMenu.Item
              className="flex items-center gap-2 px-2.5 py-2 text-xs text-[#e8e8e8] hover:bg-[#242424] rounded-[4px] cursor-pointer outline-none"
              onSelect={() => {
                setDeployProvider('vercel');
                setDeployError(null);
                setDeployUrl(null);
                setDeployOpen(true);
              }}
            >
              <div className="i-simple-icons:vercel text-sm" />
              Deploy to Vercel
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="flex items-center gap-2 px-2.5 py-2 text-xs text-[#e8e8e8] hover:bg-[#242424] rounded-[4px] cursor-pointer outline-none"
              onSelect={() => {
                setDeployProvider('netlify');
                setDeployError(null);
                setDeployUrl(null);
                setDeployOpen(true);
              }}
            >
              <div className="i-simple-icons:netlify text-sm" />
              Deploy to Netlify
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="flex items-center gap-2 px-2.5 py-2 text-xs text-[#e8e8e8] hover:bg-[#242424] rounded-[4px] cursor-pointer outline-none"
              onSelect={() => {
                setDeployProvider('cloudflare');
                setDeployError(null);
                setDeployUrl(null);
                setDeployOpen(true);
              }}
            >
              <div className="i-simple-icons:cloudflare text-sm" />
              Deploy to Cloudflare Pages
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <DialogRoot open={githubOpen}>
        <Dialog onBackdrop={() => setGithubOpen(false)} onClose={() => setGithubOpen(false)} className="max-w-[520px]">
          <DialogTitle>Export to GitHub</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-4">
              {!successUrl ? (
                <>
                  <p className="text-[13px] leading-relaxed">
                    Create a new GitHub repository and push the current WebContainer file tree as the initial commit. Your PAT is stored in <code className="px-1 py-0.5 rounded bg-[#242424] border border-[#2a2a2a]">localStorage</code> for this browser only.
                  </p>

                  <div className="space-y-3">
                    <label className="block">
                      <span className="text-xs font-medium text-[#e8e8e8]">GitHub Personal Access Token (PAT)</span>
                      <input
                        type="password"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="ghp_..."
                        className="mt-1 w-full rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-sm text-[#e8e8e8] placeholder:text-[#5c5c5c] focus:outline-none focus:border-[#6b6bff]"
                      />
                      <span className="mt-1 flex items-center justify-between text-[11px] text-[#8a8a8a]">
                        <a href="https://github.com/settings/tokens/new?scopes=repo&description=LS%20Build" target="_blank" rel="noreferrer" className="underline hover:text-[#e8e8e8]">
                          Create token (scope: repo)
                        </a>
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input type="checkbox" checked={rememberToken} onChange={(e) => setRememberToken(e.target.checked)} className="rounded" />
                          Remember
                        </label>
                      </span>
                      {getStoredToken() && (
                        <button onClick={() => { clearStoredToken(); setToken(''); }} className="mt-1 text-[11px] text-[#e5484d] hover:underline">
                          Clear stored token
                        </button>
                      )}
                      <p className="mt-1 text-[11px] text-[#5c5c5c]">Alternative: OAuth device flow — set <code className="px-1 rounded bg-[#242424]">VITE_GITHUB_CLIENT_ID</code> and extend <code className="px-1 rounded bg-[#242424]">/api/github/device</code> (PAT is sufficient for now, no full auth system).</p>
                    </label>

                    <label className="block">
                      <span className="text-xs font-medium text-[#e8e8e8]">Repository name</span>
                      <input
                        value={repoName}
                        onChange={(e) => setRepoName(e.target.value)}
                        placeholder="my-bolt-app"
                        className="mt-1 w-full rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-sm text-[#e8e8e8] placeholder:text-[#5c5c5c] focus:outline-none focus:border-[#6b6bff]"
                      />
                    </label>

                    <label className="block">
                      <span className="text-xs font-medium text-[#e8e8e8]">Description (optional)</span>
                      <input
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Exported from LS Build"
                        className="mt-1 w-full rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-sm text-[#e8e8e8] focus:outline-none focus:border-[#6b6bff]"
                      />
                    </label>

                    <label className="flex items-center gap-2 text-xs text-[#e8e8e8] cursor-pointer">
                      <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} className="rounded" />
                      Private repository
                    </label>

                    {error && <div className="rounded-md border border-[#e5484d]/30 bg-[#e5484d]/10 px-3 py-2 text-xs text-[#ff9a9e]">{error}</div>}
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <DialogButton type="secondary" onClick={() => setGithubOpen(false)}>
                      Cancel
                    </DialogButton>
                    <button
                      onClick={handleExport}
                      disabled={loading}
                      className="inline-flex h-[30px] items-center justify-center rounded-[6px] bg-[#6b6bff] hover:bg-[#5a5aff] disabled:opacity-50 disabled:cursor-not-allowed px-4 text-[13px] font-medium text-white transition-colors"
                    >
                      {loading ? 'Pushing…' : 'Create & Push'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-md border border-[#2a7a2a]/30 bg-[#2a7a2a]/10 px-3 py-3">
                    <p className="text-sm text-[#7fc87f]">✓ Pushed to GitHub</p>
                    <a href={successUrl} target="_blank" rel="noreferrer" className="text-sm underline text-[#8a8a8a] hover:text-[#e8e8e8] break-all">
                      {successUrl}
                    </a>
                  </div>
                  <div className="flex justify-end gap-2">
                    <DialogButton type="secondary" onClick={() => setGithubOpen(false)}>
                      Close
                    </DialogButton>
                    <a
                      href={successUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-[30px] items-center justify-center rounded-[6px] bg-[#1c1c1c] border border-[#2a2a2a] px-3.5 text-[13px] font-medium text-[#e8e8e8] hover:bg-[#242424]"
                    >
                      Open repo
                    </a>
                  </div>
                </div>
              )}
            </div>
          </DialogDescription>
        </Dialog>
      </DialogRoot>

      {/* Deploy Dialog — Cloudflare Pages Direct Upload (user project, not builder's wrangler.toml) */}
      <DialogRoot open={deployOpen}>
        <Dialog onBackdrop={() => setDeployOpen(false)} onClose={() => setDeployOpen(false)} className="max-w-[520px]">
          <DialogTitle>
            Deploy to {deployProvider === 'cloudflare' ? 'Cloudflare Pages' : deployProvider === 'vercel' ? 'Vercel' : 'Netlify'}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-4">
              {!deployUrl ? (
                <>
                  <p className="text-[13px] leading-relaxed">
                    {deployProvider === 'cloudflare'
                      ? 'Deploy your generated project via Cloudflare Pages Direct Upload API — separate from this builder\'s own wrangler.toml/KV config.'
                      : `Deploy your generated project to ${deployProvider} via its API.`}{' '}
                    Token is session-scoped via <code className="px-1 py-0.5 rounded bg-[#242424] border border-[#2a2a2a]">bolt_session</code> (KV) — reuses file-collection from <code className="px-1 py-0.5 rounded bg-[#242424] border border-[#2a2a2a]">zip-export.client.ts</code>.
                  </p>

                  <div className="space-y-3">
                    <label className="block">
                      <span className="text-xs font-medium text-[#e8e8e8]">
                        {deployProvider === 'cloudflare' ? 'Cloudflare API Token' : deployProvider === 'vercel' ? 'Vercel Token' : 'Netlify Token'}
                      </span>
                      <input
                        type="password"
                        value={deployToken}
                        onChange={(e) => setDeployToken(e.target.value)}
                        placeholder={
                          deployProvider === 'cloudflare' ? 'cf_... (Account.Pages edit)' : deployProvider === 'vercel' ? 'vercel_...' : 'nfp_...'
                        }
                        className="mt-1 w-full rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-sm text-[#e8e8e8] placeholder:text-[#5c5c5c] focus:outline-none focus:border-[#6b6bff]"
                      />
                      <span className="mt-1 text-[11px] text-[#8a8a8a]">
                        {deployProvider === 'cloudflare' && (
                          <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer" className="underline hover:text-[#e8e8e8]">
                            Create at dash.cloudflare.com/profile/api-tokens (Account → Pages Edit)
                          </a>
                        )}
                        {deployProvider === 'vercel' && (
                          <a href="https://vercel.com/account/tokens" target="_blank" rel="noreferrer" className="underline hover:text-[#e8e8e8]">
                            Create at vercel.com/account/tokens
                          </a>
                        )}
                        {deployProvider === 'netlify' && (
                          <a href="https://app.netlify.com/user/applications#personal-access-tokens" target="_blank" rel="noreferrer" className="underline hover:text-[#e8e8e8]">
                            Create at app.netlify.com/applications
                          </a>
                        )}
                      </span>
                    </label>

                    {deployProvider === 'cloudflare' && (
                      <label className="block">
                        <span className="text-xs font-medium text-[#e8e8e8]">Account ID (optional — auto-detected if blank)</span>
                        <input
                          value={deployAccountId}
                          onChange={(e) => setDeployAccountId(e.target.value)}
                          placeholder="cf-account-id (hex) — leave blank to auto-detect"
                          className="mt-1 w-full rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-sm text-[#e8e8e8] placeholder:text-[#5c5c5c] focus:outline-none focus:border-[#6b6bff]"
                        />
                      </label>
                    )}

                    <label className="block">
                      <span className="text-xs font-medium text-[#e8e8e8]">Project name</span>
                      <input
                        value={deployProjectName}
                        onChange={(e) => setDeployProjectName(e.target.value)}
                        placeholder="my-bolt-app"
                        className="mt-1 w-full rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-2 text-sm text-[#e8e8e8] placeholder:text-[#5c5c5c] focus:outline-none focus:border-[#6b6bff]"
                      />
                    </label>

                    {deployError && <div className="rounded-md border border-[#e5484d]/30 bg-[#e5484d]/10 px-3 py-2 text-xs text-[#ff9a9e]">{deployError}</div>}
                    {deployStatus && !deployError && <div className="rounded-md border border-[#2a2a2a] bg-[#1c1c1c] px-3 py-2 text-xs text-[#8a8a8a]">Status: {deployStatus} — polling for live URL…</div>}
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <DialogButton type="secondary" onClick={() => setDeployOpen(false)}>
                      Cancel
                    </DialogButton>
                    <button
                      onClick={handleDeploy}
                      disabled={deployLoading}
                      className="inline-flex h-[30px] items-center justify-center rounded-[6px] bg-[#6b6bff] hover:bg-[#5a5aff] disabled:opacity-50 disabled:cursor-not-allowed px-4 text-[13px] font-medium text-white transition-colors"
                    >
                      {deployLoading ? 'Deploying…' : `Deploy to ${deployProvider === 'cloudflare' ? 'Cloudflare' : deployProvider === 'vercel' ? 'Vercel' : 'Netlify'}`}
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-md border border-[#2a7a2a]/30 bg-[#2a7a2a]/10 px-3 py-3">
                    <p className="text-sm text-[#7fc87f]">✓ Deployed to {deployProvider}</p>
                    <a href={deployUrl} target="_blank" rel="noreferrer" className="text-sm underline text-[#8a8a8a] hover:text-[#e8e8e8] break-all">
                      {deployUrl}
                    </a>
                    <p className="text-[11px] text-[#5c5c5c] mt-1">Live URL — polling complete. Files via Direct Upload (Pages) — not builder wrangler.toml.</p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <DialogButton type="secondary" onClick={() => setDeployOpen(false)}>
                      Close
                    </DialogButton>
                    <a
                      href={deployUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-[30px] items-center justify-center rounded-[6px] bg-[#1c1c1c] border border-[#2a2a2a] px-3.5 text-[13px] font-medium text-[#e8e8e8] hover:bg-[#242424]"
                    >
                      Open live URL
                    </a>
                  </div>
                </div>
              )}
            </div>
          </DialogDescription>
        </Dialog>
      </DialogRoot>
    </div>
  );
}

interface ButtonProps {
  active?: boolean;
  disabled?: boolean;
  children?: any;
  onClick?: VoidFunction;
}

function Button({ active = false, disabled = false, children, onClick }: ButtonProps) {
  return (
    <button
      className={classNames('flex items-center p-1.5', {
        'bg-bolt-elements-item-backgroundDefault hover:bg-bolt-elements-item-backgroundActive text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary':
          !active,
        'bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent': active && !disabled,
        'bg-bolt-elements-item-backgroundDefault text-alpha-gray-20 dark:text-alpha-white-20 cursor-not-allowed':
          disabled,
      })}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
