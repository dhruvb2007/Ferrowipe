import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown, Minus, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/* ============================================================================
   ObsidianButton
   ============================================================================ */
export interface ObsidianButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'accent' | 'control' | 'muted' | 'ghost' | 'danger' | 'outline';
  size?: 'xs' | 'sm' | 'md' | 'icon';
}

export const ObsidianButton = React.forwardRef<HTMLButtonElement, ObsidianButtonProps>(
  ({ variant = 'control', size = 'sm', className, children, disabled, ...props }, ref) => {
    const variantStyles: Record<NonNullable<ObsidianButtonProps['variant']>, string> = {
      accent: 'obs-accent-btn font-semibold',
      control:
        'obs-control text-[var(--obs-fg)] hover:bg-[var(--obs-muted)] font-medium',
      muted:
        'bg-[var(--obs-muted)] text-[var(--obs-fg)] hover:bg-[var(--obs-muted-hover)] font-medium',
      ghost:
        'bg-transparent text-[var(--obs-text-muted)] hover:text-[var(--obs-fg)] hover:bg-[var(--obs-hover)] font-medium',
      danger: 'obs-danger-btn font-semibold',
      outline:
        'bg-transparent border border-[var(--obs-border-strong)] text-[var(--obs-fg)] hover:bg-[var(--obs-hover)] font-medium',
    };

    const sizeStyles: Record<NonNullable<ObsidianButtonProps['size']>, string> = {
      xs: 'h-7 px-2.5 text-[11px] rounded-lg gap-1.5',
      sm: 'h-8 px-3 text-xs rounded-[9px] gap-1.5',
      md: 'h-9 px-4 text-xs rounded-[10px] gap-2',
      icon: 'h-8 w-8 rounded-[9px] justify-center p-0',
    };

    return (
      <button
        ref={ref}
        type={props.type ?? 'button'}
        disabled={disabled}
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap transition-all duration-150 select-none active:scale-[0.98] disabled:opacity-45 disabled:pointer-events-none',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);
ObsidianButton.displayName = 'ObsidianButton';

/* ============================================================================
   ObsidianBadge
   ============================================================================ */
export interface ObsidianBadgeProps {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  className?: string;
}

export const ObsidianBadge: React.FC<ObsidianBadgeProps> = ({
  children,
  tone = 'neutral',
  className,
}) => {
  const tones: Record<NonNullable<ObsidianBadgeProps['tone']>, string> = {
    neutral: 'bg-[var(--obs-muted)] text-[var(--obs-text-muted)] border-[var(--obs-border)]',
    accent:
      'bg-[var(--obs-accent-soft)] text-[var(--obs-accent)] border-[var(--obs-accent-border)]',
    success:
      'bg-[var(--obs-success-soft)] text-[var(--obs-success)] border-[var(--obs-success)]/25',
    warning:
      'bg-[var(--obs-warning-soft)] text-[var(--obs-warning)] border-[var(--obs-warning)]/25',
    danger:
      'bg-[var(--obs-danger-soft)] text-[var(--obs-danger)] border-[var(--obs-danger)]/25',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
};

/* ============================================================================
   ObsidianProgress
   ============================================================================ */
export interface ObsidianProgressProps {
  value: number;
  tone?: 'accent' | 'success' | 'warning' | 'danger';
  className?: string;
}

export const ObsidianProgress: React.FC<ObsidianProgressProps> = ({
  value,
  tone = 'accent',
  className,
}) => {
  const clamped = Math.max(0, Math.min(100, value));
  const barColors = {
    accent: 'bg-[var(--obs-accent)]',
    success: 'bg-[var(--obs-success)]',
    warning: 'bg-[var(--obs-warning)]',
    danger: 'bg-[var(--obs-danger)]',
  };

  return (
    <div
      className={cn(
        'w-full h-2 rounded-full bg-[var(--obs-muted)] overflow-hidden',
        className
      )}
    >
      <motion.div
        initial={false}
        animate={{ width: `${clamped}%` }}
        transition={{ duration: 0.45, ease: EASE_OUT }}
        className={cn('h-full rounded-full', barColors[tone])}
      />
    </div>
  );
};

/* ============================================================================
   ObsidianCheckbox
   ============================================================================ */
export interface ObsidianCheckboxProps {
  checked: boolean | 'indeterminate';
  onChange: () => void;
  className?: string;
  stopPropagation?: boolean;
}

export const ObsidianCheckbox: React.FC<ObsidianCheckboxProps> = ({
  checked,
  onChange,
  className,
  stopPropagation = false,
}) => {
  const isActive = checked === true || checked === 'indeterminate';

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked === 'indeterminate' ? 'mixed' : checked}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation();
        onChange();
      }}
      className={cn(
        'h-4 w-4 rounded-[5px] border flex items-center justify-center transition-all shrink-0',
        isActive
          ? 'bg-[var(--obs-accent)] border-[var(--obs-accent)] text-white shadow-sm'
          : 'bg-[var(--obs-control)] border-[var(--obs-border-strong)] hover:border-[var(--obs-text-subtle)]',
        className
      )}
    >
      {checked === true && <Check className="h-3 w-3 stroke-[3]" />}
      {checked === 'indeterminate' && <Minus className="h-3 w-3 stroke-[3]" />}
    </button>
  );
};

/* ============================================================================
   ObsidianSwitch
   ============================================================================ */
export interface ObsidianSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  id?: string;
}

export const ObsidianSwitch: React.FC<ObsidianSwitchProps> = ({ checked, onChange, id }) => {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors p-0.5',
        checked
          ? 'bg-[var(--obs-danger)] border-[var(--obs-danger)]'
          : 'bg-[var(--obs-muted)] border-[var(--obs-border-strong)]'
      )}
    >
      <motion.span
        layout
        transition={{ type: 'spring', stiffness: 520, damping: 32 }}
        className={cn(
          'block h-3.5 w-3.5 rounded-full bg-white shadow-sm',
          checked ? 'ml-auto' : 'mr-auto'
        )}
      />
    </button>
  );
};

/* ============================================================================
   ObsidianSegmentedTabs (Spring sliding pill via layoutId)
   ============================================================================ */
export interface SegmentedTabItem<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

export function ObsidianSegmentedTabs<T extends string>({
  items,
  value,
  onChange,
  layoutId,
}: {
  items: SegmentedTabItem<T>[];
  value: T;
  onChange: (val: T) => void;
  layoutId: string;
}) {
  return (
    <div className="inline-flex items-center p-1 rounded-[10px] bg-[var(--obs-muted)] border border-[var(--obs-border)]">
      {items.map((item) => {
        const isActive = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={cn(
              'relative px-3 h-7 rounded-[7px] text-xs font-medium inline-flex items-center gap-1.5 transition-colors z-10',
              isActive
                ? 'text-[var(--obs-fg)]'
                : 'text-[var(--obs-text-muted)] hover:text-[var(--obs-fg)]'
            )}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                className="absolute inset-0 rounded-[7px] obs-control -z-10"
              />
            )}
            {item.icon}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================================
   ObsidianSelect (Frosted glass Obsidian dropdown with blur+spring reveal)
   ============================================================================ */
export interface ObsidianSelectOption {
  value: string;
  label: string;
}

export const ObsidianSelect: React.FC<{
  value: string;
  options: ObsidianSelectOption[];
  onChange: (value: string) => void;
  prefix?: string;
  className?: string;
}> = ({ value, options, onChange, prefix, className }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const activeLabel = options.find((o) => o.value === value)?.label ?? value;

  return (
    <div ref={containerRef} className={cn('relative inline-block', className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="obs-control h-8 px-2.5 rounded-[9px] text-xs inline-flex items-center justify-between gap-2 min-w-[132px] text-[var(--obs-fg)] hover:bg-[var(--obs-muted)] transition-colors"
      >
        <span className="truncate">
          {prefix && <span className="text-[var(--obs-text-muted)] mr-1">{prefix}</span>}
          <span className="font-medium">{activeLabel}</span>
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 text-[var(--obs-text-muted)] transition-transform shrink-0',
            open && 'rotate-180'
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: -4, filter: 'blur(6px)' }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.96, y: -2, filter: 'blur(4px)' }}
            transition={{ duration: 0.16, ease: EASE_OUT }}
            className="obs-menu absolute left-0 mt-1.5 min-w-[160px] rounded-xl p-1 z-50"
          >
            {options.map((opt) => {
              const selected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full px-2.5 py-1.5 rounded-lg text-xs text-left flex items-center justify-between gap-2 transition-colors',
                    selected
                      ? 'bg-[var(--obs-menu-highlight)] text-[var(--obs-fg)] font-medium'
                      : 'text-[var(--obs-text-muted)] hover:bg-[var(--obs-menu-highlight)] hover:text-[var(--obs-fg)]'
                  )}
                >
                  <span>{opt.label}</span>
                  {selected && <Check className="h-3.5 w-3.5 text-[var(--obs-accent)] shrink-0" />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ============================================================================
   ObsidianActionMenu (Frosted glass popover menu for row actions)
   ============================================================================ */
export interface ActionMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  dividerBefore?: boolean;
}

export const ObsidianActionMenu: React.FC<{
  trigger: React.ReactNode;
  items: ActionMenuItem[];
}> = ({ trigger, items }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      <div onClick={() => setOpen((v) => !v)}>{trigger}</div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: -4, filter: 'blur(6px)' }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.96, y: -2, filter: 'blur(4px)' }}
            transition={{ duration: 0.15, ease: EASE_OUT }}
            className="obs-menu absolute right-0 mt-1.5 w-44 rounded-xl p-1 z-50"
          >
            {items.map((item, idx) => (
              <React.Fragment key={idx}>
                {item.dividerBefore && (
                  <div className="my-1 h-px bg-[var(--obs-border)]" />
                )}
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    item.onClick();
                  }}
                  className={cn(
                    'w-full px-2.5 py-1.5 rounded-lg text-xs flex items-center gap-2 transition-colors text-left',
                    item.danger
                      ? 'text-[var(--obs-danger)] hover:bg-[var(--obs-danger-soft)]'
                      : 'text-[var(--obs-fg)] hover:bg-[var(--obs-menu-highlight)]'
                  )}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              </React.Fragment>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ============================================================================
   ObsidianModal (Spring-animated blurred dialog matching ObsidianUI)
   ============================================================================ */
export const ObsidianModal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  maxWidthClass?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({
  open,
  onClose,
  title,
  description,
  icon,
  maxWidthClass = 'max-w-md',
  children,
  footer,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/65 backdrop-blur-sm"
          />

          {/* Dialog Surface */}
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, scale: 0.94, y: 8, filter: 'blur(8px)' }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.96, y: 4, filter: 'blur(4px)' }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            className={cn(
              'obs-menu relative z-10 w-full rounded-2xl overflow-hidden flex flex-col max-h-[86vh]',
              maxWidthClass
            )}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-[var(--obs-border)] flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {icon}
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--obs-fg)] tracking-tight truncate">
                    {title}
                  </h3>
                  {description && (
                    <p className="text-xs text-[var(--obs-text-muted)] mt-0.5 truncate">
                      {description}
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-[var(--obs-text-muted)] hover:text-[var(--obs-fg)] hover:bg-[var(--obs-hover)] transition-colors shrink-0"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 overflow-y-auto obs-scroll flex-1">{children}</div>

            {/* Footer */}
            {footer && (
              <div className="px-5 py-3.5 border-t border-[var(--obs-border)] bg-[var(--obs-bg)]/40 flex items-center justify-end gap-2">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

/* ============================================================================
   ObsidianStatusDot (Live ping dot matching ObsidianUI Active Sessions)
   ============================================================================ */
export const ObsidianStatusDot: React.FC<{
  tone?: 'success' | 'warning' | 'accent' | 'danger';
  pulse?: boolean;
}> = ({ tone = 'success', pulse = true }) => {
  const colorMap = {
    success: 'bg-[var(--obs-success)]',
    warning: 'bg-[var(--obs-warning)]',
    accent: 'bg-[var(--obs-accent)]',
    danger: 'bg-[var(--obs-danger)]',
  };

  return (
    <span className="relative inline-flex h-2 w-2 shrink-0">
      {pulse && (
        <span
          className={cn(
            'absolute inline-flex h-full w-full rounded-full animate-obs-ping',
            colorMap[tone]
          )}
        />
      )}
      <span className={cn('relative inline-flex rounded-full h-2 w-2', colorMap[tone])} />
    </span>
  );
};
