import React, { useState, useMemo } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  FileText,
  Clock,
  Search,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { CleanReport } from '@/types';
import { formatBytes, formatDuration } from '@/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface ReportModalProps {
  isOpen: boolean;
  report: CleanReport | null;
  onClose: () => void;
  onScanAgain: () => void;
}

export const ReportModal: React.FC<ReportModalProps> = ({
  isOpen,
  report,
  onClose,
  onScanAgain,
}) => {
  const [copied, setCopied] = useState(false);
  const [skippedFilter, setSkippedFilter] = useState('');

  const filteredSkipped = useMemo(() => {
    if (!report) return [];
    const q = skippedFilter.trim().toLowerCase();
    if (!q) return report.skipped_files;
    return report.skipped_files.filter(
      (s) =>
        s.path.toLowerCase().includes(q) ||
        s.reason.toLowerCase().includes(q) ||
        s.category_id.toLowerCase().includes(q)
    );
  }, [report, skippedFilter]);

  if (!report) return null;

  const handleCopyReport = () => {
    const text = `Ferrowipe v0.1.0 - Cleaning Report
--------------------------------------
Total Space Freed: ${formatBytes(report.freed_bytes)}
Files Removed: ${report.removed_files.toLocaleString()}
Files Skipped: ${report.skipped_files.length.toLocaleString()}
Duration: ${formatDuration(report.duration_ms)}

Skipped Files Details:
${
  report.skipped_files.length === 0
    ? 'None - All selected items purged successfully.'
    : report.skipped_files.map((s) => `- ${s.path} (${s.reason})`).join('\n')
}
`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Cleaning report copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary border border-primary/25">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle>Cleaning Summary Report</DialogTitle>
              <DialogDescription className="flex items-center gap-2 mt-0.5">
                <span>Cleanup completed successfully</span>
                <span>•</span>
                <span className="inline-flex items-center gap-1 font-mono text-xs">
                  <Clock className="h-3 w-3" />
                  {formatDuration(report.duration_ms)}
                </span>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Hero Metrics */}
        <div className="grid grid-cols-3 gap-3 py-1">
          <div className="rounded-xl border bg-muted/40 p-3.5 text-center">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Freed Space
            </p>
            <div className="text-2xl font-bold text-primary mt-1 tabular-nums">
              {formatBytes(report.freed_bytes)}
            </div>
          </div>

          <div className="rounded-xl border bg-muted/40 p-3.5 text-center">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Files Removed
            </p>
            <div className="text-2xl font-bold text-foreground mt-1 tabular-nums">
              {report.removed_files.toLocaleString()}
            </div>
          </div>

          <div className="rounded-xl border bg-muted/40 p-3.5 text-center">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Skipped (Locked)
            </p>
            <div
              className={`text-2xl font-bold mt-1 tabular-nums ${
                report.skipped_files.length > 0 ? 'text-amber-500' : 'text-muted-foreground'
              }`}
            >
              {report.skipped_files.length.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Skipped Items Log */}
        <div className="flex-1 min-h-0 flex flex-col space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Skipped Files Log
              </h4>
              <Badge variant="secondary" className="text-[10px]">
                {report.skipped_files.length}
              </Badge>
            </div>

            {report.skipped_files.length > 0 && (
              <div className="relative w-56">
                <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input
                  value={skippedFilter}
                  onChange={(e) => setSkippedFilter(e.target.value)}
                  placeholder="Filter skipped paths..."
                  className="h-8 pl-8 text-xs"
                />
              </div>
            )}
          </div>

          {report.skipped_files.length === 0 ? (
            <div className="rounded-xl border bg-muted/20 p-6 text-center space-y-1.5">
              <CheckCircle2 className="h-8 w-8 text-primary mx-auto opacity-85" />
              <p className="text-sm font-semibold text-foreground">Perfect Execution</p>
              <p className="text-xs text-muted-foreground">
                Every selected item was removed cleanly without any file lock conflicts.
              </p>
            </div>
          ) : (
            <ScrollArea className="h-52 rounded-xl border bg-muted/20">
              <div className="divide-y divide-border">
                {filteredSkipped.length === 0 ? (
                  <p className="p-6 text-center text-xs text-muted-foreground">
                    No skipped files match "{skippedFilter}".
                  </p>
                ) : (
                  filteredSkipped.map((item, idx) => (
                    <div key={idx} className="p-3 text-xs flex items-start gap-2.5">
                      <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-foreground truncate" title={item.path}>
                          {item.path}
                        </p>
                        <p className="text-amber-500/90 text-[11px] mt-0.5">{item.reason}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between sm:justify-between gap-2 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={handleCopyReport} className="gap-1.5">
            {copied ? (
              <Check className="h-3.5 w-3.5 text-primary" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied ? 'Copied!' : 'Copy Summary'}
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              size="sm"
              onClick={() => {
                onClose();
                onScanAgain();
              }}
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Scan Again
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
