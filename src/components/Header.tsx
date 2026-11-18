import React from 'react';
import {
  RefreshCw,
  Sparkles,
  HardDrive,
  FolderTree,
  LayoutDashboard,
  Package,
  Radio,
} from 'lucide-react';
import { NavTab, StartupSyncProgress } from '@/types';
import {
  ObsidianBadge,
  ObsidianButton,
  ObsidianStatusDot,
} from '@/components/obsidian/ObsidianPrimitives';

interface HeaderProps {
  currentTab: NavTab;
  onRefreshDrives: () => void;
  onQuickJunkScan: () => void;
  isRefreshing: boolean;
  driveCount: number;
  startupSync: StartupSyncProgress | null;
}

const TAB_META: Record<
  NavTab,
  { title: string; subtitle: string; icon: React.ReactNode }
> = {
  dashboard: {
    title: 'Storage Overview',
    subtitle: 'System storage health, connected volumes, and instant maintenance',
    icon: <LayoutDashboard className="h-4 w-4 text-[var(--obs-accent)]" />,
  },
  cleaner: {
    title: 'Junk Cleaner',
    subtitle: 'Dynamic system-detected safe clearing for browsers, AI agents, IDEs, and logs',
    icon: <Sparkles className="h-4 w-4 text-[var(--obs-accent)]" />,
  },
  analyzer: {
    title: 'Space Analyzer',
    subtitle: 'Real-time multi-drive folder tree and instant largest space hogs finder',
    icon: <FolderTree className="h-4 w-4 text-[var(--obs-accent)]" />,
  },
  apps: {
    title: 'App Storage',
    subtitle: 'Exact disk footprint of every installed software, profile data, and dev toolchain',
    icon: <Package className="h-4 w-4 text-[var(--obs-accent)]" />,
  },
};

function formatRateShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M/s`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k/s`;
  return `${n}/s`;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onRefreshDrives,
  onQuickJunkScan,
  isRefreshing,
  driveCount,
  startupSync,
}) => {
  const meta = TAB_META[currentTab];

  return (
    <header className="h-14 border-b border-[var(--obs-border)] bg-[var(--obs-bg)]/90 backdrop-blur-md px-6 flex items-center justify-between gap-3 shrink-0 z-10">
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-8 w-8 rounded-[9px] obs-control flex items-center justify-center shrink-0">
          {meta.icon}
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold tracking-tight text-[var(--obs-fg)] truncate">
            {meta.title}
          </h1>
          <p className="text-[11px] text-[var(--obs-text-muted)] truncate hidden sm:block">
            {meta.subtitle}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* Live Sequential Startup Disk Sync Indicator with Real-Time Speed */}
        {startupSync?.is_active && (
          <ObsidianBadge tone="warning" className="hidden md:inline-flex py-1 px-2.5 gap-1.5">
            <RefreshCw className="h-3 w-3 animate-spin" />
            <span className="font-mono text-[10px] tabular-nums">
              Syncing {startupSync.current_drive} ({startupSync.current_index}/
              {startupSync.total_drives})
              {startupSync.items_per_sec > 0
                ? ` • ${formatRateShort(startupSync.items_per_sec)}`
                : ''}
            </span>
          </ObsidianBadge>
        )}
        {startupSync && !startupSync.is_active && startupSync.stage === 'done' && (
          <ObsidianBadge
            tone="success"
            className="hidden xl:inline-flex py-1 px-2.5 gap-1.5"
          >
            <ObsidianStatusDot tone="success" pulse />
            <Radio className="h-3 w-3" />
            <span className="text-[10px]">
              {startupSync.completed_drives.length} Disk
              {startupSync.completed_drives.length === 1 ? '' : 's'} Live
            </span>
          </ObsidianBadge>
        )}

        {currentTab !== 'cleaner' && (
          <ObsidianButton variant="accent" size="sm" onClick={onQuickJunkScan}>
            <Sparkles className="h-3.5 w-3.5" />
            <span>Quick Junk Scan</span>
          </ObsidianButton>
        )}

        <ObsidianButton
          variant="control"
          size="sm"
          onClick={onRefreshDrives}
          disabled={isRefreshing}
          title="Refresh drive stats, installed targets and Recycle Bin"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-[var(--obs-accent)]' : ''}`}
          />
          <span className="hidden md:inline">Refresh</span>
          {driveCount > 0 && (
            <span className="hidden lg:inline-flex items-center gap-1 text-[10px] text-[var(--obs-text-muted)] border-l border-[var(--obs-border)] pl-1.5 ml-0.5 font-mono">
              <HardDrive className="h-3 w-3" />
              {driveCount}
            </span>
          )}
        </ObsidianButton>
      </div>
    </header>
  );
};
