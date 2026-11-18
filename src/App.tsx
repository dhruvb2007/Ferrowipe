import React, { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import {
  AnalyzerNavigationRequest,
  CleanerQuickTrigger,
  CleanerStatusSummary,
  DetectedCleanupRule,
  DriveInfo,
  NavTab,
  RecycleBinStat,
  StartupSyncProgress,
} from '@/types';
import { Sidebar } from '@/components/Sidebar';
import { Header } from '@/components/Header';
import { DriveOverview } from '@/components/DriveOverview';
import { JunkCleaner } from '@/components/JunkCleaner';
import { FolderAnalyzer } from '@/components/FolderAnalyzer';
import { SoftwareStorage } from '@/components/SoftwareStorage';
import { ObsidianToaster, obsidianToast } from '@/components/obsidian/ObsidianToast';
import { cn } from '@/lib/utils';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [recycleBins, setRecycleBins] = useState<RecycleBinStat[]>([]);
  const [detectedRules, setDetectedRules] = useState<DetectedCleanupRule[]>([]);
  const [startupSync, setStartupSync] = useState<StartupSyncProgress | null>(null);
  const [isLoadingDrives, setIsLoadingDrives] = useState(false);

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

  const startupTriggeredRef = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    try {
      localStorage.setItem('ferrowipe:theme', theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

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

  const fetchDetectedRules = useCallback(async () => {
    try {
      const rules = await invoke<DetectedCleanupRule[]>('get_available_cleanup_rules');
      setDetectedRules(rules);
    } catch (err) {
      console.error('Failed to detect installed cleanup targets:', err);
    }
  }, []);

  const fetchSystemOverview = useCallback(async (showToast = false) => {
    setIsLoadingDrives(true);
    try {
      const [driveData, binData, rulesData] = await Promise.all([
        invoke<DriveInfo[]>('get_drives'),
        invoke<RecycleBinStat[]>('query_all_recycle_bins').catch(() => [] as RecycleBinStat[]),
        invoke<DetectedCleanupRule[]>('get_available_cleanup_rules').catch(
          () => [] as DetectedCleanupRule[]
        ),
      ]);
      setDrives(driveData);
      setRecycleBins(binData);
      if (rulesData.length > 0) {
        setDetectedRules(rulesData);
      }
      if (showToast) {
        obsidianToast.success(
          `Refreshed ${driveData.length} storage volume${driveData.length === 1 ? '' : 's'}`
        );
      }
    } catch (err) {
      console.error('Failed to load drive information:', err);
      if (showToast) {
        obsidianToast.error('Unable to query storage volumes');
      }
    } finally {
      setIsLoadingDrives(false);
    }
  }, []);

  useEffect(() => {
    fetchSystemOverview(false);
  }, [fetchSystemOverview]);

  // Fast sequential one-by-one disk sync on first app start + real-time listeners
  useEffect(() => {
    let unlistenStartup: UnlistenFn | undefined;
    let unlistenDrives: UnlistenFn | undefined;

    const setup = async () => {
      try {
        unlistenStartup = await listen<StartupSyncProgress>('startup:sync-progress', (event) => {
          setStartupSync(event.payload);
        });

        unlistenDrives = await listen<DriveInfo[]>('drives:updated', (event) => {
          setDrives(event.payload);
          invoke<RecycleBinStat[]>('query_all_recycle_bins')
            .then(setRecycleBins)
            .catch(() => {});
        });

        if (!startupTriggeredRef.current) {
          startupTriggeredRef.current = true;
          invoke<boolean>('start_initial_sync_all_drives', { force: false }).catch(() => {});
        }
      } catch {
        // Non-Tauri browser preview
      }
    };

    setup();
    return () => {
      if (unlistenStartup) unlistenStartup();
      if (unlistenDrives) unlistenDrives();
    };
  }, []);

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
      } else if (e.key === '4') {
        e.preventDefault();
        setCurrentTab('apps');
      } else if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        handleToggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleSidebar]);

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
    <div className="flex h-screen w-screen bg-[var(--obs-bg)] text-[var(--obs-fg)] overflow-hidden font-sans">
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
        startupSync={startupSync}
        collapsed={sidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        theme={theme}
        onToggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
      />

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <Header
          currentTab={currentTab}
          onRefreshDrives={() => fetchSystemOverview(true)}
          onQuickJunkScan={() => handleQuickClean()}
          isRefreshing={isLoadingDrives}
          driveCount={drives.length}
          startupSync={startupSync}
        />

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
              detectedRules={detectedRules}
              isLoading={isLoadingDrives}
              cleanerStatus={cleanerStatus}
              onQuickClean={handleQuickClean}
              onNavigateToCleaner={() => setCurrentTab('cleaner')}
              onNavigateToApps={() => setCurrentTab('apps')}
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
              detectedRules={detectedRules}
              onRefreshRules={fetchDetectedRules}
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

          <div
            className={cn(
              'flex-1 min-h-0 flex flex-col overflow-hidden',
              currentTab !== 'apps' && 'hidden'
            )}
          >
            <SoftwareStorage
              isActive={currentTab === 'apps'}
              onInspectPath={(path) => handleNavigateToAnalyzer(path, { mode: 'tree' })}
            />
          </div>
        </main>
      </div>

      <ObsidianToaster />
    </div>
  );
};

export default App;
