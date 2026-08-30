import { memo } from 'react';
import { classNames } from '~/utils/classNames';

type IconSize = 'sm' | 'md' | 'lg' | 'xl' | 'xxl';

interface BaseIconButtonProps {
  size?: IconSize;
  className?: string;
  iconClassName?: string;
  disabledClassName?: string;
  title?: string;
  disabled?: boolean;
  onClick?: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
}

type IconButtonWithoutChildrenProps = {
  icon: string;
  children?: undefined;
} & BaseIconButtonProps;

type IconButtonWithChildrenProps = {
  icon?: undefined;
  children: string | JSX.Element | JSX.Element[];
} & BaseIconButtonProps;

type IconButtonProps = IconButtonWithoutChildrenProps | IconButtonWithChildrenProps;

export const IconButton = memo(
  ({
    icon,
    size = 'xl',
    className,
    iconClassName,
    disabledClassName,
    disabled = false,
    title,
    onClick,
    children,
  }: IconButtonProps) => {
    return (
      <button
        className={classNames(
          'flex items-center justify-center bg-[#1c1c1c] border border-[#2a2a2a] rounded-[6px] px-2 py-1 text-[#8a8a8a] hover:bg-[#242424] hover:text-[#e8e8e8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
          className,
        )}
        title={title}
        disabled={disabled}
        onClick={(event) => {
          if (disabled) return;
          onClick?.(event);
        }}
      >
        {children ? children : <div className={classNames(icon, getIconSize(size), iconClassName, 'opacity-70')}></div>}
      </button>
    );
  },
);

function getIconSize(size: IconSize) {
  if (size === 'sm') return 'text-sm';
  else if (size === 'md') return 'text-sm';
  else if (size === 'lg') return 'text-sm';
  else if (size === 'xl') return 'text-base';
  else return 'text-lg';
}
