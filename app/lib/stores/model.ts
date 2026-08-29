import { atom } from 'nanostores';

export interface ModelInfo {
  id: string;
  label: string;
  provider: 'Qwen' | 'DeepSeek' | 'Kimi' | 'GLM' | 'MiniMax' | 'Meta' | 'NVIDIA';
  badge?: string;
}

export const SUPPORTED_MODELS: ModelInfo[] = [
  // Qwen Series
  { id: 'qwen/qwen2.5-coder-32b-instruct', label: 'Qwen 2.5 Coder 32B', provider: 'Qwen', badge: 'Top Coder' },
  { id: 'qwen/qwen2.5-72b-instruct', label: 'Qwen 2.5 72B', provider: 'Qwen', badge: 'Flagship' },
  { id: 'qwen/qwq-32b', label: 'QwQ 32B Reasoning', provider: 'Qwen', badge: 'Reasoning' },

  // DeepSeek Series
  { id: 'deepseek-ai/deepseek-r1', label: 'DeepSeek R1', provider: 'DeepSeek', badge: 'Reasoning' },
  { id: 'deepseek-ai/deepseek-v3', label: 'DeepSeek V3', provider: 'DeepSeek', badge: 'Flagship' },
  { id: 'deepseek-ai/deepseek-r1-distill-qwen-32b', label: 'DeepSeek R1 Distill Qwen 32B', provider: 'DeepSeek', badge: 'Fast Code' },
  { id: 'deepseek-ai/deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill Llama 70B', provider: 'DeepSeek' },

  // Kimi (Moonshot AI)
  { id: 'moonshotai/moonshot-v1-8k', label: 'Kimi Moonshot 8K', provider: 'Kimi' },
  { id: 'moonshotai/moonshot-v1-32k', label: 'Kimi Moonshot 32K', provider: 'Kimi' },
  { id: 'moonshotai/moonshot-v1-128k', label: 'Kimi Moonshot 128K', provider: 'Kimi', badge: 'Long Context' },
  { id: 'moonshotai/kimi-k3', label: 'Kimi K3', provider: 'Kimi', badge: 'New' },

  // GLM (Zhipu AI)
  { id: 'thudm/glm-4-9b-chat', label: 'GLM-4 9B Chat', provider: 'GLM' },
  { id: 'zhipuai/glm-4-9b-chat', label: 'Zhipu GLM-4 9B', provider: 'GLM' },
  { id: 'zhipuai/glm-5', label: 'Zhipu GLM 5', provider: 'GLM', badge: 'New' },

  // MiniMax
  { id: 'minimax/minimax-01', label: 'MiniMax 01', provider: 'MiniMax' },
  { id: 'minimax/abab6.5s-chat', label: 'MiniMax abab 6.5s', provider: 'MiniMax' },
  { id: 'minimax/minimax-m3', label: 'MiniMax M3', provider: 'MiniMax', badge: 'Multimodal' },

  // Meta & NVIDIA Flagship
  { id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct', provider: 'Meta', badge: 'Popular' },
  { id: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'Nemotron 70B Instruct', provider: 'NVIDIA' },
];

export const DEFAULT_MODEL = 'qwen/qwen2.5-coder-32b-instruct';
export const kModel = 'bolt_nvidia_model';

export const modelStore = atom<string>(initStore());

function initStore() {
  if (!import.meta.env.SSR) {
    const persistedModel = localStorage.getItem(kModel);
    if (persistedModel && SUPPORTED_MODELS.some((m) => m.id === persistedModel)) {
      return persistedModel;
    }
  }

  return DEFAULT_MODEL;
}

export function setModel(modelId: string) {
  modelStore.set(modelId);
  if (!import.meta.env.SSR) {
    localStorage.setItem(kModel, modelId);
  }
}
