import React from 'react';
import { Trash2, ShieldCheck } from 'lucide-react';
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
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  totalBytes: number;
  totalFiles: number;
  categoryNames: string[];
}

export const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  totalBytes,
  totalFiles,
  categoryNames,
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/15 text-destructive border border-destructive/25">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Confirm Disk Cleanup</DialogTitle>
              <DialogDescription>
                Permanently remove selected junk caches and temp files
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Reclaimable Space Highlight */}
          <div className="rounded-xl border bg-muted/40 p-4 text-center space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Estimated Space to Reclaim
            </p>
            <div className="text-3xl font-bold tracking-tight text-primary tabular-nums">
              {formatBytes(totalBytes)}
            </div>
            <p className="text-xs text-muted-foreground">
              Across {totalFiles.toLocaleString()} file{totalFiles === 1 ? '' : 's'} in{' '}
              {categoryNames.length} categor{categoryNames.length === 1 ? 'y' : 'ies'}
            </p>
          </div>

          {/* Affected Categories */}
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Selected Targets</p>
            <ScrollArea className="max-h-28 rounded-lg border bg-muted/20 p-2.5">
              <div className="flex flex-wrap gap-1.5">
                {categoryNames.map((name) => (
                  <Badge key={name} variant="secondary" className="font-normal">
                    {name}
                  </Badge>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Safety Note */}
          <Alert className="border-primary/25 bg-primary/5 text-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <AlertTitle className="text-xs font-semibold">Safe Deletion Engine</AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              Files locked by active processes (running browsers or system services) are safely
              skipped without interrupting your work.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} className="gap-1.5">
            <Trash2 className="h-4 w-4" />
            Proceed &amp; Clean
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
