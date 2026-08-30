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

            return (
              <div
                key={index}
                className={classNames('flex gap-3 w-full rounded-[8px] border bg-[#161616] border-[#2a2a2a] p-4', {
                  'mt-3': !isFirst,
                })}
              >
                <div
                  className={classNames(
                    'flex items-center justify-center w-7 h-7 rounded-[6px] shrink-0 self-start border text-xs',
                    isUserMessage
                      ? 'bg-[#1c1c1c] border-[#2a2a2a] text-[#8a8a8a]'
                      : 'bg-[#1c1c1c] border-[#2a2a2a] text-[#e07856]',
                  )}
                >
                  <div className={classNames('text-xs opacity-70', isUserMessage ? 'i-ph:user' : 'i-ph:sparkle')} />
                </div>
                <div className="grid grid-col-1 w-full min-w-0">
                  {isUserMessage ? <UserMessage content={content} /> : <AssistantMessage content={content} />}
                </div>
              </div>
            );
          })
        : null}
      {isStreaming && <div className="mt-3 text-[12px] text-[#8a8a8a] flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-[#e07856] animate-pulse" /> LS Build is thinking…</div>}
    </div>
  );
});
