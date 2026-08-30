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

  // Group models by provider
  const providers = ['NVIDIA', 'Meta', 'Poolside'] as const;

  return (
    <div className={classNames('relative inline-flex items-center gap-1.5', className)}>
      <div className="flex items-center gap-1 text-xs text-bolt-elements-textSecondary pl-1">
        <div className="i-ph:cpu text-bolt-elements-item-contentAccent text-sm" />
        <span className="font-medium hidden sm:inline">Model:</span>
      </div>
      <div className="relative">
        <select
          value={currentModel}
          disabled={disabled}
          onChange={(e) => setModel(e.target.value)}
          aria-label="Select NVIDIA NIM Model"
          className="appearance-none bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary text-xs rounded-md pl-2.5 pr-7 py-1 border border-bolt-elements-borderColor focus:outline-none focus:border-bolt-elements-item-contentAccent cursor-pointer transition-colors"
        >
          {providers.map((provider) => {
            const modelsInProvider = SUPPORTED_MODELS.filter((m) => m.provider === provider);
            if (modelsInProvider.length === 0) return null;

            return (
              <optgroup key={provider} label={`NVIDIA NIM • ${provider}`}>
                {modelsInProvider.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label} {model.badge ? `(${model.badge})` : ''}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1.5 text-bolt-elements-textTertiary">
          <div className="i-ph:caret-down text-xs" />
        </div>
      </div>
    </div>
  );
});
