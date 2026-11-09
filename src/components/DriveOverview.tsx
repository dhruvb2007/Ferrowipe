import React from 'react';
import {
  HardDrive,
  AlertTriangle,
  Zap,
  Disc,
  Usb,
  Network,
  CheckCircle2,
  FolderOpen,
} from 'lucide-react';
import { DriveInfo } from '../types';
import { formatBytes } from '../utils';
import { invoke } from '@tauri-apps/api/core';

interface DriveOverviewProps {
  drives: DriveInfo[];
  isLoading: boolean;
  onNavigateToCleaner: () => void;
}

export const DriveOverview: React.FC<DriveOverviewProps> = ({
  drives,
  isLoading,
  onNavigateToCleaner,
}) => {
  const lowSpaceDrives = drives.filter((d) => d.is_low_space);

  const getDriveIcon = (type: string) => {
    if (type.includes('SSD')) return <Zap className="w-5 h-5 text-cyan-400" />;
    if (type.includes('Removable')) return <Usb className="w-5 h-5 text-blue-400" />;
    if (type.includes('Network')) return <Network className="w-5 h-5 text-purple-400" />;
    if (type.includes('CD')) return <Disc className="w-5 h-5 text-slate-400" />;
    return <HardDrive className="w-5 h-5 text-amber-400" />;
  };

  const getDriveBadge = (type: string) => {
    if (type.includes('SSD')) {
      return (
        <span className="px-2 py-0.5 text-[10px] font-semibold bg-cyan-950/60 text-cyan-300 border border-cyan-800/60 rounded-full flex items-center gap-1">
          <Zap className="w-3 h-3" /> SSD / NVMe
        </span>
      );
    }
    if (type.includes('Removable')) {
      return (
        <span className="px-2 py-0.5 text-[10px] font-semibold bg-blue-950/60 text-blue-300 border border-blue-800/60 rounded-full flex items-center gap-1">
          <Usb className="w-3 h-3" /> USB Drive
        </span>
      );
    }
    if (type.includes('Network')) {
      return (
        <span className="px-2 py-0.5 text-[10px] font-semibold bg-purple-950/60 text-purple-300 border border-purple-800/60 rounded-full flex items-center gap-1">
          <Network className="w-3 h-3" /> Network
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 text-[10px] font-semibold bg-amber-950/60 text-amber-300 border border-amber-800/60 rounded-full flex items-center gap-1">
        <HardDrive className="w-3 h-3" /> HDD
      </span>
    );
  };

  const getBarColor = (pct: number, isLow: boolean) => {
    if (isLow || pct >= 90) return 'from-red-500 to-rose-600';
    if (pct >= 80) return 'from-amber-500 to-orange-600';
    return 'from-emerald-500 to-teal-500';
  };

  const handleOpenExplorer = async (mountPoint: string) => {
    try {
      await invoke('open_in_explorer', { path: mountPoint });
    } catch (err) {
      console.error('Failed to open explorer:', err);
    }
  };

  if (isLoading && drives.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-400">
        <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm">Enumerating system storage hardware...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-6">
      {/* Low Space Alert Banner */}
      {lowSpaceDrives.length > 0 && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-red-950/70 via-rose-950/50 to-surface-900 border border-red-800/60 shadow-lg flex items-start gap-4 animate-in fade-in">
          <div className="p-2 rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 shrink-0">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-red-200">
              Low Storage Space Detected
            </h3>
            <p className="text-xs text-red-300/80 mt-0.5">
              {lowSpaceDrives.map((d) => d.mount_point).join(', ')} has dropped below safe
              headroom (&lt; 15% or &lt; 15 GB free). Low disk space can degrade Windows performance
              and prevent system updates.
            </p>
          </div>
          <button
            onClick={onNavigateToCleaner}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-xl shadow-md transition-all shrink-0"
          >
            Clean Junk Now
          </button>
        </div>
      )}

      {/* Section Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Active Storage Drives</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time hardware status, partition filesystem types, and space allocations.
          </p>
        </div>
        <div className="text-xs text-slate-400 flex items-center gap-2 bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-800">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>{drives.length} Volume{drives.length === 1 ? '' : 's'} Online</span>
        </div>
      </div>

      {/* Drive Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {drives.map((drive) => {
          return (
            <div
              key={drive.mount_point}
              className={`p-6 rounded-2xl bg-surface-900/90 border transition-all hover:border-slate-700 shadow-md flex flex-col justify-between ${
                drive.is_low_space ? 'border-red-900/70 shadow-red-950/20' : 'border-slate-800/90'
              }`}
            >
              <div>
                {/* Header info */}
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60">
                      {getDriveIcon(drive.drive_type)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-base text-white">
                          {drive.volume_name}
                        </span>
                        <span className="text-xs font-mono font-bold text-emerald-400 bg-slate-800 px-2 py-0.5 rounded">
                          {drive.mount_point}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-slate-400">FS: {drive.fs_type}</span>
                        <span className="text-slate-600">•</span>
                        {getDriveBadge(drive.drive_type)}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => handleOpenExplorer(drive.mount_point)}
                    title="Open in Windows Explorer"
                    className="p-2 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-lg transition-colors border border-transparent hover:border-slate-700"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>

                {/* Progress bar */}
                <div className="space-y-1.5 my-4">
                  <div className="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden p-0.5">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r transition-all duration-700 ${getBarColor(
                        drive.usage_percentage,
                        drive.is_low_space
                      )}`}
                      style={{ width: `${Math.min(drive.usage_percentage, 100)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>{drive.usage_percentage}% Used</span>
                    {drive.is_low_space && (
                      <span className="text-red-400 font-semibold flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> Low Space Warning
                      </span>
                    )}
                  </div>
                </div>

                {/* Metrics Breakdown */}
                <div className="grid grid-cols-3 gap-2 py-3 px-4 rounded-xl bg-slate-950/60 border border-slate-800/80 text-center">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                      Used
                    </span>
                    <p className="text-xs font-bold text-slate-200 mt-0.5">
                      {formatBytes(drive.used_bytes)}
                    </p>
                  </div>
                  <div className="border-x border-slate-800/80">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                      Free
                    </span>
                    <p
                      className={`text-xs font-bold mt-0.5 ${
                        drive.is_low_space ? 'text-red-400' : 'text-emerald-400'
                      }`}
                    >
                      {formatBytes(drive.available_bytes)}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                      Capacity
                    </span>
                    <p className="text-xs font-bold text-slate-200 mt-0.5">
                      {formatBytes(drive.total_bytes)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Bottom Card Action */}
              <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  {drive.drive_type.includes('SSD')
                    ? '⚡ NVMe / SSD Trim Active'
                    : 'Mechanical Magnetic Disk'}
                </span>
                <button
                  onClick={onNavigateToCleaner}
                  className="text-xs text-emerald-400 hover:text-emerald-300 font-semibold hover:underline flex items-center gap-1"
                >
                  Analyze & Clean Junk &rarr;
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
