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
  Trash2,
} from 'lucide-react';
import { CleanReport } from '@/types';
import { formatBytes, formatDuration } from '@/utils';
import {
  ObsidianBadge,
  ObsidianButton,
  ObsidianModal,
} from '@/components/obsidian/ObsidianPrimitives';
import { obsidianToast } from '@/components/obsidian/ObsidianToast';

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
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [copiedDeleted, setCopiedDeleted] = useState(false);
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

  const deletedPaths = report.deleted_paths || [];

  const handleCopyDeletedPaths = () => {
    if (deletedPaths.length === 0) return;
    navigator.clipboard.writeText(deletedPaths.join('\n'));
    setCopiedDeleted(true);
    obsidianToast.success(
      `Copied ${deletedPaths.length} deleted path${deletedPaths.length === 1 ? '' : 's'}`
    );
    window.setTimeout(() => setCopiedDeleted(false), 2000);
  };

  const handleCopyReport = () => {
    const text = `Ferrowipe v1.0.0 - Cleaning Report
--------------------------------------
Total Space Freed: ${formatBytes(report.freed_bytes)}
Files Removed: ${report.removed_files.toLocaleString()}
Cleaned Targets: ${deletedPaths.length.toLocaleString()}
Files Skipped: ${report.skipped_files.length.toLocaleString()}
Duration: ${formatDuration(report.duration_ms)}

Deleted Paths:
${deletedPaths.length === 0 ? 'None' : deletedPaths.map((p) => `- ${p}`).join('\n')}

Skipped Files Details:
${
  report.skipped_files.length === 0
    ? 'None - All selected items purged successfully.'
    : report.skipped_files.map((s) => `- ${s.path} (${s.reason})`).join('\n')
}
`;
    navigator.clipboard.writeText(text);
    setCopiedSummary(true);
    obsidianToast.success('Cleaning report copied to clipboard');
    window.setTimeout(() => setCopiedSummary(false), 2000);
  };

  return (
    <ObsidianModal
      open={isOpen}
      onClose={onClose}
      maxWidthClass="max-w-2xl"
      title="Cleaning Summary Report"
      description={`Completed cleanly in ${formatDuration(report.duration_ms)}`}
      icon={
        <div className="h-9 w-9 rounded-xl bg-[var(--obs-success-soft)] border border-[var(--obs-success)]/25 text-[var(--obs-success)] flex items-center justify-center shrink-0">
          <CheckCircle2 className="h-4 w-4" />
        </div>
      }
      footer={
        <div className="flex items-center justify-between w-full gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            {deletedPaths.length > 0 && (
              <ObsidianButton variant="control" size="sm" onClick={handleCopyDeletedPaths}>
                {copiedDeleted ? (
                  <Check className="h-3.5 w-3.5 text-[var(--obs-success)]" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copiedDeleted ? 'Copied!' : `Copy Deleted Paths (${deletedPaths.length})`}
              </ObsidianButton>
            )}
            <ObsidianButton variant="control" size="sm" onClick={handleCopyReport}>
              {copiedSummary ? (
                <Check className="h-3.5 w-3.5 text-[var(--obs-success)]" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copiedSummary ? 'Copied!' : 'Copy Report'}
            </ObsidianButton>
          </div>
          <div className="flex items-center gap-2">
            <ObsidianButton variant="ghost" size="sm" onClick={onClose}>
              Close
            </ObsidianButton>
            <ObsidianButton
              variant="accent"
              size="sm"
              onClick={() => {
                onClose();
                onScanAgain();
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Scan Again
            </ObsidianButton>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* KPI Strip */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/65 p-3.5 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--obs-text-muted)]">
              Freed Space
            </p>
            <div className="text-2xl font-bold text-[var(--obs-accent)] mt-1 tabular-nums">
              {formatBytes(report.freed_bytes)}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/65 p-3.5 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--obs-text-muted)]">
              Files Removed
            </p>
            <div className="text-2xl font-bold text-[var(--obs-fg)] mt-1 tabular-nums">
              {report.removed_files.toLocaleString()}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/65 p-3.5 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--obs-text-muted)]">
              Skipped (Locked)
            </p>
            <div
              className={`text-2xl font-bold mt-1 tabular-nums ${
                report.skipped_files.length > 0
                  ? 'text-[var(--obs-warning)]'
                  : 'text-[var(--obs-text-muted)]'
              }`}
            >
              {report.skipped_files.length.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Cleaned / Deleted Paths */}
        {deletedPaths.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Trash2 className="h-3.5 w-3.5 text-[var(--obs-success)]" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--obs-text-muted)]">
                  Cleaned Paths
                </span>
                <ObsidianBadge tone="success">{deletedPaths.length}</ObsidianBadge>
              </div>
              <button
                type="button"
                onClick={handleCopyDeletedPaths}
                className="text-[11px] font-medium text-[var(--obs-accent)] hover:underline inline-flex items-center gap-1"
              >
                <Copy className="h-3 w-3" />
                Copy all
              </button>
            </div>
            <div className="max-h-32 overflow-y-auto obs-scroll rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/45 divide-y divide-[var(--obs-border)]/70">
              {deletedPaths.slice(0, 100).map((p, idx) => (
                <div
                  key={idx}
                  className="px-3 py-1.5 text-[11px] flex items-center justify-between gap-2"
                >
                  <span className="font-mono text-[var(--obs-fg)] truncate" title={p}>
                    {p}
                  </span>
                  <ObsidianButton
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(p);
                      obsidianToast.success('Path copied', { description: p });
                    }}
                    title="Copy path"
                  >
                    <Copy className="h-2.5 w-2.5" />
                  </ObsidianButton>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skipped Items Log */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-[var(--obs-text-muted)]" />
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--obs-text-muted)]">
                Skipped Files Log
              </span>
              <ObsidianBadge tone="neutral">{report.skipped_files.length}</ObsidianBadge>
            </div>

            {report.skipped_files.length > 0 ? (
              <div className="relative w-52">
                <Search className="h-3.5 w-3.5 text-[var(--obs-text-subtle)] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={skippedFilter}
                  onChange={(e) => setSkippedFilter(e.target.value)}
                  placeholder="Filter skipped..."
                  className="obs-control h-7 w-full pl-8 pr-2.5 rounded-lg text-xs text-[var(--obs-fg)] placeholder:text-[var(--obs-text-subtle)] outline-none focus:ring-1 focus:ring-[var(--obs-accent)]"
                />
              </div>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-[var(--obs-text-subtle)] font-mono">
                <Clock className="h-3 w-3" />
                {formatDuration(report.duration_ms)}
              </span>
            )}
          </div>

          {report.skipped_files.length === 0 ? (
            <div className="rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/45 p-5 text-center space-y-1.5">
              <CheckCircle2 className="h-7 w-7 text-[var(--obs-success)] mx-auto" />
              <p className="text-sm font-semibold text-[var(--obs-fg)]">Perfect Execution</p>
              <p className="text-xs text-[var(--obs-text-muted)]">
                Every selected item was removed cleanly without any lock conflicts.
              </p>
            </div>
          ) : (
            <div className="max-h-44 overflow-y-auto obs-scroll rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/45 divide-y divide-[var(--obs-border)]">
              {filteredSkipped.length === 0 ? (
                <p className="p-6 text-center text-xs text-[var(--obs-text-muted)]">
                  No skipped files match &ldquo;{skippedFilter}&rdquo;.
                </p>
              ) : (
                filteredSkipped.map((item, idx) => (
                  <div key={idx} className="p-3 text-xs flex items-start gap-2.5">
                    <AlertCircle className="h-4 w-4 text-[var(--obs-warning)] shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-[var(--obs-fg)] truncate" title={item.path}>
                        {item.path}
                      </p>
                      <p className="text-[var(--obs-warning)] text-[11px] mt-0.5">{item.reason}</p>
                    </div>
                    <ObsidianButton
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => {
                        navigator.clipboard.writeText(item.path);
                        obsidianToast.success('Path copied', { description: item.path });
                      }}
                      title="Copy skipped path"
                    >
                      <Copy className="h-3 w-3" />
                    </ObsidianButton>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </ObsidianModal>
  );
};
