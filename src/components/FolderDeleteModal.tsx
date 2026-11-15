import React, { useState } from 'react';
import { Trash2, AlertTriangle, X, ShieldAlert, RotateCcw } from 'lucide-react';
import { FolderItem } from '../types';
import { formatBytes } from '../utils';

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

  if (!isOpen || selectedFolders.length === 0) return null;

  const totalBytes = selectedFolders.reduce((sum, f) => sum + f.size_bytes, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-lg bg-surface-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden p-6 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-400">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Delete Selected Folders</h3>
              <p className="text-xs text-slate-400">Free up space by removing selected directories</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Space Reclaim Summary */}
        <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-center space-y-1">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
            Space to be Reclaimed
          </span>
          <div className="text-2xl font-black text-red-400 tracking-tight">
            {formatBytes(totalBytes)}
          </div>
          <p className="text-xs text-slate-400">
            Across {selectedFolders.length} selected item{selectedFolders.length === 1 ? '' : 's'}
          </p>
        </div>

        {/* Selected Folders List */}
        <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
          <span className="text-xs font-semibold text-slate-300">Selected Folders & Files:</span>
          <div className="space-y-1.5 pt-1">
            {selectedFolders.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-slate-950/60 border border-slate-800"
              >
                <div className="min-w-0 flex-1 pr-3">
                  <p className="font-semibold text-slate-200 truncate">{f.name}</p>
                  <p className="text-[10px] text-slate-500 font-mono truncate">{f.path}</p>
                </div>
                <span className="font-mono text-emerald-400 font-bold shrink-0">
                  {formatBytes(f.size_bytes)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Deletion Mode Selector */}
        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
          <label className="flex items-center gap-2.5 cursor-pointer text-xs select-none">
            <input
              type="checkbox"
              checked={permanent}
              onChange={(e) => setPermanent(e.target.checked)}
              className="rounded border-slate-700 text-red-600 focus:ring-red-500 w-4 h-4 bg-slate-900"
            />
            <span className="text-slate-200 font-medium">
              Permanent Deletion (Bypass Recycle Bin)
            </span>
          </label>

          <p className="text-[11px] text-slate-400 pl-6.5">
            {permanent ? (
              <span className="text-amber-400 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                Files will be permanently deleted and cannot be restored from the Recycle Bin!
              </span>
            ) : (
              <span className="text-emerald-400 flex items-center gap-1">
                <RotateCcw className="w-3 h-3 shrink-0" />
                Safe Mode: Folders will be moved to the Windows Recycle Bin so you can recover them if needed.
              </span>
            )}
          </p>
        </div>

        {/* Built-in Protection Note */}
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-950/40 border border-slate-800/80 text-xs text-slate-400">
          <ShieldAlert className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <span>
            <strong>Safety Shield:</strong> Ferrowipe automatically protects critical Windows operating system directories (like <code>C:\Windows</code> and system partitions).
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
            onClick={() => onConfirm(permanent)}
            className="px-5 py-2 text-xs font-bold text-white bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 rounded-xl shadow-lg shadow-red-950/50 transition-all flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {permanent ? 'Permanently Delete' : 'Move to Recycle Bin'}
          </button>
        </div>
      </div>
    </div>
  );
};
