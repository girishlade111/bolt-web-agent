import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/.server/llm/prompts';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import { appendRateLimitHeaders, checkRateLimit, createRateLimitResponse } from '~/lib/.server/rate-limiter';

export async function action(args: ActionFunctionArgs) {
  const rateLimit = await checkRateLimit(args.request, args.context.cloudflare.env as any);

  if (!rateLimit.allowed) {
    return createRateLimitResponse(rateLimit);
  }

  // Auto-provision Supabase if prompt indicates DB need or explicit toggle.
  // This keeps /api/chat safe to call even when client hasn't pre-provisioned;
  // the actual .env injection is done client-side via /api/supabase, but we
  // ensure the project exists session-scoped so LLM can use it.
  try {
    const cloned = args.request.clone();
    const body = (await cloned.json().catch(() => ({}))) as {
      messages?: Messages;
      enableSupabase?: boolean;
    };
    const lastPrompt = body.messages?.filter((m) => m.role === 'user').slice(-1)[0]?.content ?? '';
    const explicit = Boolean(body.enableSupabase);
    if (lastPrompt || explicit) {
      const { ensureSupabaseProject } = await import('~/lib/.server/supabase');
      await ensureSupabaseProject({
        sessionId: rateLimit.sessionId,
        env: args.context.cloudflare.env as Env,
        prompt: lastPrompt,
        explicitToggle: explicit,
      });
    }
  } catch (e) {
    console.warn('[api.chat] supabase auto-provision check failed', e);
  }

  const response = await chatAction(args);

  appendRateLimitHeaders(response, rateLimit);

  return response;
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  const { messages, model, enableSupabase } = (await request.json()) as {
    messages: Messages;
    model?: string;
    enableSupabase?: boolean;
  };

  const stream = new SwitchableStream();

  try {
    const options: StreamingOptions = {
      toolChoice: 'none',
      onFinish: async ({ text: content, finishReason }) => {
        if (finishReason !== 'length') {
          return stream.close();
        }

        if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
          throw Error('Cannot continue message: Maximum segments reached');
        }

        const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

        console.log(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

        messages.push({ role: 'assistant', content });
        messages.push({ role: 'user', content: CONTINUE_PROMPT });

        const result = await streamText(messages, context.cloudflare.env, options, model);

        return stream.switchSource(result.toAIStream());
      },
    };

    const result = await streamText(messages, context.cloudflare.env, options, model);

    stream.switchSource(result.toAIStream());

    return new Response(stream.readable, {
      status: 200,
      headers: {
        contentType: 'text/plain; charset=utf-8',
      },
    });
  } catch (error) {
    console.error('Chat API Error:', error);

    throw new Response(null, {
      status: 500,
      statusText: 'Internal Server Error',
    });
  }
}
