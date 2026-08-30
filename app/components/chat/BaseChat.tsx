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
  { text: 'Build a SaaS dashboard with charts and auth', icon: 'i-ph:chart-bar', color: 'from-violet-500 to-indigo-500' },
  { text: 'Create a modern e-commerce storefront', icon: 'i-ph:shopping-bag', color: 'from-emerald-500 to-teal-500' },
  { text: 'Design a real-time analytics platform', icon: 'i-ph:activity', color: 'from-orange-500 to-pink-500' },
  { text: 'Build a team collaboration workspace', icon: 'i-ph:users-three', color: 'from-blue-500 to-cyan-500' },
  { text: 'Create a fintech expense tracker', icon: 'i-ph:credit-card', color: 'from-amber-500 to-orange-500' },
  { text: 'Make an AI-powered content studio', icon: 'i-ph:sparkle', color: 'from-fuchsia-500 to-violet-500' },
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
        className={classNames(
          styles.BaseChat,
          'relative flex h-full w-full overflow-hidden bg-bolt-elements-background-depth-1',
        )}
        data-chat-visible={showChat}
      >
        <ClientOnly>{() => <Menu />}</ClientOnly>

        {/* Subtle enterprise background for landing */}
        {!chatStarted && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {/* Dot grid */}
            <div
              className="absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
              style={{
                backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`,
                backgroundSize: '24px 24px',
              }}
            />
            {/* Gradient orbs */}
            <div className="absolute -top-32 -right-32 w-[520px] h-[520px] rounded-full blur-3xl opacity-20 dark:opacity-10" style={{ background: 'radial-gradient(circle at center, #6366F1 0%, #7C3AED 30%, transparent 70%)' }} />
            <div className="absolute -bottom-40 -left-32 w-[640px] h-[640px] rounded-full blur-3xl opacity-10 dark:opacity-[0.07]" style={{ background: 'radial-gradient(circle at center, #06B6D4 0%, #6366F1 45%, transparent 70%)' }} />
            <div className="absolute top-[42%] left-1/2 -translate-x-1/2 w-[900px] h-[1px] bg-gradient-to-r from-transparent via-accent-500/10 to-transparent" />
          </div>
        )}

        <div ref={scrollRef} className="flex overflow-y-auto w-full h-full relative">
          <div className={classNames(styles.Chat, 'flex flex-col flex-grow min-w-[var(--chat-min-width)] h-full relative')}>
            {!chatStarted && (
              <div id="intro" className="mt-[7vh] sm:mt-[10vh] max-w-[720px] w-full mx-auto px-6 text-center relative">
                {/* Enterprise badge */}
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm mb-6 animate-fadeIn">
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-500" />
                  </span>
                  <span className="text-xs font-semibold tracking-widest text-slate-600 dark:text-slate-300 uppercase">Enterprise Ready • SOC2 • WebContainers</span>
                  <span className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-accent-600 dark:text-accent-400">
                    <span className="i-ph:arrow-right text-xs" />
                  </span>
                </div>

                <h1 className="text-[32px] sm:text-[42px] lg:text-[48px] font-extrabold tracking-[-0.03em] leading-[1.05] text-bolt-elements-textPrimary">
                  Build production apps
                  <br />
                  <span className="bg-gradient-to-r from-accent-600 via-violet-600 to-cyan-500 bg-clip-text text-transparent">
                    at lightspeed.
                  </span>
                </h1>
                <p className="mt-4 text-[15px] sm:text-[16px] leading-relaxed text-bolt-elements-textSecondary max-w-[560px] mx-auto">
                  <span className="font-semibold text-bolt-elements-textPrimary">LS Build</span> is the enterprise-grade AI builder — prompt, run, edit and ship full-stack apps directly in your browser. No setup. Just ship.
                </p>

                {/* Trust row */}
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-medium">
                    <span className="i-ph:lightning text-sm" /> Powered by WebContainers
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                    <span className="i-ph:shield-check text-sm text-green-500" /> Enterprise-grade
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300">
                    <span className="i-ph:code text-sm text-accent-500" /> Full-stack in browser
                  </span>
                </div>
              </div>
            )}

            <div
              className={classNames('pt-6 px-6', {
                'h-full flex flex-col': chatStarted,
              })}
            >
              <ClientOnly>
                {() => {
                  return chatStarted ? (
                    <Messages
                      ref={messageRef}
                      className="flex flex-col w-full flex-1 max-w-chat px-4 pb-6 mx-auto z-1"
                      messages={messages}
                      isStreaming={isStreaming}
                    />
                  ) : null;
                }}
              </ClientOnly>

              {/* Prompt Card — Enterprise Glass */}
              <div
                className={classNames('relative w-full max-w-chat mx-auto z-prompt', {
                  'sticky bottom-0': chatStarted,
                })}
              >
                <div className="relative group">
                  {/* Gradient border glow */}
                  <div className="absolute -inset-[1px] rounded-[20px] bg-gradient-to-r from-accent-500 via-violet-500 to-cyan-500 opacity-20 group-focus-within:opacity-40 blur-[1px] transition-opacity duration-300" />
                  <div className="relative rounded-[16px] sm:rounded-[20px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-[0_8px_40px_rgba(15,23,42,0.08),0_2px_8px_rgba(15,23,42,0.06)] dark:shadow-[0_8px_40px_rgba(0,0,0,0.35)] overflow-hidden backdrop-blur-xl">
                    {/* Top accent line */}
                    <div className="h-[2px] w-full bg-gradient-to-r from-accent-500 via-violet-500 to-cyan-500 opacity-60" />
                    <textarea
                      ref={textareaRef}
                      className="w-full pl-4 sm:pl-5 pt-4 pr-14 sm:pr-16 focus:outline-none resize-none text-[15px] leading-relaxed text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary bg-transparent"
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
                      placeholder="Describe what you want to build — LS Build will scaffold it instantly..."
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
                    <div className="flex flex-wrap justify-between items-center gap-2 text-sm p-3 sm:p-4 pt-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                      <div className="flex gap-2 items-center">
                        <IconButton
                          title="Enhance prompt"
                          disabled={input.length === 0 || enhancingPrompt}
                          className={classNames('rounded-full! px-3! py-1.5! text-xs! font-medium! border transition-all', {
                            'opacity-100! bg-accent-50 border-accent-200 text-accent-700 dark:bg-accent-500/10 dark:border-accent-500/20 dark:text-accent-300': promptEnhanced,
                            'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600': !promptEnhanced,
                          })}
                          onClick={() => enhancePrompt?.()}
                        >
                          {enhancingPrompt ? (
                            <>
                              <div className="i-svg-spinners:90-ring-with-bg text-accent-500 text-base" />
                              <div className="ml-1.5 hidden sm:inline">Enhancing…</div>
                            </>
                          ) : (
                            <>
                              <div className="i-ph:sparkle text-sm" />
                              <span className="hidden sm:inline ml-1">Enhance</span>
                              {promptEnhanced && <span className="ml-1 hidden sm:inline">✓ Enhanced</span>}
                            </>
                          )}
                        </IconButton>
                        <ClientOnly>{() => <ModelSelector disabled={isStreaming} />}</ClientOnly>
                      </div>
                      <div className="hidden sm:flex items-center gap-1.5 text-xs text-bolt-elements-textTertiary">
                        <span className="i-ph:keyboard text-sm opacity-60" />
                        <span>
                          <kbd className="kdb">Shift</kbd> + <kbd className="kdb">↵</kbd> new line • <kbd className="kdb">↵</kbd> send
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {!chatStarted && (
                  <div className="mt-3 flex items-center justify-center gap-3 text-xs text-bolt-elements-textTertiary">
                    <span className="inline-flex items-center gap-1">
                      <span className="i-ph:lock text-xs" /> Private by default
                    </span>
                    <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                    <span className="inline-flex items-center gap-1">
                      <span className="i-ph:lightning text-xs" /> No setup required
                    </span>
                    <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
                    <span className="inline-flex items-center gap-1">
                      <span className="i-ph:rocket text-xs" /> Deploy in one click
                    </span>
                  </div>
                )}

                <div className="bg-transparent pb-6" />
              </div>
            </div>

            {/* Example Prompts — Enterprise Cards */}
            {!chatStarted && (
              <div id="examples" className="relative w-full max-w-[720px] mx-auto mt-2 pb-8 px-6">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold tracking-widest uppercase text-bolt-elements-textTertiary">Try an example</p>
                  <span className="text-xs text-bolt-elements-textTertiary hidden sm:inline">Click to start building →</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {EXAMPLE_PROMPTS.map((ex, index) => (
                    <button
                      key={index}
                      onClick={(e) => sendMessage?.(e, ex.text)}
                      className="group relative text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)] dark:hover:shadow-[0_8px_24px_rgba(0,0,0,0.30)] hover:-translate-y-[1px] transition-all duration-200 overflow-hidden"
                    >
                      <div className={classNames('absolute inset-0 opacity-0 group-hover:opacity-[0.06] transition-opacity bg-gradient-to-br', ex.color)} />
                      <div className="relative flex items-start gap-3">
                        <div className={classNames('w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white shadow-sm bg-gradient-to-br', ex.color)}>
                          <span className={classNames(ex.icon, 'text-base')} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium leading-snug text-bolt-elements-textPrimary group-hover:text-accent-700 dark:group-hover:text-accent-300 transition-colors">
                            {ex.text}
                          </p>
                          <p className="text-xs text-bolt-elements-textTertiary mt-1">Ready to scaffold →</p>
                        </div>
                        <span className="i-ph:arrow-up-right text-bolt-elements-textTertiary group-hover:text-bolt-elements-textPrimary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0 mt-1" />
                      </div>
                    </button>
                  ))}
                </div>

                {/* Bottom feature strip */}
                <div className="mt-6 grid grid-cols-3 gap-3">
                  {[
                    { k: '10s', v: 'To first preview', icon: 'i-ph:timer' },
                    { k: '100%', v: 'In-browser', icon: 'i-ph:browser' },
                    { k: '∞', v: 'Deploy anywhere', icon: 'i-ph:cloud-arrow-up' },
                  ].map((s) => (
                    <div key={s.k} className="rounded-2xl bg-slate-900 text-white dark:bg-white dark:text-slate-900 p-3 sm:p-4 text-center">
                      <div className={classNames(s.icon, 'mx-auto text-lg opacity-80 mb-1')} />
                      <div className="text-lg font-extrabold leading-none tracking-tight">{s.k}</div>
                      <div className="text-xs opacity-70 font-medium">{s.v}</div>
                    </div>
                  ))}
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
