import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { classNames } from '~/utils/classNames';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';

export function Header() {
  const chat = useStore(chatStore);

  return (
    <header
      className={classNames(
        'flex items-center px-4 sm:px-6 h-[var(--header-height)] sticky top-0 z-20 shrink-0',
        'bg-bolt-elements-background-depth-1/80 backdrop-blur-xl',
        'border-b transition-all duration-300',
        {
          'border-transparent': !chat.started,
          'border-bolt-elements-borderColor shadow-sm': chat.started,
        },
      )}
      style={{
        background: chat.started
          ? undefined
          : 'linear-gradient(to bottom, var(--bolt-elements-bg-depth-1) 0%, transparent 100%)',
      }}
    >
      {/* Left — LS Build Brand */}
      <div className="flex items-center gap-3 shrink-0">
        <a href="/" className="flex items-center gap-3 group">
          {/* Logo Mark */}
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-accent-500 to-cyan-500 rounded-xl blur-[6px] opacity-30 group-hover:opacity-50 transition-opacity" />
            <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-accent-600 via-violet-600 to-cyan-500 flex items-center justify-center shadow-lg shadow-accent-500/20 group-hover:shadow-accent-500/30 transition-all duration-300 group-hover:scale-[1.02]">
              <span className="text-white font-black text-[13px] tracking-tighter leading-none">LS</span>
            </div>
          </div>
          <div className="flex flex-col -gap-1">
            <span className="text-[16px] font-extrabold tracking-tight leading-none text-bolt-elements-textPrimary flex items-baseline gap-1">
              LS Build
              <span className="hidden sm:inline-flex items-center ml-1.5 px-1.5 py-0.5 rounded-md bg-accent-50 border border-accent-200 text-[10px] font-bold tracking-widest text-accent-700 leading-none">
                ENTERPRISE
              </span>
            </span>
            <span className="text-[11px] font-medium tracking-wide text-bolt-elements-textTertiary leading-none hidden sm:block">
              AI Application Builder
            </span>
          </div>
        </a>

        {/* Divider */}
        <div className="hidden lg:block w-px h-6 bg-bolt-elements-borderColor mx-1" />

        {/* Status pill — desktop only */}
        <div className="hidden lg:flex items-center gap-2 px-2.5 py-1 rounded-full bg-green-50 border border-green-200">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          <span className="text-xs font-semibold text-green-700 tracking-wide">All systems operational</span>
        </div>
      </div>

      {/* Center — Chat Description */}
      <div className="flex-1 flex justify-center px-4 min-w-0">
        <span className="truncate text-center max-w-[420px]">
          <ClientOnly>
            {() => (
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-sm text-bolt-elements-textSecondary truncate max-w-full">
                <span className="w-1.5 h-1.5 rounded-full bg-accent-500 animate-pulse shrink-0" />
                <span className="truncate">
                  <ChatDescription />
                </span>
              </span>
            )}
          </ClientOnly>
        </span>
      </div>

      {/* Right — Actions */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {chat.started && (
          <ClientOnly>
            {() => (
              <div className="flex items-center gap-1">
                <HeaderActionButtons />
              </div>
            )}
          </ClientOnly>
        )}
        {!chat.started && (
          <div className="hidden sm:flex items-center gap-2">
            <a
              href="https://github.com/stackblitz/bolt.new"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-xs font-medium text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary hover:border-bolt-elements-borderColorActive transition-colors"
            >
              <span className="i-ph:github-logo text-sm" />
              GitHub
            </a>
          </div>
        )}
      </div>
    </header>
  );
}
