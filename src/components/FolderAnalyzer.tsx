import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Folder,
  FolderOpen,
  File,
  Search,
  Trash2,
  ChevronRight,
  RefreshCw,
  XCircle,
  FolderTree,
  Flame,
  CheckSquare,
  Square,
  Filter,
  ArrowUpDown,
  ArrowUp,
  Home,
  HardDrive,
  Info,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import {
  AnalyzeProgress,
  DeleteFoldersReport,
  DeleteFoldersRequest,
  DriveInfo,
  FolderAnalysisResult,
  FolderItem,
} from '../types';
import { formatBytes } from '../utils';
import { FolderDeleteModal } from './FolderDeleteModal';

interface FolderAnalyzerProps {
  drives: DriveInfo[];
  initialPath?: string;
  onRefreshDrives?: () => void;
}

export const FolderAnalyzer: React.FC<FolderAnalyzerProps> = ({
  drives,
  initialPath = 'C:\\',
  onRefreshDrives,
}) => {
  // Current active path & history
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [pathInput, setPathInput] = useState(initialPath);

  // Analysis results & state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null);
  const [analysisResult, setAnalysisResult] = useState<FolderAnalysisResult | null>(null);

  // Deep Scan / View Mode
  const [viewMode, setViewMode] = useState<'explorer' | 'deep_scan'>('explorer');
  const [deepScanResults, setDeepScanResults] = useState<FolderItem[]>([]);

  // Selection
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  // Filter & Sort
  const [minSizeMb, setMinSizeMb] = useState<number>(0);
  const [sortBy, setSortBy] = useState<'size_desc' | 'size_asc' | 'files_desc' | 'name_asc'>('size_desc');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals & Reports
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteReport, setDeleteReport] = useState<DeleteFoldersReport | null>(null);

  // Listen to Tauri progress events
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupListener = async () => {
      unlisten = await listen<AnalyzeProgress>('analyze:progress', (event) => {
        setProgress(event.payload);
      });
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Run Level Analysis (Explorer View)
  const runLevelAnalysis = useCallback(async (targetPath: string) => {
    setIsAnalyzing(true);
    setProgress({
      current_folder: 'Scanning immediate folders...',
      folders_scanned: 0,
      files_scanned: 0,
      bytes_scanned: 0,
    });
    setSelectedItemIds(new Set());

    try {
      const result = await invoke<FolderAnalysisResult>('analyze_folder', {
        targetPath,
      });
      setAnalysisResult(result);
      setCurrentPath(result.target_path);
      setPathInput(result.target_path);
    } catch (err) {
      console.error('Analysis failed:', err);
      alert(`Could not analyze folder: ${err}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  // Run Deep Scan (Space Hogs)
  const runDeepScan = useCallback(async (targetPath: string, minMb = 100) => {
    setIsAnalyzing(true);
    setProgress({
      current_folder: 'Deep-scanning folder hierarchy...',
      folders_scanned: 0,
      files_scanned: 0,
      bytes_scanned: 0,
    });
    setSelectedItemIds(new Set());

    try {
      const items = await invoke<FolderItem[]>('get_deep_largest_folders', {
        targetPath,
        minSizeMb: minMb,
        topN: 100,
      });
      setDeepScanResults(items);
    } catch (err) {
      console.error('Deep scan failed:', err);
      alert(`Deep scan failed: ${err}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (viewMode === 'explorer') {
      runLevelAnalysis(currentPath);
    } else {
      runDeepScan(currentPath, minSizeMb);
    }
  }, [currentPath, viewMode, runLevelAnalysis, runDeepScan, minSizeMb]);

  // Handle Cancel Analysis
  const handleCancelAnalysis = async () => {
    try {
      await invoke('cancel_folder_analysis');
    } catch (err) {
      console.error('Failed to cancel analysis:', err);
    }
  };

  // Breadcrumbs generator
  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split(/[/\\]+/).filter(Boolean);
    if (parts.length === 0) return [{ label: currentPath, path: currentPath }];

    const crumbs = [];
    let accPath = '';

    for (let i = 0; i < parts.length; i++) {
      if (i === 0) {
        accPath = parts[0].includes(':') ? `${parts[0]}\\` : parts[0];
      } else {
        accPath = `${accPath.replace(/\\$/, '')}\\${parts[i]}`;
      }
      crumbs.push({ label: parts[i], path: accPath });
    }
    return crumbs;
  }, [currentPath]);

  // Navigate to child folder
  const handleDrillDown = (item: FolderItem) => {
    if (item.is_dir) {
      runLevelAnalysis(item.path);
    }
  };

  // Navigate to parent folder
  const handleNavigateUp = () => {
    const lastSlash = currentPath.replace(/\\$/, '').lastIndexOf('\\');
    if (lastSlash >= 0) {
      const parent = currentPath.substring(0, lastSlash + 1);
      runLevelAnalysis(parent);
    }
  };

  // Quick Preset Locations
  const handleSelectPreset = (path: string) => {
    setCurrentPath(path);
    setPathInput(path);
  };

  // Open in Windows Explorer
  const handleOpenExplorer = async (path: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await invoke('open_in_explorer', { path });
    } catch (err) {
      console.error('Failed to open explorer:', err);
    }
  };

  // Filter & Sort Items
  const displayedItems = useMemo(() => {
    const rawItems = viewMode === 'explorer' ? analysisResult?.items || [] : deepScanResults;

    return rawItems
      .filter((item) => {
        if (minSizeMb > 0 && item.size_bytes < minSizeMb * 1024 * 1024) return false;
        if (searchQuery && !item.name.toLowerCase().includes(searchQuery.toLowerCase()))
          return false;
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'size_desc') return b.size_bytes - a.size_bytes;
        if (sortBy === 'size_asc') return a.size_bytes - b.size_bytes;
        if (sortBy === 'files_desc') return b.file_count - a.file_count;
        if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
        return 0;
      });
  }, [analysisResult, deepScanResults, viewMode, minSizeMb, searchQuery, sortBy]);

  // Selection handlers
  const toggleItemSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedItemIds.size === displayedItems.length) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(displayedItems.map((it) => it.id)));
    }
  };

  const selectedFolders = useMemo(() => {
    return displayedItems.filter((it) => selectedItemIds.has(it.id));
  }, [displayedItems, selectedItemIds]);

  const selectedTotalBytes = useMemo(() => {
    return selectedFolders.reduce((sum, f) => sum + f.size_bytes, 0);
  }, [selectedFolders]);

  // Execute Deletion
  const handleConfirmDelete = async (permanent: boolean) => {
    setShowDeleteModal(false);
    setIsDeleting(true);

    try {
      const request: DeleteFoldersRequest = {
        paths: selectedFolders.map((f) => f.path),
        permanent,
      };

      const report = await invoke<DeleteFoldersReport>('delete_folders', { request });
      setDeleteReport(report);
      setSelectedItemIds(new Set());

      // Refresh drive overview
      if (onRefreshDrives) onRefreshDrives();

      // Refresh current view
      if (viewMode === 'explorer') {
        runLevelAnalysis(currentPath);
      } else {
        runDeepScan(currentPath, minSizeMb);
      }
    } catch (err) {
      console.error('Delete failed:', err);
      alert(`Deletion failed: ${err}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Delete Confirmation Modal */}
      <FolderDeleteModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleConfirmDelete}
        selectedFolders={selectedFolders}
      />

      {/* Top Controls Bar */}
      <div className="border-b border-slate-800 bg-surface-900/80 p-5 space-y-4">
        {/* Row 1: Path Input & Presets */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[320px]">
            <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-700/80 rounded-xl px-3 py-2 flex-1 focus-within:border-emerald-500 transition-colors">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setCurrentPath(pathInput);
                  }
                }}
                placeholder="Enter path (e.g. C:\, D:\Projects, C:\Users)..."
                className="bg-transparent text-xs text-white placeholder-slate-500 outline-none w-full font-mono"
              />
            </div>
            <button
              onClick={() => setCurrentPath(pathInput)}
              disabled={isAnalyzing}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-md transition-all shrink-0 disabled:opacity-50"
            >
              Analyze
            </button>
          </div>

          {/* Quick Drive Presets */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[11px] text-slate-400 font-medium mr-1">Drives:</span>
            {drives.map((d) => (
              <button
                key={d.mount_point}
                onClick={() => handleSelectPreset(d.mount_point)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all border ${
                  currentPath.startsWith(d.mount_point)
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 shadow-sm'
                    : 'bg-slate-900/60 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {d.mount_point}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Breadcrumbs & View Mode */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Breadcrumbs Navigation */}
          <div className="flex items-center gap-1 overflow-x-auto text-xs py-1 max-w-full">
            <button
              onClick={handleNavigateUp}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              title="Parent Directory"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleSelectPreset('C:\\')}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              title="Root C:\"
            >
              <Home className="w-3.5 h-3.5" />
            </button>

            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.path}>
                <ChevronRight className="w-3 h-3 text-slate-600 shrink-0" />
                <button
                  onClick={() => runLevelAnalysis(crumb.path)}
                  className={`px-2 py-1 rounded-md transition-all font-mono truncate max-w-[140px] ${
                    idx === breadcrumbs.length - 1
                      ? 'bg-slate-800 text-emerald-400 font-bold border border-slate-700/60'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                  }`}
                  title={crumb.path}
                >
                  {crumb.label}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-2 bg-slate-950/80 p-1 border border-slate-800 rounded-xl shrink-0">
            <button
              onClick={() => setViewMode('explorer')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                viewMode === 'explorer'
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700/60 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <FolderTree className="w-3.5 h-3.5" />
              Folder Level
            </button>
            <button
              onClick={() => setViewMode('deep_scan')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                viewMode === 'deep_scan'
                  ? 'bg-slate-800 text-emerald-400 border border-slate-700/60 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              Top Space Hogs
            </button>
          </div>
        </div>

        {/* Row 3: Filters, Search & Bulk Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Filter by Min Size */}
            <div className="flex items-center gap-1.5 bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-300">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span>Min Size:</span>
              <select
                value={minSizeMb}
                onChange={(e) => setMinSizeMb(Number(e.target.value))}
                className="bg-transparent text-emerald-400 font-bold outline-none cursor-pointer"
              >
                <option value={0} className="bg-surface-900 text-white">All Sizes</option>
                <option value={100} className="bg-surface-900 text-white">&gt; 100 MB</option>
                <option value={500} className="bg-surface-900 text-white">&gt; 500 MB</option>
                <option value={1024} className="bg-surface-900 text-white">&gt; 1 GB</option>
                <option value={5120} className="bg-surface-900 text-white">&gt; 5 GB</option>
                <option value={10240} className="bg-surface-900 text-white">&gt; 10 GB</option>
              </select>
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-1.5 bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-300">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
              <span>Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-transparent text-emerald-400 font-bold outline-none cursor-pointer"
              >
                <option value="size_desc" className="bg-surface-900 text-white">Largest First</option>
                <option value="size_asc" className="bg-surface-900 text-white">Smallest First</option>
                <option value="files_desc" className="bg-surface-900 text-white">Most Files</option>
                <option value="name_asc" className="bg-surface-900 text-white">Name (A-Z)</option>
              </select>
            </div>

            {/* Search Input */}
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by name..."
              className="bg-slate-950/60 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 placeholder-slate-500 outline-none w-36 focus:border-slate-700"
            />
          </div>

          {/* Bulk Selection & Delete Action */}
          <div className="flex items-center gap-3">
            {selectedFolders.length > 0 && (
              <span className="font-semibold text-slate-300">
                {selectedFolders.length} selected{' '}
                <span className="text-emerald-400 font-mono font-bold">
                  ({formatBytes(selectedTotalBytes)})
                </span>
              </span>
            )}

            <button
              onClick={toggleSelectAll}
              className="text-slate-400 hover:text-white transition-colors"
            >
              {selectedItemIds.size === displayedItems.length && displayedItems.length > 0
                ? 'Deselect All'
                : 'Select All'}
            </button>

            <button
              onClick={() => setShowDeleteModal(true)}
              disabled={selectedFolders.length === 0 || isDeleting}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl shadow-md transition-all disabled:opacity-40 disabled:pointer-events-none"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Selected
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Body */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Analyzing Progress Banner */}
        {isAnalyzing && (
          <div className="p-5 rounded-2xl bg-surface-900 border border-emerald-500/40 shadow-xl space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <RefreshCw className="w-5 h-5 text-emerald-400 animate-spin" />
                <div>
                  <h4 className="text-xs font-bold text-white">
                    {viewMode === 'explorer'
                      ? 'Analyzing Directory Hierarchy...'
                      : 'Scanning Disk for Space Hogs...'}
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Traversing NTFS structures across CPU worker threads
                  </p>
                </div>
              </div>

              <button
                onClick={handleCancelAnalysis}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-400 hover:text-white bg-red-950/40 hover:bg-red-900/60 border border-red-800/60 rounded-xl transition-all"
              >
                <XCircle className="w-3.5 h-3.5" />
                Cancel
              </button>
            </div>

            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 animate-pulse w-full rounded-full" />
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
              <span className="truncate max-w-[65%]">
                {progress?.current_folder || 'Scanning...'}
              </span>
              <span className="text-emerald-400 font-semibold shrink-0">
                {formatBytes(progress?.bytes_scanned || 0)} (
                {(progress?.files_scanned || 0).toLocaleString()} files)
              </span>
            </div>
          </div>
        )}

        {/* Post Deletion Report Toast / Banner */}
        {deleteReport && (
          <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/60 text-xs flex items-center justify-between animate-in fade-in">
            <div className="space-y-0.5">
              <p className="font-bold text-emerald-300">
                Cleaned {deleteReport.deleted_paths.length} folder(s) • Freed{' '}
                {formatBytes(deleteReport.freed_bytes)}!
              </p>
              {deleteReport.failed_paths.length > 0 && (
                <p className="text-amber-400 text-[11px]">
                  {deleteReport.failed_paths.length} item(s) skipped (in use or protected).
                </p>
              )}
            </div>
            <button
              onClick={() => setDeleteReport(null)}
              className="text-slate-400 hover:text-white text-xs"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Directory Summary Card (Explorer Mode) */}
        {analysisResult && viewMode === 'explorer' && (
          <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                <HardDrive className="w-4 h-4" />
              </div>
              <div>
                <p className="font-bold text-white font-mono">{analysisResult.target_path}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Contains {analysisResult.total_folders.toLocaleString()} subfolders,{' '}
                  {analysisResult.total_files.toLocaleString()} files (Analyzed in{' '}
                  {analysisResult.duration_ms}ms)
                </p>
              </div>
            </div>

            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                Total Size
              </span>
              <p className="text-lg font-black text-emerald-400 font-mono">
                {formatBytes(analysisResult.total_bytes)}
              </p>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!isAnalyzing && displayedItems.length === 0 && (
          <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800 text-slate-400 space-y-2">
            <Info className="w-8 h-8 text-slate-500 mx-auto" />
            <p className="font-bold text-white text-sm">No folders matched your filter</p>
            <p className="text-xs">Try lowering the minimum size filter or changing search query.</p>
          </div>
        )}

        {/* Folders & Files Table List */}
        <div className="border border-slate-800 rounded-xl overflow-hidden bg-surface-900/70 divide-y divide-slate-800/80">
          {displayedItems.map((item) => {
            const isSelected = selectedItemIds.has(item.id);

            return (
              <div
                key={item.id}
                onClick={() => handleDrillDown(item)}
                className={`p-3.5 flex items-center justify-between text-xs transition-colors cursor-pointer select-none ${
                  isSelected
                    ? 'bg-slate-800/70 border-l-2 border-emerald-500'
                    : 'hover:bg-slate-800/40'
                }`}
              >
                {/* Checkbox & Name */}
                <div className="flex items-center gap-3 flex-1 min-w-0 pr-4">
                  <button
                    onClick={(e) => toggleItemSelect(item.id, e)}
                    className="text-slate-400 hover:text-white"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <Square className="w-4 h-4 text-slate-600" />
                    )}
                  </button>

                  <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 shrink-0">
                    {item.is_dir ? (
                      <Folder className="w-4 h-4 text-amber-400" />
                    ) : (
                      <File className="w-4 h-4 text-cyan-400" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-200 truncate hover:text-emerald-400 transition-colors">
                        {item.name}
                      </span>
                      {item.is_dir && (
                        <span className="text-[10px] text-slate-500 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800 shrink-0">
                          {item.subfolder_count} subfolders
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 font-mono truncate mt-0.5">
                      {item.path}
                    </p>
                  </div>
                </div>

                {/* Percentage Bar & Space Metrics */}
                <div className="flex items-center gap-6 shrink-0">
                  {/* Proportional Size Bar */}
                  <div className="w-28 space-y-1 hidden sm:block">
                    <div className="h-1.5 w-full bg-slate-950 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                        style={{ width: `${Math.min(item.percentage, 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono block text-right">
                      {item.percentage}%
                    </span>
                  </div>

                  {/* Size & Files Count */}
                  <div className="text-right w-24">
                    <span className="font-mono font-bold text-sm text-emerald-400 block">
                      {formatBytes(item.size_bytes)}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono block">
                      {item.file_count.toLocaleString()} files
                    </span>
                  </div>

                  {/* Open in Explorer Button */}
                  <button
                    onClick={(e) => handleOpenExplorer(item.path, e)}
                    title="Open in Windows Explorer"
                    className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
