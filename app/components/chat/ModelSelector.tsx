import { useStore } from '@nanostores/react';
import React, { memo } from 'react';
import { modelStore, setModel, SUPPORTED_MODELS } from '~/lib/stores/model';
import { classNames } from '~/utils/classNames';

interface ModelSelectorProps {
  className?: string;
  disabled?: boolean;
}

export const ModelSelector = memo(({ className, disabled = false }: ModelSelectorProps) => {
  const currentModel = useStore(modelStore);
  const providers = ['NVIDIA', 'Meta', 'Poolside'] as const;

  return (
    <div className={classNames('relative inline-flex items-center gap-2', className)}>
      <span className="text-[12px] text-[#8a8a8a]">Model</span>
      <div className="relative">
        <select
          value={currentModel}
          disabled={disabled}
          onChange={(e) => setModel(e.target.value)}
          aria-label="Select Model"
          className="appearance-none bg-[#1c1c1c] hover:bg-[#242424] text-[#e8e8e8] text-[12px] rounded-[6px] pl-2 pr-6 py-1 border border-[#2a2a2a] focus:outline-none focus:border-[#2a2a2a] cursor-pointer"
        >
          {providers.map((provider) => {
            const modelsInProvider = SUPPORTED_MODELS.filter((m) => m.provider === provider);
            if (modelsInProvider.length === 0) return null;
            return (
              <optgroup key={provider} label={provider}>
                {modelsInProvider.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} {model.badge ? `(${model.badge})` : ''}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-1.5 text-[#5c5c5c]">
          <div className="i-ph:caret-down text-xs" />
        </div>
      </div>
    </div>
  );
});
