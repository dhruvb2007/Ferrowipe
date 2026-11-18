import React from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DiscoverButtonProps {
  label?: string;
  onClick?: () => void;
  className?: string;
  icon?: React.ReactNode;
}

export const DiscoverButton: React.FC<DiscoverButtonProps> = ({
  label = 'Quick Junk Scan',
  onClick,
  className,
  icon,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('obs-discover-btn', className)}
    >
      <span className="obs-discover-btn__fill" aria-hidden="true" />
      <span className="obs-discover-btn__icon" aria-hidden="true">
        {icon ?? <ArrowRight className="h-4 w-4 stroke-[2.25]" />}
      </span>
      <span className="obs-discover-btn__text">{label}</span>
    </button>
  );
};
