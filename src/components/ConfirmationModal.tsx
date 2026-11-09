import React from 'react';
import { Trash2, X, ShieldCheck } from 'lucide-react';
import { formatBytes } from '../utils';

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-md bg-surface-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Confirm Disk Cleanup</h3>
              <p className="text-xs text-slate-400">Permanent removal of selected junk</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Space Highlight Card */}
        <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-center space-y-1">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            Reclaimable Space
          </span>
          <div className="text-2xl font-black text-emerald-400 tracking-tight">
            {formatBytes(totalBytes)}
          </div>
          <p className="text-xs text-slate-400">
            Across {totalFiles.toLocaleString()} file{totalFiles === 1 ? '' : 's'} in{' '}
            {categoryNames.length} categories
          </p>
        </div>

        {/* Affected Categories */}
        <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
          <span className="text-xs font-semibold text-slate-300">Selected Targets:</span>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {categoryNames.map((name) => (
              <span
                key={name}
                className="text-[11px] px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 border border-slate-700/70"
              >
                {name}
              </span>
            ))}
          </div>
        </div>

        {/* Safety Note */}
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-300 text-xs">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            <strong>Safe Deletion Engine:</strong> Files locked by active processes (running
            browsers, system services) will be safely skipped without breaking your workflow.
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/80 rounded-xl transition-all"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2 text-xs font-bold text-white bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 rounded-xl shadow-lg shadow-red-950/50 transition-all flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Proceed & Clean
          </button>
        </div>
      </div>
    </div>
  );
};
