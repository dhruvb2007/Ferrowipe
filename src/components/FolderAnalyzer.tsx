import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Folder,
  FolderOpen,
  File,
  Search,
  Trash2,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  XCircle,
  FolderTree,
  Flame,
  ArrowUp,
  Home,
  HardDrive,
  Info,
  MapPin,
  Disc,
  Link2,
  Lock,
  Copy,
  X,
  MoreHorizontal,
  ArrowUpRight,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import {
  AnalyzeProgress,
  AnalyzerNavigationRequest,
  DeleteFoldersReport,
  DeleteFoldersRequest,
  DriveInfo,
  FolderAnalysisResult,
  FolderItem,
} from '@/types';
import { formatBytes, formatDuration } from '@/utils';
import { cn } from '@/lib/utils';
import { FolderDeleteModal } from './FolderDeleteModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';

interface FolderAnalyzerProps {
  drives: DriveInfo[];
  isActive: boolean;
  navRequest?: AnalyzerNavigationRequest | null;
  onRefreshDrives?: () => void;
  onActivePathChange?: (path: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

export const FolderAnalyzer: React.FC<FolderAnalyzerProps> = ({
  drives,
  isActive,
  navRequest,
  onRefreshDrives,
  onActivePathChange,
  onBusyChange,
}) => {
  const [currentPath, setCurrentPath] = useState('C:\\');
  const [pathInput, setPathInput] = useState('C:\\');

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isFullDiskScanning, setIsFullDiskScanning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null);
  const [analysisResult, setAnalysisResult] = useState<FolderAnalysisResult | null>(null);

  const [treeItems, setTreeItems] = useState<FolderItem[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [childrenMap, setChildrenMap] = useState<Map<string, FolderItem[]>>(new Map());
  const [loadingChildPath, setLoadingChildPath] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<'tree' | 'deep_scan'>('tree');
  const [deepScanResults, setDeepScanResults] = useState<FolderItem[]>([]);

  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [singleDeleteTarget, setSingleDeleteTarget] = useState<FolderItem | null>(null);

  const [minSizeMb, setMinSizeMb] = useState<number>(0);
  const [sortBy, setSortBy] = useState<'size_desc' | 'size_asc' | 'files_desc' | 'name_asc'>(
    'size_desc'
  );
  const [searchQuery, setSearchQuery] = useState('');

  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const hasInitializedRef = useRef(false);
  const lastNavNonceRef = useRef<number | null>(null);

  // Sync busy state and current path back to App / Sidebar
  useEffect(() => {
    onBusyChange?.(isAnalyzing || isDeleting);
  }, [isAnalyzing, isDeleting, onBusyChange]);

  useEffect(() => {
    onActivePathChange?.(currentPath);
  }, [currentPath, onActivePathChange]);

  // Listen to Tauri progress events
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupListener = async () => {
      try {
        unlisten = await listen<AnalyzeProgress>('analyze:progress', (event) => {
          setProgress(event.payload);
        });
      } catch {
        // Non-Tauri browser preview
      }
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Run Level Analysis
  const runLevelAnalysis = useCallback(async (targetPath: string) => {
    setIsAnalyzing(true);
    setIsFullDiskScanning(false);
    setProgress({
      current_folder: `Scanning ${targetPath}...`,
      folders_scanned: 0,
      files_scanned: 0,
      bytes_scanned: 0,
    });
    setSelectedItemIds(new Set());
    setExpandedPaths(new Set());
    setChildrenMap(new Map());

    try {
      const result = await invoke<FolderAnalysisResult>('analyze_folder', {
        targetPath,
        depth: 0,
      });
      setAnalysisResult(result);
      setTreeItems(result.items);
      setCurrentPath(result.target_path);
      setPathInput(result.target_path);
    } catch (err) {
      console.error('Analysis failed:', err);
      toast.error(`Could not analyze folder: ${String(err)}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  // Run Full Disk Analysis
  const runFullDiskAnalysis = useCallback(async (diskRoot: string) => {
    setIsAnalyzing(true);
    setIsFullDiskScanning(true);
    setViewMode('tree');
    setProgress({
      current_folder: `Indexing full disk ${diskRoot}...`,
      folders_scanned: 0,
      files_scanned: 0,
      bytes_scanned: 0,
    });
    setSelectedItemIds(new Set());
    setExpandedPaths(new Set());
    setChildrenMap(new Map());

    try {
      const result = await invoke<FolderAnalysisResult>('analyze_full_disk', {
        diskRoot,
      });
      setAnalysisResult(result);
      setTreeItems(result.items);
      setCurrentPath(result.target_path);
      setPathInput(result.target_path);
      toast.success(
        `Indexed ${result.target_path} (${formatBytes(result.total_bytes)}) in ${formatDuration(result.duration_ms)}`
      );
    } catch (err) {
      console.error('Full disk analysis failed:', err);
      toast.error(`Full disk analysis failed: ${String(err)}`);
    } finally {
      setIsAnalyzing(false);
      setIsFullDiskScanning(false);
    }
  }, []);

  // Run Deep Scan (Top Space Hogs)
  const runDeepScan = useCallback(async (targetPath: string, minMb = 100) => {
    setIsAnalyzing(true);
    setIsFullDiskScanning(false);
    setProgress({
      current_folder: `Searching for large folders in ${targetPath}...`,
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
      setCurrentPath(targetPath);
      setPathInput(targetPath);
    } catch (err) {
      console.error('Deep scan failed:', err);
      toast.error(`Deep scan failed: ${String(err)}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  // Handle explicit navigation requests from Dashboard / Sidebar
  useEffect(() => {
    if (!navRequest) return;
    if (lastNavNonceRef.current === navRequest.nonce) return;
    lastNavNonceRef.current = navRequest.nonce;
    hasInitializedRef.current = true;

    const targetPath = navRequest.path;
    const targetMode = navRequest.mode || 'tree';
    const nextMinMb = navRequest.minSizeMb ?? (targetMode === 'deep_scan' ? 100 : 0);

    setCurrentPath(targetPath);
    setPathInput(targetPath);
    setViewMode(targetMode);
    setMinSizeMb(nextMinMb);

    if (navRequest.autoFullDisk) {
      const root = targetPath.includes(':') ? `${targetPath.split(':')[0]}:\\` : targetPath;
      runFullDiskAnalysis(root);
    } else if (targetMode === 'deep_scan') {
      runDeepScan(targetPath, nextMinMb);
    } else {
      runLevelAnalysis(targetPath);
    }
  }, [navRequest, runFullDiskAnalysis, runDeepScan, runLevelAnalysis]);

  // Lazy initialize the first time the user opens Space Analyzer directly
  useEffect(() => {
    if (!isActive || hasInitializedRef.current) return;
    hasInitializedRef.current = true;
    const defaultDrive = drives[0]?.mount_point || 'C:\\';
    setCurrentPath(defaultDrive);
    setPathInput(defaultDrive);
    runLevelAnalysis(defaultDrive);
  }, [isActive, drives, runLevelAnalysis]);

  const handleCancelAnalysis = async () => {
    try {
      await invoke('cancel_folder_analysis');
      toast.info('Analysis cancellation requested');
    } catch (err) {
      console.error('Failed to cancel analysis:', err);
    }
  };

  const handleSwitchViewMode = (mode: 'tree' | 'deep_scan') => {
    setViewMode(mode);
    setSelectedItemIds(new Set());
    if (mode === 'deep_scan') {
      const effectiveMin = minSizeMb === 0 ? 100 : minSizeMb;
      if (minSizeMb === 0) setMinSizeMb(100);
      runDeepScan(currentPath, effectiveMin);
    } else {
      if (!analysisResult || analysisResult.target_path !== currentPath) {
        runLevelAnalysis(currentPath);
      }
    }
  };

  const handleMinSizeChange = (value: string) => {
    const nextMb = Number(value);
    setMinSizeMb(nextMb);
    // In tree mode filtering is instant client-side; only re-run deep scan in deep_scan mode!
    if (viewMode === 'deep_scan') {
      runDeepScan(currentPath, nextMb);
    }
  };

  const handleDriveSwitch = (mountPoint: string) => {
    setCurrentPath(mountPoint);
    setPathInput(mountPoint);
    if (viewMode === 'deep_scan') {
      runDeepScan(mountPoint, minSizeMb);
    } else {
      runLevelAnalysis(mountPoint);
    }
  };

  const handlePathSubmit = () => {
    const trimmed = pathInput.trim();
    if (!trimmed) return;
    if (viewMode === 'deep_scan') {
      runDeepScan(trimmed, minSizeMb);
    } else {
      runLevelAnalysis(trimmed);
    }
  };

  // Toggle tree expansion
  const handleToggleExpand = async (item: FolderItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!item.is_dir || !item.has_subfolders) return;

    const isExpanded = expandedPaths.has(item.path);

    if (isExpanded) {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.delete(item.path);
        return next;
      });
    } else {
      if (!childrenMap.has(item.path)) {
        setLoadingChildPath(item.path);
        try {
          const children = await invoke<FolderItem[]>('get_folder_children', {
            folderPath: item.path,
            depth: item.depth + 1,
          });
          setChildrenMap((prev) => {
            const next = new Map(prev);
            next.set(item.path, children);
            return next;
          });
        } catch (err) {
          console.error('Failed to get subfolders:', err);
          toast.error('Unable to read subfolders (access may be restricted)');
        } finally {
          setLoadingChildPath(null);
        }
      }

      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.add(item.path);
        return next;
      });
    }
  };

  const handleLocateInExplorer = async (path: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await invoke('locate_in_explorer', { path });
      toast.success('Opened location in Windows Explorer', { description: path });
    } catch {
      try {
        await invoke('open_in_explorer', { path });
      } catch {
        toast.error('Failed to open Windows Explorer');
      }
    }
  };

  const handleOpenFolder = async (path: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await invoke('open_in_explorer', { path });
    } catch {
      toast.error('Failed to open folder in Explorer');
    }
  };

  const handleCopyPath = (path: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(path);
    toast.success('Path copied to clipboard', { description: path });
  };

  const handleFocusAsRoot = (path: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setViewMode('tree');
    runLevelAnalysis(path);
  };

  const handleNavigateUp = () => {
    const cleaned = currentPath.replace(/\\+$/, '');
    const lastSlash = cleaned.lastIndexOf('\\');
    if (lastSlash >= 0) {
      const parent = cleaned.substring(0, lastSlash + 1);
      if (parent !== currentPath) {
        if (viewMode === 'deep_scan') {
          runDeepScan(parent, minSizeMb);
        } else {
          runLevelAnalysis(parent);
        }
      }
    }
  };

  // Breadcrumbs
  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split(/[/\\]+/).filter(Boolean);
    if (parts.length === 0) return [{ label: currentPath, path: currentPath }];

    const crumbs: { label: string; path: string }[] = [];
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

  // Flattened & filtered items
  const flattenedTreeItems = useMemo(() => {
    const sortItems = (list: FolderItem[]) =>
      [...list].sort((a, b) => {
        if (sortBy === 'size_desc') return b.size_bytes - a.size_bytes;
        if (sortBy === 'size_asc') return a.size_bytes - b.size_bytes;
        if (sortBy === 'files_desc') return b.file_count - a.file_count;
        if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
        return 0;
      });

    if (viewMode === 'deep_scan') {
      const q = searchQuery.trim().toLowerCase();
      return sortItems(
        deepScanResults.filter((item) => {
          if (minSizeMb > 0 && item.size_bytes < minSizeMb * 1024 * 1024) return false;
          if (
            q &&
            !item.name.toLowerCase().includes(q) &&
            !item.path.toLowerCase().includes(q)
          ) {
            return false;
          }
          return true;
        })
      );
    }

    const result: FolderItem[] = [];
    const q = searchQuery.trim().toLowerCase();

    const appendItems = (items: FolderItem[]) => {
      for (const item of sortItems(items)) {
        if (minSizeMb > 0 && item.size_bytes < minSizeMb * 1024 * 1024) continue;
        if (q && !item.name.toLowerCase().includes(q) && !item.path.toLowerCase().includes(q)) {
          continue;
        }

        result.push(item);

        if (item.is_dir && expandedPaths.has(item.path)) {
          const children = childrenMap.get(item.path);
          if (children && children.length > 0) {
            appendItems(children);
          }
        }
      }
    };

    appendItems(treeItems);
    return result;
  }, [
    treeItems,
    expandedPaths,
    childrenMap,
    viewMode,
    deepScanResults,
    minSizeMb,
    searchQuery,
    sortBy,
  ]);

  const toggleItemSelect = (id: string) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedItemIds.size === flattenedTreeItems.length && flattenedTreeItems.length > 0) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(flattenedTreeItems.map((it) => it.id)));
    }
  };

  const selectedFolders = useMemo(() => {
    return flattenedTreeItems.filter((it) => selectedItemIds.has(it.id));
  }, [flattenedTreeItems, selectedItemIds]);

  const selectedTotalBytes = useMemo(() => {
    return selectedFolders.reduce((sum, f) => sum + f.size_bytes, 0);
  }, [selectedFolders]);

  const modalTargets = singleDeleteTarget ? [singleDeleteTarget] : selectedFolders;

  const handleConfirmDelete = async (permanent: boolean) => {
    const targets = modalTargets;
    setShowDeleteModal(false);
    setSingleDeleteTarget(null);
    if (targets.length === 0) return;

    setIsDeleting(true);
    try {
      const request: DeleteFoldersRequest = {
        paths: targets.map((f) => f.path),
        permanent,
      };

      const report = await invoke<DeleteFoldersReport>('delete_folders', { request });
      setSelectedItemIds(new Set());

      if (report.deleted_paths.length > 0) {
        toast.success(
          `Removed ${report.deleted_paths.length} item${report.deleted_paths.length === 1 ? '' : 's'} — freed ${formatBytes(report.freed_bytes)}`,
          {
            description:
              report.failed_paths.length > 0
                ? `${report.failed_paths.length} item(s) skipped (protected or in use).`
                : permanent
                ? 'Permanently deleted.'
                : 'Moved safely to Recycle Bin.',
          }
        );
      } else if (report.failed_paths.length > 0) {
        toast.warning(
          `Could not remove ${report.failed_paths.length} item(s) — protected or locked by Windows`
        );
      }

      if (onRefreshDrives) onRefreshDrives();

      if (viewMode === 'tree') {
        runLevelAnalysis(currentPath);
      } else {
        runDeepScan(currentPath, minSizeMb);
      }
    } catch (err) {
      console.error('Delete failed:', err);
      toast.error(`Deletion failed: ${String(err)}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const currentDriveRoot = currentPath.includes(':')
    ? `${currentPath.split(':')[0]}:\\`
    : drives[0]?.mount_point || 'C:\\';

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Delete Confirmation Modal */}
      <FolderDeleteModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSingleDeleteTarget(null);
        }}
        onConfirm={handleConfirmDelete}
        selectedFolders={modalTargets}
      />

      {/* Top Controls Area */}
      <div className="border-b border-border bg-card/50 px-6 py-4 space-y-3 shrink-0">
        {/* Row 1: Drive Selector Pills + Path Input + Primary Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Drive Pills */}
          {drives.length > 0 && (
            <div className="flex items-center gap-1 pr-1">
              {drives.map((d) => {
                const isCurrent = currentPath
                  .toUpperCase()
                  .startsWith(d.mount_point.toUpperCase());
                return (
                  <Button
                    key={d.mount_point}
                    size="sm"
                    variant={isCurrent ? 'secondary' : 'outline'}
                    onClick={() => handleDriveSwitch(d.mount_point)}
                    disabled={isAnalyzing}
                    className={cn(
                      'h-8 px-2.5 text-xs font-mono font-semibold',
                      isCurrent && 'border-primary/45 bg-primary/15 text-primary hover:bg-primary/20'
                    )}
                  >
                    {d.mount_point.replace('\\', '')}
                  </Button>
                );
              })}
            </div>
          )}

          {/* Path Input */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePathSubmit();
              }}
              placeholder="Enter path (e.g. C:\Users, D:\Projects)..."
              className="h-8 pl-8 pr-8 text-xs font-mono"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleCopyPath(currentPath)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Copy current path</TooltipContent>
            </Tooltip>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={handlePathSubmit}
            disabled={isAnalyzing}
            className="h-8 text-xs gap-1.5"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isAnalyzing && !isFullDiskScanning && 'animate-spin')} />
            Analyze
          </Button>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                onClick={() => runFullDiskAnalysis(currentDriveRoot)}
                disabled={isAnalyzing}
                className="h-8 text-xs gap-1.5 font-semibold"
              >
                <Disc className={cn('h-3.5 w-3.5', isFullDiskScanning && 'animate-spin')} />
                Full Disk Index ({currentDriveRoot.replace('\\', '')})
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Indexes the entire {currentDriveRoot} partition in parallel for instant folder expansion
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Row 2: Breadcrumbs + View Mode Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Breadcrumbs */}
          <div className="flex items-center gap-1 overflow-x-auto max-w-full py-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={handleNavigateUp}
                  disabled={breadcrumbs.length <= 1 || isAnalyzing}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Parent folder</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => handleDriveSwitch(currentDriveRoot)}
                  disabled={isAnalyzing}
                >
                  <Home className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Drive root ({currentDriveRoot})</TooltipContent>
            </Tooltip>

            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.path}>
                <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                <button
                  onClick={() =>
                    viewMode === 'deep_scan'
                      ? runDeepScan(crumb.path, minSizeMb)
                      : runLevelAnalysis(crumb.path)
                  }
                  className={cn(
                    'px-2 py-1 rounded-md text-xs font-mono truncate max-w-[150px] transition-colors',
                    idx === breadcrumbs.length - 1
                      ? 'bg-secondary text-primary font-semibold'
                      : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                  )}
                  title={crumb.path}
                >
                  {crumb.label}
                </button>
              </React.Fragment>
            ))}
          </div>

          {/* Mode Tabs */}
          <Tabs
            value={viewMode}
            onValueChange={(val) => handleSwitchViewMode(val as 'tree' | 'deep_scan')}
          >
            <TabsList className="h-8">
              <TabsTrigger value="tree" className="text-xs h-7 px-3 gap-1.5">
                <FolderTree className="h-3.5 w-3.5" />
                Folder Tree
              </TabsTrigger>
              <TabsTrigger value="deep_scan" className="text-xs h-7 px-3 gap-1.5">
                <Flame className="h-3.5 w-3.5 text-orange-500" />
                Top Space Hogs
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Row 3: Filters, Sort, Search & Select All */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Min Size Select */}
            <Select value={String(minSizeMb)} onValueChange={handleMinSizeChange}>
              <SelectTrigger className="h-8 w-[138px] text-xs">
                <SelectValue placeholder="Min size" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">All Sizes</SelectItem>
                <SelectItem value="100">&gt; 100 MB</SelectItem>
                <SelectItem value="500">&gt; 500 MB</SelectItem>
                <SelectItem value="1024">&gt; 1 GB</SelectItem>
                <SelectItem value="5120">&gt; 5 GB</SelectItem>
                <SelectItem value="10240">&gt; 10 GB</SelectItem>
              </SelectContent>
            </Select>

            {/* Sort Select */}
            <Select
              value={sortBy}
              onValueChange={(v) => setSortBy(v as typeof sortBy)}
            >
              <SelectTrigger className="h-8 w-[142px] text-xs">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="size_desc">Largest First</SelectItem>
                <SelectItem value="size_asc">Smallest First</SelectItem>
                <SelectItem value="files_desc">Most Files</SelectItem>
                <SelectItem value="name_asc">Name (A–Z)</SelectItem>
              </SelectContent>
            </Select>

            {/* Instant Search */}
            <div className="relative w-48">
              <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter results..."
                className="h-8 pl-8 pr-7 text-xs"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSelectAll}
              disabled={flattenedTreeItems.length === 0}
              className="h-8 text-xs text-muted-foreground hover:text-foreground"
            >
              {selectedItemIds.size === flattenedTreeItems.length &&
              flattenedTreeItems.length > 0
                ? 'Deselect All'
                : 'Select All'}
            </Button>

            {selectedFolders.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => {
                  setSingleDeleteTarget(null);
                  setShowDeleteModal(true);
                }}
                disabled={isDeleting}
                className="h-8 text-xs gap-1.5 font-semibold"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete ({selectedFolders.length}) • {formatBytes(selectedTotalBytes)}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <ScrollArea className="flex-1 h-full">
        <div className="p-6 space-y-4 max-w-7xl mx-auto">
          {/* Analyzing Progress Card */}
          {isAnalyzing && (
            <Card className="border-primary/40 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-foreground">
                        {isFullDiskScanning
                          ? 'Indexing Full Disk Hierarchy...'
                          : viewMode === 'deep_scan'
                          ? 'Scanning for Largest Space Hogs...'
                          : 'Analyzing Directory Tree...'}
                      </h4>
                      <p className="text-[11px] text-muted-foreground">
                        Running parallel NTFS traversal across worker threads
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleCancelAnalysis}
                    className="h-8 text-xs gap-1.5"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                </div>

                <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden relative">
                  <div className="h-full w-1/3 bg-primary rounded-full animate-indeterminate-bar" />
                </div>

                <div className="flex items-center justify-between gap-4 text-[11px] font-mono">
                  <span className="text-muted-foreground truncate">
                    {progress?.current_folder || 'Scanning...'}
                  </span>
                  <span className="text-primary font-semibold tabular-nums shrink-0">
                    {formatBytes(progress?.bytes_scanned || 0)} (
                    {(progress?.files_scanned || 0).toLocaleString()} files,{' '}
                    {(progress?.folders_scanned || 0).toLocaleString()} folders)
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Directory Summary Card */}
          {analysisResult && viewMode === 'tree' && (
            <Card className="bg-muted/25">
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 border border-primary/25 text-primary flex items-center justify-center shrink-0">
                    <HardDrive className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs font-semibold text-foreground font-mono truncate">
                        {analysisResult.target_path}
                      </p>
                      {analysisResult.is_full_disk && (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-primary/35 bg-primary/10 text-primary h-5"
                        >
                          Full Disk Indexed
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                      {analysisResult.total_folders.toLocaleString()} folders •{' '}
                      {analysisResult.total_files.toLocaleString()} files • Analyzed in{' '}
                      {formatDuration(analysisResult.duration_ms)}
                    </p>
                  </div>
                </div>

                <div className="sm:text-right shrink-0">
                  <p className="text-[10px] uppercase font-medium text-muted-foreground tracking-wider">
                    Accounted Size
                  </p>
                  <p className="text-xl font-bold text-primary font-mono tabular-nums">
                    {formatBytes(analysisResult.total_bytes)}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Deep Scan Summary Banner */}
          {viewMode === 'deep_scan' && !isAnalyzing && (
            <Card className="bg-muted/25">
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-orange-500/10 border border-orange-500/25 text-orange-500 flex items-center justify-center shrink-0">
                    <Flame className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">
                      Top Space Hogs in <span className="font-mono text-primary">{currentPath}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Showing {flattenedTreeItems.length} largest folders matching filters (min{' '}
                      {minSizeMb > 0 ? `${minSizeMb} MB` : 'all sizes'})
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => runDeepScan(currentPath, minSizeMb)}
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                  Rescan
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Empty State */}
          {!isAnalyzing && flattenedTreeItems.length === 0 && (
            <Card>
              <CardContent className="p-12 text-center space-y-2">
                <Info className="h-8 w-8 text-muted-foreground mx-auto opacity-60" />
                <p className="text-sm font-semibold text-foreground">
                  No folders or files matched
                </p>
                <p className="text-xs text-muted-foreground">
                  Try lowering the minimum size filter, clearing your search query, or analyzing a
                  different path.
                </p>
                {(minSizeMb > 0 || searchQuery) && (
                  <div className="pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        setMinSizeMb(0);
                        setSearchQuery('');
                        if (viewMode === 'deep_scan') {
                          runDeepScan(currentPath, 0);
                        }
                      }}
                    >
                      Reset Filters
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Hierarchical Tree / Results Table */}
          {flattenedTreeItems.length > 0 && (
            <Card className="overflow-hidden">
              {/* Table Header */}
              <div className="px-4 py-2.5 bg-muted/40 border-b flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>Name &amp; Path</span>
                <div className="flex items-center gap-6 pr-2">
                  <span className="w-24 hidden sm:inline text-right">Share</span>
                  <span className="w-24 text-right">Size</span>
                  <span className="w-24 text-right">Actions</span>
                </div>
              </div>

              <div className="divide-y divide-border/70">
                {flattenedTreeItems.map((item) => {
                  const isSelected = selectedItemIds.has(item.id);
                  const isExpanded = expandedPaths.has(item.path);
                  const isLoadingThis = loadingChildPath === item.path;

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'py-2.5 pr-4 flex items-center justify-between text-xs transition-colors select-none group',
                        isSelected ? 'bg-primary/10' : 'hover:bg-accent/40'
                      )}
                      style={{
                        paddingLeft: `${viewMode === 'tree' ? Math.max(item.depth * 22 + 12, 12) : 12}px`,
                      }}
                    >
                      {/* Left: Chevron + Checkbox + Icon + Name */}
                      <div className="flex items-center gap-2.5 flex-1 min-w-0 pr-4">
                        {viewMode === 'tree' ? (
                          item.is_dir && item.has_subfolders ? (
                            <button
                              onClick={(e) => handleToggleExpand(item, e)}
                              title={isExpanded ? 'Collapse subfolders' : 'Expand subfolders'}
                              className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
                            >
                              {isLoadingThis ? (
                                <RefreshCw className="h-3.5 w-3.5 animate-spin text-primary" />
                              ) : isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5 text-primary" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </button>
                          ) : (
                            <div className="w-6 shrink-0" />
                          )
                        ) : null}

                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleItemSelect(item.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0"
                        />

                        <div className="h-7 w-7 rounded-md bg-muted/60 border flex items-center justify-center shrink-0">
                          {item.is_dir ? (
                            isExpanded ? (
                              <FolderOpen className="h-3.5 w-3.5 text-amber-500" />
                            ) : (
                              <Folder className="h-3.5 w-3.5 text-amber-500" />
                            )
                          ) : (
                            <File className="h-3.5 w-3.5 text-cyan-500" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              onClick={() => item.is_dir && handleFocusAsRoot(item.path)}
                              className={cn(
                                'font-medium truncate transition-colors',
                                item.is_dir
                                  ? 'text-foreground hover:text-primary cursor-pointer'
                                  : 'text-foreground/90'
                              )}
                              title={item.path}
                            >
                              {item.name}
                            </span>

                            {item.is_junction && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="outline"
                                    className="h-4 px-1.5 text-[9px] gap-0.5 border-amber-500/35 bg-amber-500/10 text-amber-500"
                                  >
                                    <Link2 className="h-2.5 w-2.5" />
                                    Junction
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Windows Junction / Reparse Point taking 0 bytes of disk space
                                </TooltipContent>
                              </Tooltip>
                            )}

                            {item.is_access_denied && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge
                                    variant="outline"
                                    className="h-4 px-1.5 text-[9px] gap-0.5 border-destructive/35 bg-destructive/10 text-destructive"
                                  >
                                    <Lock className="h-2.5 w-2.5" />
                                    Protected
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>
                                  Access restricted by Windows NTFS system permissions
                                </TooltipContent>
                              </Tooltip>
                            )}

                            {item.is_dir && item.has_subfolders && !item.is_junction && (
                              <Badge
                                variant="secondary"
                                className="h-4 px-1.5 text-[9px] font-mono font-normal"
                              >
                                {item.subfolder_count} sub
                              </Badge>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
                            {item.path}
                          </p>
                        </div>
                      </div>

                      {/* Right: Progress Share + Size + Actions */}
                      <div className="flex items-center gap-5 shrink-0">
                        {/* Proportional Bar */}
                        <div className="w-24 space-y-1 hidden sm:block">
                          <Progress
                            value={Math.min(item.percentage, 100)}
                            className="h-1.5"
                          />
                          <span className="text-[10px] text-muted-foreground font-mono tabular-nums block text-right">
                            {item.percentage}%
                          </span>
                        </div>

                        {/* Size & File Count */}
                        <div className="text-right w-24 tabular-nums">
                          {item.is_junction ? (
                            <span className="font-mono font-semibold text-[11px] text-amber-500 block">
                              0 B (Link)
                            </span>
                          ) : item.is_access_denied && item.size_bytes === 0 ? (
                            <span className="font-mono font-semibold text-[11px] text-destructive block">
                              Restricted
                            </span>
                          ) : (
                            <span className="font-mono font-semibold text-xs text-primary block">
                              {formatBytes(item.size_bytes)}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground font-mono block">
                            {item.is_junction
                              ? 'Link'
                              : item.is_access_denied && item.size_bytes === 0
                              ? 'ACL Locked'
                              : `${item.file_count.toLocaleString()} files`}
                          </span>
                        </div>

                        {/* Row Actions */}
                        <div className="flex items-center justify-end gap-1 w-24">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-[11px] gap-1"
                                onClick={(e) => handleLocateInExplorer(item.path, e)}
                              >
                                <MapPin className="h-3 w-3 text-primary" />
                                Locate
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Highlight in Windows File Explorer</TooltipContent>
                          </Tooltip>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              {item.is_dir && (
                                <DropdownMenuItem
                                  onClick={(e) => handleFocusAsRoot(item.path, e)}
                                  className="text-xs gap-2"
                                >
                                  <ArrowUpRight className="h-3.5 w-3.5" />
                                  Focus as Root
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={(e) => handleOpenFolder(item.path, e)}
                                className="text-xs gap-2"
                              >
                                <FolderOpen className="h-3.5 w-3.5" />
                                Open in Explorer
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => handleCopyPath(item.path, e)}
                                className="text-xs gap-2"
                              >
                                <Copy className="h-3.5 w-3.5" />
                                Copy Full Path
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSingleDeleteTarget(item);
                                  setShowDeleteModal(true);
                                }}
                                className="text-xs gap-2 text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete Item...
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
