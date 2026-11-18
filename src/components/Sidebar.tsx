import React from 'react';
import { motion } from 'motion/react';
import {
  LayoutDashboard,
  Sparkles,
  FolderTree,
  HardDrive,
  Zap,
  Usb,
  Network,
  Disc,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
  AlertTriangle,
  Loader2,
  Package,
} from 'lucide-react';
import { CleanerStatusSummary, DriveInfo, NavTab, StartupSyncProgress } from '@/types';
import { formatBytes } from '@/utils';
import { cn } from '@/lib/utils';
import {
  ObsidianBadge,
  ObsidianButton,
  ObsidianProgress,
  ObsidianStatusDot,
} from '@/components/obsidian/ObsidianPrimitives';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  drives: DriveInfo[];
  activeAnalyzerDrive?: string;
  onSelectDriveForAnalyzer: (mountPoint: string) => void;
  cleanerStatus: CleanerStatusSummary;
  isAnalyzerBusy: boolean;
  startupSync: StartupSyncProgress | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  drives,
  activeAnalyzerDrive,
  onSelectDriveForAnalyzer,
  cleanerStatus,
  isAnalyzerBusy,
  startupSync,
  collapsed,
  onToggleCollapse,
  theme,
  onToggleTheme,
}) => {
  const lowSpaceCount = drives.filter((d) => d.is_low_space).length;
  const isBusy =
    cleanerStatus.isScanning ||
    cleanerStatus.isCleaning ||
    isAnalyzerBusy ||
    Boolean(startupSync?.is_active);

  const navItems: {
    id: NavTab;
    label: string;
    shortcut: string;
    icon: React.ReactNode;
    badge?: React.ReactNode;
  }[] = [
    {
      id: 'dashboard',
      label: 'Overview',
      shortcut: 'Ctrl+1',
      icon: <LayoutDashboard className="h-4 w-4 shrink-0" />,
      badge:
        lowSpaceCount > 0 ? (
          <ObsidianBadge tone="danger">
            <AlertTriangle className="h-2.5 w-2.5" />
            {lowSpaceCount}
          </ObsidianBadge>
        ) : null,
    },
    {
      id: 'cleaner',
      label: 'Junk Cleaner',
      shortcut: 'Ctrl+2',
      icon: <Sparkles className="h-4 w-4 shrink-0" />,
      badge:
        cleanerStatus.isScanning || cleanerStatus.isCleaning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--obs-accent)] shrink-0" />
        ) : cleanerStatus.reclaimableBytes > 0 ? (
          <ObsidianBadge tone="accent" className="font-mono">
            {formatBytes(cleanerStatus.reclaimableBytes, 0)}
          </ObsidianBadge>
        ) : null,
    },
    {
      id: 'analyzer',
      label: 'Space Analyzer',
      shortcut: 'Ctrl+3',
      icon: <FolderTree className="h-4 w-4 shrink-0" />,
      badge: isAnalyzerBusy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--obs-accent)] shrink-0" />
      ) : null,
    },
    {
      id: 'apps',
      label: 'App Storage',
      shortcut: 'Ctrl+4',
      icon: <Package className="h-4 w-4 shrink-0" />,
    },
  ];

  const getMiniDriveIcon = (type: string) => {
    if (type.includes('SSD')) return <Zap className="h-3.5 w-3.5 text-[var(--obs-accent)] shrink-0" />;
    if (type.includes('Removable')) return <Usb className="h-3.5 w-3.5 text-sky-400 shrink-0" />;
    if (type.includes('Network')) return <Network className="h-3.5 w-3.5 text-violet-400 shrink-0" />;
    if (type.includes('CD')) return <Disc className="h-3.5 w-3.5 text-[var(--obs-text-muted)] shrink-0" />;
    return <HardDrive className="h-3.5 w-3.5 text-[var(--obs-text-muted)] shrink-0" />;
  };

  const getDriveTone = (pct: number, isLow: boolean): 'danger' | 'warning' | 'accent' => {
    if (isLow || pct >= 90) return 'danger';
    if (pct >= 80) return 'warning';
    return 'accent';
  };

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-[var(--obs-border)] bg-[var(--obs-sidebar)] transition-[width] duration-200 ease-out shrink-0 z-20',
        collapsed ? 'w-[68px]' : 'w-[248px]'
      )}
    >
      {/* Brand Header with /Ferrowipe_LOGO.png */}
      <div
        className={cn(
          'h-14 flex items-center border-b border-[var(--obs-border)] px-3',
          collapsed ? 'justify-center' : 'justify-between'
        )}
      >
        <button
          type="button"
          onClick={() => onSelectTab('dashboard')}
          className="flex items-center gap-2.5 min-w-0 text-left group"
          title="Ferrowipe — Storage Overview"
        >
          <img
            src="/Ferrowipe_LOGO.png"
            alt="Ferrowipe Logo"
            className="h-9 w-9 rounded-[10px] object-cover shrink-0 shadow-sm ring-1 ring-black/10 dark:ring-white/10 transition-transform duration-200 group-hover:scale-105"
          />
          {!collapsed && (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm tracking-tight text-[var(--obs-fg)] truncate">
                  Ferrowipe
                </span>
              </div>
              <p className="text-[10px] text-[var(--obs-text-subtle)] truncate mt-0.5">
                Windows Disk Optimizer
              </p>
            </div>
          )}
        </button>

        {!collapsed && (
          <ObsidianButton
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onToggleCollapse}
            title="Collapse sidebar (Ctrl+B)"
          >
            <PanelLeftClose className="h-4 w-4" />
          </ObsidianButton>
        )}
      </div>

      {/* Scrollable Navigation Body */}
      <div className="flex-1 obs-scroll py-3 px-2.5 space-y-5">
        {collapsed && (
          <div className="flex justify-center">
            <ObsidianButton
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={onToggleCollapse}
              title="Expand sidebar (Ctrl+B)"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </ObsidianButton>
          </div>
        )}

        {/* Workspace Section */}
        <div className="space-y-1">
          {!collapsed && (
            <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--obs-text-subtle)]">
              Workspace
            </p>
          )}
          {navItems.map((item) => {
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                title={collapsed ? `${item.label} (${item.shortcut})` : undefined}
                className={cn(
                  'relative w-full flex items-center rounded-[10px] text-xs font-medium transition-colors z-10',
                  collapsed ? 'justify-center h-9 px-0' : 'justify-between h-9 px-2.5',
                  isActive
                    ? 'text-[var(--obs-fg)]'
                    : 'text-[var(--obs-text-muted)] hover:text-[var(--obs-fg)] hover:bg-[var(--obs-hover)]'
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="obs-sidebar-nav-active"
                    transition={{ type: 'spring', stiffness: 460, damping: 34 }}
                    className="absolute inset-0 rounded-[10px] obs-control -z-10"
                  />
                )}
                {isActive && (
                  <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-[var(--obs-accent)]" />
                )}

                <span className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={cn(
                      isActive ? 'text-[var(--obs-accent)]' : 'text-[var(--obs-text-muted)]'
                    )}
                  >
                    {item.icon}
                  </span>
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </span>

                {!collapsed && (
                  <span className="flex items-center gap-1.5 shrink-0">
                    {item.badge}
                    {!item.badge && (
                      <kbd className="text-[9px] font-mono text-[var(--obs-text-subtle)] bg-[var(--obs-bg)]/80 border border-[var(--obs-border)] px-1.5 py-0.5 rounded-[5px]">
                        {item.shortcut}
                      </kbd>
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="h-px bg-[var(--obs-border)] mx-1" />

        {/* Quick Drives Section */}
        <div className="space-y-1.5">
          {!collapsed && (
            <div className="px-2.5 flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--obs-text-subtle)]">
                Quick Drives
              </p>
              <span className="text-[10px] font-mono text-[var(--obs-text-subtle)]">
                {drives.length}
              </span>
            </div>
          )}

          {drives.length === 0 ? (
            !collapsed && (
              <p className="px-2.5 py-1 text-[11px] text-[var(--obs-text-subtle)]">
                No drives detected
              </p>
            )
          ) : (
            <div className="space-y-1">
              {drives.map((drive) => {
                const isFocused =
                  currentTab === 'analyzer' &&
                  activeAnalyzerDrive?.toUpperCase().startsWith(drive.mount_point.toUpperCase());

                if (collapsed) {
                  return (
                    <button
                      key={drive.mount_point}
                      type="button"
                      onClick={() => onSelectDriveForAnalyzer(drive.mount_point)}
                      title={`${drive.volume_name} (${drive.mount_point}) — ${formatBytes(drive.available_bytes)} free`}
                      className={cn(
                        'w-full h-9 rounded-[10px] flex flex-col items-center justify-center gap-1 transition-all',
                        isFocused
                          ? 'obs-control text-[var(--obs-accent)]'
                          : 'text-[var(--obs-text-muted)] hover:bg-[var(--obs-hover)] hover:text-[var(--obs-fg)]'
                      )}
                    >
                      <span className="text-[11px] font-mono font-bold leading-none">
                        {drive.mount_point.replace('\\', '')}
                      </span>
                      <span
                        className={cn(
                          'h-1 w-6 rounded-full',
                          drive.is_low_space
                            ? 'bg-[var(--obs-danger)]'
                            : 'bg-[var(--obs-accent)]/70'
                        )}
                      />
                    </button>
                  );
                }

                return (
                  <button
                    key={drive.mount_point}
                    type="button"
                    onClick={() => onSelectDriveForAnalyzer(drive.mount_point)}
                    className={cn(
                      'w-full rounded-[10px] p-2.5 text-left transition-all space-y-1.5',
                      isFocused
                        ? 'obs-control ring-1 ring-[var(--obs-accent-border)]'
                        : 'hover:bg-[var(--obs-hover)]'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {getMiniDriveIcon(drive.drive_type)}
                        <span className="text-xs font-medium text-[var(--obs-fg)] truncate">
                          {drive.volume_name}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono font-bold text-[var(--obs-accent)] shrink-0">
                        {drive.mount_point.replace('\\', '')}
                      </span>
                    </div>

                    <ObsidianProgress
                      value={drive.usage_percentage}
                      tone={getDriveTone(drive.usage_percentage, drive.is_low_space)}
                      className="h-1.5"
                    />

                    <div className="flex items-center justify-between text-[10px] text-[var(--obs-text-muted)] tabular-nums">
                      <span className={drive.is_low_space ? 'text-[var(--obs-danger)] font-medium' : ''}>
                        {formatBytes(drive.available_bytes)} free
                      </span>
                      <span>{drive.usage_percentage}%</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sidebar Footer */}
      <div className="border-t border-[var(--obs-border)] p-2.5">
        <div
          className={cn(
            'flex items-center',
            collapsed ? 'justify-center' : 'justify-between px-1.5'
          )}
        >
          {!collapsed && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--obs-text-muted)]">
              <ObsidianStatusDot tone={isBusy ? 'warning' : 'success'} pulse />
              <span className="truncate">
                {cleanerStatus.isCleaning
                  ? 'Purging Junk...'
                  : startupSync?.is_active
                  ? `Syncing ${startupSync.current_drive} (${startupSync.current_index}/${startupSync.total_drives})`
                  : isBusy
                  ? 'Engine Active'
                  : startupSync?.stage === 'done'
                  ? `Live Sync (${startupSync.completed_drives.length} disks)`
                  : 'Rust Engine Ready'}
              </span>
            </div>
          )}

          <ObsidianButton
            variant="ghost"
            size="icon"
            onClick={onToggleTheme}
            className="h-7 w-7 shrink-0"
            title={`Switch to ${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          >
            {theme === 'dark' ? (
              <Sun className="h-3.5 w-3.5" />
            ) : (
              <Moon className="h-3.5 w-3.5" />
            )}
          </ObsidianButton>
        </div>
      </div>
    </aside>
  );
};
