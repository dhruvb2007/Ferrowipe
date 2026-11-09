import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DriveInfo } from './types';
import { Header } from './components/Header';
import { DriveOverview } from './components/DriveOverview';
import { JunkCleaner } from './components/JunkCleaner';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<'drives' | 'cleaner'>('drives');
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [isLoadingDrives, setIsLoadingDrives] = useState(false);

  const fetchDrives = useCallback(async () => {
    setIsLoadingDrives(true);
    try {
      const data = await invoke<DriveInfo[]>('get_drives');
      setDrives(data);
    } catch (err) {
      console.error('Failed to load drive information:', err);
    } finally {
      setIsLoadingDrives(false);
    }
  }, []);

  useEffect(() => {
    fetchDrives();
  }, [fetchDrives]);

  return (
    <div className="flex flex-col h-screen w-screen bg-surface-950 text-slate-100 overflow-hidden font-sans">
      {/* Top Header */}
      <Header
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        onRefreshDrives={fetchDrives}
        isRefreshing={isLoadingDrives}
      />

      {/* Main Content Body */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {currentTab === 'drives' ? (
          <DriveOverview
            drives={drives}
            isLoading={isLoadingDrives}
            onNavigateToCleaner={() => setCurrentTab('cleaner')}
          />
        ) : (
          <JunkCleaner onCleanSuccess={fetchDrives} />
        )}
      </main>

      {/* Subtle Status Footer */}
      <footer className="h-7 border-t border-slate-900 bg-surface-950 px-6 flex items-center justify-between text-[11px] text-slate-400 select-none">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
          <span>Ferrowipe Engine Ready</span>
        </div>
        <div className="flex items-center gap-4">
          <span>NTFS / ReFS Native Optimizer</span>
          <span>MIT License</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
