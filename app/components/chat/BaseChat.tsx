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
import { SupabaseToggle } from './SupabaseToggle';

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
  supabaseEnabled?: boolean;
  onSupabaseToggle?: (enabled: boolean) => void;
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
          <div
            className={classNames(
              styles.Chat,
              'flex flex-col flex-grow min-w-[var(--chat-min-width)] h-full',
              { 'justify-center items-center': !chatStarted },
            )}
          >
            {chatStarted ? (
              <div className="px-8 h-full flex flex-col">
                <ClientOnly>
                  {() => (
                    <Messages
                      ref={messageRef}
                      className="flex flex-col w-full flex-1 max-w-chat px-0 pb-6 mx-auto z-1"
                      messages={messages}
                      isStreaming={isStreaming}
                    />
                  )}
                </ClientOnly>

                {/* Prompt — sticky at bottom when chat started */}
                <div className="relative w-full max-w-chat mx-auto z-prompt sticky bottom-0">
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

                    {/* Toolbar */}
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
            ) : (
              /* Home page — only the prompt input, vertically + horizontally centered */
              <div className="w-full max-w-[640px] px-8">
                <div className="relative w-full max-w-chat mx-auto z-prompt">
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

                    {/* Toolbar */}
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
