import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion } from 'motion/react';
import {
  Folder,
  FolderOpen,
  File,
  Search,
  Trash2,
  ChevronRight,
  ChevronDown,
  RefreshCw,
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
  Zap,
  Radio,
  Gauge,
  ShieldCheck,
  Scale,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import {
  AnalyzeProgress,
  AnalyzerNavigationRequest,
  DeleteFoldersReport,
  DeleteFoldersRequest,
  DiskVerificationReport,
  DriveIndexStatus,
  DriveInfo,
  FolderAnalysisResult,
  FolderItem,
  TreeUpdateEvent,
} from '@/types';
import { formatBytes, formatDuration } from '@/utils';
import { cn } from '@/lib/utils';
import { FolderDeleteModal } from './FolderDeleteModal';
import {
  ObsidianActionMenu,
  ObsidianBadge,
  ObsidianButton,
  ObsidianCheckbox,
  ObsidianProgress,
  ObsidianSegmentedTabs,
  ObsidianSelect,
  ObsidianStatusDot,
} from '@/components/obsidian/ObsidianPrimitives';
import { obsidianToast } from '@/components/obsidian/ObsidianToast';

interface FolderAnalyzerProps {
  drives: DriveInfo[];
  isActive: boolean;
  navRequest?: AnalyzerNavigationRequest | null;
  onRefreshDrives?: () => void;
  onActivePathChange?: (path: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

interface DriveViewMemory {
  currentPath: string;
  expandedPaths: string[];
}

const MIN_SIZE_OPTIONS = [
  { value: '0', label: 'All Sizes' },
  { value: '100', label: '> 100 MB' },
  { value: '500', label: '> 500 MB' },
  { value: '1024', label: '> 1 GB' },
  { value: '5120', label: '> 5 GB' },
  { value: '10240', label: '> 10 GB' },
];

const SORT_OPTIONS = [
  { value: 'size_desc', label: 'Largest First' },
  { value: 'size_asc', label: 'Smallest First' },
  { value: 'files_desc', label: 'Most Files' },
  { value: 'name_asc', label: 'Name (A–Z)' },
];

function getDriveRootFromPath(p: string, fallback = 'C:\\'): string {
  const trimmed = p.trim();
  if (trimmed.length >= 2 && trimmed[1] === ':') {
    return `${trimmed[0].toUpperCase()}:\\`;
  }
  return fallback;
}

function formatItemsPerSec(rate: number): string {
  if (rate >= 1_000_000) return `${(rate / 1_000_000).toFixed(2)}M/s`;
  if (rate >= 1_000) return `${(rate / 1_000).toFixed(1)}k/s`;
  return `${rate.toLocaleString()}/s`;
}

function evaluateDiskSizeMatch(
  diskTotalBytes: number,
  diskUsedBytes: number,
  scannedBytes: number
) {
  const differenceBytes = scannedBytes - diskUsedBytes;
  const absDifferenceBytes = Math.abs(differenceBytes);
  const pctTol = Math.floor(diskUsedBytes * 0.015);
  const toleranceBytes = Math.min(
    1536 * 1024 * 1024,
    Math.max(128 * 1024 * 1024, pctTol)
  );
  const matchPercentage =
    diskUsedBytes > 0
      ? Math.round((scannedBytes / diskUsedBytes) * 1000) / 10
      : scannedBytes === 0
      ? 100
      : 0;
  const exceedsCapacity = diskTotalBytes > 0 && scannedBytes > diskTotalBytes;
  const matched =
    diskUsedBytes === 0
      ? scannedBytes === 0
      : !exceedsCapacity && absDifferenceBytes <= toleranceBytes;

  return {
    matched,
    differenceBytes,
    absDifferenceBytes,
    matchPercentage,
    toleranceBytes,
  };
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
  const [isSmartSyncing, setIsSmartSyncing] = useState(false);
  const [isVerifyingDisk, setIsVerifyingDisk] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [progress, setProgress] = useState<AnalyzeProgress | null>(null);
  const [analysisResult, setAnalysisResult] = useState<FolderAnalysisResult | null>(null);
  const [indexedStatuses, setIndexedStatuses] = useState<Map<string, DriveIndexStatus>>(new Map());
  const [verificationByDrive, setVerificationByDrive] = useState<
    Map<string, DiskVerificationReport>
  >(new Map());
  const [liveSyncBanner, setLiveSyncBanner] = useState<string | null>(null);

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
  const [visibleLimit, setVisibleLimit] = useState(250);

  const hasInitializedRef = useRef(false);
  const lastNavNonceRef = useRef<number | null>(null);
  const activeRequestIdRef = useRef<number>(0);
  const isRefreshingTreeRef = useRef(false);
  const autoCheckedDrivesRef = useRef<Set<string>>(new Set());
  const driveViewMemoryRef = useRef<Map<string, DriveViewMemory>>(new Map());

  const currentPathRef = useRef(currentPath);
  const expandedPathsRef = useRef(expandedPaths);
  const viewModeRef = useRef(viewMode);
  const minSizeMbRef = useRef(minSizeMb);
  const liveBannerTimerRef = useRef<number | null>(null);

  useEffect(() => {
    currentPathRef.current = currentPath;
    setVisibleLimit(250);
  }, [currentPath]);

  useEffect(() => {
    expandedPathsRef.current = expandedPaths;
  }, [expandedPaths]);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    minSizeMbRef.current = minSizeMb;
  }, [minSizeMb]);

  useEffect(() => {
    onBusyChange?.(isAnalyzing || isDeleting || isVerifyingDisk);
  }, [isAnalyzing, isDeleting, isVerifyingDisk, onBusyChange]);

  useEffect(() => {
    onActivePathChange?.(currentPath);
  }, [currentPath, onActivePathChange]);

  const refreshIndexedStatuses = useCallback(async () => {
    try {
      const list = await invoke<DriveIndexStatus[]>('get_indexed_drives_status');
      const map = new Map<string, DriveIndexStatus>();
      for (const s of list) {
        map.set(s.drive_root.toUpperCase(), s);
      }
      setIndexedStatuses(map);
    } catch {
      // Non-Tauri preview
    }
  }, []);

  useEffect(() => {
    refreshIndexedStatuses();
  }, [refreshIndexedStatuses]);

  const computeRelativeDepth = useCallback((rootPath: string, folderPath: string): number => {
    const normRoot = rootPath.replace(/\\+$/, '').toUpperCase();
    const normFolder = folderPath.replace(/\\+$/, '').toUpperCase();
    if (!normFolder.startsWith(normRoot)) return 1;
    const rel = normFolder.slice(normRoot.length).replace(/^\\+/, '');
    if (!rel) return 1;
    return rel.split('\\').filter(Boolean).length;
  }, []);

  const refreshCurrentViewFromCache = useCallback(
    async (targetPath: string, expandedList: string[]) => {
      try {
        const batchRequests = expandedList.map((p) => ({
          path: p,
          depth: computeRelativeDepth(targetPath, p),
        }));

        const [viewRes, batchChildren] = await Promise.all([
          invoke<FolderAnalysisResult | null>('get_cached_folder_view', {
            targetPath,
            depth: 0,
          }),
          batchRequests.length > 0
            ? invoke<Record<string, FolderItem[]>>('get_cached_children_batch', {
                requests: batchRequests,
              })
            : Promise.resolve({} as Record<string, FolderItem[]>),
        ]);

        if (viewRes) {
          setAnalysisResult(viewRes);
          setTreeItems(viewRes.items);
          setCurrentPath(viewRes.target_path);
          setPathInput(viewRes.target_path);

          const nextChildrenMap = new Map<string, FolderItem[]>();
          const stillExistingExpanded = new Set<string>();
          for (const [k, v] of Object.entries(batchChildren)) {
            nextChildrenMap.set(k, v);
            stillExistingExpanded.add(k);
          }
          setChildrenMap(nextChildrenMap);
          setExpandedPaths((prev) => {
            const next = new Set<string>();
            prev.forEach((p) => {
              if (stillExistingExpanded.has(p)) next.add(p);
            });
            return next;
          });

          const validIds = new Set<string>(viewRes.items.map((it) => it.id));
          nextChildrenMap.forEach((items) => items.forEach((it) => validIds.add(it.id)));
          setSelectedItemIds((prev) => {
            if (prev.size === 0) return prev;
            const next = new Set<string>();
            prev.forEach((id) => {
              if (validIds.has(id)) next.add(id);
            });
            return next;
          });
        } else {
          const fallbackRoot = getDriveRootFromPath(targetPath);
          if (fallbackRoot.toUpperCase() !== targetPath.toUpperCase()) {
            const rootView = await invoke<FolderAnalysisResult | null>('get_cached_folder_view', {
              targetPath: fallbackRoot,
              depth: 0,
            });
            if (rootView) {
              setAnalysisResult(rootView);
              setTreeItems(rootView.items);
              setCurrentPath(rootView.target_path);
              setPathInput(rootView.target_path);
              setExpandedPaths(new Set());
              setChildrenMap(new Map());
              obsidianToast.info(`Folder removed externally — returned to ${fallbackRoot}`);
            }
          }
        }
      } catch (err) {
        console.error('Cache refresh failed:', err);
      }
    },
    [computeRelativeDepth]
  );

  // Listen for progress AND live real-time filesystem updates
  useEffect(() => {
    let unlistenProgress: UnlistenFn | undefined;
    let unlistenTree: UnlistenFn | undefined;

    const setupListeners = async () => {
      try {
        unlistenProgress = await listen<AnalyzeProgress>('analyze:progress', (event) => {
          const payload = event.payload;
          const activeDriveRoot = getDriveRootFromPath(currentPathRef.current);
          if (
            !payload.drive_root ||
            payload.drive_root.toUpperCase() === activeDriveRoot.toUpperCase()
          ) {
            setProgress(payload);
          }
        });

        unlistenTree = await listen<TreeUpdateEvent>('analyzer:tree-updated', async (event) => {
          const payload = event.payload;
          refreshIndexedStatuses();

          const activePath = currentPathRef.current;
          const activeDriveRoot = getDriveRootFromPath(activePath);
          if (payload.drive_root.toUpperCase() !== activeDriveRoot.toUpperCase()) {
            return;
          }

          if (payload.changes_applied > 0 || payload.sync_mode === 'delta_sync') {
            setLiveSyncBanner(payload.summary);
            if (liveBannerTimerRef.current) {
              window.clearTimeout(liveBannerTimerRef.current);
            }
            liveBannerTimerRef.current = window.setTimeout(() => {
              setLiveSyncBanner(null);
            }, 4500);
          }

          // Coalesce rapid background filesystem updates so overlapping IPC calls never pile up
          if (isRefreshingTreeRef.current) {
            return;
          }
          isRefreshingTreeRef.current = true;
          try {
            if (viewModeRef.current === 'deep_scan') {
              const items = await invoke<FolderItem[]>('get_deep_largest_folders', {
                targetPath: activePath,
                minSizeMb: minSizeMbRef.current,
                topN: 100,
              });
              setDeepScanResults(items);
            } else {
              await refreshCurrentViewFromCache(activePath, Array.from(expandedPathsRef.current));
            }
          } catch {
            // Ignore transient refresh errors
          } finally {
            isRefreshingTreeRef.current = false;
          }
        });
      } catch {
        // Non-Tauri browser preview
      }
    };

    setupListeners();
    return () => {
      if (unlistenProgress) unlistenProgress();
      if (unlistenTree) unlistenTree();
      if (liveBannerTimerRef.current) window.clearTimeout(liveBannerTimerRef.current);
    };
  }, [refreshIndexedStatuses, refreshCurrentViewFromCache]);

  const rememberCurrentDriveView = useCallback(() => {
    const driveRoot = getDriveRootFromPath(currentPathRef.current);
    driveViewMemoryRef.current.set(driveRoot.toUpperCase(), {
      currentPath: currentPathRef.current,
      expandedPaths: Array.from(expandedPathsRef.current),
    });
  }, []);

  const openPathSmart = useCallback(
    async (
      targetPath: string,
      options?: { restoreExpanded?: string[]; forceRescan?: boolean }
    ) => {
      const reqId = ++activeRequestIdRef.current;
      const targetDriveRoot = getDriveRootFromPath(targetPath).toUpperCase();
      const alreadyInMemory = indexedStatuses.has(targetDriveRoot) && !options?.forceRescan;

      if (!alreadyInMemory) {
        setIsAnalyzing(true);
        setIsFullDiskScanning(true);
        setProgress({
          current_folder: `Indexing ${targetPath}...`,
          drive_root: targetDriveRoot,
          folders_scanned: 0,
          files_scanned: 0,
          bytes_scanned: 0,
          items_per_sec: 0,
          folders_per_sec: 0,
          files_per_sec: 0,
          bytes_per_sec: 0,
          elapsed_ms: 0,
        });
      }
      setSelectedItemIds(new Set());

      try {
        const result = await invoke<FolderAnalysisResult>('analyze_folder', {
          targetPath,
          depth: 0,
          forceRescan: options?.forceRescan ?? false,
        });

        refreshIndexedStatuses();

        // If user switched to another disk while this one finished in the background,
        // keep the finished disk safely cached in Rust without clobbering the active UI view!
        if (activeRequestIdRef.current !== reqId) {
          return;
        }

        setAnalysisResult(result);
        setTreeItems(result.items);
        setCurrentPath(result.target_path);
        setPathInput(result.target_path);

        if (options?.restoreExpanded && options.restoreExpanded.length > 0) {
          const requests = options.restoreExpanded.map((p) => ({
            path: p,
            depth: computeRelativeDepth(result.target_path, p),
          }));
          const batch = await invoke<Record<string, FolderItem[]>>('get_cached_children_batch', {
            requests,
          });
          if (activeRequestIdRef.current !== reqId) return;
          const nextMap = new Map<string, FolderItem[]>();
          const validExpanded = new Set<string>();
          for (const [k, v] of Object.entries(batch)) {
            nextMap.set(k, v);
            validExpanded.add(k);
          }
          setChildrenMap(nextMap);
          setExpandedPaths(validExpanded);
        } else {
          setExpandedPaths(new Set());
          setChildrenMap(new Map());
        }

        if (!alreadyInMemory && !result.from_cache && result.duration_ms > 150) {
          obsidianToast.success(
            `Indexed ${targetDriveRoot} (${formatBytes(result.total_bytes)})`,
            { description: `Completed in ${formatDuration(result.duration_ms)} • Live sync active` }
          );
        }
      } catch (err) {
        if (activeRequestIdRef.current === reqId) {
          console.error('Analysis failed:', err);
          obsidianToast.error('Could not analyze folder', { description: String(err) });
        }
      } finally {
        if (activeRequestIdRef.current === reqId) {
          setIsAnalyzing(false);
          setIsFullDiskScanning(false);
        }
      }
    },
    [indexedStatuses, computeRelativeDepth, refreshIndexedStatuses]
  );

  const runFullDiskReindex = useCallback(
    async (diskRoot: string, forceReindex = true) => {
      const reqId = ++activeRequestIdRef.current;
      const normRoot = getDriveRootFromPath(diskRoot).toUpperCase();
      setIsAnalyzing(true);
      setIsFullDiskScanning(true);
      setViewMode('tree');
      setProgress({
        current_folder: `Indexing full disk ${diskRoot}...`,
        drive_root: normRoot,
        folders_scanned: 0,
        files_scanned: 0,
        bytes_scanned: 0,
        items_per_sec: 0,
        folders_per_sec: 0,
        files_per_sec: 0,
        bytes_per_sec: 0,
        elapsed_ms: 0,
      });
      setSelectedItemIds(new Set());
      setExpandedPaths(new Set());
      setChildrenMap(new Map());

      try {
        const result = await invoke<FolderAnalysisResult>('analyze_full_disk', {
          diskRoot,
          forceReindex,
        });
        refreshIndexedStatuses();
        if (activeRequestIdRef.current !== reqId) return;

        setAnalysisResult(result);
        setTreeItems(result.items);
        setCurrentPath(result.target_path);
        setPathInput(result.target_path);
        obsidianToast.success(
          `Indexed ${result.target_path} (${formatBytes(result.total_bytes)})`,
          { description: `Completed in ${formatDuration(result.duration_ms)} • Live sync active` }
        );
      } catch (err) {
        if (activeRequestIdRef.current === reqId) {
          console.error('Full disk analysis failed:', err);
          obsidianToast.error('Full disk analysis failed', { description: String(err) });
        }
      } finally {
        if (activeRequestIdRef.current === reqId) {
          setIsAnalyzing(false);
          setIsFullDiskScanning(false);
        }
      }
    },
    [refreshIndexedStatuses]
  );

  const runSmartSync = useCallback(async () => {
    setIsSmartSyncing(true);
    try {
      const result = await invoke<FolderAnalysisResult>('smart_sync_folder', {
        targetPath: currentPathRef.current,
      });
      setAnalysisResult(result);
      setTreeItems(result.items);
      await refreshCurrentViewFromCache(result.target_path, Array.from(expandedPathsRef.current));
      refreshIndexedStatuses();
      if (result.last_sync_summary) {
        obsidianToast.success(result.last_sync_summary);
      }
    } catch (err) {
      console.error('Smart sync failed:', err);
      obsidianToast.error('Smart sync failed', { description: String(err) });
    } finally {
      setIsSmartSyncing(false);
    }
  }, [refreshCurrentViewFromCache, refreshIndexedStatuses]);

  const runVerifyAndRecalculateDisk = useCallback(
    async (
      targetPath: string,
      forceRecalculate: boolean,
      options?: { silentIfMatched?: boolean }
    ) => {
      const reqId = ++activeRequestIdRef.current;
      const normRoot = getDriveRootFromPath(targetPath).toUpperCase();
      autoCheckedDrivesRef.current.add(normRoot);

      const driveMeta = drives.find((d) => d.mount_point.toUpperCase() === normRoot);
      const cachedStatus = indexedStatuses.get(normRoot);
      const predictedMismatch =
        forceRecalculate ||
        !cachedStatus?.is_indexed ||
        (driveMeta
          ? !evaluateDiskSizeMatch(
              driveMeta.total_bytes,
              driveMeta.used_bytes,
              cachedStatus.total_bytes
            ).matched
          : false);

      setIsVerifyingDisk(true);
      if (predictedMismatch) {
        setIsAnalyzing(true);
        setIsFullDiskScanning(true);
        setProgress({
          current_folder: forceRecalculate
            ? `Re-analyzing full disk ${normRoot} from scratch...`
            : `Size mismatch detected — recalculating full disk ${normRoot}...`,
          drive_root: normRoot,
          folders_scanned: 0,
          files_scanned: 0,
          bytes_scanned: 0,
          items_per_sec: 0,
          folders_per_sec: 0,
          files_per_sec: 0,
          bytes_per_sec: 0,
          elapsed_ms: 0,
        });
        setSelectedItemIds(new Set());
      }

      try {
        const report = await invoke<DiskVerificationReport>('verify_and_recalculate_disk', {
          targetPath,
          forceRecalculate,
        });

        refreshIndexedStatuses();
        onRefreshDrives?.();

        setVerificationByDrive((prev) => {
          const next = new Map(prev);
          next.set(report.drive_root.toUpperCase(), report);
          return next;
        });

        if (activeRequestIdRef.current !== reqId) return;

        setAnalysisResult(report.analysis_result);
        setTreeItems(report.analysis_result.items);
        setCurrentPath(report.analysis_result.target_path);
        setPathInput(report.analysis_result.target_path);
        setExpandedPaths(new Set());
        setChildrenMap(new Map());

        if (viewModeRef.current === 'deep_scan') {
          const items = await invoke<FolderItem[]>('get_deep_largest_folders', {
            targetPath: report.analysis_result.target_path,
            minSizeMb: minSizeMbRef.current,
            topN: 100,
          });
          if (activeRequestIdRef.current === reqId) {
            setDeepScanResults(items);
          }
        }

        if (!report.recalculated && report.matched_after) {
          if (!options?.silentIfMatched) {
            obsidianToast.success(`Disk size verified (${report.match_percentage}%)`, {
              description: report.summary,
            });
          }
        } else if (report.matched_after) {
          obsidianToast.success(
            `Whole disk ${report.drive_root} recalculated & matched (${report.match_percentage}%)`,
            {
              description: `Scanned ${formatBytes(report.scanned_bytes_after)} vs OS used ${formatBytes(report.disk_used_bytes)} in ${formatDuration(report.duration_ms)}`,
            }
          );
        } else {
          obsidianToast.info(`Whole disk ${report.drive_root} recalculated`, {
            description: report.summary,
          });
        }
      } catch (err) {
        if (activeRequestIdRef.current === reqId) {
          console.error('Disk verification failed:', err);
          obsidianToast.error('Disk verification failed', { description: String(err) });
        }
      } finally {
        if (activeRequestIdRef.current === reqId) {
          setIsVerifyingDisk(false);
          setIsAnalyzing(false);
          setIsFullDiskScanning(false);
        }
      }
    },
    [drives, indexedStatuses, refreshIndexedStatuses, onRefreshDrives]
  );

  const runDeepScan = useCallback(
    async (targetPath: string, minMb = 100) => {
      const reqId = ++activeRequestIdRef.current;
      const targetDriveRoot = getDriveRootFromPath(targetPath).toUpperCase();
      const alreadyInMemory = indexedStatuses.has(targetDriveRoot);

      if (!alreadyInMemory) {
        setIsAnalyzing(true);
        setIsFullDiskScanning(false);
        setProgress({
          current_folder: `Indexing ${targetPath} for largest folders...`,
          drive_root: targetDriveRoot,
          folders_scanned: 0,
          files_scanned: 0,
          bytes_scanned: 0,
          items_per_sec: 0,
          folders_per_sec: 0,
          files_per_sec: 0,
          bytes_per_sec: 0,
          elapsed_ms: 0,
        });
      }
      setSelectedItemIds(new Set());

      try {
        const items = await invoke<FolderItem[]>('get_deep_largest_folders', {
          targetPath,
          minSizeMb: minMb,
          topN: 100,
        });
        refreshIndexedStatuses();
        if (activeRequestIdRef.current !== reqId) return;
        setDeepScanResults(items);
        setCurrentPath(targetPath);
        setPathInput(targetPath);
      } catch (err) {
        if (activeRequestIdRef.current === reqId) {
          console.error('Deep scan failed:', err);
          obsidianToast.error('Deep scan failed', { description: String(err) });
        }
      } finally {
        if (activeRequestIdRef.current === reqId) {
          setIsAnalyzing(false);
        }
      }
    },
    [indexedStatuses, refreshIndexedStatuses]
  );

  useEffect(() => {
    if (!navRequest) return;
    if (lastNavNonceRef.current === navRequest.nonce) return;
    lastNavNonceRef.current = navRequest.nonce;
    hasInitializedRef.current = true;

    rememberCurrentDriveView();

    const targetPath = navRequest.path;
    const targetMode = navRequest.mode || 'tree';
    const nextMinMb = navRequest.minSizeMb ?? (targetMode === 'deep_scan' ? 100 : 0);

    setCurrentPath(targetPath);
    setPathInput(targetPath);
    setViewMode(targetMode);
    setMinSizeMb(nextMinMb);

    if (navRequest.autoFullDisk) {
      const root = getDriveRootFromPath(targetPath);
      runFullDiskReindex(root, false);
    } else if (targetMode === 'deep_scan') {
      runDeepScan(targetPath, nextMinMb);
    } else {
      const mem = driveViewMemoryRef.current.get(getDriveRootFromPath(targetPath).toUpperCase());
      const isDriveRootClick = targetPath.replace(/\\+$/, '').length === 2;
      if (isDriveRootClick && mem) {
        openPathSmart(mem.currentPath, { restoreExpanded: mem.expandedPaths });
      } else {
        openPathSmart(targetPath);
      }
    }
  }, [navRequest, rememberCurrentDriveView, runFullDiskReindex, runDeepScan, openPathSmart]);

  useEffect(() => {
    if (!isActive || hasInitializedRef.current) return;
    hasInitializedRef.current = true;
    const defaultDrive = drives[0]?.mount_point || 'C:\\';
    setCurrentPath(defaultDrive);
    setPathInput(defaultDrive);
    openPathSmart(defaultDrive);
  }, [isActive, drives, openPathSmart]);

  const handleSwitchViewMode = (mode: 'tree' | 'deep_scan') => {
    setViewMode(mode);
    setSelectedItemIds(new Set());
    if (mode === 'deep_scan') {
      const effectiveMin = minSizeMb === 0 ? 100 : minSizeMb;
      if (minSizeMb === 0) setMinSizeMb(100);
      runDeepScan(currentPath, effectiveMin);
    } else {
      openPathSmart(currentPath, { restoreExpanded: Array.from(expandedPaths) });
    }
  };

  const handleMinSizeChange = (value: string) => {
    const nextMb = Number(value);
    setMinSizeMb(nextMb);
    if (viewMode === 'deep_scan') {
      runDeepScan(currentPath, nextMb);
    }
  };

  const handleDriveSwitch = (mountPoint: string, forceRoot = false) => {
    const targetDriveKey = getDriveRootFromPath(mountPoint).toUpperCase();
    const currentDriveKey = getDriveRootFromPath(currentPath).toUpperCase();

    if (targetDriveKey !== currentDriveKey) {
      rememberCurrentDriveView();
    }

    const remembered = !forceRoot ? driveViewMemoryRef.current.get(targetDriveKey) : undefined;
    const destination = remembered ? remembered.currentPath : mountPoint;

    setCurrentPath(destination);
    setPathInput(destination);
    if (viewMode === 'deep_scan') {
      runDeepScan(destination, minSizeMb);
    } else {
      openPathSmart(destination, { restoreExpanded: remembered?.expandedPaths });
    }
  };

  const handlePathSubmit = () => {
    const trimmed = pathInput.trim();
    if (!trimmed) return;
    if (viewMode === 'deep_scan') {
      runDeepScan(trimmed, minSizeMb);
    } else {
      openPathSmart(trimmed);
    }
  };

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
          obsidianToast.error('Unable to read subfolders (access may be restricted)');
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
      obsidianToast.success('Located in Windows Explorer', { description: path });
    } catch {
      try {
        await invoke('open_in_explorer', { path });
      } catch {
        obsidianToast.error('Failed to open Windows Explorer');
      }
    }
  };

  const handleOpenFolder = async (path: string) => {
    try {
      await invoke('open_in_explorer', { path });
    } catch {
      obsidianToast.error('Failed to open folder in Explorer');
    }
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    obsidianToast.success('Path copied to clipboard', { description: path });
  };

  const handleFocusAsRoot = (path: string) => {
    setViewMode('tree');
    openPathSmart(path);
  };

  const handleNavigateUp = () => {
    const cleaned = currentPath.replace(/\\+$/, '');
    const lastSlash = cleaned.lastIndexOf('\\');
    if (lastSlash >= 0) {
      const parent = cleaned.substring(0, lastSlash + 1);
      if (parent !== currentPath) {
        if (viewMode === 'deep_scan') runDeepScan(parent, minSizeMb);
        else openPathSmart(parent);
      }
    }
  };

  const breadcrumbs = useMemo(() => {
    const parts = currentPath.split(/[/\\]+/).filter(Boolean);
    if (parts.length === 0) return [{ label: currentPath, path: currentPath }];
    const crumbs: { label: string; path: string }[] = [];
    let accPath = '';
    for (let i = 0; i < parts.length; i++) {
      if (i === 0) accPath = parts[0].includes(':') ? `${parts[0]}\\` : parts[0];
      else accPath = `${accPath.replace(/\\$/, '')}\\${parts[i]}`;
      crumbs.push({ label: parts[i], path: accPath });
    }
    return crumbs;
  }, [currentPath]);

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
          if (children && children.length > 0) appendItems(children);
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

  const selectedFolders = useMemo(
    () => flattenedTreeItems.filter((it) => selectedItemIds.has(it.id)),
    [flattenedTreeItems, selectedItemIds]
  );

  const selectedTotalBytes = useMemo(
    () => selectedFolders.reduce((sum, f) => sum + f.size_bytes, 0),
    [selectedFolders]
  );

  const handleCopySelectedPaths = () => {
    if (selectedFolders.length === 0) return;
    navigator.clipboard.writeText(selectedFolders.map((f) => f.path).join('\n'));
    obsidianToast.success(
      `Copied ${selectedFolders.length} selected path${selectedFolders.length === 1 ? '' : 's'} to clipboard`
    );
  };

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
        obsidianToast.success(
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
        obsidianToast.warning(
          `Could not remove ${report.failed_paths.length} item(s) — protected or locked`
        );
      }

      if (onRefreshDrives) onRefreshDrives();
      if (viewMode === 'tree') {
        await refreshCurrentViewFromCache(currentPath, Array.from(expandedPaths));
      } else {
        await runDeepScan(currentPath, minSizeMb);
      }
    } catch (err) {
      console.error('Delete failed:', err);
      obsidianToast.error('Deletion failed', { description: String(err) });
    } finally {
      setIsDeleting(false);
    }
  };

  const currentDriveRoot = getDriveRootFromPath(currentPath, drives[0]?.mount_point || 'C:\\');
  const currentDriveKey = currentDriveRoot.toUpperCase();
  const activeDriveStatus = indexedStatuses.get(currentDriveKey);
  const currentDriveInfo = useMemo(
    () => drives.find((d) => d.mount_point.toUpperCase() === currentDriveKey) || null,
    [drives, currentDriveKey]
  );
  const activeVerification = verificationByDrive.get(currentDriveKey) || null;

  const liveSizeComparison = useMemo(() => {
    const diskTotal = currentDriveInfo?.total_bytes ?? activeVerification?.disk_total_bytes ?? 0;
    const diskUsed = currentDriveInfo?.used_bytes ?? activeVerification?.disk_used_bytes ?? 0;
    const diskFree = currentDriveInfo?.available_bytes ?? activeVerification?.disk_free_bytes ?? 0;
    const isDriveRootView =
      analysisResult &&
      getDriveRootFromPath(analysisResult.target_path).toUpperCase() ===
        analysisResult.target_path.toUpperCase();
    const scannedBytes =
      activeDriveStatus?.is_indexed
        ? activeDriveStatus.total_bytes
        : isDriveRootView
        ? analysisResult.total_bytes
        : activeVerification?.scanned_bytes_after ?? null;

    if (diskTotal <= 0 || scannedBytes === null) return null;
    const check = evaluateDiskSizeMatch(diskTotal, diskUsed, scannedBytes);
    const usedOfDiskPct =
      diskTotal > 0 ? Math.min(100, Math.round((diskUsed / diskTotal) * 1000) / 10) : 0;
    const scannedOfDiskPct =
      diskTotal > 0 ? Math.min(100, Math.round((scannedBytes / diskTotal) * 1000) / 10) : 0;

    return {
      diskTotal,
      diskUsed,
      diskFree,
      scannedBytes,
      usedOfDiskPct,
      scannedOfDiskPct,
      ...check,
    };
  }, [currentDriveInfo, activeDriveStatus, activeVerification, analysisResult]);

  // Automatic once-per-drive-per-session size check:
  // If scanned size does not match OS disk used space when viewing an indexed drive,
  // automatically verify and recalculate the whole disk.
  useEffect(() => {
    if (!isActive || isAnalyzing || isVerifyingDisk || isSmartSyncing) return;
    if (!activeDriveStatus?.is_indexed || activeDriveStatus.is_syncing) return;
    if (!liveSizeComparison || liveSizeComparison.matched) return;
    if (autoCheckedDrivesRef.current.has(currentDriveKey)) return;

    autoCheckedDrivesRef.current.add(currentDriveKey);
    runVerifyAndRecalculateDisk(currentPathRef.current, false, { silentIfMatched: true });
  }, [
    isActive,
    isAnalyzing,
    isVerifyingDisk,
    isSmartSyncing,
    activeDriveStatus,
    liveSizeComparison,
    currentDriveKey,
    runVerifyAndRecalculateDisk,
  ]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <FolderDeleteModal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setSingleDeleteTarget(null);
        }}
        onConfirm={handleConfirmDelete}
        selectedFolders={modalTargets}
      />

      {/* Top Controls Bar */}
      <div className="border-b border-[var(--obs-border)] bg-[var(--obs-panel)]/70 px-6 py-3.5 space-y-3 shrink-0">
        {/* Row 1: Drive Pills + Path Input + Smart Sync & Reindex */}
        <div className="flex flex-wrap items-center gap-2">
          {drives.length > 0 && (
            <div className="flex items-center gap-1 pr-1">
              {drives.map((d) => {
                const isCurrent = currentPath
                  .toUpperCase()
                  .startsWith(d.mount_point.toUpperCase());
                const status = indexedStatuses.get(d.mount_point.toUpperCase());
                const isLive = Boolean(status?.is_indexed && status?.is_watching);

                return (
                  <ObsidianButton
                    key={d.mount_point}
                    size="sm"
                    variant={isCurrent ? 'control' : 'ghost'}
                    onClick={() => handleDriveSwitch(d.mount_point)}
                    title={
                      isLive && status
                        ? `${d.volume_name} (${d.mount_point}) — Live synced (${formatBytes(status.total_bytes)} indexed)`
                        : `Switch to ${d.volume_name} (${d.mount_point}) — ongoing sync continues in background`
                    }
                    className={cn(
                      'font-mono font-bold px-2.5 gap-1.5',
                      isCurrent && 'ring-1 ring-[var(--obs-accent-border)] text-[var(--obs-accent)]'
                    )}
                  >
                    {isLive && (
                      <ObsidianStatusDot
                        tone={status?.is_syncing ? 'warning' : 'success'}
                        pulse={Boolean(status?.is_syncing)}
                      />
                    )}
                    {d.mount_point.replace('\\', '')}
                  </ObsidianButton>
                );
              })}
            </div>
          )}

          {/* Path Input */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="h-3.5 w-3.5 text-[var(--obs-text-subtle)] absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handlePathSubmit();
              }}
              placeholder="Enter path (e.g. C:\Users, D:\Projects)..."
              className="obs-control h-8 w-full pl-8 pr-8 rounded-[9px] text-xs font-mono text-[var(--obs-fg)] placeholder:text-[var(--obs-text-subtle)] outline-none focus:ring-1 focus:ring-[var(--obs-accent)]"
            />
            <button
              type="button"
              onClick={() => handleCopyPath(currentPath)}
              title="Copy current path"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--obs-text-subtle)] hover:text-[var(--obs-fg)]"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>

          <ObsidianButton
            variant="control"
            size="sm"
            onClick={runSmartSync}
            disabled={isAnalyzing || isSmartSyncing || isVerifyingDisk}
            title={`Incrementally sync only changed entries inside ${currentPath}`}
          >
            <Zap
              className={cn('h-3.5 w-3.5 text-[var(--obs-accent)]', isSmartSyncing && 'animate-pulse')}
            />
            Smart Sync
          </ObsidianButton>

          <ObsidianButton
            variant="control"
            size="sm"
            onClick={() => runVerifyAndRecalculateDisk(currentPath, false)}
            disabled={isAnalyzing || isVerifyingDisk}
            title={`Compare ${currentDriveRoot} OS disk full/used size with scanned size and automatically recalculate if not matched`}
          >
            <Scale
              className={cn(
                'h-3.5 w-3.5 text-[var(--obs-accent)]',
                isVerifyingDisk && 'animate-pulse'
              )}
            />
            Check Size
          </ObsidianButton>

          <ObsidianButton
            variant="accent"
            size="sm"
            onClick={() => runVerifyAndRecalculateDisk(currentPath, true)}
            disabled={isAnalyzing || isVerifyingDisk}
            title={`Analyze whole disk ${currentDriveRoot} again from scratch and verify against OS disk size`}
          >
            <Disc
              className={cn(
                'h-3.5 w-3.5',
                (isFullDiskScanning || isVerifyingDisk) && 'animate-spin'
              )}
            />
            Analyze Whole Disk Again ({currentDriveRoot.replace('\\', '')})
          </ObsidianButton>
        </div>

        {/* Row 2: Breadcrumbs + Obsidian Segmented Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 overflow-x-auto max-w-full py-0.5">
            <ObsidianButton
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={handleNavigateUp}
              disabled={breadcrumbs.length <= 1 || isAnalyzing}
              title="Parent folder"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </ObsidianButton>
            <ObsidianButton
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => handleDriveSwitch(currentDriveRoot, true)}
              disabled={isAnalyzing}
              title={`Drive root (${currentDriveRoot})`}
            >
              <Home className="h-3.5 w-3.5" />
            </ObsidianButton>

            {breadcrumbs.map((crumb, idx) => (
              <React.Fragment key={crumb.path}>
                <ChevronRight className="h-3 w-3 text-[var(--obs-text-subtle)] shrink-0" />
                <button
                  type="button"
                  onClick={() =>
                    viewMode === 'deep_scan'
                      ? runDeepScan(crumb.path, minSizeMb)
                      : openPathSmart(crumb.path)
                  }
                  className={cn(
                    'px-2 py-1 rounded-md text-xs font-mono truncate max-w-[150px] transition-colors',
                    idx === breadcrumbs.length - 1
                      ? 'bg-[var(--obs-muted)] text-[var(--obs-accent)] font-semibold'
                      : 'text-[var(--obs-text-muted)] hover:text-[var(--obs-fg)] hover:bg-[var(--obs-hover)]'
                  )}
                  title={crumb.path}
                >
                  {crumb.label}
                </button>
              </React.Fragment>
            ))}
          </div>

          <ObsidianSegmentedTabs
            layoutId="obs-analyzer-view-mode"
            value={viewMode}
            onChange={handleSwitchViewMode}
            items={[
              {
                value: 'tree',
                label: 'Folder Tree',
                icon: <FolderTree className="h-3.5 w-3.5" />,
              },
              {
                value: 'deep_scan',
                label: 'Top Space Hogs',
                icon: <Flame className="h-3.5 w-3.5 text-[var(--obs-accent)]" />,
              },
            ]}
          />
        </div>

        {/* Row 3: Obsidian Selects, Search, Copy Paths & Bulk Delete */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <ObsidianSelect
              prefix="Min:"
              value={String(minSizeMb)}
              options={MIN_SIZE_OPTIONS}
              onChange={handleMinSizeChange}
            />

            <ObsidianSelect
              prefix="Sort:"
              value={sortBy}
              options={SORT_OPTIONS}
              onChange={(v) => setSortBy(v as typeof sortBy)}
            />

            <div className="relative w-48">
              <Search className="h-3.5 w-3.5 text-[var(--obs-text-subtle)] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter results..."
                className="obs-control h-8 w-full pl-8 pr-7 rounded-[9px] text-xs text-[var(--obs-fg)] placeholder:text-[var(--obs-text-subtle)] outline-none focus:ring-1 focus:ring-[var(--obs-accent)]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--obs-text-subtle)] hover:text-[var(--obs-fg)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ObsidianButton
              variant="ghost"
              size="sm"
              onClick={toggleSelectAll}
              disabled={flattenedTreeItems.length === 0}
            >
              {selectedItemIds.size === flattenedTreeItems.length &&
              flattenedTreeItems.length > 0
                ? 'Deselect All'
                : 'Select All'}
            </ObsidianButton>

            {selectedFolders.length > 0 && (
              <>
                <ObsidianButton
                  variant="control"
                  size="sm"
                  onClick={handleCopySelectedPaths}
                  title="Copy all selected file/folder paths to clipboard"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy Paths ({selectedFolders.length})
                </ObsidianButton>
                <ObsidianButton
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setSingleDeleteTarget(null);
                    setShowDeleteModal(true);
                  }}
                  disabled={isDeleting}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete ({selectedFolders.length}) • {formatBytes(selectedTotalBytes)}
                </ObsidianButton>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 obs-scroll h-full">
        <div className="p-6 space-y-4 max-w-7xl mx-auto">
          {/* Unstoppable Indexing Progress Card with Real-Time Reading Speed Telemetry */}
          {isAnalyzing && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="obs-card p-4 space-y-3.5 ring-1 ring-[var(--obs-accent-border)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-[var(--obs-accent-soft)] text-[var(--obs-accent)] flex items-center justify-center shrink-0">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-[var(--obs-fg)]">
                      {isFullDiskScanning
                        ? `Indexing Full Disk ${currentDriveRoot}...`
                        : viewMode === 'deep_scan'
                        ? `Indexing ${currentDriveRoot} for Largest Space Hogs...`
                        : 'Indexing Directory Tree...'}
                    </h4>
                    <p className="text-[11px] text-[var(--obs-text-muted)]">
                      Native Win32 multi-core scan • Switching disks will not interrupt background
                      sync
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {progress && progress.items_per_sec > 0 && (
                    <ObsidianBadge
                      tone={
                        progress.items_per_sec >= 20000
                          ? 'success'
                          : progress.items_per_sec >= 5000
                          ? 'warning'
                          : 'danger'
                      }
                      className="font-mono py-1 px-2.5 text-[11px]"
                    >
                      <Gauge className="h-3 w-3" />
                      {formatItemsPerSec(progress.items_per_sec)}
                      {progress.items_per_sec >= 20000
                        ? ' • Fast'
                        : progress.items_per_sec >= 5000
                        ? ' • Moderate'
                        : ' • Slow (close bg apps)'}
                    </ObsidianBadge>
                  )}
                  <ObsidianBadge tone="neutral" className="py-1 px-2.5 text-[10px]">
                    <ShieldCheck className="h-3 w-3 text-[var(--obs-success)]" />
                    Auto-Sync Active
                  </ObsidianBadge>
                </div>
              </div>

              <div className="h-1.5 w-full bg-[var(--obs-muted)] rounded-full overflow-hidden relative">
                <div className="h-full w-1/3 bg-[var(--obs-accent)] rounded-full animate-indeterminate-bar" />
              </div>

              {/* Real-Time Reading Speed Telemetry Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-lg border border-[var(--obs-border)] bg-[var(--obs-bg)]/60 px-3 py-2">
                  <p className="text-[9px] uppercase tracking-wider text-[var(--obs-text-subtle)] font-semibold">
                    Read Speed
                  </p>
                  <p className="text-xs font-bold font-mono text-[var(--obs-accent)] tabular-nums mt-0.5">
                    {progress && progress.items_per_sec > 0
                      ? `${progress.items_per_sec.toLocaleString()} items/s`
                      : 'Measuring...'}
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--obs-border)] bg-[var(--obs-bg)]/60 px-3 py-2">
                  <p className="text-[9px] uppercase tracking-wider text-[var(--obs-text-subtle)] font-semibold">
                    Folders / sec
                  </p>
                  <p className="text-xs font-bold font-mono text-[var(--obs-fg)] tabular-nums mt-0.5">
                    {(progress?.folders_per_sec || 0).toLocaleString()} /s
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--obs-border)] bg-[var(--obs-bg)]/60 px-3 py-2">
                  <p className="text-[9px] uppercase tracking-wider text-[var(--obs-text-subtle)] font-semibold">
                    Files / sec
                  </p>
                  <p className="text-xs font-bold font-mono text-[var(--obs-fg)] tabular-nums mt-0.5">
                    {(progress?.files_per_sec || 0).toLocaleString()} /s
                  </p>
                </div>
                <div className="rounded-lg border border-[var(--obs-border)] bg-[var(--obs-bg)]/60 px-3 py-2">
                  <p className="text-[9px] uppercase tracking-wider text-[var(--obs-text-subtle)] font-semibold">
                    Data Indexed Rate
                  </p>
                  <p className="text-xs font-bold font-mono text-emerald-400 tabular-nums mt-0.5">
                    {formatBytes(progress?.bytes_per_sec || 0)}/s
                    {progress && progress.elapsed_ms > 0
                      ? ` • ${formatDuration(progress.elapsed_ms)}`
                      : ''}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 text-[11px] font-mono">
                <span className="text-[var(--obs-text-muted)] truncate">
                  Reading: {progress?.current_folder || 'Scanning...'}
                </span>
                <span className="text-[var(--obs-accent)] font-semibold tabular-nums shrink-0">
                  {formatBytes(progress?.bytes_scanned || 0)} (
                  {(progress?.files_scanned || 0).toLocaleString()} files,{' '}
                  {(progress?.folders_scanned || 0).toLocaleString()} folders)
                </span>
              </div>
            </motion.div>
          )}

          {/* Disk Full Size vs Scanned Size Verification Bar */}
          {liveSizeComparison && (
            <div
              className={cn(
                'obs-card p-3.5 space-y-2.5',
                !liveSizeComparison.matched &&
                  !activeVerification?.recalculated &&
                  'ring-1 ring-[var(--obs-warning)]/50'
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Scale className="h-3.5 w-3.5 text-[var(--obs-accent)] shrink-0" />
                  <span className="text-xs font-semibold text-[var(--obs-fg)]">
                    Disk Size Check ({currentDriveRoot.replace('\\', '')})
                  </span>
                  {currentDriveInfo?.volume_name && (
                    <span className="text-[11px] text-[var(--obs-text-subtle)]">
                      {currentDriveInfo.volume_name}
                    </span>
                  )}

                  {isVerifyingDisk || isFullDiskScanning ? (
                    <ObsidianBadge tone="warning">
                      <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                      Verifying &amp; Recalculating...
                    </ObsidianBadge>
                  ) : liveSizeComparison.matched ? (
                    <ObsidianBadge tone="success">
                      <CheckCircle2 className="h-2.5 w-2.5" />
                      Matched ({liveSizeComparison.matchPercentage}%)
                    </ObsidianBadge>
                  ) : (
                    <ObsidianBadge tone={activeVerification?.recalculated ? 'warning' : 'danger'}>
                      <AlertTriangle className="h-2.5 w-2.5" />
                      {activeVerification?.recalculated
                        ? `Recalculated • ${
                            liveSizeComparison.differenceBytes < 0 ? '-' : '+'
                          }${formatBytes(liveSizeComparison.absDifferenceBytes)} diff`
                        : `Size Mismatch (${
                            liveSizeComparison.differenceBytes < 0 ? '-' : '+'
                          }${formatBytes(liveSizeComparison.absDifferenceBytes)})`}
                    </ObsidianBadge>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {!liveSizeComparison.matched && !isAnalyzing && !isVerifyingDisk && (
                    <ObsidianButton
                      variant="accent"
                      size="xs"
                      onClick={() => runVerifyAndRecalculateDisk(currentPath, true)}
                      title="Recalculate the entire disk now to reconcile the size mismatch"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Recalculate Now
                    </ObsidianButton>
                  )}
                  <ObsidianButton
                    variant="ghost"
                    size="xs"
                    onClick={() => runVerifyAndRecalculateDisk(currentPath, false)}
                    disabled={isAnalyzing || isVerifyingDisk}
                    title="Re-check OS disk used space vs scanned index size and recalculate if not matched"
                  >
                    <Scale className="h-3 w-3" />
                    Re-verify
                  </ObsidianButton>
                </div>
              </div>

              {/* 4-column Size Telemetry */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                <div className="rounded-lg border border-[var(--obs-border)] bg-[var(--obs-bg)]/50 px-2.5 py-1.5">
                  <p className="text-[9px] uppercase tracking-wider text-[var(--obs-text-subtle)] font-semibold">
                    Disk Full Size
                  </p>
                  <p className="font-mono font-bold text-[var(--obs-fg)] tabular-nums mt-0.5">
                    {formatBytes(liveSizeComparison.diskTotal)}
                  </p>
                  <p className="text-[10px] text-[var(--obs-text-subtle)] font-mono tabular-nums">
                    {formatBytes(liveSizeComparison.diskFree)} free
                  </p>
                </div>

                <div className="rounded-lg border border-[var(--obs-border)] bg-[var(--obs-bg)]/50 px-2.5 py-1.5">
                  <p className="text-[9px] uppercase tracking-wider text-[var(--obs-text-subtle)] font-semibold">
                    Disk Used (OS)
                  </p>
                  <p className="font-mono font-bold text-[var(--obs-fg)] tabular-nums mt-0.5">
                    {formatBytes(liveSizeComparison.diskUsed)}
                  </p>
                  <p className="text-[10px] text-[var(--obs-text-subtle)] font-mono tabular-nums">
                    {liveSizeComparison.usedOfDiskPct}% of full disk
                  </p>
                </div>

                <div className="rounded-lg border border-[var(--obs-border)] bg-[var(--obs-bg)]/50 px-2.5 py-1.5">
                  <p className="text-[9px] uppercase tracking-wider text-[var(--obs-text-subtle)] font-semibold">
                    Scanned Size
                  </p>
                  <p className="font-mono font-bold text-[var(--obs-accent)] tabular-nums mt-0.5">
                    {formatBytes(liveSizeComparison.scannedBytes)}
                  </p>
                  <p className="text-[10px] text-[var(--obs-text-subtle)] font-mono tabular-nums">
                    {liveSizeComparison.matchPercentage}% of OS used
                  </p>
                </div>

                <div className="rounded-lg border border-[var(--obs-border)] bg-[var(--obs-bg)]/50 px-2.5 py-1.5">
                  <p className="text-[9px] uppercase tracking-wider text-[var(--obs-text-subtle)] font-semibold">
                    Difference
                  </p>
                  <p
                    className={cn(
                      'font-mono font-bold tabular-nums mt-0.5',
                      liveSizeComparison.matched
                        ? 'text-emerald-400'
                        : 'text-[var(--obs-warning)]'
                    )}
                  >
                    {liveSizeComparison.differenceBytes < 0 ? '-' : '+'}
                    {formatBytes(liveSizeComparison.absDifferenceBytes)}
                  </p>
                  <p className="text-[10px] text-[var(--obs-text-subtle)] truncate">
                    {liveSizeComparison.matched
                      ? 'Within normal tolerance'
                      : liveSizeComparison.differenceBytes < 0
                      ? 'Below OS used space'
                      : 'Above OS used (hardlinks)'}
                  </p>
                </div>
              </div>

              {/* Dual visual bar: OS Disk Used vs Scanned Index */}
              <div className="space-y-1">
                <div className="h-2 w-full rounded-full bg-[var(--obs-muted)] overflow-hidden relative">
                  <div
                    className="absolute inset-y-0 left-0 bg-[var(--obs-fg)]/20 rounded-full transition-all duration-300"
                    style={{ width: `${liveSizeComparison.usedOfDiskPct}%` }}
                    title={`OS Disk Used: ${formatBytes(liveSizeComparison.diskUsed)} (${liveSizeComparison.usedOfDiskPct}%)`}
                  />
                  <div
                    className={cn(
                      'absolute inset-y-0 left-0 rounded-full transition-all duration-300',
                      liveSizeComparison.matched
                        ? 'bg-emerald-500/85'
                        : 'bg-[var(--obs-accent)]'
                    )}
                    style={{ width: `${liveSizeComparison.scannedOfDiskPct}%` }}
                    title={`Scanned Size: ${formatBytes(liveSizeComparison.scannedBytes)} (${liveSizeComparison.scannedOfDiskPct}% of disk)`}
                  />
                </div>
                {activeVerification?.summary && (
                  <p className="text-[10px] text-[var(--obs-text-muted)]">
                    {activeVerification.summary}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Directory Summary */}
          {analysisResult && viewMode === 'tree' && (
            <div className="obs-card p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-9 w-9 rounded-lg bg-[var(--obs-accent-soft)] border border-[var(--obs-accent-border)] text-[var(--obs-accent)] flex items-center justify-center shrink-0">
                  <HardDrive className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-semibold text-[var(--obs-fg)] font-mono truncate">
                      {analysisResult.target_path}
                    </p>
                    {(analysisResult.is_watching || activeDriveStatus?.is_watching) && (
                      <ObsidianBadge tone="success">
                        <Radio className="h-2.5 w-2.5 animate-pulse" />
                        Live Sync
                      </ObsidianBadge>
                    )}
                    {(analysisResult.is_syncing ||
                      activeDriveStatus?.is_syncing ||
                      isSmartSyncing) && (
                      <ObsidianBadge tone="warning">
                        <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                        Syncing changes...
                      </ObsidianBadge>
                    )}
                    {liveSyncBanner && (
                      <ObsidianBadge tone="accent">{liveSyncBanner}</ObsidianBadge>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--obs-text-muted)] mt-0.5 tabular-nums">
                    {analysisResult.total_folders.toLocaleString()} folders •{' '}
                    {analysisResult.total_files.toLocaleString()} files •{' '}
                    {analysisResult.duration_ms === 0
                      ? 'Instant from live index'
                      : analysisResult.from_cache
                      ? `Loaded snapshot in ${formatDuration(analysisResult.duration_ms)}`
                      : `Indexed in ${formatDuration(analysisResult.duration_ms)}`}
                    {indexedStatuses.size > 1 &&
                      ` • ${indexedStatuses.size} drives kept live in memory`}
                  </p>
                </div>
              </div>

              <div className="sm:text-right shrink-0">
                <p className="text-[10px] uppercase font-medium text-[var(--obs-text-subtle)] tracking-wider">
                  Accounted Size
                </p>
                <p className="text-xl font-bold text-[var(--obs-accent)] font-mono tabular-nums">
                  {formatBytes(analysisResult.total_bytes)}
                </p>
              </div>
            </div>
          )}

          {/* Deep Scan Summary */}
          {viewMode === 'deep_scan' && !isAnalyzing && (
            <div className="obs-card p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-[var(--obs-accent-soft)] border border-[var(--obs-accent-border)] text-[var(--obs-accent)] flex items-center justify-center shrink-0">
                  <Flame className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-semibold text-[var(--obs-fg)]">
                      Top Space Hogs in{' '}
                      <span className="font-mono text-[var(--obs-accent)]">{currentPath}</span>
                    </p>
                    {activeDriveStatus?.is_watching && (
                      <ObsidianBadge tone="success">
                        <Radio className="h-2.5 w-2.5 animate-pulse" />
                        Live
                      </ObsidianBadge>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--obs-text-muted)]">
                    Showing {flattenedTreeItems.length} largest folders across all depths (min{' '}
                    {minSizeMb > 0 ? `${minSizeMb} MB` : 'all sizes'})
                  </p>
                </div>
              </div>
              <ObsidianButton
                variant="control"
                size="sm"
                onClick={runSmartSync}
                disabled={isSmartSyncing}
              >
                <Zap
                  className={cn(
                    'h-3.5 w-3.5 text-[var(--obs-accent)]',
                    isSmartSyncing && 'animate-pulse'
                  )}
                />
                Smart Sync
              </ObsidianButton>
            </div>
          )}

          {/* Empty State */}
          {!isAnalyzing && flattenedTreeItems.length === 0 && (
            <div className="obs-card p-12 text-center space-y-2">
              <Info className="h-8 w-8 text-[var(--obs-text-subtle)] mx-auto" />
              <p className="text-sm font-semibold text-[var(--obs-fg)]">
                No folders or files matched
              </p>
              <p className="text-xs text-[var(--obs-text-muted)]">
                Try lowering the minimum size filter, clearing your search query, or analyzing a
                different path.
              </p>
              {(minSizeMb > 0 || searchQuery) && (
                <div className="pt-2">
                  <ObsidianButton
                    variant="control"
                    size="sm"
                    onClick={() => {
                      setMinSizeMb(0);
                      setSearchQuery('');
                      if (viewMode === 'deep_scan') runDeepScan(currentPath, 0);
                    }}
                  >
                    Reset Filters
                  </ObsidianButton>
                </div>
              )}
            </div>
          )}

          {/* Tree Table */}
          {flattenedTreeItems.length > 0 && (
            <div className="obs-card overflow-hidden">
              <div className="px-4 py-2.5 bg-[var(--obs-bg)]/60 border-b border-[var(--obs-border)] flex items-center justify-between text-[11px] font-medium text-[var(--obs-text-subtle)]">
                <span>Name &amp; Path</span>
                <div className="flex items-center gap-6 pr-2">
                  <span className="w-24 hidden sm:inline text-right">Share</span>
                  <span className="w-24 text-right">Size</span>
                  <span className="w-24 text-right">Actions</span>
                </div>
              </div>

              <div className="divide-y divide-[var(--obs-border)]/70">
                {flattenedTreeItems.slice(0, visibleLimit).map((item) => {
                  const isSelected = selectedItemIds.has(item.id);
                  const isExpanded = expandedPaths.has(item.path);
                  const isLoadingThis = loadingChildPath === item.path;

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'py-2.5 pr-4 flex items-center justify-between text-xs transition-colors select-none group',
                        isSelected
                          ? 'bg-[var(--obs-accent-soft)]'
                          : 'hover:bg-[var(--obs-hover)]'
                      )}
                      style={{
                        paddingLeft: `${
                          viewMode === 'tree' ? Math.max(item.depth * 22 + 12, 12) : 12
                        }px`,
                      }}
                    >
                      {/* Left */}
                      <div className="flex items-center gap-2.5 flex-1 min-w-0 pr-4">
                        {viewMode === 'tree' ? (
                          item.is_dir && item.has_subfolders ? (
                            <button
                              type="button"
                              onClick={(e) => handleToggleExpand(item, e)}
                              title={isExpanded ? 'Collapse subfolders' : 'Expand subfolders'}
                              className="h-6 w-6 flex items-center justify-center rounded-md text-[var(--obs-text-muted)] hover:text-[var(--obs-fg)] hover:bg-[var(--obs-hover)] transition-colors shrink-0"
                            >
                              {isLoadingThis ? (
                                <RefreshCw className="h-3.5 w-3.5 animate-spin text-[var(--obs-accent)]" />
                              ) : isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5 text-[var(--obs-accent)]" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </button>
                          ) : (
                            <div className="w-6 shrink-0" />
                          )
                        ) : null}

                        <ObsidianCheckbox
                          checked={isSelected}
                          onChange={() => toggleItemSelect(item.id)}
                          stopPropagation
                        />

                        <div className="h-7 w-7 rounded-lg obs-control flex items-center justify-center shrink-0">
                          {item.is_dir ? (
                            isExpanded ? (
                              <FolderOpen className="h-3.5 w-3.5 text-[var(--obs-accent)]" />
                            ) : (
                              <Folder className="h-3.5 w-3.5 text-amber-400" />
                            )
                          ) : (
                            <File className="h-3.5 w-3.5 text-sky-400" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              onClick={() => item.is_dir && handleFocusAsRoot(item.path)}
                              className={cn(
                                'font-medium truncate transition-colors',
                                item.is_dir
                                  ? 'text-[var(--obs-fg)] hover:text-[var(--obs-accent)] cursor-pointer'
                                  : 'text-[var(--obs-fg)]/90'
                              )}
                              title={item.path}
                            >
                              {item.name}
                            </span>

                            {item.is_junction && (
                              <ObsidianBadge tone="warning" className="text-[9px]">
                                <Link2 className="h-2.5 w-2.5" />
                                Junction
                              </ObsidianBadge>
                            )}

                            {item.is_access_denied && (
                              <ObsidianBadge tone="danger" className="text-[9px]">
                                <Lock className="h-2.5 w-2.5" />
                                Protected
                              </ObsidianBadge>
                            )}

                            {item.is_dir && item.subfolder_count > 0 && !item.is_junction && (
                              <ObsidianBadge tone="neutral" className="font-mono text-[9px]">
                                {item.subfolder_count.toLocaleString()} sub
                              </ObsidianBadge>
                            )}
                          </div>
                          <p className="text-[10px] text-[var(--obs-text-subtle)] font-mono truncate mt-0.5">
                            {item.path}
                          </p>
                        </div>
                      </div>

                      {/* Right */}
                      <div className="flex items-center gap-5 shrink-0">
                        <div className="w-24 space-y-1 hidden sm:block">
                          <ObsidianProgress value={item.percentage} className="h-1.5" />
                          <span className="text-[10px] text-[var(--obs-text-subtle)] font-mono tabular-nums block text-right">
                            {item.percentage}%
                          </span>
                        </div>

                        <div className="text-right w-24 tabular-nums">
                          {item.is_junction ? (
                            <span className="font-mono font-semibold text-[11px] text-[var(--obs-warning)] block">
                              0 B (Link)
                            </span>
                          ) : item.is_access_denied && item.size_bytes === 0 ? (
                            <span className="font-mono font-semibold text-[11px] text-[var(--obs-danger)] block">
                              Restricted
                            </span>
                          ) : (
                            <span className="font-mono font-semibold text-xs text-[var(--obs-accent)] block">
                              {formatBytes(item.size_bytes)}
                            </span>
                          )}
                          <span className="text-[10px] text-[var(--obs-text-subtle)] font-mono block">
                            {item.is_junction
                              ? 'Link'
                              : item.is_access_denied && item.size_bytes === 0
                              ? 'ACL Locked'
                              : `${item.file_count.toLocaleString()} files`}
                          </span>
                        </div>

                        <div className="flex items-center justify-end gap-1 w-24">
                          <ObsidianButton
                            variant="control"
                            size="xs"
                            onClick={(e) => handleLocateInExplorer(item.path, e)}
                            title="Highlight in Windows File Explorer"
                          >
                            <MapPin className="h-3 w-3 text-[var(--obs-accent)]" />
                            Locate
                          </ObsidianButton>

                          <ObsidianActionMenu
                            trigger={
                              <ObsidianButton
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                title="More actions"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </ObsidianButton>
                            }
                            items={[
                              ...(item.is_dir
                                ? [
                                    {
                                      label: 'Focus as Root',
                                      icon: <ArrowUpRight className="h-3.5 w-3.5" />,
                                      onClick: () => handleFocusAsRoot(item.path),
                                    },
                                  ]
                                : []),
                              {
                                label: 'Open in Explorer',
                                icon: <FolderOpen className="h-3.5 w-3.5" />,
                                onClick: () => handleOpenFolder(item.path),
                              },
                              {
                                label: 'Copy Full Path',
                                icon: <Copy className="h-3.5 w-3.5" />,
                                onClick: () => handleCopyPath(item.path),
                              },
                              {
                                label: 'Delete Item...',
                                icon: <Trash2 className="h-3.5 w-3.5" />,
                                danger: true,
                                dividerBefore: true,
                                onClick: () => {
                                  setSingleDeleteTarget(item);
                                  setShowDeleteModal(true);
                                },
                              },
                            ]}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {flattenedTreeItems.length > visibleLimit && (
                <div className="px-4 py-3 border-t border-[var(--obs-border)] bg-[var(--obs-bg)]/45 flex items-center justify-between text-xs">
                  <span className="text-[var(--obs-text-muted)] font-mono">
                    Showing {visibleLimit.toLocaleString()} of{' '}
                    {flattenedTreeItems.length.toLocaleString()} items
                  </span>
                  <ObsidianButton
                    variant="control"
                    size="xs"
                    onClick={() => setVisibleLimit((prev) => prev + 250)}
                  >
                    Show More (+250)
                  </ObsidianButton>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
