import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

type Listener = (items: ToastItem[]) => void;

let nextId = 1;
let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l([...toasts]));
}

function pushToast(tone: ToastTone, title: string, description?: string) {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, tone, title, description }];
  emit();
  window.setTimeout(() => {
    dismissToast(id);
  }, 3800);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export const obsidianToast = {
  success: (title: string, opts?: { description?: string }) =>
    pushToast('success', title, opts?.description),
  error: (title: string, opts?: { description?: string }) =>
    pushToast('error', title, opts?.description),
  info: (title: string, opts?: { description?: string }) =>
    pushToast('info', title, opts?.description),
  warning: (title: string, opts?: { description?: string }) =>
    pushToast('warning', title, opts?.description),
};

const TONE_ICON: Record<ToastTone, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-[var(--obs-success)] shrink-0" />,
  error: <AlertCircle className="h-4 w-4 text-[var(--obs-danger)] shrink-0" />,
  warning: <AlertTriangle className="h-4 w-4 text-[var(--obs-warning)] shrink-0" />,
  info: <Info className="h-4 w-4 text-[var(--obs-accent)] shrink-0" />,
};

export const ObsidianToaster: React.FC = () => {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-2rem)] pointer-events-none">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.div
            key={item.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.94, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: 10, scale: 0.96, filter: 'blur(4px)' }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'obs-menu pointer-events-auto rounded-xl px-3.5 py-3 flex items-start gap-2.5 text-xs'
            )}
          >
            <div className="mt-0.5">{TONE_ICON[item.tone]}</div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-[var(--obs-fg)] leading-snug">{item.title}</p>
              {item.description && (
                <p className="text-[11px] text-[var(--obs-text-muted)] mt-0.5 truncate font-mono">
                  {item.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(item.id)}
              className="text-[var(--obs-text-subtle)] hover:text-[var(--obs-fg)] p-0.5 rounded transition-colors shrink-0"
              aria-label="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
