import React from 'react';
import { HardDrive, Trash2, Shield, RefreshCw } from 'lucide-react';

interface HeaderProps {
  currentTab: 'drives' | 'cleaner';
  onSelectTab: (tab: 'drives' | 'cleaner') => void;
  onRefreshDrives: () => void;
  isRefreshing: boolean;
  totalSpaceCleanable?: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onSelectTab,
  onRefreshDrives,
  isRefreshing,
}) => {
  return (
    <header className="h-16 border-b border-slate-800/80 bg-surface-900/95 backdrop-blur-md px-6 flex items-center justify-between z-20">
      {/* Brand Identity */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 via-teal-600 to-cyan-700 p-0.5 shadow-lg shadow-emerald-950/40 flex items-center justify-center">
          <div className="w-full h-full bg-surface-950/80 rounded-[10px] flex items-center justify-center">
            <Shield className="w-5 h-5 text-emerald-400 stroke-[2.2]" />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
              Ferrowipe
              <span className="text-[10px] font-semibold tracking-wider uppercase px-2 py-0.5 bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-full">
                v0.1.0
              </span>
            </h1>
          </div>
          <p className="text-xs text-slate-400">High-Performance Windows Disk Optimizer</p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <nav className="flex items-center gap-1.5 bg-surface-950/80 p-1 border border-slate-800/80 rounded-xl">
        <button
          onClick={() => onSelectTab('drives')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            currentTab === 'drives'
              ? 'bg-slate-800 text-emerald-400 shadow-sm border border-slate-700/60'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
          }`}
        >
          <HardDrive className="w-4 h-4" />
          Drive Overview
        </button>

        <button
          onClick={() => onSelectTab('cleaner')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all ${
            currentTab === 'cleaner'
              ? 'bg-slate-800 text-emerald-400 shadow-sm border border-slate-700/60'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
          }`}
        >
          <Trash2 className="w-4 h-4" />
          Junk Cleaner
        </button>
      </nav>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={onRefreshDrives}
          disabled={isRefreshing}
          title="Refresh Drive Stats"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/70 rounded-lg transition-all disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>
    </header>
  );
};
