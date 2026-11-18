import React from 'react';
import { RefreshCw, Sparkles, HardDrive, FolderTree, LayoutDashboard } from 'lucide-react';
import { NavTab } from '@/types';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface HeaderProps {
  currentTab: NavTab;
  onRefreshDrives: () => void;
  onQuickJunkScan: () => void;
  isRefreshing: boolean;
  driveCount: number;
}

const TAB_META: Record<
  NavTab,
  { title: string; subtitle: string; icon: React.ReactNode }
> = {
  dashboard: {
    title: 'Storage Overview',
    subtitle: 'System health, real-time volumes, and one-click maintenance',
    icon: <LayoutDashboard className="h-4 w-4 text-primary" />,
  },
  cleaner: {
    title: 'Junk Cleaner',
    subtitle: 'Rule-based safe cleanup for caches, temp files, and logs',
    icon: <Sparkles className="h-4 w-4 text-primary" />,
  },
  analyzer: {
    title: 'Space Analyzer',
    subtitle: 'Interactive disk tree explorer and top space hogs finder',
    icon: <FolderTree className="h-4 w-4 text-primary" />,
  },
};

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onRefreshDrives,
  onQuickJunkScan,
  isRefreshing,
  driveCount,
}) => {
  const meta = TAB_META[currentTab];

  return (
    <header className="h-14 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-6 flex items-center justify-between shrink-0 z-10">
      {/* Contextual Page Heading */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-8 w-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          {meta.icon}
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold tracking-tight text-foreground truncate">
            {meta.title}
          </h1>
          <p className="text-[11px] text-muted-foreground truncate hidden sm:block">
            {meta.subtitle}
          </p>
        </div>
      </div>

      {/* Right Contextual Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {currentTab !== 'cleaner' && (
          <Button size="sm" onClick={onQuickJunkScan} className="h-8 gap-1.5 text-xs">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Quick Junk Scan</span>
          </Button>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={onRefreshDrives}
              disabled={isRefreshing}
              className="h-8 gap-1.5 text-xs"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-primary' : ''}`}
              />
              <span className="hidden md:inline">Refresh</span>
              {driveCount > 0 && (
                <span className="hidden lg:inline-flex items-center gap-1 text-[10px] text-muted-foreground border-l pl-1.5 ml-0.5 font-mono">
                  <HardDrive className="h-3 w-3" />
                  {driveCount}
                </span>
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh drive hardware stats &amp; Recycle Bin</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
};
