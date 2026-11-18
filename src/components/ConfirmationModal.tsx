import React, { useState, useEffect } from 'react';
import { Trash2, ShieldCheck, Copy, Check } from 'lucide-react';
import { JunkItem } from '@/types';
import { formatBytes } from '@/utils';
import {
  ObsidianBadge,
  ObsidianButton,
  ObsidianModal,
} from '@/components/obsidian/ObsidianPrimitives';
import { obsidianToast } from '@/components/obsidian/ObsidianToast';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  totalBytes: number;
  totalFiles: number;
  categoryNames: string[];
  selectedItems?: JunkItem[];
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  totalBytes,
  totalFiles,
  categoryNames,
  selectedItems = [],
}) => {
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    if (isOpen) setCopiedAll(false);
  }, [isOpen]);

  const handleCopyAllPaths = () => {
    const paths = selectedItems.map((it) => it.path).filter(Boolean);
    if (paths.length === 0) return;
    navigator.clipboard.writeText(paths.join('\n'));
    setCopiedAll(true);
    obsidianToast.success(
      `Copied ${paths.length} deleting path${paths.length === 1 ? '' : 's'} to clipboard`
    );
    window.setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleCopySingle = (path: string) => {
    navigator.clipboard.writeText(path);
    obsidianToast.success('Path copied to clipboard', { description: path });
  };

  return (
    <ObsidianModal
      open={isOpen}
      onClose={onClose}
      maxWidthClass="max-w-lg"
      title="Confirm Disk Cleanup"
      description="Permanently remove selected junk caches and temp files"
      icon={
        <div className="h-9 w-9 rounded-xl bg-[var(--obs-danger-soft)] border border-[var(--obs-danger)]/25 text-[var(--obs-danger)] flex items-center justify-center shrink-0">
          <Trash2 className="h-4 w-4" />
        </div>
      }
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          {selectedItems.length > 0 ? (
            <ObsidianButton variant="control" size="sm" onClick={handleCopyAllPaths}>
              {copiedAll ? (
                <Check className="h-3.5 w-3.5 text-[var(--obs-success)]" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copiedAll ? 'Copied Paths!' : `Copy Paths (${selectedItems.length})`}
            </ObsidianButton>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <ObsidianButton variant="ghost" onClick={onClose}>
              Cancel
            </ObsidianButton>
            <ObsidianButton variant="danger" onClick={onConfirm}>
              <Trash2 className="h-3.5 w-3.5" />
              Proceed &amp; Clean
            </ObsidianButton>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Reclaimable Space Highlight */}
        <div className="rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/70 p-4 text-center space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--obs-text-muted)]">
            Estimated Space to Reclaim
          </p>
          <div className="text-3xl font-bold tracking-tight text-[var(--obs-accent)] tabular-nums">
            {formatBytes(totalBytes)}
          </div>
          <p className="text-xs text-[var(--obs-text-muted)] tabular-nums">
            Across {totalFiles.toLocaleString()} file{totalFiles === 1 ? '' : 's'} in{' '}
            {categoryNames.length} categor{categoryNames.length === 1 ? 'y' : 'ies'}
          </p>
        </div>

        {/* Selected Categories */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-[var(--obs-text-muted)]">Selected Targets</p>
          <div className="max-h-20 overflow-y-auto obs-scroll rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/50 p-2.5 flex flex-wrap gap-1.5">
            {categoryNames.map((name) => (
              <ObsidianBadge key={name} tone="neutral">
                {name}
              </ObsidianBadge>
            ))}
          </div>
        </div>

        {/* Deleting Paths Preview with Copy */}
        {selectedItems.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium text-[var(--obs-text-muted)]">
                Paths to Clean ({selectedItems.length})
              </p>
              <button
                type="button"
                onClick={handleCopyAllPaths}
                className="text-[11px] font-medium text-[var(--obs-accent)] hover:underline inline-flex items-center gap-1"
              >
                <Copy className="h-3 w-3" />
                Copy all
              </button>
            </div>
            <div className="max-h-36 overflow-y-auto obs-scroll rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/50 p-2 space-y-1">
              {selectedItems.slice(0, 100).map((it) => (
                <div
                  key={it.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--obs-border)]/70 bg-[var(--obs-panel)] px-2.5 py-1.5 text-[11px]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[var(--obs-fg)] truncate" title={it.path}>
                      {it.path}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-mono text-[10px] text-[var(--obs-text-muted)] tabular-nums">
                      {formatBytes(it.size_bytes)}
                    </span>
                    <ObsidianButton
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      onClick={() => handleCopySingle(it.path)}
                      title="Copy path"
                    >
                      <Copy className="h-2.5 w-2.5" />
                    </ObsidianButton>
                  </div>
                </div>
              ))}
              {selectedItems.length > 100 && (
                <p className="text-[10px] text-[var(--obs-text-subtle)] text-center py-1">
                  +{selectedItems.length - 100} more paths (use &ldquo;Copy Paths&rdquo; to copy all)
                </p>
              )}
            </div>
          </div>
        )}

        {/* Safety Note */}
        <div className="rounded-xl border border-[var(--obs-accent-border)] bg-[var(--obs-accent-soft)] p-3 flex items-start gap-2.5 text-xs">
          <ShieldCheck className="h-4 w-4 text-[var(--obs-accent)] shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-[var(--obs-fg)]">Safe Deletion Engine</p>
            <p className="text-[11px] text-[var(--obs-text-muted)] leading-relaxed">
              Passwords, cookies, logins, bookmarks, IDE settings, and locked files are strictly
              protected and automatically skipped.
            </p>
          </div>
        </div>
      </div>
    </ObsidianModal>
  );
};
