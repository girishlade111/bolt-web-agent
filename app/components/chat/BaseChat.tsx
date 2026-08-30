import type { Message } from 'ai';
import React, { type RefCallback } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { Menu } from '~/components/sidebar/Menu.client';
import { IconButton } from '~/components/ui/IconButton';
import { Workbench } from '~/components/workbench/Workbench.client';
import { classNames } from '~/utils/classNames';
import { Messages } from './Messages.client';
import { SendButton } from './SendButton.client';
import { ModelSelector } from './ModelSelector';

import styles from './BaseChat.module.scss';

interface BaseChatProps {
  textareaRef?: React.RefObject<HTMLTextAreaElement> | undefined;
  messageRef?: RefCallback<HTMLDivElement> | undefined;
  scrollRef?: RefCallback<HTMLDivElement> | undefined;
  showChat?: boolean;
  chatStarted?: boolean;
  isStreaming?: boolean;
  messages?: Message[];
  enhancingPrompt?: boolean;
  promptEnhanced?: boolean;
  input?: string;
  handleStop?: () => void;
  sendMessage?: (event: React.UIEvent, messageInput?: string) => void;
  handleInputChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  enhancePrompt?: () => void;
}

const EXAMPLE_PROMPTS = [
  { text: 'Build a SaaS dashboard with charts and auth' },
  { text: 'Create a modern e-commerce storefront' },
  { text: 'Design a real-time analytics platform' },
  { text: 'Build a team collaboration workspace' },
  { text: 'Create a fintech expense tracker' },
  { text: 'Make an AI-powered content studio' },
];

const TEXTAREA_MIN_HEIGHT = 76;

export const BaseChat = React.forwardRef<HTMLDivElement, BaseChatProps>(
  (
    {
      textareaRef,
      messageRef,
      scrollRef,
      showChat = true,
      chatStarted = false,
      isStreaming = false,
      enhancingPrompt = false,
      promptEnhanced = false,
      messages,
      input = '',
      sendMessage,
      handleInputChange,
      enhancePrompt,
      handleStop,
    },
    ref,
  ) => {
    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    return (
      <div
        ref={ref}
        className={classNames(styles.BaseChat, 'relative flex h-full w-full overflow-hidden bg-[#0d0d0d]')}
        data-chat-visible={showChat}
      >
        <ClientOnly>{() => <Menu />}</ClientOnly>

        <div ref={scrollRef} className="flex overflow-y-auto w-full h-full">
          <div className={classNames(styles.Chat, 'flex flex-col flex-grow min-w-[var(--chat-min-width)] h-full')}>
            {!chatStarted && (
              <div id="intro" className="pt-[48px] pb-4 max-w-[640px] w-full mx-auto px-8">
                <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-[#e8e8e8]">Where ideas begin</h1>
                <p className="mt-2 text-[12.5px] leading-relaxed text-[#8a8a8a] max-w-[480px]">
                  LS Build brings ideas to life in seconds. Prompt, run, edit and deploy — all in the browser, no setup required.
                </p>
              </div>
            )}

            <div className={classNames('px-8', { 'h-full flex flex-col': chatStarted })}>
              <ClientOnly>
                {() => {
                  return chatStarted ? (
                    <Messages
                      ref={messageRef}
                      className="flex flex-col w-full flex-1 max-w-chat px-0 pb-6 mx-auto z-1"
                      messages={messages}
                      isStreaming={isStreaming}
                    />
                  ) : null;
                }}
              </ClientOnly>

              {/* Prompt — card with hairline border, no shadow */}
              <div className={classNames('relative w-full max-w-chat mx-auto z-prompt', { 'sticky bottom-0': chatStarted })}>
                <div className="rounded-[8px] bg-[#161616] border border-[#2a2a2a] overflow-hidden">
                  <textarea
                    ref={textareaRef}
                    className="w-full pl-4 pr-[52px] pt-3.5 pb-2 focus:outline-none resize-none text-[13.5px] leading-relaxed text-[#e8e8e8] placeholder-[#5c5c5c] bg-transparent"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        if (event.shiftKey) return;
                        event.preventDefault();
                        sendMessage?.(event);
                      }
                    }}
                    value={input}
                    onChange={(event) => handleInputChange?.(event)}
                    style={{
                      minHeight: TEXTAREA_MIN_HEIGHT,
                      maxHeight: TEXTAREA_MAX_HEIGHT,
                    }}
                    placeholder="How can LS Build help you today?"
                    translate="no"
                  />
                  <ClientOnly>
                    {() => (
                      <SendButton
                        show={input.length > 0 || isStreaming}
                        isStreaming={isStreaming}
                        onClick={(event) => {
                          if (isStreaming) {
                            handleStop?.();
                            return;
                          }
                          sendMessage?.(event);
                        }}
                      />
                    )}
                  </ClientOnly>

                  {/* Toolbar — separated by hairline, quiet buttons */}
                  <div className="flex justify-between items-center gap-2 px-3 py-2.5 border-t border-[#2a2a2a] bg-[#161616]">
                    <div className="flex gap-2 items-center">
                      <IconButton
                        title="Enhance prompt"
                        disabled={input.length === 0 || enhancingPrompt}
                        className={classNames(
                          'rounded-[6px]! border! px-2.5! py-1! text-xs! font-medium! transition-colors',
                          promptEnhanced
                            ? 'bg-[#1c1c1c]! border-[#2a2a2a]! text-[#e07856]!'
                            : 'bg-[#1c1c1c] border-[#2a2a2a] text-[#8a8a8a] hover:text-[#e8e8e8] hover:bg-[#242424]',
                        )}
                        onClick={() => enhancePrompt?.()}
                      >
                        {enhancingPrompt ? (
                          <>
                            <div className="i-svg-spinners:90-ring-with-bg text-[#e07856] text-sm" />
                            <span className="ml-1.5 text-xs">Enhancing…</span>
                          </>
                        ) : (
                          <>
                            <div className="i-ph:sparkle text-xs opacity-70" />
                            <span className="ml-1 text-xs">{promptEnhanced ? 'Enhanced' : 'Enhance'}</span>
                          </>
                        )}
                      </IconButton>
                      <ClientOnly>{() => <ModelSelector disabled={isStreaming} />}</ClientOnly>
                    </div>
                    {input.length > 3 ? (
                      <div className="hidden sm:flex items-center gap-1 text-[11px] text-[#5c5c5c]">
                        <span>
                          <kbd className="kdb">Shift</kbd> + <kbd className="kdb">↵</kbd> new line
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="bg-[#0d0d0d] pb-6" />
              </div>
            </div>

            {/* Examples — single bordered card with internal dividers (sectioned list) */}
            {!chatStarted && (
              <div id="examples" className="w-full max-w-[640px] mx-auto px-8 pb-8">
                <div className="rounded-[8px] bg-[#161616] border border-[#2a2a2a] overflow-hidden divide-y divide-[#2a2a2a]">
                  {EXAMPLE_PROMPTS.map((ex, index) => (
                    <button
                      key={index}
                      onClick={(e) => sendMessage?.(e, ex.text)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-[14px] text-left hover:bg-[#1c1c1c] transition-colors group"
                    >
                      <span className="text-[13.5px] font-medium leading-snug text-[#e8e8e8] group-hover:text-[#e8e8e8]">{ex.text}</span>
                      <span className="i-ph:arrow-right text-[#5c5c5c] group-hover:text-[#8a8a8a] text-sm shrink-0" />
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-[#5c5c5c]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#3ecf5e]" />
                  WebContainers ready • No setup • Private by default
                </div>
              </div>
            )}
          </div>

          <ClientOnly>{() => <Workbench chatStarted={chatStarted} isStreaming={isStreaming} />}</ClientOnly>
        </div>
      </div>
    );
  },
);
