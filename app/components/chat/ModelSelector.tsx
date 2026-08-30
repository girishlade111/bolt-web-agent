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
    <div className={classNames('relative inline-flex items-center gap-1.5', className)}>
      <div className="hidden sm:flex items-center gap-1 text-xs font-medium text-bolt-elements-textTertiary">
        <span className="w-6 h-6 rounded-full bg-accent-50 dark:bg-accent-500/10 border border-accent-200 dark:border-accent-500/20 flex items-center justify-center">
          <span className="i-ph:cpu text-accent-600 dark:text-accent-400 text-xs" />
        </span>
      </div>
      <div className="relative">
        <select
          value={currentModel}
          disabled={disabled}
          onChange={(e) => setModel(e.target.value)}
          aria-label="Select NVIDIA NIM Model"
          className="appearance-none bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-bolt-elements-textPrimary text-xs font-medium rounded-full pl-3 pr-7 py-1.5 border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-accent-300 dark:focus:border-accent-500/50 focus:ring-2 focus:ring-accent-500/10 cursor-pointer transition-all shadow-sm"
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
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-bolt-elements-textTertiary">
          <div className="i-ph:caret-down text-xs" />
        </div>
      </div>
    </div>
  );
});
