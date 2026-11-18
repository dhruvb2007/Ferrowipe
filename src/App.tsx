import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  AnalyzerNavigationRequest,
  CleanerQuickTrigger,
  CleanerStatusSummary,
  DriveInfo,
  NavTab,
  RecycleBinStat,
} from '@/types';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { DriveOverview } from '@/components/DriveOverview';
import { JunkCleaner } from '@/components/JunkCleaner';
import { FolderAnalyzer } from '@/components/FolderAnalyzer';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [recycleBins, setRecycleBins] = useState<RecycleBinStat[]>([]);
  const [isLoadingDrives, setIsLoadingDrives] = useState(false);

  // Sidebar & Theme preferences
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ferrowipe:sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return localStorage.getItem('ferrowipe:theme') === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  });

  // Cross-view triggers & live statuses
  const [analyzerNavRequest, setAnalyzerNavRequest] =
    useState<AnalyzerNavigationRequest | null>(null);
  const [cleanerTrigger, setCleanerTrigger] = useState<CleanerQuickTrigger | null>(null);
  const [cleanerStatus, setCleanerStatus] = useState<CleanerStatusSummary>({
    isScanning: false,
    isCleaning: false,
    reclaimableBytes: 0,
    reclaimableFiles: 0,
  });
  const [activeAnalyzerPath, setActiveAnalyzerPath] = useState<string>('C:\\');
  const [isAnalyzerBusy, setIsAnalyzerBusy] = useState(false);

  // Apply theme class to <html>
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('ferrowipe:theme', theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  // Persist sidebar state
  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('ferrowipe:sidebar-collapsed', String(next));
      } catch {
        // Ignore
      }
      return next;
    });
  }, []);

  // Fetch drives & recycle bin info
  const fetchSystemOverview = useCallback(async (showToast = false) => {
    setIsLoadingDrives(true);
    try {
      const [driveData, binData] = await Promise.all([
        invoke<DriveInfo[]>('get_drives'),
        invoke<RecycleBinStat[]>('query_all_recycle_bins').catch(() => [] as RecycleBinStat[]),
      ]);
      setDrives(driveData);
      setRecycleBins(binData);
      if (showToast) {
        toast.success(`Refreshed ${driveData.length} storage volume${driveData.length === 1 ? '' : 's'}`);
      }
    } catch (err) {
      console.error('Failed to load drive information:', err);
      if (showToast) {
        toast.error('Unable to query storage volumes');
      }
    } finally {
      setIsLoadingDrives(false);
    }
  }, []);

  useEffect(() => {
    fetchSystemOverview(false);
  }, [fetchSystemOverview]);

  // Global keyboard shortcuts (Ctrl+1/2/3, Ctrl+B)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '1') {
        e.preventDefault();
        setCurrentTab('dashboard');
      } else if (e.key === '2') {
        e.preventDefault();
        setCurrentTab('cleaner');
      } else if (e.key === '3') {
        e.preventDefault();
        setCurrentTab('analyzer');
      } else if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        handleToggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleSidebar]);

  // Cross-tab convenience navigation handlers
  const handleQuickClean = useCallback((presetRuleIds?: string[]) => {
    setCurrentTab('cleaner');
    setCleanerTrigger({
      presetRuleIds,
      autoScan: true,
      nonce: Date.now(),
    });
  }, []);

  const handleNavigateToAnalyzer = useCallback(
    (
      path: string,
      options?: { mode?: 'tree' | 'deep_scan'; autoFullDisk?: boolean; minSizeMb?: number }
    ) => {
      setActiveAnalyzerPath(path);
      setCurrentTab('analyzer');
      setAnalyzerNavRequest({
        path,
        mode: options?.mode ?? 'tree',
        autoFullDisk: options?.autoFullDisk ?? false,
        minSizeMb: options?.minSizeMb,
        nonce: Date.now(),
      });
    },
    []
  );

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-screen w-screen bg-background text-foreground overflow-hidden font-sans">
        {/* Collapsible Desktop Navigation Sidebar */}
        <Sidebar
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          drives={drives}
          activeAnalyzerDrive={activeAnalyzerPath}
          onSelectDriveForAnalyzer={(mountPoint) =>
            handleNavigateToAnalyzer(mountPoint, { mode: 'tree' })
          }
          cleanerStatus={cleanerStatus}
          isAnalyzerBusy={isAnalyzerBusy}
          collapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleSidebar}
          theme={theme}
          onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        />

        {/* Right Application Shell */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          <Header
            currentTab={currentTab}
            onRefreshDrives={() => fetchSystemOverview(true)}
            onQuickJunkScan={() => handleQuickClean()}
            isRefreshing={isLoadingDrives}
            driveCount={drives.length}
          />

          {/* Persistent Views Container (preserves scan & tree state across tab switches) */}
          <main className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
            <div
              className={cn(
                'flex-1 min-h-0 flex flex-col overflow-hidden',
                currentTab !== 'dashboard' && 'hidden'
              )}
            >
              <DriveOverview
                drives={drives}
                recycleBins={recycleBins}
                isLoading={isLoadingDrives}
                cleanerStatus={cleanerStatus}
                onQuickClean={handleQuickClean}
                onNavigateToCleaner={() => setCurrentTab('cleaner')}
                onNavigateToAnalyzer={handleNavigateToAnalyzer}
              />
            </div>

            <div
              className={cn(
                'flex-1 min-h-0 flex flex-col overflow-hidden',
                currentTab !== 'cleaner' && 'hidden'
              )}
            >
              <JunkCleaner
                quickTrigger={cleanerTrigger}
                onCleanSuccess={() => fetchSystemOverview(false)}
                onStatusChange={setCleanerStatus}
              />
            </div>

            <div
              className={cn(
                'flex-1 min-h-0 flex flex-col overflow-hidden',
                currentTab !== 'analyzer' && 'hidden'
              )}
            >
              <FolderAnalyzer
                drives={drives}
                isActive={currentTab === 'analyzer'}
                navRequest={analyzerNavRequest}
                onRefreshDrives={() => fetchSystemOverview(false)}
                onActivePathChange={setActiveAnalyzerPath}
                onBusyChange={setIsAnalyzerBusy}
              />
            </div>
          </main>
        </div>
      </div>

      <Toaster theme={theme} richColors position="bottom-right" closeButton />
    </TooltipProvider>
  );
};

export default App;
