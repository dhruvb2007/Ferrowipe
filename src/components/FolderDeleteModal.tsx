import React, { useState, useEffect } from 'react';
import { Trash2, AlertTriangle, ShieldAlert, RotateCcw } from 'lucide-react';
import { FolderItem } from '@/types';
import { formatBytes } from '@/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

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

  // Always reset to Safe Mode when opening modal
  useEffect(() => {
    if (isOpen) {
      setPermanent(false);
    }
  }, [isOpen]);

  const totalBytes = selectedFolders.reduce((sum, f) => sum + f.size_bytes, 0);

  return (
    <Dialog open={isOpen && selectedFolders.length > 0} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/15 text-destructive border border-destructive/25">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Delete Selected Items</DialogTitle>
              <DialogDescription>
                Free up disk space by removing selected folders or files
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Space Reclaim Summary */}
          <div className="rounded-xl border bg-muted/40 p-4 text-center space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Space to be Reclaimed
            </p>
            <div className="text-3xl font-bold tracking-tight text-destructive tabular-nums">
              {formatBytes(totalBytes)}
            </div>
            <p className="text-xs text-muted-foreground">
              Across {selectedFolders.length} selected item{selectedFolders.length === 1 ? '' : 's'}
            </p>
          </div>

          {/* Selected Folders List */}
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Selected Paths</p>
            <ScrollArea className="max-h-36 rounded-lg border bg-muted/20 p-2">
              <div className="space-y-1.5">
                {selectedFolders.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-3 rounded-md border bg-card/60 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground truncate">{f.name}</p>
                      <p className="text-[10px] text-muted-foreground font-mono truncate">
                        {f.path}
                      </p>
                    </div>
                    <Badge variant="secondary" className="font-mono tabular-nums shrink-0">
                      {formatBytes(f.size_bytes)}
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Deletion Mode Selector */}
          <div
            className={`rounded-xl border p-3.5 transition-colors space-y-2 ${
              permanent
                ? 'border-destructive/40 bg-destructive/5'
                : 'border-border bg-muted/30'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <label
                  htmlFor="permanent-delete-switch"
                  className="text-xs font-semibold text-foreground cursor-pointer"
                >
                  Permanent Deletion (Bypass Recycle Bin)
                </label>
                <p className="text-[11px] text-muted-foreground">
                  {permanent
                    ? 'Items will be permanently erased and cannot be restored.'
                    : 'Safe Mode: Items are moved to the Windows Recycle Bin.'}
                </p>
              </div>
              <Switch
                id="permanent-delete-switch"
                checked={permanent}
                onCheckedChange={setPermanent}
              />
            </div>

            <div className="flex items-center gap-1.5 text-[11px] pt-0.5">
              {permanent ? (
                <span className="text-destructive flex items-center gap-1.5 font-medium">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Irreversible action — double-check paths above before continuing.
                </span>
              ) : (
                <span className="text-primary flex items-center gap-1.5 font-medium">
                  <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                  Recoverable from Windows Recycle Bin if deleted by mistake.
                </span>
              )}
            </div>
          </div>

          {/* Safety Shield Note */}
          <Alert className="bg-muted/20">
            <ShieldAlert className="h-4 w-4 text-primary" />
            <AlertTitle className="text-xs font-semibold">Built-in Safety Shield</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              Critical Windows directories (such as <code className="font-mono">C:\Windows</code>{' '}
              and root partitions) are automatically protected against deletion.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => onConfirm(permanent)}
            className="gap-1.5"
          >
            <Trash2 className="h-4 w-4" />
            {permanent ? 'Permanently Delete' : 'Move to Recycle Bin'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
