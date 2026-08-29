import { createOpenAI } from '@ai-sdk/openai';
import { DEFAULT_MODEL } from './constants';

export const NVIDIA_MODELS = [
  // Qwen Series
  { id: 'qwen/qwen2.5-coder-32b-instruct', label: 'Qwen 2.5 Coder 32B (Recommended)', provider: 'Qwen' },
  { id: 'qwen/qwen2.5-72b-instruct', label: 'Qwen 2.5 72B Instruct', provider: 'Qwen' },
  { id: 'qwen/qwq-32b', label: 'QwQ 32B (Reasoning)', provider: 'Qwen' },

  // DeepSeek Series
  { id: 'deepseek-ai/deepseek-r1', label: 'DeepSeek R1 (Reasoning)', provider: 'DeepSeek' },
  { id: 'deepseek-ai/deepseek-v3', label: 'DeepSeek V3', provider: 'DeepSeek' },
  { id: 'deepseek-ai/deepseek-r1-distill-qwen-32b', label: 'DeepSeek R1 Distill Qwen 32B', provider: 'DeepSeek' },
  { id: 'deepseek-ai/deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill Llama 70B', provider: 'DeepSeek' },

  // Kimi (Moonshot AI)
  { id: 'moonshotai/moonshot-v1-8k', label: 'Kimi Moonshot v1 8K', provider: 'Kimi' },
  { id: 'moonshotai/moonshot-v1-32k', label: 'Kimi Moonshot v1 32K', provider: 'Kimi' },
  { id: 'moonshotai/moonshot-v1-128k', label: 'Kimi Moonshot v1 128K', provider: 'Kimi' },
  { id: 'moonshotai/kimi-k3', label: 'Kimi K3', provider: 'Kimi' },

  // GLM (Zhipu AI)
  { id: 'thudm/glm-4-9b-chat', label: 'GLM-4 9B Chat', provider: 'GLM' },
  { id: 'zhipuai/glm-4-9b-chat', label: 'Zhipu GLM-4 9B', provider: 'GLM' },
  { id: 'zhipuai/glm-5', label: 'Zhipu GLM 5', provider: 'GLM' },

  // MiniMax
  { id: 'minimax/minimax-01', label: 'MiniMax 01', provider: 'MiniMax' },
  { id: 'minimax/abab6.5s-chat', label: 'MiniMax abab 6.5s', provider: 'MiniMax' },
  { id: 'minimax/minimax-m3', label: 'MiniMax M3', provider: 'MiniMax' },

  // Meta & NVIDIA Flagship
  { id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct', provider: 'Meta' },
  { id: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'Nemotron 70B Instruct', provider: 'NVIDIA' },
];

export function getNvidiaModel(apiKey: string, modelName: string = DEFAULT_MODEL) {
  const nvidia = createOpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey,
  });

  return nvidia(modelName);
}

export function getModel(apiKey: string, modelName: string = DEFAULT_MODEL) {
  return getNvidiaModel(apiKey, modelName);
}
