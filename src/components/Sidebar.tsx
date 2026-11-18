import React from 'react';
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
} from 'lucide-react';
import { CleanerStatusSummary, DriveInfo, NavTab } from '@/types';
import { formatBytes } from '@/utils';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  drives: DriveInfo[];
  activeAnalyzerDrive?: string;
  onSelectDriveForAnalyzer: (mountPoint: string) => void;
  cleanerStatus: CleanerStatusSummary;
  isAnalyzerBusy: boolean;
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
  collapsed,
  onToggleCollapse,
  theme,
  onToggleTheme,
}) => {
  const lowSpaceCount = drives.filter((d) => d.is_low_space).length;

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
          <Badge variant="destructive" className="h-5 px-1.5 text-[10px] font-semibold gap-0.5">
            <AlertTriangle className="h-2.5 w-2.5" />
            {lowSpaceCount}
          </Badge>
        ) : null,
    },
    {
      id: 'cleaner',
      label: 'Junk Cleaner',
      shortcut: 'Ctrl+2',
      icon: <Sparkles className="h-4 w-4 shrink-0" />,
      badge:
        cleanerStatus.isScanning || cleanerStatus.isCleaning ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
        ) : cleanerStatus.reclaimableBytes > 0 ? (
          <Badge
            variant="secondary"
            className="h-5 px-1.5 text-[10px] font-mono text-primary bg-primary/10 border border-primary/25"
          >
            {formatBytes(cleanerStatus.reclaimableBytes, 0)}
          </Badge>
        ) : null,
    },
    {
      id: 'analyzer',
      label: 'Space Analyzer',
      shortcut: 'Ctrl+3',
      icon: <FolderTree className="h-4 w-4 shrink-0" />,
      badge: isAnalyzerBusy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
      ) : null,
    },
  ];

  const getMiniDriveIcon = (type: string) => {
    if (type.includes('SSD')) return <Zap className="h-3.5 w-3.5 text-cyan-500 shrink-0" />;
    if (type.includes('Removable')) return <Usb className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
    if (type.includes('Network')) return <Network className="h-3.5 w-3.5 text-purple-500 shrink-0" />;
    if (type.includes('CD')) return <Disc className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
    return <HardDrive className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  };

  const getUsageBarClass = (pct: number, isLow: boolean) => {
    if (isLow || pct >= 90) return 'bg-destructive';
    if (pct >= 80) return 'bg-amber-500';
    return 'bg-primary';
  };

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-all duration-200 shrink-0 z-20',
        collapsed ? 'w-[64px]' : 'w-[248px]'
      )}
    >
      {/* Brand Header */}
      <div
        className={cn(
          'h-14 flex items-center border-b border-sidebar-border px-3',
          collapsed ? 'justify-center' : 'justify-between'
        )}
      >
        <button
          onClick={() => onSelectTab('dashboard')}
          className="flex items-center gap-2.5 min-w-0 text-left group"
          title="Ferrowipe Home"
        >
          <img
            src="/ferrowipe-icon.svg"
            alt="Ferrowipe"
            className="h-8 w-8 rounded-lg shrink-0 shadow-sm transition-transform group-hover:scale-105"
          />
          {!collapsed && (
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm tracking-tight text-foreground truncate">
                  Ferrowipe
                </span>
                <Badge
                  variant="outline"
                  className="text-[9px] px-1.5 py-0 h-4 font-mono text-primary border-primary/30 bg-primary/10"
                >
                  v0.1
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground truncate">Windows Disk Optimizer</p>
            </div>
          )}
        </button>

        {!collapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                onClick={onToggleCollapse}
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Collapse sidebar</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Navigation Body */}
      <ScrollArea className="flex-1 py-3">
        <div className="px-2.5 space-y-5">
          {/* Expand Button when collapsed */}
          {collapsed && (
            <div className="flex justify-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    onClick={onToggleCollapse}
                  >
                    <PanelLeftOpen className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Expand sidebar</TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Primary Navigation */}
          <div className="space-y-1">
            {!collapsed && (
              <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                Workspace
              </p>
            )}
            {navItems.map((item) => {
              const isActive = currentTab === item.id;
              const btn = (
                <button
                  key={item.id}
                  onClick={() => onSelectTab(item.id)}
                  className={cn(
                    'w-full flex items-center rounded-lg text-xs font-medium transition-all relative',
                    collapsed ? 'justify-center h-9 px-0' : 'justify-between h-9 px-2.5',
                    isActive
                      ? 'bg-sidebar-accent text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60'
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-primary" />
                  )}
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span className={cn(isActive ? 'text-primary' : 'text-muted-foreground')}>
                      {item.icon}
                    </span>
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </span>

                  {!collapsed && (
                    <span className="flex items-center gap-1.5 shrink-0">
                      {item.badge}
                      {!item.badge && (
                        <kbd className="text-[9px] font-mono text-muted-foreground/70 bg-background/60 border border-border/70 px-1 py-0.5 rounded">
                          {item.shortcut}
                        </kbd>
                      )}
                    </span>
                  )}
                </button>
              );

              if (collapsed) {
                return (
                  <Tooltip key={item.id}>
                    <TooltipTrigger asChild>{btn}</TooltipTrigger>
                    <TooltipContent side="right" className="flex items-center gap-2">
                      <span>{item.label}</span>
                      <kbd className="text-[10px] font-mono opacity-75">{item.shortcut}</kbd>
                    </TooltipContent>
                  </Tooltip>
                );
              }
              return btn;
            })}
          </div>

          <Separator className="bg-sidebar-border" />

          {/* Quick Drives Jump List */}
          <div className="space-y-1.5">
            {!collapsed && (
              <div className="px-2.5 flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                  Quick Drives
                </p>
                <span className="text-[10px] font-mono text-muted-foreground">
                  {drives.length}
                </span>
              </div>
            )}

            {drives.length === 0 ? (
              !collapsed && (
                <p className="px-2.5 text-[11px] text-muted-foreground/70 py-1">
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
                      <Tooltip key={drive.mount_point}>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() => onSelectDriveForAnalyzer(drive.mount_point)}
                            className={cn(
                              'w-full h-9 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-colors border',
                              isFocused
                                ? 'bg-primary/15 border-primary/35 text-primary'
                                : 'border-transparent hover:bg-sidebar-accent text-muted-foreground hover:text-foreground'
                            )}
                          >
                            <span className="text-[11px] font-mono font-bold leading-none">
                              {drive.mount_point.replace('\\', '')}
                            </span>
                            <span
                              className={cn(
                                'h-1 w-6 rounded-full',
                                drive.is_low_space ? 'bg-destructive' : 'bg-primary/60'
                              )}
                            />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right" className="space-y-1">
                          <p className="font-semibold text-xs">
                            {drive.volume_name} ({drive.mount_point})
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatBytes(drive.available_bytes)} free of{' '}
                            {formatBytes(drive.total_bytes)} ({drive.usage_percentage}% used)
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  }

                  return (
                    <button
                      key={drive.mount_point}
                      onClick={() => onSelectDriveForAnalyzer(drive.mount_point)}
                      className={cn(
                        'w-full rounded-lg p-2 text-left transition-all border space-y-1.5',
                        isFocused
                          ? 'bg-sidebar-accent border-primary/35'
                          : 'border-transparent hover:bg-sidebar-accent/60 hover:border-sidebar-border'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {getMiniDriveIcon(drive.drive_type)}
                          <span className="text-xs font-medium text-foreground truncate">
                            {drive.volume_name}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono font-semibold text-primary shrink-0">
                          {drive.mount_point.replace('\\', '')}
                        </span>
                      </div>

                      <Progress
                        value={Math.min(drive.usage_percentage, 100)}
                        className="h-1.5"
                        indicatorClassName={getUsageBarClass(
                          drive.usage_percentage,
                          drive.is_low_space
                        )}
                      />

                      <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
                        <span className={drive.is_low_space ? 'text-destructive font-medium' : ''}>
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
      </ScrollArea>

      {/* Sidebar Footer */}
      <div className="border-t border-sidebar-border p-2.5 space-y-2">
        <div
          className={cn(
            'flex items-center',
            collapsed ? 'justify-center' : 'justify-between px-1.5'
          )}
        >
          {!collapsed && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span
                className={cn(
                  'h-2 w-2 rounded-full shrink-0',
                  cleanerStatus.isScanning || cleanerStatus.isCleaning || isAnalyzerBusy
                    ? 'bg-amber-500 animate-pulse'
                    : 'bg-primary'
                )}
              />
              <span className="truncate">
                {cleanerStatus.isCleaning
                  ? 'Cleaning...'
                  : cleanerStatus.isScanning || isAnalyzerBusy
                  ? 'Engine Active'
                  : 'Rust Engine Ready'}
              </span>
            </div>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleTheme}
                className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
              >
                {theme === 'dark' ? (
                  <Sun className="h-3.5 w-3.5" />
                ) : (
                  <Moon className="h-3.5 w-3.5" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              Switch to {theme === 'dark' ? 'Light' : 'Dark'} mode
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
};
