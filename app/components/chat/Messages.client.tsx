import type { Message } from 'ai';
import React from 'react';
import { classNames } from '~/utils/classNames';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';

interface MessagesProps {
  id?: string;
  className?: string;
  isStreaming?: boolean;
  messages?: Message[];
}

export const Messages = React.forwardRef<HTMLDivElement, MessagesProps>((props: MessagesProps, ref) => {
  const { id, isStreaming = false, messages = [] } = props;

  return (
    <div id={id} ref={ref} className={props.className}>
      {messages.length > 0
        ? messages.map((message, index) => {
            const { role, content } = message;
            const isUserMessage = role === 'user';
            const isFirst = index === 0;
            const isLast = index === messages.length - 1;

            return (
              <div
                key={index}
                className={classNames('flex gap-4 p-5 w-full rounded-2xl border transition-all', {
                  'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm': isUserMessage,
                  'bg-slate-50 dark:bg-slate-900/50 border-slate-100 dark:border-slate-800/50': !isUserMessage && (!isStreaming || (isStreaming && !isLast)),
                  'bg-gradient-to-b from-slate-50 dark:from-slate-900/50 to-transparent border-transparent':
                    !isUserMessage && isStreaming && isLast,
                  'mt-4': !isFirst,
                })}
              >
                <div
                  className={classNames(
                    'flex items-center justify-center w-8 h-8 rounded-xl shrink-0 self-start shadow-sm border',
                    isUserMessage
                      ? 'bg-gradient-to-br from-accent-600 to-violet-600 text-white border-white/20'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700',
                  )}
                >
                  <div className={classNames('text-sm', isUserMessage ? 'i-ph:user-fill' : 'i-ph:sparkle-fill')} />
                </div>
                <div className="grid grid-col-1 w-full min-w-0">
                  {isUserMessage ? <UserMessage content={content} /> : <AssistantMessage content={content} />}
                </div>
              </div>
            );
          })
        : null}
      {isStreaming && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <span className="w-2 h-2 rounded-full bg-accent-500 animate-bounce [animation-delay:-0.3s]" />
          <span className="w-2 h-2 rounded-full bg-violet-500 animate-bounce [animation-delay:-0.15s]" />
          <span className="w-2 h-2 rounded-full bg-cyan-500 animate-bounce" />
          <span className="ml-2 text-xs font-medium tracking-wide text-slate-500 dark:text-slate-400">LS Build is building…</span>
        </div>
      )}
    </div>
  );
});
