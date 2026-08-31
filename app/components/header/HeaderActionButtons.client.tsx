import { useStore } from '@nanostores/react';
import { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { Dialog, DialogRoot, DialogTitle, DialogDescription, DialogButton } from '~/components/ui/Dialog';
import { getGitHubConnection, collectFiles, pushToGitHub } from '~/lib/github.client';
import { downloadProjectZip } from '~/lib/zip-export.client';
import { ConnectorsPanel } from '~/components/header/ConnectorsPanel.client';

interface HeaderActionButtonsProps {}

export function HeaderActionButtons({}: HeaderActionButtonsProps) {
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const { showChat } = useStore(chatStore);

  const canHideChat = showWorkbench || !showChat;

  const [githubOpen, setGithubOpen] = useState(false);
  const [repoName, setRepoName] = useState('');
  const [description, setDescription] = useState('Exported from LS Build');
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successUrl, setSuccessUrl] = useState<string | null>(null);
  const [zipLoading, setZipLoading] = useState(false);

  // github connection state (loaded from the session's server-side KV; manage via the Connectors panel)
  const [ghConnected, setGhConnected] = useState(false);
  const [ghLogin, setGhLogin] = useState<string | null>(null);

  useEffect(() => {
    if (!githubOpen) {
      return;
    }

    // check for an existing session-connected GitHub account when dialog opens
    getGitHubConnection().then((conn) => {
      setGhConnected(conn.hasToken);
      setGhLogin(conn.login);
    });

    // suggest repo name from first artifact or timestamp
    const artifact = workbenchStore.firstArtifact;

    if (artifact?.title) {
      const slug = artifact.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60);
      setRepoName(slug || `bolt-export-${Date.now()}`);
    } else if (!repoName) {
      setRepoName(`bolt-export-${Date.now().toString(36)}`);
    }
  }, [githubOpen]);

  const handleExport = async () => {
    setError(null);
    setSuccessUrl(null);

    const trimmedRepo = repoName.trim();

    if (!ghConnected) {
      setError('Connect your GitHub account first using the "Connectors" menu');
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
      // no token in body â€” server uses the session-connected (device flow) token
      const result = await pushToGitHub({
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
    if (zipLoading) {
      return;
    }

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
        <span className="hidden sm:inline">{zipLoading ? 'Zippingâ€¦' : 'Download ZIP'}</span>
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

      {/* Unified Connectors panel â€” GitHub / Vercel / Netlify / Cloudflare (connect, disconnect, status, deploy) */}
      <ConnectorsPanel />

      <DialogRoot open={githubOpen}>
        <Dialog onBackdrop={() => setGithubOpen(false)} onClose={() => setGithubOpen(false)} className="max-w-[520px]">
          <DialogTitle>Export to GitHub</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-4">
              {!successUrl ? (
                <>
                  <p className="text-[13px] leading-relaxed">
                    Create a new GitHub repository and push the current WebContainer file tree as the initial commit.
                    Connect once via GitHub OAuth Device Flow â€” the token is stored server-side, keyed to your{' '}
                    <code className="px-1 py-0.5 rounded bg-[#242424] border border-[#2a2a2a]">bolt_session</code>{' '}
                    (never in localStorage).
                  </p>

                  <div className="space-y-3">
                    {/* Connection status â€” manage via the Connectors panel in the header */}
                    <div className="rounded-md border border-[#2a2a2a] bg-[#141414] p-3">
                      <div className="flex items-center justify-between">
                        <span
                          className={classNames(
                            'flex items-center gap-2 text-xs',
                            ghConnected ? 'text-[#7fc87f]' : 'text-[#8a8a8a]',
                          )}
                        >
                          <div className={ghConnected ? 'i-ph:check-circle text-sm' : 'i-ph:warning-circle text-sm'} />
                          {ghConnected
                            ? `GitHub connected${ghLogin ? ` as ${ghLogin}` : ''}`
                            : 'GitHub account not connected'}
                        </span>
                      </div>

                      {!ghConnected && (
                        <p className="mt-2 text-[11px] text-[#8a8a8a]">
                          Use the <span className="font-medium text-[#e8e8e8]">Connectors</span> menu in the header to
                          connect your GitHub account (OAuth Device Flow).
                        </p>
                      )}
                    </div>

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
                      <input
                        type="checkbox"
                        checked={isPrivate}
                        onChange={(e) => setIsPrivate(e.target.checked)}
                        className="rounded"
                      />
                      Private repository
                    </label>

                    {error && (
                      <div className="rounded-md border border-[#e5484d]/30 bg-[#e5484d]/10 px-3 py-2 text-xs text-[#ff9a9e]">
                        {error}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <DialogButton type="secondary" onClick={() => setGithubOpen(false)}>
                      Cancel
                    </DialogButton>
                    <button
                      onClick={handleExport}
                      disabled={loading || !ghConnected}
                      className="inline-flex h-[30px] items-center justify-center rounded-[6px] bg-[#6b6bff] hover:bg-[#5a5aff] disabled:opacity-50 disabled:cursor-not-allowed px-4 text-[13px] font-medium text-white transition-colors"
                    >
                      {loading ? 'Pushingâ€¦' : 'Create & Push'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-md border border-[#2a7a2a]/30 bg-[#2a7a2a]/10 px-3 py-3">
                    <p className="text-sm text-[#7fc87f]">âœ“ Pushed to GitHub</p>
                    <a
                      href={successUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm underline text-[#8a8a8a] hover:text-[#e8e8e8] break-all"
                    >
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
