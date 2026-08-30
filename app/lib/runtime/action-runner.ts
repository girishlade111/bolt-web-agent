import { WebContainer } from '@webcontainer/api';
import { map, type MapStore } from 'nanostores';
import * as nodePath from 'node:path';
import type { BoltAction } from '~/types/actions';
import { createScopedLogger } from '~/utils/logger';
import { unreachable } from '~/utils/unreachable';
import type { ActionCallbackData } from './message-parser';

const logger = createScopedLogger('ActionRunner');

/**
 * LLM-emitted shell commands execute via `jsh -c` unchecked.
 * Basic allowlist/blocklist filter to prevent destructive/resource-abuse.
 * Blocklist is checked first; allowlist is informational (standard dev commands).
 */

export const BLOCKED_SHELL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // destructive rm -rf targeting root/home – rm with r+f flags + dangerous path
  { pattern: /\brm\s+[^;|&\n]*-[a-z]*r[a-z]*f[^;|&\n]*\s+\/\s*(?:[;|&\n]|$)/i, reason: 'rm -rf / (root deletion)' },
  { pattern: /\brm\s+[^;|&\n]*-[a-z]*r[a-z]*f[^;|&\n]*\s+\/\*\s*(?:[;|&\n]|$)/i, reason: 'rm -rf /* (root wildcard)' },
  { pattern: /\brm\s+[^;|&\n]*-[a-z]*r[a-z]*f[^;|&\n]*\s+~(?:\s|$|\/|[;|&\n])/i, reason: 'rm -rf ~ (home deletion)' },
  { pattern: /\brm\s+[^;|&\n]*-[a-z]*r[a-z]*f[^;|&\n]*\s+\$HOME(?:\s|$|\/|[;|&\n])/i, reason: 'rm -rf $HOME' },
  { pattern: /\brm\s+[^;|&\n]*-[a-z]*r[a-z]*f[^;|&\n]*\s+\.\s*(?:[;|&\n]|$)/i, reason: 'rm -rf . (current dir)' },
  { pattern: /\brm\s+[^;|&\n]*-[a-z]*r[a-z]*f[^;|&\n]*\s+\.\.\s*(?:[;|&\n]|$)/i, reason: 'rm -rf .. (parent dir)' },
  { pattern: /\brm\s+[^;|&\n]*--[a-z-]*no-preserve-root\b/i, reason: 'rm --no-preserve-root' },
  { pattern: /\bchmod\s+[^;|&\n]*777\s+\/\b/i, reason: 'chmod 777 on root' },
  { pattern: /\bchmod\s+-R\s+777\b/i, reason: 'chmod -R 777 (recursive world-writable)' },
  { pattern: /\bchown\s+-R\b[^;|&\n]*\s+\/\s*(?:[;|&\n]|$)/i, reason: 'chown -R on root' },
  { pattern: /\bmkfs(\.\w+)?\b/i, reason: 'mkfs (filesystem creation)' },

  // fork bombs
  { pattern: /:\(\)\s*\{\s*:\|\s*:&\s*;\s*\}\s*;\s*:/, reason: 'fork bomb :(){ :|:& };:' },
  { pattern: /:\(\)\s*\{[^}]*:\s*\|\s*:&\s*;/, reason: 'potential fork bomb definition' },

  // infinite loops in shell / npm scripts
  { pattern: /\bwhile\s+true\b/i, reason: 'infinite loop while true' },
  { pattern: /\bwhile\s*:\s*;?\s*do\b/i, reason: 'infinite loop while :; do' },
  { pattern: /\bfor\s*\(\(\s*;;\s*\)\)/, reason: 'infinite loop for(;;)' },
  { pattern: /\bwhile\s*\(\s*true\s*\)/i, reason: 'infinite loop while(true)' },
  { pattern: /\buntil\s+true\b/i, reason: 'infinite loop until true' },

  // curl/wget to arbitrary external URLs – also covers pipe-to-shell
  { pattern: /\bcurl\b[^;|&\n]*\|\s*(sh|bash|zsh)\b/i, reason: 'curl pipe to shell' },
  { pattern: /\bwget\b[^;|&\n]*\|\s*(sh|bash|zsh)\b/i, reason: 'wget pipe to shell' },
  { pattern: /\bcurl\b[^;|&\n]*https?:\/\//i, reason: 'curl to external URL' },
  { pattern: /\bwget\b[^;|&\n]*https?:\/\//i, reason: 'wget to external URL' },

  // disk-fill / resource abuse
  { pattern: /\bdd\s+if=\/dev\/(zero|urandom|random)/i, reason: 'dd from /dev/zero|urandom (disk fill)' },
  { pattern: /\bcat\s+\/dev\/zero/i, reason: 'cat /dev/zero (disk fill)' },
  { pattern: /\bhead\s+-c\b[^;|&\n]*\/dev\/zero/i, reason: 'head -c /dev/zero (disk fill)' },
  { pattern: /\bfallocate\b/i, reason: 'fallocate (disk allocation)' },
  { pattern: /\btruncate\s+-s\s+\d+[GMK]/i, reason: 'truncate large file (disk fill)' },
  { pattern: /\byes\s*>\s*\S+/, reason: 'yes > file (disk fill)' },
  { pattern: /\byes\s*\|/, reason: 'yes pipe (resource abuse)' },
  { pattern: /:\s*>\s*\/dev\/sda/i, reason: 'write to raw disk /dev/sda' },

  // shutdown / firewall / reverse shell listeners
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: 'shutdown/reboot/halt' },
  { pattern: /\binit\s+0\b/i, reason: 'init 0 (shutdown)' },
  { pattern: /\b(iptables|ufw)\b/i, reason: 'firewall manipulation' },
  { pattern: /\bnc\s+.*-l\b/i, reason: 'netcat listener (potential reverse shell)' },
  { pattern: /\bncat\s+.*-l\b/i, reason: 'ncat listener' },
  { pattern: /\bsocat\b[^;|&\n]*\bexec\b/i, reason: 'socat exec (potential reverse shell)' },
  { pattern: /\bstress(-ng)?\b/i, reason: 'stress/stress-ng (resource abuse)' },
];

export const ALLOWED_SHELL_PREFIXES: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /^\s*npm\s+(install|i|ci|run\s+(dev|build|start|preview|lint|test|typecheck)|exec|create|init|list|view)\b/i, description: 'npm install/run dev/build' },
  { pattern: /^\s*pnpm\s+(install|i|add|run\s+(dev|build|start|preview|lint|test)|exec|dlx|create)\b/i, description: 'pnpm install/run' },
  { pattern: /^\s*yarn\s+(install|add|run\s+(dev|build|start)|create)\b/i, description: 'yarn install/run' },
  { pattern: /^\s*bun\s+(install|add|run\s+(dev|build))\b/i, description: 'bun install/run' },
  { pattern: /^\s*npx\s+\S+/i, description: 'npx' },
  { pattern: /^\s*node\s+/i, description: 'node' },
  { pattern: /^\s*git\s+(clone|status|add|commit|push|pull|checkout|branch|log|diff|fetch|init|remote|config)\b/i, description: 'git' },
  { pattern: /^\s*(ls|cat|echo|mkdir|touch|cp|mv|pwd|whoami|ps|env|printenv|vite|tsc|eslint|prettier)\b/i, description: 'standard CLI tools' },
];

export function isShellCommandBlocked(content: string): { blocked: boolean; reason?: string } {
  if (!content || !content.trim()) {
    return { blocked: true, reason: 'empty command' };
  }

  for (const { pattern, reason } of BLOCKED_SHELL_PATTERNS) {
    if (pattern.test(content)) {
      return { blocked: true, reason };
    }
  }

  return { blocked: false };
}

export function validateShellCommand(content: string): { allowed: boolean; reason?: string } {
  const blocked = isShellCommandBlocked(content);
  if (blocked.blocked) {
    return { allowed: false, reason: blocked.reason };
  }

  // Allowlist is informational – log when command does not match known dev prefixes but still allow if not blocklisted
  const trimmed = content.trim();
  const matchesAllowlist = ALLOWED_SHELL_PREFIXES.some(({ pattern }) => pattern.test(trimmed));

  if (!matchesAllowlist) {
    logger.debug(`Shell command not in allowlist but not blocklisted, allowing: ${trimmed.slice(0, 120)}`);
  }

  return { allowed: true };
}

export type ActionStatus = 'pending' | 'running' | 'complete' | 'aborted' | 'failed';

export type BaseActionState = BoltAction & {
  status: Exclude<ActionStatus, 'failed'>;
  abort: () => void;
  executed: boolean;
  abortSignal: AbortSignal;
};

export type FailedActionState = BoltAction &
  Omit<BaseActionState, 'status'> & {
    status: Extract<ActionStatus, 'failed'>;
    error: string;
  };

export type ActionState = BaseActionState | FailedActionState;

type BaseActionUpdate = Partial<Pick<BaseActionState, 'status' | 'abort' | 'executed'>>;

export type ActionStateUpdate =
  | BaseActionUpdate
  | (Omit<BaseActionUpdate, 'status'> & { status: 'failed'; error: string });

type ActionsMap = MapStore<Record<string, ActionState>>;

export class ActionRunner {
  #webcontainer: Promise<WebContainer>;
  #currentExecutionPromise: Promise<void> = Promise.resolve();

  actions: ActionsMap = map({});

  constructor(webcontainerPromise: Promise<WebContainer>) {
    this.#webcontainer = webcontainerPromise;
  }

  addAction(data: ActionCallbackData) {
    const { actionId } = data;

    const actions = this.actions.get();
    const action = actions[actionId];

    if (action) {
      // action already added
      return;
    }

    const abortController = new AbortController();

    this.actions.setKey(actionId, {
      ...data.action,
      status: 'pending',
      executed: false,
      abort: () => {
        abortController.abort();
        this.#updateAction(actionId, { status: 'aborted' });
      },
      abortSignal: abortController.signal,
    });

    this.#currentExecutionPromise.then(() => {
      this.#updateAction(actionId, { status: 'running' });
    });
  }

  async runAction(data: ActionCallbackData) {
    const { actionId } = data;
    const action = this.actions.get()[actionId];

    if (!action) {
      unreachable(`Action ${actionId} not found`);
    }

    if (action.executed) {
      return;
    }

    this.#updateAction(actionId, { ...action, ...data.action, executed: true });

    this.#currentExecutionPromise = this.#currentExecutionPromise
      .then(() => {
        return this.#executeAction(actionId);
      })
      .catch((error) => {
        console.error('Action failed:', error);
      });
  }

  async #executeAction(actionId: string) {
    const action = this.actions.get()[actionId];

    this.#updateAction(actionId, { status: 'running' });

    try {
      switch (action.type) {
        case 'shell': {
          await this.#runShellAction(action, actionId);
          break;
        }
        case 'file': {
          await this.#runFileAction(action);
          break;
        }
      }

      this.#updateAction(actionId, { status: action.abortSignal.aborted ? 'aborted' : 'complete' });
    } catch (error) {
      this.#updateAction(actionId, { status: 'failed', error: 'Action failed' });

      // re-throw the error to be caught in the promise chain
      throw error;
    }
  }

  async #runShellAction(action: ActionState, actionId?: string) {
    if (action.type !== 'shell') {
      unreachable('Expected shell action');
    }

    const validation = validateShellCommand(action.content);

    if (!validation.allowed) {
      const preview = action.content.slice(0, 500);
      const reason = validation.reason ?? 'blocked by policy';
      const timestamp = new Date().toISOString();

      logger.warn(`Blocked shell action [${reason}]: ${preview}`);
      console.warn('[ActionRunner] Blocked shell action', {
        actionId: actionId ?? 'unknown',
        reason,
        timestamp,
        content: preview,
      });

      throw new Error(`Blocked by security policy: ${reason}`);
    }

    const webcontainer = await this.#webcontainer;

    const process = await webcontainer.spawn('jsh', ['-c', action.content], {
      env: { npm_config_yes: true },
    });

    action.abortSignal.addEventListener('abort', () => {
      process.kill();
    });

    process.output.pipeTo(
      new WritableStream({
        write(data) {
          console.log(data);
        },
      }),
    );

    const exitCode = await process.exit;

    logger.debug(`Process terminated with code ${exitCode}`);
  }

  async #runFileAction(action: ActionState) {
    if (action.type !== 'file') {
      unreachable('Expected file action');
    }

    const webcontainer = await this.#webcontainer;

    let folder = nodePath.dirname(action.filePath);

    // remove trailing slashes
    folder = folder.replace(/\/+$/g, '');

    if (folder !== '.') {
      try {
        await webcontainer.fs.mkdir(folder, { recursive: true });
        logger.debug('Created folder', folder);
      } catch (error) {
        logger.error('Failed to create folder\n\n', error);
      }
    }

    try {
      await webcontainer.fs.writeFile(action.filePath, action.content);
      logger.debug(`File written ${action.filePath}`);
    } catch (error) {
      logger.error('Failed to write file\n\n', error);
    }
  }

  #updateAction(id: string, newState: ActionStateUpdate) {
    const actions = this.actions.get();

    this.actions.setKey(id, { ...actions[id], ...newState });
  }
}
