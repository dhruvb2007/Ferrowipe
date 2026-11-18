import React, { useState, useEffect } from 'react';
import { Trash2, AlertTriangle, ShieldAlert, RotateCcw, Copy, Check } from 'lucide-react';
import { FolderItem } from '@/types';
import { formatBytes } from '@/utils';
import { cn } from '@/lib/utils';
import {
  ObsidianBadge,
  ObsidianButton,
  ObsidianModal,
  ObsidianSwitch,
} from '@/components/obsidian/ObsidianPrimitives';
import { obsidianToast } from '@/components/obsidian/ObsidianToast';

interface FolderDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (permanent: boolean) => void;
  selectedFolders: FolderItem[];
}

export const FolderDeleteModal: React.FC<FolderDeleteModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  selectedFolders,
}) => {
  const [permanent, setPermanent] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPermanent(false);
      setCopiedAll(false);
    }
  }, [isOpen]);

  const totalBytes = selectedFolders.reduce((sum, f) => sum + f.size_bytes, 0);

  const handleCopyAllPaths = () => {
    const text = selectedFolders.map((f) => f.path).join('\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    obsidianToast.success(
      `Copied ${selectedFolders.length} deleting path${selectedFolders.length === 1 ? '' : 's'}`
    );
    window.setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleCopySinglePath = (path: string) => {
    navigator.clipboard.writeText(path);
    obsidianToast.success('Path copied to clipboard', { description: path });
  };

  return (
    <ObsidianModal
      open={isOpen && selectedFolders.length > 0}
      onClose={onClose}
      maxWidthClass="max-w-lg"
      title="Delete Selected Items"
      description="Free up disk space by removing selected folders or files"
      icon={
        <div className="h-9 w-9 rounded-xl bg-[var(--obs-danger-soft)] border border-[var(--obs-danger)]/25 text-[var(--obs-danger)] flex items-center justify-center shrink-0">
          <Trash2 className="h-4 w-4" />
        </div>
      }
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <ObsidianButton variant="control" size="sm" onClick={handleCopyAllPaths}>
            {copiedAll ? (
              <Check className="h-3.5 w-3.5 text-[var(--obs-success)]" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copiedAll ? 'Copied Paths!' : `Copy Paths (${selectedFolders.length})`}
          </ObsidianButton>
          <div className="flex items-center gap-2">
            <ObsidianButton variant="ghost" onClick={onClose}>
              Cancel
            </ObsidianButton>
            <ObsidianButton variant="danger" onClick={() => onConfirm(permanent)}>
              <Trash2 className="h-3.5 w-3.5" />
              {permanent ? 'Permanently Delete' : 'Move to Recycle Bin'}
            </ObsidianButton>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Reclaim Summary */}
        <div className="rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/70 p-4 text-center space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--obs-text-muted)]">
            Space to be Reclaimed
          </p>
          <div className="text-3xl font-bold tracking-tight text-[var(--obs-danger)] tabular-nums">
            {formatBytes(totalBytes)}
          </div>
          <p className="text-xs text-[var(--obs-text-muted)]">
            Across {selectedFolders.length} selected item{selectedFolders.length === 1 ? '' : 's'}
          </p>
        </div>

        {/* Selected Paths with Copy Support */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium text-[var(--obs-text-muted)]">
              Paths to Delete ({selectedFolders.length})
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
          <div className="max-h-36 overflow-y-auto obs-scroll rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/50 p-2 space-y-1.5">
            {selectedFolders.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between gap-2.5 rounded-lg border border-[var(--obs-border)] bg-[var(--obs-panel)] px-3 py-2 text-xs group"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-[var(--obs-fg)] truncate">{f.name}</p>
                  <p className="text-[10px] text-[var(--obs-text-subtle)] font-mono truncate">
                    {f.path}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <ObsidianBadge tone="neutral" className="font-mono tabular-nums">
                    {formatBytes(f.size_bytes)}
                  </ObsidianBadge>
                  <ObsidianButton
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => handleCopySinglePath(f.path)}
                    title="Copy this path"
                  >
                    <Copy className="h-3 w-3" />
                  </ObsidianButton>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Deletion Mode Selector */}
        <div
          className={cn(
            'rounded-xl border p-3.5 transition-colors space-y-2',
            permanent
              ? 'border-[var(--obs-danger)]/40 bg-[var(--obs-danger-soft)]'
              : 'border-[var(--obs-border)] bg-[var(--obs-bg)]/50'
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <label
                htmlFor="obs-permanent-switch"
                className="text-xs font-semibold text-[var(--obs-fg)] cursor-pointer"
              >
                Permanent Deletion (Bypass Recycle Bin)
              </label>
              <p className="text-[11px] text-[var(--obs-text-muted)]">
                {permanent
                  ? 'Items will be permanently erased and cannot be recovered.'
                  : 'Safe Mode: Items are moved to the Windows Recycle Bin.'}
              </p>
            </div>
            <ObsidianSwitch
              id="obs-permanent-switch"
              checked={permanent}
              onChange={setPermanent}
            />
          </div>

          <div className="flex items-center gap-1.5 text-[11px] pt-0.5">
            {permanent ? (
              <span className="text-[var(--obs-danger)] flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Irreversible action — verify paths before confirming.
              </span>
            ) : (
              <span className="text-[var(--obs-success)] flex items-center gap-1.5 font-medium">
                <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                Recoverable from Windows Recycle Bin if needed.
              </span>
            )}
          </div>
        </div>

        {/* Built-in Safety Shield */}
        <div className="rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/45 p-3 flex items-start gap-2.5 text-xs">
          <ShieldAlert className="h-4 w-4 text-[var(--obs-accent)] shrink-0 mt-0.5" />
          <p className="text-[11px] text-[var(--obs-text-muted)] leading-relaxed">
            <strong className="text-[var(--obs-fg)]">Safety Shield:</strong> Critical Windows
            directories (such as <code className="font-mono">C:\Windows</code> and root partitions)
            are automatically protected.
          </p>
        </div>
      </div>
    </ObsidianModal>
  );
};
