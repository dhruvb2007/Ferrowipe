import React, { useState } from 'react';
import { CheckCircle, AlertCircle, Copy, Check, X, FileText, Clock } from 'lucide-react';
import { CleanReport } from '../types';
import { formatBytes, formatDuration } from '../utils';

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

  if (!isOpen || !report) return null;

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
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-2xl bg-surface-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 bg-surface-950/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
              <CheckCircle className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Cleaning Summary Report</h3>
              <p className="text-xs text-slate-400">Cleanup execution finished successfully</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Hero Metrics */}
        <div className="grid grid-cols-3 gap-3 p-6 bg-slate-900/40 border-b border-slate-800/80">
          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-center">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Freed Space
            </span>
            <div className="text-2xl font-black text-emerald-400 mt-0.5">
              {formatBytes(report.freed_bytes)}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-center">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Files Removed
            </span>
            <div className="text-2xl font-black text-slate-200 mt-0.5">
              {report.removed_files.toLocaleString()}
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-center">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Skipped (Locked)
            </span>
            <div
              className={`text-2xl font-black mt-0.5 ${
                report.skipped_files.length > 0 ? 'text-amber-400' : 'text-slate-400'
              }`}
            >
              {report.skipped_files.length.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Skipped Items Section */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" />
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Skipped Files Log ({report.skipped_files.length})
              </h4>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Clock className="w-3.5 h-3.5" />
              <span>Elapsed: {formatDuration(report.duration_ms)}</span>
            </div>
          </div>

          {report.skipped_files.length === 0 ? (
            <div className="p-6 rounded-xl bg-slate-950/40 border border-slate-800/80 text-center text-xs text-slate-400">
              <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-80" />
              <p className="font-semibold text-slate-300">Perfect Execution</p>
              <p className="mt-0.5">Every single selected file was successfully deleted without any locks.</p>
            </div>
          ) : (
            <div className="border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800/80 bg-slate-950/50">
              {report.skipped_files.map((item, idx) => (
                <div key={idx} className="p-3 text-xs flex items-start gap-3">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-slate-300 truncate">{item.path}</p>
                    <p className="text-amber-400/90 text-[11px] mt-0.5">{item.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-surface-950/80 flex items-center justify-between">
          <button
            onClick={handleCopyReport}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-xl border border-slate-700/80 transition-all"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied to Clipboard!' : 'Copy Summary'}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
            >
              Close
            </button>
            <button
              onClick={onScanAgain}
              className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-md transition-all"
            >
              Scan Again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
