import { atom } from 'nanostores';

export interface ModelInfo {
  id: string;
  label: string;
  provider: 'NVIDIA' | 'Meta' | 'Poolside';
  badge?: string;
}

export const SUPPORTED_MODELS: ModelInfo[] = [
  // NVIDIA Nemotron Series
  { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', label: 'Nemotron 3.5 Lightning 30B', provider: 'NVIDIA', badge: 'Recommended' },
  { id: 'nvidia/nemotron-3-nano-30b-a3b', label: 'Nemotron 3 Nano 30B', provider: 'NVIDIA', badge: 'Fast' },
  { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B', provider: 'NVIDIA', badge: 'Reasoning' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b', label: 'Nemotron 3 Ultra 550B', provider: 'NVIDIA', badge: 'Flagship' },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', label: 'Nemotron Nano Omni', provider: 'NVIDIA', badge: 'Reasoning' },

  // Meta Series
  { id: 'meta/llama-3.2-11b-vision-instruct', label: 'Llama 3.2 11B Vision', provider: 'Meta', badge: 'Vision' },
  { id: 'meta/llama-3.2-90b-vision-instruct', label: 'Llama 3.2 90B Vision', provider: 'Meta', badge: 'Flagship Vision' },

  // Poolside Series
  { id: 'poolside/laguna-xs-2.1', label: 'Laguna XS 2.1', provider: 'Poolside', badge: 'Coder' },
];

export const DEFAULT_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b';
export const kModel = 'bolt_nvidia_model';

export const modelStore = atom<string>(initStore());

function initStore() {
  if (!import.meta.env.SSR) {
    const persistedModel = localStorage.getItem(kModel);
    if (persistedModel && SUPPORTED_MODELS.some((m) => m.id === persistedModel)) {
      return persistedModel;
    }
    localStorage.setItem(kModel, DEFAULT_MODEL);
  }

  return DEFAULT_MODEL;
}

export function setModel(modelId: string) {
  modelStore.set(modelId);
  if (!import.meta.env.SSR) {
    localStorage.setItem(kModel, modelId);
  }
}
