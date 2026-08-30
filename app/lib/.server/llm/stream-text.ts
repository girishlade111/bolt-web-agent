import { streamText as _streamText, convertToCoreMessages } from 'ai';
import { getAPIKey } from '~/lib/.server/llm/api-key';
import { getNvidiaModel } from '~/lib/.server/llm/model';
import { DEFAULT_MODEL, MAX_TOKENS } from './constants';
import { getSystemPrompt } from './prompts';

interface ToolResult<Name extends string, Args, Result> {
  toolCallId: string;
  toolName: Name;
  args: Args;
  result: Result;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolInvocations?: ToolResult<string, unknown, unknown>[];
}

export type Messages = Message[];

export type StreamingOptions = Omit<Parameters<typeof _streamText>[0], 'model'>;

export function streamText(
  messages: Messages,
  env: Env,
  options?: StreamingOptions,
  modelName: string = DEFAULT_MODEL,
) {
  const apiKey = getAPIKey(env);

  if (!apiKey) {
    throw new Error('NVIDIA_API_KEY is not set. Please add NVIDIA_API_KEY to your .env.local file and restart the dev server.');
  }

  return _streamText({
    model: getNvidiaModel(apiKey, modelName),
    system: getSystemPrompt(),
    maxTokens: MAX_TOKENS,
    messages: convertToCoreMessages(messages),
    ...options,
  });
}
