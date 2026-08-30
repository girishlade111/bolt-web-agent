import { classNames } from '~/utils/classNames';

interface SupabaseToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  disabled?: boolean;
}

export function SupabaseToggle({ enabled, onToggle, disabled }: SupabaseToggleProps) {
  return (
    <label
      className={classNames(
        'flex items-center gap-2 rounded-[6px] border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer select-none',
        enabled
          ? 'bg-[#1c2b1c]! border-[#2a4a2a]! text-[#7fc87f]!'
          : 'bg-[#1c1c1c] border-[#2a2a2a] text-[#8a8a8a] hover:text-[#e8e8e8] hover:bg-[#242424]',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
      )}
      title={enabled ? 'Supabase database will be provisioned for this session' : 'Add Supabase database to your app'}
    >
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => onToggle(e.target.checked)}
        disabled={disabled}
        className="sr-only"
      />
      <div className={classNames('w-3 h-3 rounded-[2px] border flex items-center justify-center', enabled ? 'bg-[#2a5a2a] border-[#3a7a3a]' : 'border-[#3a3a3a] bg-transparent')}>
        {enabled && <div className="i-ph:check-bold text-[10px] text-[#7fc87f]" />}
      </div>
      <span className="flex items-center gap-1">
        <span className="i-ph:database text-xs opacity-70" />
        Database
      </span>
    </label>
  );
}
