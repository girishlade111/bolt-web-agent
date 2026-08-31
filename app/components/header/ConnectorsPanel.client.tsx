import { useState, useEffect, useRef } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { connectGitHub, disconnectGitHub, getGitHubConnection } from '~/lib/github.client';
import {
  getDeployToken,
  setDeployToken,
  clearDeployToken,
  deployToCloudflare,
  deployToVercel,
  deployToNetlify,
  pollDeploymentStatus,
  pollVercelDeployment,
  pollNetlifyDeployment,
  type DeployProvider,
} from '~/lib/deploy.client';

/**
 * Unified "Connectors" panel — one consistent UI for GitHub / Vercel / Netlify / Cloudflare.
 *
 * UI-layer only: every connect/disconnect/status/deploy action calls the same
 * session-scoped client helpers (fetchWithSession + bolt_session KV storage) the
 * individual dialogs used before. No API or token-storage logic changed.
 *
 * Each connector row shows:
 *  - connected / not-connected status (live from the session's server-side KV)
 *  - Connect button (GitHub = OAuth device flow; deploy targets = token form)
 *  - Disconnect button
 *  - Deploy action (deploy targets only, enabled once connected)
 */

type ConnectorId = 'github' | DeployProvider;

const CONNECTORS: Array<{
  id: ConnectorId;
  label: string;
  icon: string;
  isDeployTarget: boolean;
  tokenPlaceholder: string;
  tokenHelp?: { href: string; label: string };
}> = [
  {
    id: 'github',
    label: 'GitHub',
    icon: 'i-ph:github-logo',
    isDeployTarget: false,
    tokenPlaceholder: '',
  },
  {
    id: 'vercel',
    label: 'Vercel',
    icon: 'i-simple-icons:vercel',
    isDeployTarget: true,
    tokenPlaceholder: 'vercel_...',
    tokenHelp: { href: 'https://vercel.com/account/tokens', label: 'Create at vercel.com/account/tokens' },
  },
  {
    id: 'netlify',
    label: 'Netlify',
    icon: 'i-simple-icons:netlify',
    isDeployTarget: true,
    tokenPlaceholder: 'nfp_...',
    tokenHelp: {
      href: 'https://app.netlify.com/user/applications#personal-access-tokens',
      label: 'Create at app.netlify.com/applications',
    },
  },
  {
    id: 'cloudflare',
    label: 'Cloudflare Pages',
    icon: 'i-simple-icons:cloudflare',
    isDeployTarget: true,
    tokenPlaceholder: 'cf_... (Account.Pages edit)',
    tokenHelp: {
      href: 'https://dash.cloudflare.com/profile/api-tokens',
      label: 'Create at dash.cloudflare.com/profile/api-tokens (Account → Pages Edit)',
    },
  },
];

interface DeployProviderState {
  connected: boolean;
  connecting: boolean; // token form open / saving
  tokenInput: string;
  accountIdInput: string;
  error: string | null;
}

const emptyProviderState: DeployProviderState = {
  connected: false,
  connecting: false,
  tokenInput: '',
  accountIdInput: '',
  error: null,
};

export function ConnectorsPanel() {
  const [open, setOpen] = useState(false);

  // github (OAuth device flow) state
  const [ghConnected, setGhConnected] = useState(false);
  const [ghLogin, setGhLogin] = useState<string | null>(null);
  const [ghConnecting, setGhConnecting] = useState(false);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);
  const [ghError, setGhError] = useState<string | null>(null);
  const flowIdRef = useRef(0);

  // deploy provider states
  const [providerStates, setProviderStates] = useState<Record<DeployProvider, DeployProviderState>>({
    vercel: { ...emptyProviderState },
    netlify: { ...emptyProviderState },
    cloudflare: { ...emptyProviderState },
  });

  // shared deploy runner state (any deploy target)
  const [deployingProvider, setDeployingProvider] = useState<DeployProvider | null>(null);
  const [deployStatus, setDeployStatus] = useState<string | null>(null);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployLogs, setDeployLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);

  // auto-scroll deploy log area
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [deployLogs, deployingProvider]);

  const setProviderState = (provider: DeployProvider, patch: Partial<DeployProviderState>) => {
    setProviderStates((prev) => ({ ...prev, [provider]: { ...prev[provider], ...patch } }));
  };

  // refresh all connection statuses from the session's server-side KV (bolt_session)
  const refreshStatuses = () => {
    getGitHubConnection().then((conn) => {
      setGhConnected(conn.hasToken);
      setGhLogin(conn.login);
    });

    const providers: DeployProvider[] = ['vercel', 'netlify', 'cloudflare'];

    for (const provider of providers) {
      getDeployToken(provider).then((token) => {
        setProviderState(provider, { connected: !!token });
      });
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);

    if (nextOpen) {
      refreshStatuses();
    }
  };

  // ---------- GitHub (OAuth device flow) ----------

  const handleConnectGitHub = async () => {
    setGhError(null);
    setGhConnecting(true);

    const thisFlow = ++flowIdRef.current;

    try {
      const { login } = await connectGitHub({
        onCode: (code, uri) => {
          if (flowIdRef.current !== thisFlow) {
            return;
          }

          setUserCode(code);
          setVerifyUrl(uri);
        },
        shouldAbort: () => flowIdRef.current !== thisFlow,
      });

      if (flowIdRef.current !== thisFlow) {
        return;
      }

      setGhConnected(true);
      setGhLogin(login);
      setUserCode(null);
      setVerifyUrl(null);
      toast.success(login ? `Connected to GitHub as ${login}` : 'Connected to GitHub');
    } catch (e: any) {
      if (flowIdRef.current === thisFlow && e?.message !== 'Connect cancelled') {
        setGhError(e.message ?? 'Failed to connect GitHub account');
      }

      setUserCode(null);
      setVerifyUrl(null);
    } finally {
      if (flowIdRef.current === thisFlow) {
        setGhConnecting(false);
      }
    }
  };

  const handleDisconnectGitHub = async () => {
    setGhError(null);

    try {
      await disconnectGitHub();
      setGhConnected(false);
      setGhLogin(null);
      toast.success('Disconnected GitHub account');
    } catch (e: any) {
      setGhError(e.message ?? 'Failed to disconnect');
    }
  };

  // ---------- Deploy providers (session-scoped token via /api/deploy/token) ----------

  const handleSaveToken = async (provider: DeployProvider) => {
    setProviderState(provider, { error: null });

    const token = providerStates[provider].tokenInput.trim();
    const accountId = providerStates[provider].accountIdInput.trim();

    if (!token) {
      setProviderState(provider, { error: 'Token is required' });
      return;
    }

    try {
      await setDeployToken(provider, token, accountId ? { accountId } : undefined);
      setProviderState(provider, { connected: true, connecting: false, tokenInput: '', accountIdInput: '' });
      toast.success(`Connected to ${CONNECTORS.find((c) => c.id === provider)?.label}`);
    } catch {
      setProviderState(provider, { error: 'Failed to save token' });
    }
  };

  const handleDisconnectProvider = async (provider: DeployProvider) => {
    setProviderState(provider, { error: null });

    try {
      await clearDeployToken(provider);
      setProviderState(provider, { connected: false, connecting: false, tokenInput: '', accountIdInput: '' });
      toast.success(`Disconnected ${CONNECTORS.find((c) => c.id === provider)?.label}`);
    } catch {
      setProviderState(provider, { error: 'Failed to disconnect' });
    }
  };

  // ---------- deploy action (same client helpers + polling as before) ----------

  const handleDeploy = async (provider: DeployProvider) => {
    setDeployError(null);
    setDeployUrl(null);
    setDeployLogs([]);
    setDeployingProvider(provider);
    setDeployStatus('initializing');
    abortRef.current = false;

    // derive project name from artifact title (same as previous one-click deploy)
    const artifact = workbenchStore.firstArtifact;
    const projectName =
      (artifact?.title ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 63) || `bolt-${Date.now().toString(36)}`;

    try {
      const onLog = (line: string) => setDeployLogs((prev) => [...prev.slice(-499), line]);

      let result: any;

      if (provider === 'cloudflare') {
        result = await deployToCloudflare({ projectName });
      } else if (provider === 'vercel') {
        result = await deployToVercel({ projectName });
      } else {
        result = await deployToNetlify({ projectName });
      }

      let finalUrl = result.url;
      const deploymentId = result.deploymentId;
      let status = result.status;

      if (status === 'initializing' && deploymentId) {
        setDeployStatus('building');

        try {
          const polled =
            provider === 'cloudflare'
              ? await pollDeploymentStatus(provider, deploymentId, projectName, {
                  intervalMs: 2000,
                  timeoutMs: 60000,
                })
              : provider === 'vercel'
                ? await pollVercelDeployment(deploymentId, projectName, { intervalMs: 3000, timeoutMs: 180000, onLog })
                : await pollNetlifyDeployment(deploymentId, projectName, {
                    intervalMs: 3000,
                    timeoutMs: 180000,
                    onLog,
                  });

          finalUrl = polled.url || finalUrl;
          status = polled.status;
        } catch (pollErr: any) {
          if (abortRef.current) {
            return;
          }

          // polling failed — deployment may still be live; fall through with URL
          console.warn(`[${provider}-deploy] polling failed`, pollErr);
        }
      }

      if (abortRef.current) {
        return;
      }

      setDeployUrl(finalUrl);
      setDeployStatus(status === 'initializing' ? 'ready' : status);
      toast.success(`Deployed to ${CONNECTORS.find((c) => c.id === provider)?.label}: ${finalUrl}`);
    } catch (e: any) {
      if (!abortRef.current) {
        setDeployError(e.message ?? 'Deploy failed');
        setDeployStatus('error');
      }
    } finally {
      if (!abortRef.current) {
        setDeployingProvider(null);
      }
    }
  };

  // ---------- render helpers ----------

  const renderDeployProviderRow = (c: (typeof CONNECTORS)[number]) => {
    const provider = c.id as DeployProvider;
    const state = providerStates[provider];
    const isDeploying = deployingProvider === provider;

    return (
      <div key={c.id} className="space-y-2 border-b border-[#242424] px-2.5 py-3 last:border-b-0">
        {/* status line */}
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs font-medium text-[#e8e8e8]">
            <div className={classNames(c.icon, 'text-sm')} />
            {c.label}
          </span>
          <span
            className={classNames(
              'flex items-center gap-1 text-[11px]',
              state.connected ? 'text-[#7fc87f]' : 'text-[#8a8a8a]',
            )}
          >
            <div
              className={classNames('h-1.5 w-1.5 rounded-full', state.connected ? 'bg-[#2a7a2a]' : 'bg-[#4a4a4a]')}
            />
            {state.connected ? 'Connected' : 'Not connected'}
          </span>
        </div>

        {state.error && <p className="text-[11px] text-[#ff9a9e]">{state.error}</p>}

        {/* connect form (token) */}
        {state.connecting && !state.connected && (
          <div className="space-y-2 rounded-md border border-[#2a2a2a] bg-[#141414] p-2.5">
            <input
              type="password"
              value={state.tokenInput}
              onChange={(e) => setProviderState(provider, { tokenInput: e.target.value })}
              placeholder={c.tokenPlaceholder}
              className="w-full rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-1.5 text-xs text-[#e8e8e8] placeholder:text-[#5c5c5c] focus:outline-none focus:border-[#6b6bff]"
            />
            {provider === 'cloudflare' && (
              <input
                value={state.accountIdInput}
                onChange={(e) => setProviderState(provider, { accountIdInput: e.target.value })}
                placeholder="Account ID (optional — auto-detected if blank)"
                className="w-full rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-1.5 text-xs text-[#e8e8e8] placeholder:text-[#5c5c5c] focus:outline-none focus:border-[#6b6bff]"
              />
            )}
            {c.tokenHelp && (
              <a
                href={c.tokenHelp.href}
                target="_blank"
                rel="noreferrer"
                className="block text-[11px] underline text-[#8a8a8a] hover:text-[#e8e8e8]"
              >
                {c.tokenHelp.label}
              </a>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setProviderState(provider, { connecting: false })}
                className="inline-flex h-[26px] items-center rounded-[6px] border border-[#2a2a2a] bg-[#1c1c1c] hover:bg-[#242424] px-3 text-[11px] text-[#e8e8e8] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveToken(provider)}
                className="inline-flex h-[26px] items-center rounded-[6px] bg-[#6b6bff] hover:bg-[#5a5aff] px-3 text-[11px] font-medium text-white transition-colors"
              >
                Save token
              </button>
            </div>
            <p className="text-[10px] leading-relaxed text-[#5c5c5c]">
              Stored server-side, keyed to your <code className="rounded bg-[#242424] px-1 py-0.5">bolt_session</code> —
              never in localStorage.
            </p>
          </div>
        )}

        {/* action buttons */}
        <div className="flex items-center justify-end gap-2">
          {state.connected ? (
            <>
              <button
                onClick={() => handleDisconnectProvider(provider)}
                disabled={deployingProvider !== null}
                className="inline-flex h-[26px] items-center rounded-[6px] border border-[#e5484d]/40 bg-[#1c1c1c] hover:bg-[#2a1a1a] disabled:opacity-50 disabled:cursor-not-allowed px-2.5 text-[11px] font-medium text-[#ff9a9e] transition-colors"
              >
                Disconnect
              </button>
              <button
                onClick={() => handleDeploy(provider)}
                disabled={deployingProvider !== null}
                className="inline-flex h-[26px] items-center gap-1.5 rounded-[6px] bg-[#6b6bff] hover:bg-[#5a5aff] disabled:opacity-50 disabled:cursor-not-allowed px-3 text-[11px] font-medium text-white transition-colors"
                title={`Deploy the current WebContainer project to ${c.label}`}
              >
                <div
                  className={classNames(
                    isDeploying ? 'i-svg-spinners:90-ring-with-bg' : 'i-ph:rocket-launch',
                    'text-xs',
                  )}
                />
                {isDeploying ? 'Deploying…' : 'Deploy'}
              </button>
            </>
          ) : (
            !state.connecting && (
              <button
                onClick={() => setProviderState(provider, { connecting: true, error: null })}
                className="inline-flex h-[26px] items-center rounded-[6px] bg-[#242424] hover:bg-[#2e2e2e] px-3 text-[11px] font-medium text-[#e8e8e8] transition-colors"
              >
                Connect
              </button>
            )
          )}
        </div>

        {/* shared deploy progress for this provider */}
        {isDeploying && <DeployProgress status={deployStatus} error={deployError} logs={deployLogs} logRef={logRef} />}
      </div>
    );
  };

  const renderGitHubRow = () => (
    <div className="space-y-2 border-b border-[#242424] px-2.5 py-3">
      {/* status line */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium text-[#e8e8e8]">
          <div className="i-ph:github-logo text-sm" />
          GitHub
        </span>
        <span
          className={classNames(
            'flex items-center gap-1 text-[11px]',
            ghConnected ? 'text-[#7fc87f]' : 'text-[#8a8a8a]',
          )}
        >
          <div className={classNames('h-1.5 w-1.5 rounded-full', ghConnected ? 'bg-[#2a7a2a]' : 'bg-[#4a4a4a]')} />
          {ghConnected ? `Connected${ghLogin ? ` as ${ghLogin}` : ''}` : 'Not connected'}
        </span>
      </div>

      {ghError && <p className="text-[11px] text-[#ff9a9e]">{ghError}</p>}

      {/* device flow UI */}
      {ghConnecting && userCode && (
        <div className="space-y-2 rounded-md border border-[#2a2a2a] bg-[#141414] p-2.5">
          <p className="text-[11px] text-[#e8e8e8]">
            1. Visit{' '}
            <a
              href={verifyUrl ?? 'https://github.com/login/device'}
              target="_blank"
              rel="noreferrer"
              className="underline text-[#6b6bff] hover:text-[#8a8aff]"
            >
              {verifyUrl ?? 'github.com/login/device'}
            </a>
          </p>
          <p className="text-[11px] text-[#e8e8e8]">2. Enter this code:</p>
          <div className="flex items-center justify-between gap-2">
            <code className="rounded border border-[#2a2a2a] bg-[#0d0d0d] px-3 py-1.5 font-mono text-base tracking-[0.3em] text-[#7fc87f] select-all">
              {userCode}
            </code>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(userCode).catch(() => undefined);
                toast.success('Code copied');
              }}
              className="inline-flex h-[26px] items-center rounded-[6px] border border-[#2a2a2a] bg-[#1c1c1c] hover:bg-[#242424] px-3 text-[11px] text-[#e8e8e8] transition-colors"
            >
              Copy
            </button>
          </div>
          <p className="flex items-center gap-2 text-[10px] text-[#8a8a8a]">
            <div className="i-svg-spinners:90-ring-with-bg text-sm" />
            Waiting for authorization…
          </p>
        </div>
      )}

      {/* action buttons */}
      <div className="flex items-center justify-end gap-2">
        {ghConnected ? (
          <button
            onClick={handleDisconnectGitHub}
            className="inline-flex h-[26px] items-center rounded-[6px] border border-[#e5484d]/40 bg-[#1c1c1c] hover:bg-[#2a1a1a] px-2.5 text-[11px] font-medium text-[#ff9a9e] transition-colors"
          >
            Disconnect
          </button>
        ) : (
          !ghConnecting && (
            <button
              onClick={handleConnectGitHub}
              className="inline-flex h-[26px] items-center gap-1.5 rounded-[6px] bg-[#24292f] hover:bg-[#2f353d] px-3 text-[11px] font-medium text-white transition-colors"
            >
              <div className="i-ph:github-logo text-xs" />
              Connect
            </button>
          )
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-[#5c5c5c]">
        OAuth Device Flow — token stored server-side, keyed to your{' '}
        <code className="rounded bg-[#242424] px-1 py-0.5">bolt_session</code> — never in localStorage.
      </p>
    </div>
  );

  return (
    <DropdownMenu.Root open={open} onOpenChange={handleOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          disabled={deployingProvider !== null}
          className="inline-flex items-center gap-1 sm:gap-1.5 rounded-md border border-bolt-elements-borderColor bg-[#1c1c1c] hover:bg-[#242424] disabled:opacity-50 disabled:cursor-not-allowed px-2 sm:px-3 py-1.5 text-xs font-medium text-[#e8e8e8] transition-colors shrink-0"
          title="Connect GitHub, Vercel, Netlify and Cloudflare — one session-scoped connection per service"
        >
          <div className={classNames(deployingProvider ? 'i-svg-spinners:90-ring-with-bg' : 'i-ph:plugs', 'text-sm')} />
          <span className="hidden sm:inline">
            {deployingProvider ? `Deploying to ${deployingProvider}…` : 'Connectors'}
          </span>
          <div className="i-ph:caret-down text-xs opacity-60 hidden sm:block" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="w-[360px] max-h-[70vh] overflow-y-auto bg-[#161616] border border-[#2a2a2a] rounded-md p-1.5 shadow-lg z-50"
          sideOffset={5}
          align="end"
        >
          <p className="px-2.5 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-[#5c5c5c]">Connectors</p>
          {renderGitHubRow()}
          {CONNECTORS.filter((c) => c.isDeployTarget).map(renderDeployProviderRow)}

          {(deployingProvider || deployUrl || deployError) && (
            <div className="px-2.5 py-2">
              {deployUrl && !deployError && (
                <div className="mb-2 rounded-md border border-[#2a7a2a]/30 bg-[#2a7a2a]/10 px-3 py-2">
                  <p className="text-xs text-[#7fc87f]">✓ Live URL</p>
                  <a
                    href={deployUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline text-[#8a8a8a] hover:text-[#e8e8e8] break-all"
                  >
                    {deployUrl}
                  </a>
                </div>
              )}
              {deployError && (
                <div className="rounded-md border border-[#e5484d]/30 bg-[#e5484d]/10 px-3 py-2 text-[11px] text-[#ff9a9e]">
                  {deployError}
                </div>
              )}
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    if (deployingProvider) {
                      abortRef.current = true;
                      setDeployingProvider(null);
                    }

                    setDeployUrl(null);
                    setDeployError(null);
                    setDeployLogs([]);
                    setDeployStatus(null);
                  }}
                  className="inline-flex h-[26px] items-center rounded-[6px] border border-[#2a2a2a] bg-[#1c1c1c] hover:bg-[#242424] px-3 text-[11px] text-[#e8e8e8] transition-colors"
                >
                  {deployingProvider ? 'Close (keeps deploying)' : 'Dismiss'}
                </button>
              </div>
            </div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function DeployProgress({
  status,
  error,
  logs,
  logRef,
}: {
  status: string | null;
  error: string | null;
  logs: string[];
  logRef: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-[#e8e8e8]">Deploy logs</span>
        <span className="text-[10px] text-[#5c5c5c]">{status ?? 'idle'}</span>
      </div>
      <div
        ref={logRef}
        className="h-[120px] overflow-y-auto rounded-md border border-[#2a2a2a] bg-[#0d0d0d] px-2.5 py-1.5 font-mono text-[10px] leading-[1.5] text-[#8a8a8a] whitespace-pre-wrap break-all"
      >
        {logs.length === 0 ? (
          <span className="text-[#5c5c5c]">{status === 'initializing' ? 'Uploading files…' : 'No logs yet.'}</span>
        ) : (
          logs.map((line, i) => (
            <div key={`${i}-${line.slice(0, 24)}`} className="text-[#8a8a8a]">
              {line}
            </div>
          ))
        )}
      </div>
      {error && <p className="text-[10px] text-[#ff9a9e]">{error}</p>}
    </div>
  );
}
