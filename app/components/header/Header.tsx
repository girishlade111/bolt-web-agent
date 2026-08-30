import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';

export function Header() {
  const chat = useStore(chatStore);

  return (
    <header className="flex items-center px-3 sm:px-6 h-[56px] shrink-0 bg-[#0d0d0d] border-b border-[#2a2a2a] sticky top-0 z-20 gap-2">
      {/* Left — Brand */}
      <div className="flex items-center gap-2 sm:gap-3 shrink-0 min-w-0">
        <a href="/" className="flex items-center gap-2 sm:gap-2.5 group shrink-0">
          {/* Enterprise SVG Logo Mark */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 32 32"
            width="28"
            height="28"
            className="shrink-0 transition-transform duration-200 group-hover:scale-105"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="hIconBg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#1e1e38"/>
                <stop offset="100%" stopColor="#111120"/>
              </linearGradient>
              <linearGradient id="hAccent" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#6366f1"/>
                <stop offset="50%" stopColor="#818cf8"/>
                <stop offset="100%" stopColor="#38bdf8"/>
              </linearGradient>
              <linearGradient id="hShine" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.1"/>
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0"/>
              </linearGradient>
              <filter id="hGlow">
                <feGaussianBlur stdDeviation="1" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <rect width="32" height="32" rx="7" fill="url(#hIconBg)"/>
            <rect width="32" height="16" rx="7" fill="url(#hShine)"/>
            <rect x="0.5" y="0.5" width="31" height="31" rx="6.5" fill="none" stroke="url(#hAccent)" strokeOpacity="0.45" strokeWidth="0.9"/>
            <g filter="url(#hGlow)">
              <rect x="5.5" y="7" width="2.8" height="13.5" rx="1" fill="url(#hAccent)"/>
              <rect x="5.5" y="17.7" width="8.5" height="2.8" rx="1" fill="url(#hAccent)"/>
            </g>
            <g filter="url(#hGlow)">
              <rect x="16.5" y="7" width="8" height="2.6" rx="0.9" fill="url(#hAccent)"/>
              <rect x="16.5" y="14.7" width="8" height="2.6" rx="0.9" fill="url(#hAccent)"/>
              <rect x="16.5" y="22.4" width="8" height="2.6" rx="0.9" fill="url(#hAccent)"/>
              <rect x="16.5" y="7" width="2.6" height="7.7" rx="0.9" fill="url(#hAccent)"/>
              <rect x="21.9" y="14.7" width="2.6" height="10.3" rx="0.9" fill="url(#hAccent)"/>
            </g>
            <circle cx="29.5" cy="29.5" r="1.2" fill="#38bdf8" opacity="0.8"/>
          </svg>
          <div className="hidden xs:flex sm:flex flex-col">
            <span className="text-[13px] sm:text-[13.5px] font-semibold leading-none tracking-tight text-[#e8e8e8]">LS Build</span>
            <span className="hidden sm:block text-[11px] leading-none text-[#8a8a8a] mt-0.5">AI Application Builder</span>
          </div>
        </a>
        <div className="hidden sm:flex items-center ml-2 sm:ml-3 pl-2 sm:pl-3 border-l border-[#2a2a2a]">
          <span className="text-xs text-[#8a8a8a]">Enterprise</span>
          <span className="ml-2 w-1.5 h-1.5 rounded-full bg-[#3ecf5e]" />
        </div>
      </div>

      {/* Center — Chat description as quiet inline — hidden on mobile to prevent header overflow */}
      <div className="hidden sm:flex flex-1 justify-center px-2 sm:px-4 min-w-0">
        <span className="truncate text-center">
          <ClientOnly>
            {() => (
              <span className="text-[12.5px] text-[#8a8a8a] truncate">
                <ChatDescription />
              </span>
            )}
          </ClientOnly>
        </span>
      </div>

      {/* Right */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 min-w-0">
        {chat.started && (
          <ClientOnly>
            {() => <HeaderActionButtons />}
          </ClientOnly>
        )}
      </div>
    </header>
  );
}
