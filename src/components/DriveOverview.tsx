import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import {
  HardDrive,
  AlertTriangle,
  Zap,
  Disc,
  Usb,
  Network,
  CheckCircle2,
  FolderOpen,
  Sparkles,
  Flame,
  Trash2,
  Globe,
  FolderTree,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import {
  CleanerStatusSummary,
  DetectedCleanupRule,
  DriveInfo,
  RecycleBinStat,
} from '@/types';
import { formatBytes } from '@/utils';
import { cn } from '@/lib/utils';
import {
  ObsidianBadge,
  ObsidianButton,
  ObsidianProgress,
} from '@/components/obsidian/ObsidianPrimitives';
import { DiscoverButton } from '@/components/obsidian/DiscoverButton';
import { StorageStatusBars } from '@/components/obsidian/StorageStatusBars';
import { obsidianToast } from '@/components/obsidian/ObsidianToast';

interface DriveOverviewProps {
  drives: DriveInfo[];
  recycleBins: RecycleBinStat[];
  detectedRules: DetectedCleanupRule[];
  isLoading: boolean;
  cleanerStatus: CleanerStatusSummary;
  onQuickClean: (presetRuleIds?: string[]) => void;
  onNavigateToCleaner: () => void;
  onNavigateToApps: () => void;
  onNavigateToAnalyzer: (
    path: string,
    options?: { mode?: 'tree' | 'deep_scan'; autoFullDisk?: boolean; minSizeMb?: number }
  ) => void;
}

export const DriveOverview: React.FC<DriveOverviewProps> = ({
  drives,
  recycleBins,
  detectedRules,
  isLoading,
  cleanerStatus,
  onQuickClean,
  onNavigateToCleaner,
  onNavigateToApps,
  onNavigateToAnalyzer,
}) => {
  const browserRules = useMemo(
    () => detectedRules.filter((r) => r.group === 'Browser'),
    [detectedRules]
  );

  const quickSafeRuleIds = useMemo(() => {
    const preferred = ['user_temp', 'windows_temp', 'recycle_bin', 'thumb_cache'];
    if (detectedRules.length === 0) return preferred;
    const avail = new Set(detectedRules.map((r) => r.id));
    return preferred.filter((id) => avail.has(id));
  }, [detectedRules]);

  const browserSubtitle = useMemo(() => {
    if (browserRules.length === 0) return 'No supported browsers detected';
    const seen = new Set<string>();
    const names: string[] = [];
    for (const b of browserRules) {
      const clean = b.name
        .split('—')[0]
        .replace(' Cache', '')
        .replace('Google ', '')
        .replace('Microsoft ', '')
        .replace('Mozilla ', '')
        .replace(' Browser', '')
        .trim();
      if (!seen.has(clean)) {
        seen.add(clean);
        names.push(clean);
      }
    }
    return `Safe clear ${names.join(', ')}`;
  }, [browserRules]);
  const lowSpaceDrives = useMemo(() => drives.filter((d) => d.is_low_space), [drives]);
  const primaryDrive = useMemo(
    () => drives.find((d) => d.mount_point.toUpperCase().startsWith('C:')) || drives[0],
    [drives]
  );

  const totals = useMemo(() => {
    const totalBytes = drives.reduce((acc, d) => acc + d.total_bytes, 0);
    const usedBytes = drives.reduce((acc, d) => acc + d.used_bytes, 0);
    const availableBytes = drives.reduce((acc, d) => acc + d.available_bytes, 0);
    const pct = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
    const ssdCount = drives.filter((d) => d.drive_type.includes('SSD')).length;
    return { totalBytes, usedBytes, availableBytes, pct, ssdCount };
  }, [drives]);

  const recycleSummary = useMemo(() => {
    const totalBytes = recycleBins.reduce((acc, r) => acc + r.bytes, 0);
    const totalItems = recycleBins.reduce((acc, r) => acc + r.items, 0);
    return { totalBytes, totalItems };
  }, [recycleBins]);

  const getDriveIcon = (type: string) => {
    if (type.includes('SSD')) return <Zap className="h-5 w-5 text-[var(--obs-accent)]" />;
    if (type.includes('Removable')) return <Usb className="h-5 w-5 text-sky-400" />;
    if (type.includes('Network')) return <Network className="h-5 w-5 text-violet-400" />;
    if (type.includes('CD')) return <Disc className="h-5 w-5 text-[var(--obs-text-muted)]" />;
    return <HardDrive className="h-5 w-5 text-amber-400" />;
  };

  const getDriveTypeBadge = (type: string) => {
    if (type.includes('SSD')) {
      return (
        <ObsidianBadge tone="accent">
          <Zap className="h-2.5 w-2.5" /> SSD / NVMe
        </ObsidianBadge>
      );
    }
    if (type.includes('Removable')) {
      return (
        <ObsidianBadge tone="neutral">
          <Usb className="h-2.5 w-2.5 text-sky-400" /> USB Drive
        </ObsidianBadge>
      );
    }
    if (type.includes('Network')) {
      return (
        <ObsidianBadge tone="neutral">
          <Network className="h-2.5 w-2.5 text-violet-400" /> Network
        </ObsidianBadge>
      );
    }
    return (
      <ObsidianBadge tone="warning">
        <HardDrive className="h-2.5 w-2.5" /> HDD
      </ObsidianBadge>
    );
  };

  const getProgressTone = (pct: number, isLow: boolean): 'danger' | 'warning' | 'accent' => {
    if (isLow || pct >= 90) return 'danger';
    if (pct >= 80) return 'warning';
    return 'accent';
  };

  const handleOpenExplorer = async (mountPoint: string) => {
    try {
      await invoke('open_in_explorer', { path: mountPoint });
    } catch (err) {
      obsidianToast.error(`Failed to open Explorer for ${mountPoint}`);
      console.error(err);
    }
  };

  const healthTone =
    lowSpaceDrives.length > 0 || totals.pct >= 90
      ? { label: 'Low Space Attention', tone: 'danger' as const }
      : totals.pct >= 80
      ? { label: 'Moderate Usage', tone: 'warning' as const }
      : { label: 'Healthy Headroom', tone: 'success' as const };

  const primaryMount = primaryDrive?.mount_point || 'C:\\';

  if (isLoading && drives.length === 0) {
    return (
      <div className="flex-1 obs-scroll p-6 space-y-6 max-w-7xl mx-auto w-full">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="obs-card h-52 lg:col-span-2 animate-pulse" />
          <div className="obs-card h-52 animate-pulse" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="obs-card h-24 animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="obs-card h-52 animate-pulse" />
          <div className="obs-card h-52 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 obs-scroll h-full">
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Low Space Warning Alert */}
        {lowSpaceDrives.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-[var(--obs-danger)]/40 bg-[var(--obs-danger-soft)] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-xl bg-[var(--obs-danger)]/20 text-[var(--obs-danger)] flex items-center justify-center shrink-0">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-[var(--obs-fg)]">
                  Low Storage Headroom Detected ({lowSpaceDrives.map((d) => d.mount_point).join(', ')})
                </h3>
                <p className="text-[11px] text-[var(--obs-text-muted)] mt-0.5">
                  Free space fell below 15% or 15 GB. Clear junk caches or inspect large folders to
                  keep Windows responsive.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ObsidianButton
                variant="control"
                size="sm"
                onClick={() =>
                  onNavigateToAnalyzer(lowSpaceDrives[0].mount_point, {
                    mode: 'deep_scan',
                    minSizeMb: 100,
                  })
                }
              >
                <Flame className="h-3.5 w-3.5 text-[var(--obs-accent)]" />
                Space Hogs
              </ObsidianButton>
              <ObsidianButton variant="danger" size="sm" onClick={() => onQuickClean()}>
                <Sparkles className="h-3.5 w-3.5" />
                Clean Now
              </ObsidianButton>
            </div>
          </motion.div>
        )}

        {/* Top Hero Bento Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* System Storage Health Card with ObsidianUI Status Bars & Discover Button */}
          <div className="obs-card lg:col-span-2 p-5 flex flex-col justify-between gap-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-[var(--obs-fg)] tracking-tight">
                    System Storage Health
                  </h2>
                  <ObsidianBadge tone={healthTone.tone}>
                    {lowSpaceDrives.length > 0 ? (
                      <AlertTriangle className="h-2.5 w-2.5" />
                    ) : (
                      <ShieldCheck className="h-2.5 w-2.5" />
                    )}
                    {healthTone.label}
                  </ObsidianBadge>
                </div>
                <p className="text-xs text-[var(--obs-text-muted)]">
                  Hover segments to inspect storage distribution
                  {totals.ssdCount > 0 ? ` • ${totals.ssdCount} SSD/NVMe online` : ''}
                </p>
              </div>

              <DiscoverButton
                label="Run Smart Scan"
                onClick={() => onQuickClean()}
              />
            </div>

            {/* Interactive Segmented Health Bars */}
            <StorageStatusBars
              drives={drives}
              usedPercent={totals.pct}
              totalBytes={totals.totalBytes}
              usedBytes={totals.usedBytes}
              availableBytes={totals.availableBytes}
              lowSpaceCount={lowSpaceDrives.length}
            />

            {/* Compact 3-Column Metrics */}
            <div className="grid grid-cols-3 gap-2.5 pt-1">
              <div className="rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/60 px-3.5 py-2.5 min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--obs-text-subtle)] truncate">
                  Capacity
                </p>
                <p className="text-base font-bold text-[var(--obs-fg)] tabular-nums mt-0.5 truncate">
                  {formatBytes(totals.totalBytes)}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/60 px-3.5 py-2.5 min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--obs-text-subtle)] truncate">
                  Used
                </p>
                <p className="text-base font-bold text-[var(--obs-fg)] tabular-nums mt-0.5 truncate">
                  {formatBytes(totals.usedBytes)}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/60 px-3.5 py-2.5 min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--obs-text-subtle)] truncate">
                  Available
                </p>
                <p
                  className={cn(
                    'text-base font-bold tabular-nums mt-0.5 truncate',
                    lowSpaceDrives.length > 0
                      ? 'text-[var(--obs-danger)]'
                      : 'text-[var(--obs-accent)]'
                  )}
                >
                  {formatBytes(totals.availableBytes)}
                </p>
              </div>
            </div>
          </div>

          {/* Recycle Bin & Quick Action Card */}
          <div className="obs-card p-5 flex flex-col justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-[var(--obs-fg)] flex items-center gap-2">
                  <span className="h-7 w-7 rounded-lg bg-[var(--obs-accent-soft)] border border-[var(--obs-accent-border)] text-[var(--obs-accent)] flex items-center justify-center">
                    <Trash2 className="h-3.5 w-3.5" />
                  </span>
                  Recycle Bin
                </h2>
                <ObsidianBadge tone="neutral" className="font-mono">
                  {recycleSummary.totalItems.toLocaleString()} item
                  {recycleSummary.totalItems === 1 ? '' : 's'}
                </ObsidianBadge>
              </div>
              <p className="text-xs text-[var(--obs-text-muted)]">
                Native Win32 check across local partitions
              </p>
            </div>

            <div className="rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/65 p-4 flex items-baseline justify-between gap-2">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--obs-text-subtle)]">
                  Reclaimable Now
                </p>
                <p className="text-2xl font-bold text-[var(--obs-fg)] tabular-nums mt-1">
                  {formatBytes(recycleSummary.totalBytes)}
                </p>
              </div>
              {cleanerStatus.reclaimableBytes > 0 && (
                <button
                  type="button"
                  onClick={onNavigateToCleaner}
                  className="text-right group"
                >
                  <p className="text-[10px] uppercase tracking-wider text-[var(--obs-accent)] font-semibold">
                    Last Scan
                  </p>
                  <p className="text-xs font-bold font-mono text-[var(--obs-accent)] group-hover:underline">
                    {formatBytes(cleanerStatus.reclaimableBytes)} →
                  </p>
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <ObsidianButton
                variant="accent"
                size="sm"
                className="w-full"
                onClick={() => onQuickClean()}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Smart Scan
              </ObsidianButton>
              <ObsidianButton
                variant="control"
                size="sm"
                className="w-full"
                onClick={() => onQuickClean(['recycle_bin'])}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Empty Bin
              </ObsidianButton>
            </div>
          </div>
        </div>

        {/* One-Click Maintenance Workflows */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--obs-text-muted)]">
              Quick Workflows
            </h2>
            <span className="text-[11px] text-[var(--obs-text-subtle)]">
              Launch focused cleanup &amp; analysis tasks in one click
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                title: 'Quick Safe Clean',
                desc: 'Temp files, Recycle Bin & Thumbnails',
                icon: <Sparkles className="h-4 w-4 text-[var(--obs-accent)]" />,
                onClick: () => onQuickClean(quickSafeRuleIds),
              },
              {
                title: `Browser Caches${browserRules.length > 0 ? ` (${browserRules.length})` : ''}`,
                desc: browserSubtitle,
                icon: <Globe className="h-4 w-4 text-sky-400" />,
                onClick: () =>
                  browserRules.length > 0
                    ? onQuickClean(browserRules.map((b) => b.id))
                    : onNavigateToCleaner(),
              },
              {
                title: 'App Storage',
                desc: 'See how much space each software takes',
                icon: <HardDrive className="h-4 w-4 text-violet-400" />,
                onClick: onNavigateToApps,
              },
              {
                title: 'Top Space Hogs',
                desc: `Find largest folders on ${primaryMount}`,
                icon: <Flame className="h-4 w-4 text-amber-400" />,
                onClick: () =>
                  onNavigateToAnalyzer(primaryMount, {
                    mode: 'deep_scan',
                    minSizeMb: 100,
                  }),
              },
            ].map((action) => (
              <motion.button
                key={action.title}
                type="button"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.99 }}
                transition={{ duration: 0.16 }}
                onClick={action.onClick}
                className="obs-card group p-4 text-left flex flex-col justify-between gap-3 hover:ring-1 hover:ring-[var(--obs-accent-border)] transition-all"
              >
                <div className="flex items-center justify-between w-full">
                  <div className="h-9 w-9 rounded-[10px] obs-control flex items-center justify-center">
                    {action.icon}
                  </div>
                  <ArrowRight className="h-4 w-4 text-[var(--obs-text-subtle)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--obs-accent)]" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-[var(--obs-fg)]">{action.title}</p>
                  <p className="text-[11px] text-[var(--obs-text-muted)] mt-0.5">{action.desc}</p>
                </div>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Connected Storage Volumes */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--obs-text-muted)]">
                Connected Storage Volumes
              </h2>
              <p className="text-[11px] text-[var(--obs-text-subtle)] mt-0.5">
                Direct Win32 seek-penalty detection, partition filesystems, and live headroom
              </p>
            </div>
            <ObsidianBadge tone="neutral" className="py-1 px-2.5 text-[11px]">
              <CheckCircle2 className="h-3 w-3 text-[var(--obs-success)]" />
              {drives.length} Volume{drives.length === 1 ? '' : 's'} Online
            </ObsidianBadge>
          </div>

          {drives.length === 0 ? (
            <div className="obs-card p-10 text-center space-y-2">
              <div className="h-11 w-11 rounded-xl obs-control mx-auto flex items-center justify-center text-[var(--obs-text-muted)]">
                <HardDrive className="h-5 w-5" />
              </div>
              <p className="text-sm font-semibold text-[var(--obs-fg)]">
                No Storage Volumes Detected
              </p>
              <p className="text-xs text-[var(--obs-text-muted)] max-w-md mx-auto">
                Run Ferrowipe in the Tauri desktop app or click Refresh to query local drives.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {drives.map((drive) => (
                <div
                  key={drive.mount_point}
                  className={cn(
                    'obs-card p-5 flex flex-col justify-between gap-4 transition-all hover:ring-1 hover:ring-[var(--obs-border-strong)]',
                    drive.is_low_space && 'ring-1 ring-[var(--obs-danger)]/45'
                  )}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-11 w-11 rounded-xl obs-control flex items-center justify-center shrink-0">
                        {getDriveIcon(drive.drive_type)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-sm text-[var(--obs-fg)] truncate">
                            {drive.volume_name}
                          </h3>
                          <span className="text-[11px] font-mono font-bold text-[var(--obs-accent)] bg-[var(--obs-accent-soft)] border border-[var(--obs-accent-border)] px-2 py-0.5 rounded-md">
                            {drive.mount_point}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                          {getDriveTypeBadge(drive.drive_type)}
                          <ObsidianBadge tone="neutral" className="font-mono">
                            {drive.fs_type}
                          </ObsidianBadge>
                        </div>
                      </div>
                    </div>

                    <ObsidianButton
                      variant="ghost"
                      size="icon"
                      onClick={() => handleOpenExplorer(drive.mount_point)}
                      title={`Open ${drive.mount_point} in Windows Explorer`}
                    >
                      <FolderOpen className="h-4 w-4" />
                    </ObsidianButton>
                  </div>

                  {/* Progress Bar */}
                  <div className="space-y-1.5">
                    <ObsidianProgress
                      value={drive.usage_percentage}
                      tone={getProgressTone(drive.usage_percentage, drive.is_low_space)}
                      className="h-2.5"
                    />
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--obs-text-muted)] tabular-nums">
                        {drive.usage_percentage}% used
                      </span>
                      {drive.is_low_space ? (
                        <span className="text-[var(--obs-danger)] font-medium flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" /> Low Space Warning
                        </span>
                      ) : (
                        <span className="text-[var(--obs-text-subtle)] text-[11px]">
                          {drive.drive_type.includes('SSD') ? 'TRIM Active' : 'Standard Volume'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="grid grid-cols-3 divide-x divide-[var(--obs-border)] rounded-xl border border-[var(--obs-border)] bg-[var(--obs-bg)]/55 py-2.5 text-center">
                    <div className="px-2">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--obs-text-subtle)] font-medium">
                        Used
                      </p>
                      <p className="text-xs font-semibold text-[var(--obs-fg)] tabular-nums mt-0.5">
                        {formatBytes(drive.used_bytes)}
                      </p>
                    </div>
                    <div className="px-2">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--obs-text-subtle)] font-medium">
                        Free
                      </p>
                      <p
                        className={cn(
                          'text-xs font-semibold tabular-nums mt-0.5',
                          drive.is_low_space
                            ? 'text-[var(--obs-danger)]'
                            : 'text-[var(--obs-accent)]'
                        )}
                      >
                        {formatBytes(drive.available_bytes)}
                      </p>
                    </div>
                    <div className="px-2">
                      <p className="text-[10px] uppercase tracking-wider text-[var(--obs-text-subtle)] font-medium">
                        Capacity
                      </p>
                      <p className="text-xs font-semibold text-[var(--obs-fg)] tabular-nums mt-0.5">
                        {formatBytes(drive.total_bytes)}
                      </p>
                    </div>
                  </div>

                  {/* Card Actions */}
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <div className="flex items-center gap-2">
                      <ObsidianButton
                        variant="control"
                        size="xs"
                        onClick={() =>
                          onNavigateToAnalyzer(drive.mount_point, { mode: 'tree' })
                        }
                      >
                        <FolderTree className="h-3.5 w-3.5" />
                        Explore
                      </ObsidianButton>
                      <ObsidianButton
                        variant="ghost"
                        size="xs"
                        onClick={() =>
                          onNavigateToAnalyzer(drive.mount_point, {
                            mode: 'deep_scan',
                            minSizeMb: 100,
                          })
                        }
                      >
                        <Flame className="h-3.5 w-3.5 text-[var(--obs-accent)]" />
                        Space Hogs
                      </ObsidianButton>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        onNavigateToAnalyzer(drive.mount_point, {
                          mode: 'tree',
                          autoFullDisk: true,
                        })
                      }
                      className="text-xs font-semibold text-[var(--obs-accent)] hover:underline inline-flex items-center gap-1"
                    >
                      Full Scan
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
