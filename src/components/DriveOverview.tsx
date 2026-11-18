import React, { useMemo } from 'react';
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
import { toast } from 'sonner';
import { CleanerStatusSummary, DriveInfo, RecycleBinStat } from '@/types';
import { formatBytes } from '@/utils';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';

interface DriveOverviewProps {
  drives: DriveInfo[];
  recycleBins: RecycleBinStat[];
  isLoading: boolean;
  cleanerStatus: CleanerStatusSummary;
  onQuickClean: (presetRuleIds?: string[]) => void;
  onNavigateToCleaner: () => void;
  onNavigateToAnalyzer: (
    path: string,
    options?: { mode?: 'tree' | 'deep_scan'; autoFullDisk?: boolean; minSizeMb?: number }
  ) => void;
}

export const DriveOverview: React.FC<DriveOverviewProps> = ({
  drives,
  recycleBins,
  isLoading,
  cleanerStatus,
  onQuickClean,
  onNavigateToCleaner,
  onNavigateToAnalyzer,
}) => {
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
    if (type.includes('SSD')) return <Zap className="h-5 w-5 text-cyan-500" />;
    if (type.includes('Removable')) return <Usb className="h-5 w-5 text-blue-500" />;
    if (type.includes('Network')) return <Network className="h-5 w-5 text-purple-500" />;
    if (type.includes('CD')) return <Disc className="h-5 w-5 text-muted-foreground" />;
    return <HardDrive className="h-5 w-5 text-amber-500" />;
  };

  const getDriveTypeBadge = (type: string) => {
    if (type.includes('SSD')) {
      return (
        <Badge
          variant="outline"
          className="text-[10px] gap-1 border-cyan-500/30 bg-cyan-500/10 text-cyan-500 font-medium"
        >
          <Zap className="h-2.5 w-2.5" /> SSD / NVMe
        </Badge>
      );
    }
    if (type.includes('Removable')) {
      return (
        <Badge
          variant="outline"
          className="text-[10px] gap-1 border-blue-500/30 bg-blue-500/10 text-blue-500 font-medium"
        >
          <Usb className="h-2.5 w-2.5" /> USB
        </Badge>
      );
    }
    if (type.includes('Network')) {
      return (
        <Badge
          variant="outline"
          className="text-[10px] gap-1 border-purple-500/30 bg-purple-500/10 text-purple-500 font-medium"
        >
          <Network className="h-2.5 w-2.5" /> Network
        </Badge>
      );
    }
    return (
      <Badge
        variant="outline"
        className="text-[10px] gap-1 border-amber-500/30 bg-amber-500/10 text-amber-500 font-medium"
      >
        <HardDrive className="h-2.5 w-2.5" /> HDD
      </Badge>
    );
  };

  const getIndicatorClass = (pct: number, isLow: boolean) => {
    if (isLow || pct >= 90) return 'bg-destructive';
    if (pct >= 80) return 'bg-amber-500';
    return 'bg-primary';
  };

  const handleOpenExplorer = async (mountPoint: string) => {
    try {
      await invoke('open_in_explorer', { path: mountPoint });
    } catch (err) {
      toast.error(`Failed to open Explorer for ${mountPoint}`);
      console.error(err);
    }
  };

  // SVG Ring calculation
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(totals.pct, 100) / 100) * circumference;

  const healthState =
    lowSpaceDrives.length > 0 || totals.pct >= 90
      ? { label: 'Low Space Attention', color: 'text-destructive', stroke: 'stroke-destructive' }
      : totals.pct >= 80
      ? { label: 'Moderate Usage', color: 'text-amber-500', stroke: 'stroke-amber-500' }
      : { label: 'Healthy Headroom', color: 'text-primary', stroke: 'stroke-primary' };

  const primaryMount = primaryDrive?.mount_point || 'C:\\';

  if (isLoading && drives.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Skeleton className="h-48 lg:col-span-2 rounded-xl" />
          <Skeleton className="h-48 rounded-xl" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <Skeleton className="h-52 rounded-xl" />
          <Skeleton className="h-52 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 h-full">
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Low Space Warning Alert */}
        {lowSpaceDrives.length > 0 && (
          <Alert variant="destructive" className="bg-destructive/10 border-destructive/40">
            <AlertTriangle className="h-4 w-4" />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
              <div>
                <AlertTitle className="text-sm font-semibold">
                  Low Storage Headroom Detected ({lowSpaceDrives.map((d) => d.mount_point).join(', ')})
                </AlertTitle>
                <AlertDescription className="text-xs opacity-90 mt-0.5">
                  Free space has dropped below 15% or 15 GB. Clear accumulated caches or inspect
                  large folders to keep Windows responsive.
                </AlertDescription>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs border-destructive/40 hover:bg-destructive/20"
                  onClick={() =>
                    onNavigateToAnalyzer(lowSpaceDrives[0].mount_point, {
                      mode: 'deep_scan',
                      minSizeMb: 100,
                    })
                  }
                >
                  <Flame className="h-3.5 w-3.5 mr-1.5" />
                  Space Hogs
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-8 text-xs"
                  onClick={() => onQuickClean()}
                >
                  <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                  Clean Junk Now
                </Button>
              </div>
            </div>
          </Alert>
        )}

        {/* Hero Storage Summary Bento */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* System Storage Health Overview Card */}
          <Card className="lg:col-span-2 relative overflow-hidden">
            <CardHeader className="pb-3 flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base font-semibold">System Storage Health</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Aggregated across {drives.length} mounted volume{drives.length === 1 ? '' : 's'}
                  {totals.ssdCount > 0 ? ` (${totals.ssdCount} SSD/NVMe detected)` : ''}
                </CardDescription>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  'gap-1 text-[11px] font-medium',
                  lowSpaceDrives.length > 0
                    ? 'border-destructive/40 bg-destructive/10 text-destructive'
                    : 'border-primary/30 bg-primary/10 text-primary'
                )}
              >
                {lowSpaceDrives.length > 0 ? (
                  <AlertTriangle className="h-3 w-3" />
                ) : (
                  <ShieldCheck className="h-3 w-3" />
                )}
                {healthState.label}
              </Badge>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row items-center gap-6">
                {/* Compact Ring Gauge */}
                <div className="relative h-24 w-24 shrink-0 flex items-center justify-center">
                  <svg className="h-24 w-24 -rotate-90" viewBox="0 0 96 96">
                    <circle
                      cx="48"
                      cy="48"
                      r={radius}
                      fill="none"
                      strokeWidth="8"
                      className="stroke-secondary"
                    />
                    <circle
                      cx="48"
                      cy="48"
                      r={radius}
                      fill="none"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      strokeDashoffset={strokeDashoffset}
                      className={cn('transition-all duration-700', healthState.stroke)}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xl font-bold tabular-nums leading-none">
                      {totals.pct}%
                    </span>
                    <span className="text-[10px] text-muted-foreground mt-0.5">Used</span>
                  </div>
                </div>

                {/* 3 Stat Tiles */}
                <div className="grid grid-cols-3 gap-2.5 flex-1 w-full">
                  <div className="rounded-lg border bg-muted/35 p-3 min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground truncate">
                      Capacity
                    </p>
                    <p className="text-base sm:text-lg font-bold tabular-nums mt-1 text-foreground truncate">
                      {formatBytes(totals.totalBytes)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {drives.length} Volume{drives.length === 1 ? '' : 's'}
                    </p>
                  </div>

                  <div className="rounded-lg border bg-muted/35 p-3 min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground truncate">
                      Used
                    </p>
                    <p className="text-base sm:text-lg font-bold tabular-nums mt-1 text-foreground truncate">
                      {formatBytes(totals.usedBytes)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {totals.pct}% Allocated
                    </p>
                  </div>

                  <div className="rounded-lg border bg-muted/35 p-3 min-w-0">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground truncate">
                      Available
                    </p>
                    <p
                      className={cn(
                        'text-base sm:text-lg font-bold tabular-nums mt-1 truncate',
                        lowSpaceDrives.length > 0 ? 'text-destructive' : 'text-primary'
                      )}
                    >
                      {formatBytes(totals.availableBytes)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {100 - totals.pct}% Free
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recycle Bin & Quick Status Card */}
          <Card className="flex flex-col justify-between">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold flex items-center gap-2">
                  <Trash2 className="h-4 w-4 text-primary" />
                  Recycle Bin
                </CardTitle>
                <Badge variant="secondary" className="text-[10px] font-mono">
                  {recycleSummary.totalItems.toLocaleString()} item
                  {recycleSummary.totalItems === 1 ? '' : 's'}
                </Badge>
              </div>
              <CardDescription className="text-xs">
                Instant native check across local drives
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-muted/35 p-3 flex items-baseline justify-between">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Reclaimable Now
                  </p>
                  <p className="text-2xl font-bold tabular-nums text-foreground mt-0.5">
                    {formatBytes(recycleSummary.totalBytes)}
                  </p>
                </div>
                {cleanerStatus.reclaimableBytes > 0 && (
                  <button
                    onClick={onNavigateToCleaner}
                    className="text-right group"
                  >
                    <p className="text-[10px] uppercase tracking-wider text-primary font-medium">
                      Last Scan Found
                    </p>
                    <p className="text-sm font-bold font-mono text-primary group-hover:underline">
                      {formatBytes(cleanerStatus.reclaimableBytes)} →
                    </p>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  className="w-full text-xs gap-1.5"
                  onClick={() => onQuickClean()}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Smart Scan
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs gap-1.5"
                  onClick={() => onQuickClean(['recycle_bin'])}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Empty Bin
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* One-Click Quick Maintenance Shortcuts */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              Quick Actions
            </h2>
            <span className="text-[11px] text-muted-foreground">
              One-click workflows for common cleanup tasks
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <button
              onClick={() =>
                onQuickClean(['user_temp', 'windows_temp', 'recycle_bin', 'thumb_cache'])
              }
              className="group rounded-xl border bg-card p-4 text-left transition-all hover:border-primary/40 hover:bg-accent/40 flex flex-col justify-between gap-3"
            >
              <div className="flex items-center justify-between w-full">
                <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary border border-primary/20 flex items-center justify-center">
                  <Sparkles className="h-4 w-4" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground">Quick Safe Clean</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Scan Temp folders, Recycle Bin &amp; Thumbnails
                </p>
              </div>
            </button>

            <button
              onClick={() =>
                onQuickClean([
                  'browser_chrome',
                  'browser_edge',
                  'browser_firefox',
                  'browser_brave',
                ])
              }
              className="group rounded-xl border bg-card p-4 text-left transition-all hover:border-amber-500/40 hover:bg-accent/40 flex flex-col justify-between gap-3"
            >
              <div className="flex items-center justify-between w-full">
                <div className="h-9 w-9 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center justify-center">
                  <Globe className="h-4 w-4" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-amber-500" />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground">Browser Caches</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Clear Chrome, Edge, Firefox &amp; Brave cache
                </p>
              </div>
            </button>

            <button
              onClick={() =>
                onNavigateToAnalyzer(primaryMount, {
                  mode: 'deep_scan',
                  minSizeMb: 100,
                })
              }
              className="group rounded-xl border bg-card p-4 text-left transition-all hover:border-orange-500/40 hover:bg-accent/40 flex flex-col justify-between gap-3"
            >
              <div className="flex items-center justify-between w-full">
                <div className="h-9 w-9 rounded-lg bg-orange-500/10 text-orange-500 border border-orange-500/20 flex items-center justify-center">
                  <Flame className="h-4 w-4" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-orange-500" />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground">Top Space Hogs</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Find folders &gt; 100 MB on {primaryMount}
                </p>
              </div>
            </button>

            <button
              onClick={() =>
                onNavigateToAnalyzer(primaryMount, {
                  mode: 'tree',
                  autoFullDisk: true,
                })
              }
              className="group rounded-xl border bg-card p-4 text-left transition-all hover:border-cyan-500/40 hover:bg-accent/40 flex flex-col justify-between gap-3"
            >
              <div className="flex items-center justify-between w-full">
                <div className="h-9 w-9 rounded-lg bg-cyan-500/10 text-cyan-500 border border-cyan-500/20 flex items-center justify-center">
                  <FolderTree className="h-4 w-4" />
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-500" />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground">Full Disk Index</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Deep-index {primaryMount} for instant tree drilldown
                </p>
              </div>
            </button>
          </div>
        </div>

        {/* Connected Storage Volumes */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-foreground">
                Connected Storage Volumes
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Direct Win32 hardware detection, partition filesystems, and live capacity
              </p>
            </div>
            <Badge variant="secondary" className="gap-1.5 text-xs font-normal">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              {drives.length} Volume{drives.length === 1 ? '' : 's'} Online
            </Badge>
          </div>

          {drives.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center space-y-2">
                <HardDrive className="h-8 w-8 text-muted-foreground mx-auto opacity-60" />
                <p className="text-sm font-medium text-foreground">No Storage Volumes Detected</p>
                <p className="text-xs text-muted-foreground">
                  Run Ferrowipe via the Tauri desktop app or click Refresh to query connected drives.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {drives.map((drive) => (
                <Card
                  key={drive.mount_point}
                  className={cn(
                    'transition-all hover:border-primary/35 flex flex-col justify-between',
                    drive.is_low_space && 'border-destructive/45'
                  )}
                >
                  <CardContent className="p-5 space-y-4">
                    {/* Drive Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-11 w-11 rounded-xl bg-muted/60 border flex items-center justify-center shrink-0">
                          {getDriveIcon(drive.drive_type)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold text-sm text-foreground truncate">
                              {drive.volume_name}
                            </h3>
                            <Badge
                              variant="secondary"
                              className="font-mono text-[11px] font-bold px-2 py-0 text-primary"
                            >
                              {drive.mount_point}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                            {getDriveTypeBadge(drive.drive_type)}
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {drive.fs_type}
                            </Badge>
                          </div>
                        </div>
                      </div>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
                            onClick={() => handleOpenExplorer(drive.mount_point)}
                          >
                            <FolderOpen className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Open {drive.mount_point} in File Explorer</TooltipContent>
                      </Tooltip>
                    </div>

                    {/* Capacity Progress */}
                    <div className="space-y-1.5">
                      <Progress
                        value={Math.min(drive.usage_percentage, 100)}
                        className="h-2.5"
                        indicatorClassName={getIndicatorClass(
                          drive.usage_percentage,
                          drive.is_low_space
                        )}
                      />
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground tabular-nums">
                          {drive.usage_percentage}% used
                        </span>
                        {drive.is_low_space ? (
                          <span className="text-destructive font-medium flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> Low Space Warning
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-[11px]">
                            {drive.drive_type.includes('SSD')
                              ? 'TRIM Supported'
                              : 'Standard Volume'}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Metrics Breakdown */}
                    <div className="grid grid-cols-3 divide-x rounded-lg border bg-muted/30 py-2.5 text-center">
                      <div className="px-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                          Used
                        </p>
                        <p className="text-xs font-semibold text-foreground tabular-nums mt-0.5">
                          {formatBytes(drive.used_bytes)}
                        </p>
                      </div>
                      <div className="px-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                          Free
                        </p>
                        <p
                          className={cn(
                            'text-xs font-semibold tabular-nums mt-0.5',
                            drive.is_low_space ? 'text-destructive' : 'text-primary'
                          )}
                        >
                          {formatBytes(drive.available_bytes)}
                        </p>
                      </div>
                      <div className="px-2">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                          Capacity
                        </p>
                        <p className="text-xs font-semibold text-foreground tabular-nums mt-0.5">
                          {formatBytes(drive.total_bytes)}
                        </p>
                      </div>
                    </div>

                    {/* Drive Actions */}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-8 text-xs gap-1.5"
                          onClick={() =>
                            onNavigateToAnalyzer(drive.mount_point, { mode: 'tree' })
                          }
                        >
                          <FolderTree className="h-3.5 w-3.5" />
                          Explore
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs gap-1.5"
                          onClick={() =>
                            onNavigateToAnalyzer(drive.mount_point, {
                              mode: 'deep_scan',
                              minSizeMb: 100,
                            })
                          }
                        >
                          <Flame className="h-3.5 w-3.5 text-orange-500" />
                          Space Hogs
                        </Button>
                      </div>

                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs gap-1 text-primary hover:text-primary"
                        onClick={() =>
                          onNavigateToAnalyzer(drive.mount_point, {
                            mode: 'tree',
                            autoFullDisk: true,
                          })
                        }
                      >
                        Full Scan
                        <ArrowRight className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
};
