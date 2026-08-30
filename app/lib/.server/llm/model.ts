import { createOpenAI } from '@ai-sdk/openai';
import { DEFAULT_MODEL } from './constants';

export const NVIDIA_MODELS = [
  // NVIDIA Nemotron Series
  { id: 'nvidia/nemotron-3.5-lightning-30b-a3b', label: 'Nemotron 3.5 Lightning 30B (Recommended)', provider: 'NVIDIA' },
  { id: 'nvidia/nemotron-3-nano-30b-a3b', label: 'Nemotron 3 Nano 30B', provider: 'NVIDIA' },
  { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B (Reasoning)', provider: 'NVIDIA' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b', label: 'Nemotron 3 Ultra 550B', provider: 'NVIDIA' },
  { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', label: 'Nemotron Nano Omni Reasoning', provider: 'NVIDIA' },

  // Meta Series
  { id: 'meta/llama-3.2-11b-vision-instruct', label: 'Llama 3.2 11B Vision', provider: 'Meta' },
  { id: 'meta/llama-3.2-90b-vision-instruct', label: 'Llama 3.2 90B Vision', provider: 'Meta' },

  // Poolside Series
  { id: 'poolside/laguna-xs-2.1', label: 'Laguna XS 2.1 (Coder)', provider: 'Poolside' },
];

export function getNvidiaModel(apiKey: string, modelName: string = DEFAULT_MODEL) {
  const isSupported = NVIDIA_MODELS.some((m) => m.id === modelName);
  const targetModel = isSupported ? modelName : DEFAULT_MODEL;

  const nvidia = createOpenAI({
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKey,
  });

  return nvidia(targetModel);
}

export function getModel(apiKey: string, modelName: string = DEFAULT_MODEL) {
  return getNvidiaModel(apiKey, modelName);
}
