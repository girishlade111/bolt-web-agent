import { useState, useEffect, useRef } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { connectGitHub, disconnectGitHub, getGitHubConnection, pushToGitHub, collectFiles } from '~/lib/github.client';
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
  listConnectorResources,
  deleteConnectorResource,
  type DeployProvider,
  type ConnectorResource,
} from '~/lib/deploy.client';
import {
  getSupabaseConnection,
  connectSupabase,
  disconnectSupabase,
  getLinkedSupabaseProject,
  linkSupabaseProject,
  unlinkSupabaseProject,
  getSupabaseSchema,
  applySupabaseSchemaOp,
  type SupabaseLinkedProject,
  type SupabaseTable,
} from '~/lib/supabase.client';

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

type ConnectorId = 'github' | 'supabase' | DeployProvider;
type ManageableId = ConnectorId;

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
    id: 'supabase',
    label: 'Supabase',
    icon: 'i-simple-icons:supabase',
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

  // ---------- resource management (list / edit / delete) ----------
  // One provider's resource list is expanded at a time.
  const [manageProvider, setManageProvider] = useState<ManageableId | null>(null);
  const [resLoading, setResLoading] = useState(false);
  const [resError, setResError] = useState<string | null>(null);
  const [resources, setResources] = useState<ConnectorResource[]>([]);

  // delete confirmation: two-step type-to-confirm (deletes real external resources)
  const [deleteTarget, setDeleteTarget] = useState<ConnectorResource | null>(null);
  const [confirmInput, setConfirmInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [busyResource, setBusyResource] = useState<string | null>(null); // per-row push busy marker

  // ---------- Supabase (Management API OAuth) state ----------
  const [sbConnected, setSbConnected] = useState(false);
  const [sbEmail, setSbEmail] = useState<string | null>(null);
  const [sbConnecting, setSbConnecting] = useState(false);
  const [sbError, setSbError] = useState<string | null>(null);
  const [sbLinked, setSbLinked] = useState<SupabaseLinkedProject | null>(null);
  const [sbSchema, setSbSchema] = useState<SupabaseTable[] | null>(null);
  const [sbSchemaLoading, setSbSchemaLoading] = useState(false);
  const [sbSchemaBusy, setSbSchemaBusy] = useState(false);
  const [sbSchemaError, setSbSchemaError] = useState<string | null>(null);

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
    getGitHubConnection()
      .then((conn) => {
        setGhConnected(conn.hasToken);
        setGhLogin(conn.login);
      })
      .catch(() => undefined);

    const providers: DeployProvider[] = ['vercel', 'netlify', 'cloudflare'];

    for (const provider of providers) {
      getDeployToken(provider).then((token) => {
        setProviderState(provider, { connected: !!token });
      });
    }

    getSupabaseConnection()
      .then((conn) => {
        setSbConnected(conn.connected);
        setSbEmail(conn.email);
      })
      .catch(() => undefined);
    getLinkedSupabaseProject()
      .then(setSbLinked)
      .catch(() => undefined);
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

  // ---------- resource management handlers (list / edit / delete) ----------

  const loadResources = async (provider: ManageableId) => {
    setManageProvider(provider);
    setResLoading(true);
    setResError(null);
    setResources([]);
    setDeleteTarget(null);
    setConfirmInput('');

    try {
      setResources(await listConnectorResources(provider));
    } catch (e: any) {
      setResError(e?.message ?? 'Failed to load resources');
    } finally {
      setResLoading(false);
    }
  };

  const toggleManage = (provider: ManageableId) => {
    if (manageProvider === provider) {
      setManageProvider(null);
      setDeleteTarget(null);
      setConfirmInput('');
    } else {
      loadResources(provider);
    }
  };

  /**
   * Edit — re-deploy an existing deploy-target project (push new build) instead
   * of creating a new one. Vercel/Cloudflare attach to the project by name;
   * Netlify redeploys into the existing site via siteId.
   */
  const handleEditResource = async (provider: DeployProvider, resource: ConnectorResource) => {
    setDeployError(null);
    setDeployUrl(null);
    setDeployLogs([]);
    setDeployStatus('initializing');
    setDeployingProvider(provider);
    abortRef.current = false;

    const projectName = resource.name;
    const onLog = (line: string) => setDeployLogs((prev) => [...prev.slice(-499), line]);

    try {
      let result: any;

      if (provider === 'cloudflare') {
        result = await deployToCloudflare({ projectName });
      } else if (provider === 'vercel') {
        result = await deployToVercel({ projectName });
      } else {
        result = await deployToNetlify({ projectName, siteId: resource.id });
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

          setDeployError(pollErr?.message ?? 'Deployment polling failed');
          setDeployStatus(null);

          return;
        }
      }

      if (abortRef.current) {
        return;
      }

      setDeployUrl(finalUrl);
      setDeployStatus(status === 'error' ? null : 'done');
      toast.success(`Re-deployed ${resource.name} to ${CONNECTORS.find((c) => c.id === provider)?.label}`);
    } catch (e: any) {
      setDeployError(e?.message ?? 'Re-deploy failed');
      setDeployStatus(null);
    } finally {
      if (!abortRef.current) {
        setDeployingProvider(null);
      }
    }
  };

  /** Edit — push the current WebContainer file tree to an existing GitHub repo. */
  const handlePushToRepo = async (resource: ConnectorResource) => {
    setBusyResource(resource.id);
    setResError(null);

    try {
      const files = collectFiles();

      if (Object.keys(files).length === 0) {
        throw new Error('No files to push. Generate an app first.');
      }

      const result = await pushToGitHub({ repoName: resource.name, existingRepo: true, files });
      toast.success(`Pushed ${result.filesPushed} files to ${result.repoUrl}`);
    } catch (e: any) {
      setResError(e?.message ?? 'Push to repo failed');
    } finally {
      setBusyResource(null);
    }
  };

  /** Delete — destructive; requires type-to-confirm, audit-logged server-side. */
  const handleDeleteResource = async (resource: ConnectorResource) => {
    if (!manageProvider) {
      return;
    }

    setDeleting(true);

    try {
      await deleteConnectorResource({
        provider: manageProvider,
        id: resource.id,
        name: resource.name,
        confirmName: confirmInput,
      });
      toast.success(`Deleted ${resource.name}`);

      // if the deleted supabase project was the linked one, clear link state
      if (manageProvider === 'supabase' && sbLinked?.ref === resource.id) {
        setSbLinked(null);
        setSbSchema(null);
      }

      setDeleteTarget(null);
      setConfirmInput('');
      await loadResources(manageProvider);
    } catch (e: any) {
      toast.error(e?.message ?? 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

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
                onClick={() => toggleManage(provider)}
                disabled={deployingProvider !== null}
                className={classNames(
                  'inline-flex h-[26px] items-center gap-1 rounded-[6px] border px-2.5 text-[11px] font-medium transition-colors',
                  manageProvider === provider
                    ? 'border-[#6b6bff]/50 bg-[#6b6bff]/10 text-[#a3a3ff]'
                    : 'border-[#2a2a2a] bg-[#1c1c1c] text-[#e8e8e8] hover:bg-[#242424]',
                )}
              >
                <div className="i-ph:list-dashes text-xs" />
                Manage
              </button>
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

        {renderResourceSection(provider, c.label)}
      </div>
    );
  };

  // ---------- Supabase (Management API OAuth) handlers ----------

  const handleConnectSupabase = async () => {
    setSbError(null);
    setSbConnecting(true);

    try {
      await connectSupabase();

      const conn = await getSupabaseConnection();
      setSbConnected(conn.connected);
      setSbEmail(conn.email);

      if (conn.connected) {
        toast.success(conn.email ? `Connected to Supabase as ${conn.email}` : 'Connected to Supabase');
      }
    } catch (e: any) {
      setSbError(e?.message ?? 'Failed to connect Supabase account');
    } finally {
      setSbConnecting(false);
    }
  };

  const handleDisconnectSupabase = async () => {
    setSbError(null);

    try {
      await disconnectSupabase();
      setSbConnected(false);
      setSbEmail(null);
      setSbLinked(null);
      setSbSchema(null);
      toast.success('Disconnected Supabase account');
    } catch (e: any) {
      setSbError(e?.message ?? 'Failed to disconnect');
    }
  };

  /** Link an existing project (from the resource list) to the current session. */
  const handleLinkSupabaseProject = async (resource: ConnectorResource) => {
    setSbSchemaError(null);

    try {
      const linked = await linkSupabaseProject(resource.id);
      setSbLinked(linked);
      toast.success(`Linked project ${linked.name}`);
    } catch (e: any) {
      setSbSchemaError(e?.message ?? 'Failed to link project');
    }
  };

  const handleLoadSchema = async () => {
    if (!sbLinked) {
      return;
    }

    setSbSchemaLoading(true);
    setSbSchemaError(null);

    try {
      setSbSchema(await getSupabaseSchema());
    } catch (e: any) {
      setSbSchemaError(e?.message ?? 'Failed to load schema');
      setSbSchema(null);
    } finally {
      setSbSchemaLoading(false);
    }
  };

  const handleSchemaOp = async (payload: Parameters<typeof applySupabaseSchemaOp>[0]) => {
    setSbSchemaBusy(true);
    setSbSchemaError(null);

    try {
      await applySupabaseSchemaOp(payload);
      await handleLoadSchema();
    } catch (e: any) {
      setSbSchemaError(e?.message ?? 'Schema edit failed');
    } finally {
      setSbSchemaBusy(false);
    }
  };

  const handleUnlinkSupabaseProject = async () => {
    setSbSchemaError(null);

    try {
      await unlinkSupabaseProject();
      setSbLinked(null);
      setSbSchema(null);
      toast.success('Unlinked project');
    } catch (e: any) {
      setSbSchemaError(e?.message ?? 'Failed to unlink');
    }
  };

  /** Shared resource list UI (rendered inside a connected connector's row). */
  const renderResourceSection = (provider: ManageableId, label: string) => {
    if (manageProvider !== provider) {
      return null;
    }

    return (
      <div className="space-y-2 rounded-md border border-[#2a2a2a] bg-[#141414] p-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-[#e8e8e8]">Your {label} resources</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => loadResources(provider)}
              disabled={resLoading || deleting}
              className="inline-flex h-[22px] items-center rounded-[6px] border border-[#2a2a2a] bg-[#1c1c1c] hover:bg-[#242424] disabled:opacity-50 px-2 text-[10px] text-[#e8e8e8] transition-colors"
            >
              Refresh
            </button>
            <button
              onClick={() => {
                setManageProvider(null);
                setDeleteTarget(null);
                setConfirmInput('');
              }}
              className="inline-flex h-[22px] items-center rounded-[6px] border border-[#2a2a2a] bg-[#1c1c1c] hover:bg-[#242424] px-2 text-[10px] text-[#8a8a8a] transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        {resLoading && (
          <p className="flex items-center gap-1.5 text-[10px] text-[#8a8a8a]">
            <div className="i-svg-spinners:90-ring-with-bg text-xs" />
            Loading resources…
          </p>
        )}

        {resError && <p className="text-[10px] text-[#ff9a9e]">{resError}</p>}

        {!resLoading && !resError && resources.length === 0 && (
          <p className="text-[10px] text-[#5c5c5c]">No existing resources found on this account.</p>
        )}

        {resources.map((r) => (
          <div
            key={`${provider}-${r.id}`}
            className="space-y-1.5 rounded border border-[#242424] bg-[#101010] px-2 py-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-[11px] text-[#6b6bff] hover:text-[#8a8aff] hover:underline"
                >
                  {r.name}
                </a>
              ) : (
                <span className="truncate text-[11px] text-[#e8e8e8]">{r.name}</span>
              )}
              <span className="shrink-0 text-[10px] text-[#5c5c5c]">
                {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : r.kind}
              </span>
            </div>

            {deleteTarget?.id === r.id ? (
              <div className="space-y-1.5 rounded border border-[#e5484d]/40 bg-[#e5484d]/5 p-2">
                <p className="text-[10px] leading-relaxed text-[#ff9a9e]">
                  This permanently deletes <strong className="text-[#e8e8e8]">{r.name}</strong> from {label}. This
                  cannot be undone. Type the resource name to confirm:
                </p>
                <input
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                  placeholder={r.name}
                  autoFocus
                  className="h-[26px] w-full rounded border border-[#2a2a2a] bg-[#0d0d0d] px-2 font-mono text-[11px] text-[#e8e8e8] placeholder:text-[#4a4a4a] focus:border-[#e5484d]/60 focus:outline-none"
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    onClick={() => {
                      setDeleteTarget(null);
                      setConfirmInput('');
                    }}
                    disabled={deleting}
                    className="inline-flex h-[24px] items-center rounded-[6px] border border-[#2a2a2a] bg-[#1c1c1c] hover:bg-[#242424] disabled:opacity-50 px-2 text-[10px] text-[#e8e8e8] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleDeleteResource(r)}
                    disabled={confirmInput !== r.name || deleting}
                    className="inline-flex h-[24px] items-center rounded-[6px] bg-[#e5484d] hover:bg-[#ff5a5f] disabled:cursor-not-allowed disabled:opacity-40 px-2 text-[10px] font-medium text-white transition-colors"
                  >
                    {deleting ? 'Deleting…' : `Delete ${r.name}`}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-end gap-1.5">
                {provider === 'github' && (
                  <button
                    onClick={() => handlePushToRepo(r)}
                    disabled={busyResource === r.id || deleting}
                    className="inline-flex h-[24px] items-center gap-1 rounded-[6px] bg-[#242424] hover:bg-[#2e2e2e] disabled:opacity-50 px-2 text-[10px] font-medium text-[#e8e8e8] transition-colors"
                    title={`Push the current project files to ${r.name}`}
                  >
                    <div
                      className={classNames(
                        busyResource === r.id ? 'i-svg-spinners:90-ring-with-bg' : 'i-ph:upload-simple',
                        'text-[10px]',
                      )}
                    />
                    {busyResource === r.id ? 'Pushing…' : 'Push'}
                  </button>
                )}
                {provider === 'supabase' && (
                  <button
                    onClick={() => handleLinkSupabaseProject(r)}
                    disabled={sbLinked?.ref === r.id || sbSchemaBusy}
                    className="inline-flex h-[24px] items-center gap-1 rounded-[6px] bg-[#242424] hover:bg-[#2e2e2e] disabled:opacity-50 px-2 text-[10px] font-medium text-[#e8e8e8] transition-colors"
                    title={`Link the existing Supabase project "${r.name}" to this session`}
                  >
                    <div
                      className={classNames(sbLinked?.ref === r.id ? 'i-ph:link-break' : 'i-ph:link', 'text-[10px]')}
                    />
                    {sbLinked?.ref === r.id ? 'Linked' : 'Link'}
                  </button>
                )}
                {provider !== 'github' && provider !== 'supabase' && (
                  <button
                    onClick={() => handleEditResource(provider as DeployProvider, r)}
                    disabled={deployingProvider !== null || deleting}
                    className="inline-flex h-[24px] items-center gap-1 rounded-[6px] bg-[#242424] hover:bg-[#2e2e2e] disabled:cursor-not-allowed disabled:opacity-50 px-2 text-[10px] font-medium text-[#e8e8e8] transition-colors"
                    title={`Re-deploy the current project to the existing ${label} project "${r.name}"`}
                  >
                    <div className="i-ph:arrow-clockwise text-[10px]" />
                    Re-deploy
                  </button>
                )}
                <button
                  onClick={() => {
                    setDeleteTarget(r);
                    setConfirmInput('');
                  }}
                  disabled={deleting || busyResource === r.id}
                  className="inline-flex h-[24px] items-center rounded-[6px] border border-[#e5484d]/40 bg-[#1c1c1c] hover:bg-[#2a1a1a] disabled:opacity-50 px-2 text-[10px] font-medium text-[#ff9a9e] transition-colors"
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}

        {provider === 'supabase' && (
          <div className="space-y-2 rounded border border-[#242424] bg-[#101010] px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[11px] font-medium text-[#e8e8e8]">
                {sbLinked ? (
                  <>
                    Linked: <span className="text-[#7fc87f]">{sbLinked.name}</span>
                    <span className="ml-1.5 text-[10px] text-[#5c5c5c]">({sbLinked.ref})</span>
                  </>
                ) : (
                  <span className="text-[#8a8a8a]">No project linked to this session</span>
                )}
              </span>
              {sbLinked && (
                <button
                  onClick={handleUnlinkSupabaseProject}
                  disabled={sbSchemaBusy}
                  className="shrink-0 inline-flex h-[22px] items-center rounded-[6px] border border-[#2a2a2a] bg-[#1c1c1c] hover:bg-[#242424] disabled:opacity-50 px-2 text-[10px] text-[#8a8a8a] transition-colors"
                >
                  Unlink
                </button>
              )}
            </div>

            {sbLinked && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#8a8a8a]">Schema (public tables)</span>
                  <div className="flex gap-1.5">
                    {!sbSchema && (
                      <button
                        onClick={handleLoadSchema}
                        disabled={sbSchemaLoading || sbSchemaBusy}
                        className="inline-flex h-[22px] items-center gap-1 rounded-[6px] bg-[#242424] hover:bg-[#2e2e2e] disabled:opacity-50 px-2 text-[10px] font-medium text-[#e8e8e8] transition-colors"
                      >
                        <div
                          className={classNames(
                            sbSchemaLoading ? 'i-svg-spinners:90-ring-with-bg' : 'i-ph:table',
                            'text-[10px]',
                          )}
                        />
                        {sbSchemaLoading ? 'Loading…' : 'View schema'}
                      </button>
                    )}
                    {sbSchema && (
                      <button
                        onClick={() => setSbSchema(null)}
                        className="inline-flex h-[22px] items-center rounded-[6px] border border-[#2a2a2a] bg-[#1c1c1c] hover:bg-[#242424] px-2 text-[10px] text-[#8a8a8a] transition-colors"
                      >
                        Hide
                      </button>
                    )}
                  </div>
                </div>

                {sbSchemaError && <p className="text-[10px] text-[#ff9a9e]">{sbSchemaError}</p>}

                {sbSchema?.map((table) => (
                  <div key={table.name} className="rounded border border-[#242424] bg-[#0d0d0d] px-2 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <code className="text-[11px] text-[#7fc87f]">{table.name}</code>
                      <button
                        onClick={() => {
                          if (window.confirm(`Drop table "${table.name}"? This is irreversible and audit-logged.`)) {
                            handleSchemaOp({ op: 'drop-table', table: table.name });
                          }
                        }}
                        disabled={sbSchemaBusy}
                        className="inline-flex h-[20px] items-center rounded border border-[#e5484d]/40 bg-transparent hover:bg-[#2a1a1a] disabled:opacity-50 px-1.5 text-[9px] font-medium text-[#ff9a9e] transition-colors"
                      >
                        Drop
                      </button>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {table.columns.map((col) => (
                        <div key={col.name} className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="truncate text-[#e8e8e8]">
                            {col.name}
                            {!col.nullable && <span className="ml-1 text-[#5c5c5c]">NOT NULL</span>}
                          </span>
                          <span className="shrink-0 flex items-center gap-1.5">
                            <span className="text-[#6b6bff]">{col.type}</span>
                            <button
                              onClick={() => {
                                const newType = window.prompt(
                                  `New type for "${col.name}" (e.g. text, integer, timestamptz)`,
                                );

                                if (newType) {
                                  handleSchemaOp({
                                    op: 'set-type',
                                    table: table.name,
                                    column: col.name,
                                    type: newType,
                                  });
                                }
                              }}
                              disabled={sbSchemaBusy}
                              className="text-[9px] text-[#5c5c5c] hover:text-[#e8e8e8] disabled:opacity-50"
                              title="Change column type"
                            >
                              edit
                            </button>
                            <button
                              onClick={() => {
                                if (
                                  window.confirm(`Drop column "${table.name}.${col.name}"? Audit-logged, irreversible.`)
                                ) {
                                  handleSchemaOp({ op: 'drop-column', table: table.name, column: col.name });
                                }
                              }}
                              disabled={sbSchemaBusy}
                              className="text-[9px] text-[#5c5c5c] hover:text-[#ff9a9e] disabled:opacity-50"
                              title="Drop column"
                            >
                              drop
                            </button>
                          </span>
                        </div>
                      ))}
                      <button
                        onClick={() => {
                          const name = window.prompt('Column name:');

                          if (!name) {
                            return;
                          }

                          const type = window.prompt('Column type (e.g. text, integer, timestamptz):', 'text');

                          if (!type) {
                            return;
                          }

                          handleSchemaOp({ op: 'add-column', table: table.name, name, type });
                        }}
                        disabled={sbSchemaBusy}
                        className="mt-1 inline-flex h-[20px] items-center gap-1 rounded-[4px] border border-[#2a2a2a] bg-[#1c1c1c] hover:bg-[#242424] disabled:opacity-50 px-1.5 text-[9px] text-[#8a8a8a] transition-colors"
                      >
                        <div className="i-ph:plus text-[9px]" />
                        Add column
                      </button>
                    </div>
                  </div>
                ))}

                <p className="text-[10px] leading-relaxed text-[#5c5c5c]">
                  Destructive schema edits (drop column / drop table) are audit-logged server-side.
                </p>
              </>
            )}
          </div>
        )}

        <p className="text-[10px] leading-relaxed text-[#5c5c5c]">
          Deletes are real and irreversible — they are logged server-side (provider, resource id, timestamp) for
          accountability.
        </p>
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
        {ghConnected && (
          <button
            onClick={() => toggleManage('github')}
            className={classNames(
              'inline-flex h-[26px] items-center gap-1 rounded-[6px] border px-2.5 text-[11px] font-medium transition-colors',
              manageProvider === 'github'
                ? 'border-[#6b6bff]/50 bg-[#6b6bff]/10 text-[#a3a3ff]'
                : 'border-[#2a2a2a] bg-[#1c1c1c] text-[#e8e8e8] hover:bg-[#242424]',
            )}
          >
            <div className="i-ph:list-dashes text-xs" />
            Manage
          </button>
        )}
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

      {renderResourceSection('github', 'GitHub')}

      <p className="text-[10px] leading-relaxed text-[#5c5c5c]">
        OAuth Device Flow — token stored server-side, keyed to your{' '}
        <code className="rounded bg-[#242424] px-1 py-0.5">bolt_session</code> — never in localStorage.
      </p>
    </div>
  );

  const renderSupabaseRow = () => (
    <div className="space-y-2 border-b border-[#242424] px-2.5 py-3">
      {/* status line */}
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-medium text-[#e8e8e8]">
          <div className="i-simple-icons:supabase text-sm" />
          Supabase
        </span>
        <span
          className={classNames(
            'flex items-center gap-1 text-[11px]',
            sbConnected ? 'text-[#7fc87f]' : 'text-[#8a8a8a]',
          )}
        >
          <div className={classNames('h-1.5 w-1.5 rounded-full', sbConnected ? 'bg-[#2a7a2a]' : 'bg-[#4a4a4a]')} />
          {sbConnected ? `Connected${sbEmail ? ` as ${sbEmail}` : ''}` : 'Not connected'}
        </span>
      </div>

      {sbError && <p className="text-[11px] text-[#ff9a9e]">{sbError}</p>}

      {sbConnecting && (
        <p className="flex items-center gap-2 text-[11px] text-[#8a8a8a]">
          <div className="i-svg-spinners:90-ring-with-bg text-sm" />
          Waiting for the Supabase OAuth popup…
        </p>
      )}

      {/* action buttons */}
      <div className="flex items-center justify-end gap-2">
        {sbConnected && (
          <button
            onClick={() => toggleManage('supabase')}
            className={classNames(
              'inline-flex h-[26px] items-center gap-1 rounded-[6px] border px-2.5 text-[11px] font-medium transition-colors',
              manageProvider === 'supabase'
                ? 'border-[#6b6bff]/50 bg-[#6b6bff]/10 text-[#a3a3ff]'
                : 'border-[#2a2a2a] bg-[#1c1c1c] text-[#e8e8e8] hover:bg-[#242424]',
            )}
          >
            <div className="i-ph:list-dashes text-xs" />
            Manage
          </button>
        )}
        {sbConnected ? (
          <button
            onClick={handleDisconnectSupabase}
            className="inline-flex h-[26px] items-center rounded-[6px] border border-[#e5484d]/40 bg-[#1c1c1c] hover:bg-[#2a1a1a] px-2.5 text-[11px] font-medium text-[#ff9a9e] transition-colors"
          >
            Disconnect
          </button>
        ) : (
          !sbConnecting && (
            <button
              onClick={handleConnectSupabase}
              className="inline-flex h-[26px] items-center gap-1.5 rounded-[6px] bg-[#3ecf8e] hover:bg-[#4fdb9a] px-3 text-[11px] font-medium text-[#0a1f16] transition-colors"
            >
              <div className="i-simple-icons:supabase text-xs" />
              Connect
            </button>
          )
        )}
      </div>

      {renderResourceSection('supabase', 'Supabase')}

      <p className="text-[10px] leading-relaxed text-[#5c5c5c]">
        Supabase Management API OAuth — token stored server-side, keyed to your{' '}
        <code className="rounded bg-[#242424] px-1 py-0.5">bolt_session</code>. Link an existing project instead of
        auto-provisioning one.
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
          {renderSupabaseRow()}
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
