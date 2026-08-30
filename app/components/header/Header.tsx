import { useStore } from '@nanostores/react';
import { ClientOnly } from 'remix-utils/client-only';
import { chatStore } from '~/lib/stores/chat';
import { HeaderActionButtons } from './HeaderActionButtons.client';
import { ChatDescription } from '~/lib/persistence/ChatDescription.client';

export function Header() {
  const chat = useStore(chatStore);

  return (
    <header className="flex items-center px-6 h-[56px] shrink-0 bg-[#0d0d0d] border-b border-[#2a2a2a] sticky top-0 z-20">
      {/* Left — Brand */}
      <div className="flex items-center gap-3 shrink-0">
        <a href="/" className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-[6px] bg-[#161616] border border-[#2a2a2a] flex items-center justify-center">
            <span className="text-[11px] font-semibold tracking-tight leading-none text-[#e8e8e8]">LS</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[13.5px] font-semibold leading-none tracking-tight text-[#e8e8e8]">LS Build</span>
            <span className="text-[11px] leading-none text-[#8a8a8a] mt-0.5">AI Application Builder</span>
          </div>
        </a>
        <div className="hidden sm:flex items-center ml-3 pl-3 border-l border-[#2a2a2a]">
          <span className="text-xs text-[#8a8a8a]">Enterprise</span>
          <span className="ml-2 w-1.5 h-1.5 rounded-full bg-[#3ecf5e]" />
        </div>
      </div>

      {/* Center — Chat description as quiet inline */}
      <div className="flex-1 flex justify-center px-4 min-w-0">
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
      <div className="flex items-center gap-2 shrink-0">
        {chat.started && (
          <ClientOnly>
            {() => <HeaderActionButtons />}
          </ClientOnly>
        )}
      </div>
    </header>
  );
}
