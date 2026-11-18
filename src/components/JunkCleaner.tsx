import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  FolderArchive,
  Trash2,
  Globe,
  RefreshCw,
  Image,
  Flame,
  FileCode,
  ChevronDown,
  ChevronRight,
  Play,
  XCircle,
  Sparkles,
  ShieldCheck,
  Search,
  ArrowLeft,
  ChevronsUpDown,
  MapPin,
  X,
  Bot,
  Code2,
  Terminal,
  Cpu,
  MessageSquare,
  Music,
  Gamepad2,
  Smartphone,
  Boxes,
  Radar,
  Copy,
  Lock,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import {
  CategorySummary,
  CleanerQuickTrigger,
  CleanerStatusSummary,
  CleanProgress,
  CleanReport,
  CleanRequest,
  DetectedCleanupRule,
  JunkItem,
  ScanProgress,
  ScanResult,
} from '@/types';
import { formatBytes, formatDuration } from '@/utils';
import { cn } from '@/lib/utils';
import { ConfirmationModal } from './ConfirmationModal';
import { ReportModal } from './ReportModal';
import {
  ObsidianBadge,
  ObsidianButton,
  ObsidianCheckbox,
  ObsidianProgress,
} from '@/components/obsidian/ObsidianPrimitives';
import { obsidianToast } from '@/components/obsidian/ObsidianToast';

interface JunkCleanerProps {
  detectedRules: DetectedCleanupRule[];
  onRefreshRules?: () => void;
  quickTrigger?: CleanerQuickTrigger | null;
  onCleanSuccess?: () => void;
  onStatusChange?: (status: CleanerStatusSummary) => void;
}

function getRuleIcon(iconKey: string): React.ReactNode {
  switch (iconKey) {
    case 'user_temp':
      return <FolderArchive className="h-4 w-4 text-[var(--obs-accent)] shrink-0" />;
    case 'windows_temp':
      return <FolderArchive className="h-4 w-4 text-sky-400 shrink-0" />;
    case 'recycle_bin':
      return <Trash2 className="h-4 w-4 text-[var(--obs-danger)] shrink-0" />;
    case 'browser_chrome':
      return <Globe className="h-4 w-4 text-amber-400 shrink-0" />;
    case 'browser_edge':
      return <Globe className="h-4 w-4 text-sky-400 shrink-0" />;
    case 'browser_firefox':
      return <Globe className="h-4 w-4 text-orange-400 shrink-0" />;
    case 'browser_brave':
      return <Globe className="h-4 w-4 text-amber-500 shrink-0" />;
    case 'browser_opera':
      return <Globe className="h-4 w-4 text-rose-400 shrink-0" />;
    case 'browser_vivaldi':
      return <Globe className="h-4 w-4 text-red-400 shrink-0" />;
    case 'ai_agent':
      return <Bot className="h-4 w-4 text-violet-400 shrink-0" />;
    case 'ai_ide':
      return <Bot className="h-4 w-4 text-fuchsia-400 shrink-0" />;
    case 'android_studio':
      return <Smartphone className="h-4 w-4 text-emerald-400 shrink-0" />;
    case 'gradle':
      return <Boxes className="h-4 w-4 text-teal-400 shrink-0" />;
    case 'ide':
    case 'app_vscode':
      return <Code2 className="h-4 w-4 text-sky-400 shrink-0" />;
    case 'dev_cache':
      return <Terminal className="h-4 w-4 text-emerald-400 shrink-0" />;
    case 'app_discord':
      return <MessageSquare className="h-4 w-4 text-indigo-400 shrink-0" />;
    case 'app_spotify':
      return <Music className="h-4 w-4 text-green-400 shrink-0" />;
    case 'app_steam':
      return <Gamepad2 className="h-4 w-4 text-blue-400 shrink-0" />;
    case 'windows_update':
      return <RefreshCw className="h-4 w-4 text-violet-400 shrink-0" />;
    case 'gpu_cache':
      return <Cpu className="h-4 w-4 text-lime-400 shrink-0" />;
    case 'thumb_cache':
      return <Image className="h-4 w-4 text-teal-400 shrink-0" />;
    case 'crash_dumps':
      return <Flame className="h-4 w-4 text-rose-400 shrink-0" />;
    case 'prefetch_logs':
      return <FileCode className="h-4 w-4 text-indigo-400 shrink-0" />;
    default:
      return <Sparkles className="h-4 w-4 text-[var(--obs-accent)] shrink-0" />;
  }
}

export const JunkCleaner: React.FC<JunkCleanerProps> = ({
  detectedRules,
  onRefreshRules,
  quickTrigger,
  onCleanSuccess,
  onStatusChange,
}) => {
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [isRedetecting, setIsRedetecting] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [cleanProgress, setCleanProgress] = useState<CleanProgress | null>(null);

  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [resultSearch, setResultSearch] = useState('');

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [cleanReport, setCleanReport] = useState<CleanReport | null>(null);

  const hasInitializedSelectionRef = useRef(false);
  const lastTriggerNonceRef = useRef<number | null>(null);

  // Sync selected rules when detectedRules arrives or refreshes
  useEffect(() => {
    if (detectedRules.length === 0) return;
    const validIds = new Set(detectedRules.map((r) => r.id));

    if (!hasInitializedSelectionRef.current) {
      hasInitializedSelectionRef.current = true;
      setSelectedRuleIds(detectedRules.map((r) => r.id));
    } else {
      setSelectedRuleIds((prev) => prev.filter((id) => validIds.has(id)));
    }
  }, [detectedRules]);

  // Dynamic presets built strictly from what is installed on this PC
  const dynamicPresets = useMemo(() => {
    const allIds = detectedRules.map((r) => r.id);
    const validSet = new Set(allIds);
    const presets: { id: string; label: string; ruleIds: string[] }[] = [];

    if (allIds.length > 0) {
      presets.push({ id: 'all', label: 'All Detected', ruleIds: allIds });
    }

    const quickIds = ['user_temp', 'windows_temp', 'recycle_bin', 'thumb_cache'].filter((id) =>
      validSet.has(id)
    );
    if (quickIds.length > 0) {
      presets.push({ id: 'quick', label: 'Quick Clean', ruleIds: quickIds });
    }

    const browserIds = detectedRules.filter((r) => r.group === 'Browser').map((r) => r.id);
    if (browserIds.length > 0) {
      presets.push({
        id: 'browsers',
        label: `Browsers (${browserIds.length})`,
        ruleIds: browserIds,
      });
    }

    const aiIds = detectedRules.filter((r) => r.group === 'AI & Agents').map((r) => r.id);
    if (aiIds.length > 0) {
      presets.push({
        id: 'ai',
        label: `AI & Agents (${aiIds.length})`,
        ruleIds: aiIds,
      });
    }

    const ideIds = detectedRules.filter((r) => r.group === 'IDEs & Dev').map((r) => r.id);
    if (ideIds.length > 0) {
      presets.push({
        id: 'dev',
        label: `IDEs & Dev (${ideIds.length})`,
        ruleIds: ideIds,
      });
    }

    const appIds = detectedRules.filter((r) => r.group === 'Apps').map((r) => r.id);
    if (appIds.length > 0) {
      presets.push({
        id: 'apps',
        label: `Apps (${appIds.length})`,
        ruleIds: appIds,
      });
    }

    const systemIds = detectedRules
      .filter((r) => r.group === 'System' || r.id === 'windows_temp')
      .map((r) => r.id);
    if (systemIds.length > 0) {
      presets.push({ id: 'system', label: 'System & GPU', ruleIds: systemIds });
    }

    return presets;
  }, [detectedRules]);

  useEffect(() => {
    let unlistenScan: UnlistenFn | undefined;
    let unlistenClean: UnlistenFn | undefined;

    const setupListeners = async () => {
      try {
        unlistenScan = await listen<ScanProgress>('scan:progress', (event) => {
          setScanProgress(event.payload);
        });
        unlistenClean = await listen<CleanProgress>('clean:progress', (event) => {
          setCleanProgress(event.payload);
        });
      } catch {
        // Browser preview without Tauri runtime
      }
    };

    setupListeners();

    return () => {
      if (unlistenScan) unlistenScan();
      if (unlistenClean) unlistenClean();
    };
  }, []);

  const runScanWithRules = useCallback(async (ruleIds: string[]) => {
    if (ruleIds.length === 0) {
      obsidianToast.warning('Select at least one target category to scan');
      return;
    }

    setIsScanning(true);
    setScanProgress({ scanned_files: 0, scanned_bytes: 0, current_path: 'Initializing scan...' });
    setScanResult(null);
    setResultSearch('');

    try {
      const result = await invoke<ScanResult>('start_scan', {
        activeCategories: ruleIds,
      });

      setScanResult(result);

      const itemIds = new Set<string>();
      result.categories.forEach((cat) => {
        cat.items.forEach((item) => itemIds.add(item.id));
      });
      setSelectedItemIds(itemIds);

      const initExpanded = new Set<string>();
      result.categories.slice(0, 3).forEach((c) => initExpanded.add(c.category_id));
      setExpandedCategories(initExpanded);

      if (result.total_reclaimable_bytes > 0) {
        obsidianToast.success(
          `Found ${formatBytes(result.total_reclaimable_bytes)} across ${result.total_reclaimable_files.toLocaleString()} items`,
          { description: `Completed in ${formatDuration(result.scan_duration_ms)}` }
        );
      } else {
        obsidianToast.info('System is already clean for the selected targets');
      }
    } catch (err) {
      console.error('Scan failed:', err);
      obsidianToast.error('Scan failed', { description: String(err) });
    } finally {
      setIsScanning(false);
    }
  }, []);

  useEffect(() => {
    if (!quickTrigger || detectedRules.length === 0) return;
    if (lastTriggerNonceRef.current === quickTrigger.nonce) return;
    lastTriggerNonceRef.current = quickTrigger.nonce;
    hasInitializedSelectionRef.current = true;

    const validSet = new Set(detectedRules.map((r) => r.id));
    const filtered =
      quickTrigger.presetRuleIds && quickTrigger.presetRuleIds.length > 0
        ? quickTrigger.presetRuleIds.filter((id) => validSet.has(id))
        : detectedRules.map((r) => r.id);

    const targetRules = filtered.length > 0 ? filtered : detectedRules.map((r) => r.id);
    setSelectedRuleIds(targetRules);
    if (quickTrigger.autoScan && !isScanning && !isCleaning) {
      runScanWithRules(targetRules);
    }
  }, [quickTrigger, detectedRules, isScanning, isCleaning, runScanWithRules]);

  const { selectedBytes, selectedFiles, selectedCategories, selectedJunkItems } = useMemo(() => {
    if (!scanResult) {
      return {
        selectedBytes: 0,
        selectedFiles: 0,
        selectedCategories: [] as string[],
        selectedJunkItems: [] as JunkItem[],
      };
    }
    let bytes = 0;
    let files = 0;
    const catNamesSet = new Set<string>();
    const items: JunkItem[] = [];

    scanResult.categories.forEach((cat) => {
      let catHasSelected = false;
      cat.items.forEach((item) => {
        if (selectedItemIds.has(item.id)) {
          bytes += item.size_bytes;
          files += item.file_count;
          catHasSelected = true;
          items.push(item);
        }
      });
      if (catHasSelected) catNamesSet.add(cat.name);
    });

    return {
      selectedBytes: bytes,
      selectedFiles: files,
      selectedCategories: Array.from(catNamesSet),
      selectedJunkItems: items,
    };
  }, [scanResult, selectedItemIds]);

  useEffect(() => {
    onStatusChange?.({
      isScanning,
      isCleaning,
      reclaimableBytes: selectedBytes,
      reclaimableFiles: selectedFiles,
    });
  }, [isScanning, isCleaning, selectedBytes, selectedFiles, onStatusChange]);

  const toggleRule = (ruleId: string) => {
    setSelectedRuleIds((prev) =>
      prev.includes(ruleId) ? prev.filter((id) => id !== ruleId) : [...prev, ruleId]
    );
  };

  const toggleSelectAllRules = () => {
    if (selectedRuleIds.length === detectedRules.length) {
      setSelectedRuleIds([]);
    } else {
      setSelectedRuleIds(detectedRules.map((r) => r.id));
    }
  };

  const handleRedetectTargets = async () => {
    if (!onRefreshRules) return;
    setIsRedetecting(true);
    try {
      await Promise.resolve(onRefreshRules());
      obsidianToast.success('Refreshed installed browsers, AI agents & IDE targets');
    } finally {
      window.setTimeout(() => setIsRedetecting(false), 300);
    }
  };

  const handleStartScan = () => runScanWithRules(selectedRuleIds);

  const handleCancelScan = async () => {
    try {
      await invoke('cancel_scan');
      obsidianToast.info('Scan cancellation requested');
    } catch (err) {
      console.error('Failed to cancel scan:', err);
    }
  };

  const handleCancelClean = async () => {
    try {
      await invoke('cancel_clean');
      obsidianToast.info('Cleanup cancellation requested');
    } catch (err) {
      console.error('Failed to cancel clean:', err);
    }
  };

  const toggleCategorySelection = (category: CategorySummary) => {
    const newSelected = new Set(selectedItemIds);
    const allSelected = category.items.every((it) => newSelected.has(it.id));
    if (allSelected) {
      category.items.forEach((it) => newSelected.delete(it.id));
    } else {
      category.items.forEach((it) => newSelected.add(it.id));
    }
    setSelectedItemIds(newSelected);
  };

  const toggleItemSelection = (itemId: string) => {
    const newSelected = new Set(selectedItemIds);
    if (newSelected.has(itemId)) newSelected.delete(itemId);
    else newSelected.add(itemId);
    setSelectedItemIds(newSelected);
  };

  const toggleCategoryExpand = (catId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(catId)) newExpanded.delete(catId);
    else newExpanded.add(catId);
    setExpandedCategories(newExpanded);
  };

  const handleToggleExpandAll = () => {
    if (!scanResult) return;
    if (expandedCategories.size === scanResult.categories.length) {
      setExpandedCategories(new Set());
    } else {
      setExpandedCategories(new Set(scanResult.categories.map((c) => c.category_id)));
    }
  };

  const allScannedItemIds = useMemo(() => {
    if (!scanResult) return [] as string[];
    return scanResult.categories.flatMap((c) => c.items.map((it) => it.id));
  }, [scanResult]);

  const handleToggleSelectAllScanned = () => {
    if (selectedItemIds.size === allScannedItemIds.length) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(allScannedItemIds));
    }
  };

  const filteredCategories = useMemo(() => {
    if (!scanResult) return [];
    const q = resultSearch.trim().toLowerCase();
    if (!q) return scanResult.categories;

    return scanResult.categories
      .map((cat) => {
        const catMatches =
          cat.name.toLowerCase().includes(q) || cat.description.toLowerCase().includes(q);
        const matchingItems = catMatches
          ? cat.items
          : cat.items.filter(
              (it) => it.name.toLowerCase().includes(q) || it.path.toLowerCase().includes(q)
            );
        return { ...cat, items: matchingItems };
      })
      .filter((cat) => cat.items.length > 0);
  }, [scanResult, resultSearch]);

  const handleCopySelectedPaths = () => {
    const paths = selectedJunkItems.map((it) => it.path).filter(Boolean);
    if (paths.length === 0) return;
    navigator.clipboard.writeText(paths.join('\n'));
    obsidianToast.success(
      `Copied ${paths.length} selected path${paths.length === 1 ? '' : 's'} to clipboard`
    );
  };

  const handleCopySinglePath = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(path);
    obsidianToast.success('Path copied to clipboard', { description: path });
  };

  const handleLocateItem = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke('locate_in_explorer', { path });
    } catch {
      try {
        await invoke('open_in_explorer', { path });
      } catch {
        obsidianToast.error('Could not open path in File Explorer');
      }
    }
  };

  const handleConfirmClean = async () => {
    setShowConfirmModal(false);
    setIsCleaning(true);
    setCleanProgress({
      cleaned_files: 0,
      freed_bytes: 0,
      total_target_bytes: selectedBytes,
      current_path: 'Initializing safe deletion engine...',
    });

    try {
      const selectedCatIds = (scanResult?.categories || [])
        .filter((cat) => cat.items.some((it) => selectedItemIds.has(it.id)))
        .map((cat) => cat.category_id);

      const request: CleanRequest = {
        selected_category_ids: selectedCatIds,
        selected_item_ids: Array.from(selectedItemIds),
      };

      const report = await invoke<CleanReport>('start_clean', { request });
      setCleanReport(report);
      setShowReportModal(true);
      setScanResult(null);
      setSelectedItemIds(new Set());
      obsidianToast.success(
        `Freed ${formatBytes(report.freed_bytes)} across ${report.removed_files.toLocaleString()} files`
      );
      if (onCleanSuccess) onCleanSuccess();
    } catch (err) {
      console.error('Cleaning failed:', err);
      obsidianToast.error('Cleanup failed', { description: String(err) });
    } finally {
      setIsCleaning(false);
    }
  };

  const activePresetId = useMemo(() => {
    const sortedSel = [...selectedRuleIds].sort().join(',');
    const found = dynamicPresets.find((p) => [...p.ruleIds].sort().join(',') === sortedSel);
    return found?.id || null;
  }, [selectedRuleIds, dynamicPresets]);

  const cleanPct = useMemo(() => {
    if (!cleanProgress || cleanProgress.total_target_bytes <= 0) return 0;
    return Math.min(
      100,
      Math.round((cleanProgress.freed_bytes / cleanProgress.total_target_bytes) * 100)
    );
  }, [cleanProgress]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <ConfirmationModal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={handleConfirmClean}
        totalBytes={selectedBytes}
        totalFiles={selectedFiles}
        categoryNames={selectedCategories}
        selectedItems={selectedJunkItems}
      />

      <ReportModal
        isOpen={showReportModal}
        report={cleanReport}
        onClose={() => setShowReportModal(false)}
        onScanAgain={handleStartScan}
      />

      <div className="flex-1 obs-scroll h-full">
        <div className="p-6 space-y-5 max-w-7xl mx-auto">
          {/* Scanning Progress Card */}
          {isScanning && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="obs-card p-5 space-y-4 ring-1 ring-[var(--obs-accent-border)]"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-[var(--obs-accent-soft)] text-[var(--obs-accent)] flex items-center justify-center">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--obs-fg)]">
                      Scanning System Storage...
                    </h3>
                    <p className="text-xs text-[var(--obs-text-muted)]">
                      Traversing detected caches &amp; temp folders across parallel worker threads
                    </p>
                  </div>
                </div>
                <ObsidianButton variant="danger" size="sm" onClick={handleCancelScan}>
                  <XCircle className="h-3.5 w-3.5" />
                  Cancel Scan
                </ObsidianButton>
              </div>

              <div className="h-2 w-full bg-[var(--obs-muted)] rounded-full overflow-hidden relative">
                <div className="h-full w-1/3 bg-[var(--obs-accent)] rounded-full animate-indeterminate-bar" />
              </div>

              <div className="flex items-center justify-between gap-4 text-xs">
                <span className="font-mono text-[var(--obs-text-muted)] truncate">
                  {scanProgress?.current_path || 'Scanning...'}
                </span>
                <span className="font-semibold text-[var(--obs-accent)] font-mono tabular-nums shrink-0">
                  {formatBytes(scanProgress?.scanned_bytes || 0)} (
                  {(scanProgress?.scanned_files || 0).toLocaleString()} items)
                </span>
              </div>
            </motion.div>
          )}

          {/* Cleaning Progress Card */}
          {isCleaning && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="obs-card p-5 space-y-4 ring-1 ring-[var(--obs-danger)]/40"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-[var(--obs-danger-soft)] text-[var(--obs-danger)] flex items-center justify-center">
                    <Trash2 className="h-4 w-4 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--obs-fg)]">
                      Purging Selected Junk Files...
                    </h3>
                    <p className="text-xs text-[var(--obs-text-muted)]">
                      Safely reclaiming space while protecting personal data &amp; locked files
                    </p>
                  </div>
                </div>
                <ObsidianButton variant="control" size="sm" onClick={handleCancelClean}>
                  <XCircle className="h-3.5 w-3.5 text-[var(--obs-danger)]" />
                  Stop
                </ObsidianButton>
              </div>

              <ObsidianProgress value={cleanPct > 0 ? cleanPct : 15} tone="danger" />

              <div className="flex items-center justify-between gap-4 text-xs">
                <span className="font-mono text-[var(--obs-text-muted)] truncate">
                  {cleanProgress?.current_path || 'Purging...'}
                </span>
                <span className="font-semibold text-[var(--obs-danger)] font-mono tabular-nums shrink-0">
                  Freed {formatBytes(cleanProgress?.freed_bytes || 0)} (
                  {(cleanProgress?.cleaned_files || 0).toLocaleString()} files)
                </span>
              </div>
            </motion.div>
          )}

          {/* Phase A: Dynamic System-Detected Target Selection */}
          {!scanResult && !isScanning && !isCleaning && (
            <div className="space-y-5">
              {/* Auto-Detection Banner */}
              <div className="obs-card px-4 py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs text-[var(--obs-text-muted)]">
                  <Radar className="h-3.5 w-3.5 text-[var(--obs-accent)] shrink-0" />
                  <span>
                    Auto-detected{' '}
                    <strong className="text-[var(--obs-fg)] font-semibold">
                      {detectedRules.length}
                    </strong>{' '}
                    installed target{detectedRules.length === 1 ? '' : 's'} (browsers, AI agents,
                    IDEs &amp; system caches) — software you don&apos;t have is hidden.
                  </span>
                </div>
                {onRefreshRules && (
                  <ObsidianButton
                    variant="ghost"
                    size="xs"
                    onClick={handleRedetectTargets}
                    disabled={isRedetecting}
                  >
                    <RefreshCw className={cn('h-3 w-3', isRedetecting && 'animate-spin')} />
                    Re-detect
                  </ObsidianButton>
                )}
              </div>

              {/* Dynamic Presets & Scan Action Bar */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-medium text-[var(--obs-text-muted)] mr-1">
                    Presets:
                  </span>
                  {dynamicPresets.map((preset) => {
                    const active = activePresetId === preset.id;
                    return (
                      <ObsidianButton
                        key={preset.id}
                        size="xs"
                        variant={active ? 'control' : 'ghost'}
                        onClick={() => setSelectedRuleIds(preset.ruleIds)}
                        className={cn(
                          active && 'ring-1 ring-[var(--obs-accent-border)] text-[var(--obs-accent)]'
                        )}
                      >
                        {preset.label}
                      </ObsidianButton>
                    );
                  })}
                  <ObsidianButton
                    size="xs"
                    variant="ghost"
                    onClick={toggleSelectAllRules}
                    disabled={detectedRules.length === 0}
                  >
                    {selectedRuleIds.length === detectedRules.length && detectedRules.length > 0
                      ? 'Clear All'
                      : 'Select All'}
                  </ObsidianButton>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  <ObsidianBadge tone="neutral" className="font-mono py-1.5 px-2.5 text-[11px]">
                    {selectedRuleIds.length} / {detectedRules.length} selected
                  </ObsidianBadge>
                  <ObsidianButton
                    variant="accent"
                    size="md"
                    onClick={handleStartScan}
                    disabled={selectedRuleIds.length === 0}
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Scan Selected Targets
                  </ObsidianButton>
                </div>
              </div>

              {/* Dynamic Rules Selection Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {detectedRules.map((rule) => {
                  const isChecked = selectedRuleIds.includes(rule.id);
                  return (
                    <div
                      key={rule.id}
                      onClick={() => toggleRule(rule.id)}
                      className={cn(
                        'obs-card p-4 flex items-start gap-3 cursor-pointer transition-all select-none',
                        isChecked
                          ? 'ring-1 ring-[var(--obs-accent-border)]'
                          : 'opacity-65 hover:opacity-100'
                      )}
                    >
                      <ObsidianCheckbox
                        checked={isChecked}
                        onChange={() => toggleRule(rule.id)}
                        stopPropagation
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {getRuleIcon(rule.icon_key)}
                            <h4 className="text-xs font-semibold text-[var(--obs-fg)] truncate">
                              {rule.name}
                            </h4>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {rule.profile_count > 1 && (
                              <ObsidianBadge tone="accent" className="font-mono text-[9px]">
                                {rule.profile_count}
                              </ObsidianBadge>
                            )}
                            <ObsidianBadge tone="neutral" className="text-[9px]">
                              {rule.group}
                            </ObsidianBadge>
                          </div>
                        </div>
                        <p
                          className="text-[11px] text-[var(--obs-text-muted)] line-clamp-2 leading-snug"
                          title={rule.description}
                        >
                          {rule.description}
                        </p>
                        {rule.safe_note && (
                          <p className="text-[10px] text-[var(--obs-success)] flex items-center gap-1 truncate">
                            <Lock className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate" title={rule.safe_note}>
                              {rule.safe_note}
                            </span>
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Safety Guarantee Strip */}
              <div className="obs-card p-4 flex items-start gap-3 text-xs">
                <div className="h-8 w-8 rounded-lg bg-[var(--obs-accent-soft)] border border-[var(--obs-accent-border)] text-[var(--obs-accent)] flex items-center justify-center shrink-0">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-semibold text-[var(--obs-fg)]">
                    Zero-Danger Safe Clearing &amp; Chrome Data Protection
                  </p>
                  <p className="text-[11px] text-[var(--obs-text-muted)] mt-0.5 leading-relaxed">
                    Ferrowipe enforces a hard Rust safety guard: browser passwords, cookies, logins,
                    bookmarks, history, extensions, open tabs, AI agent auth/skills, IDE settings,
                    Android SDKs/keystores, and personal documents are strictly protected and never
                    deleted.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Phase B: Interactive Scan Results Preview */}
          {scanResult && !isScanning && !isCleaning && (
            <div className="space-y-4">
              {/* Summary Action Card */}
              <div className="obs-card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ring-1 ring-[var(--obs-accent-border)]">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--obs-text-muted)]">
                      Selected Reclaimable Space
                    </span>
                    <ObsidianBadge tone="neutral" className="font-mono">
                      {formatDuration(scanResult.scan_duration_ms)}
                    </ObsidianBadge>
                  </div>
                  <div className="flex items-baseline gap-2.5 flex-wrap">
                    <span className="text-3xl font-bold text-[var(--obs-accent)] tracking-tight tabular-nums">
                      {formatBytes(selectedBytes)}
                    </span>
                    <span className="text-xs text-[var(--obs-text-muted)] tabular-nums">
                      {selectedFiles.toLocaleString()} file{selectedFiles === 1 ? '' : 's'} across{' '}
                      {selectedCategories.length} categor
                      {selectedCategories.length === 1 ? 'y' : 'ies'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <ObsidianButton
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setScanResult(null);
                      setSelectedItemIds(new Set());
                    }}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Edit Targets
                  </ObsidianButton>
                  <ObsidianButton variant="control" size="sm" onClick={handleStartScan}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    Rescan
                  </ObsidianButton>
                  <ObsidianButton
                    variant="control"
                    size="sm"
                    onClick={handleCopySelectedPaths}
                    disabled={selectedJunkItems.length === 0}
                    title="Copy all selected deleting paths to clipboard"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy Paths ({selectedJunkItems.length})
                  </ObsidianButton>
                  <ObsidianButton
                    variant="danger"
                    size="sm"
                    onClick={() => setShowConfirmModal(true)}
                    disabled={selectedItemIds.size === 0}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clean Selected
                  </ObsidianButton>
                </div>
              </div>

              {/* Zero Junk Found */}
              {scanResult.categories.length === 0 ? (
                <div className="obs-card p-12 text-center space-y-2.5">
                  <div className="h-11 w-11 rounded-xl bg-[var(--obs-accent-soft)] text-[var(--obs-accent)] mx-auto flex items-center justify-center">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <h3 className="text-sm font-semibold text-[var(--obs-fg)]">
                    Your System is Clean!
                  </h3>
                  <p className="text-xs text-[var(--obs-text-muted)] max-w-md mx-auto">
                    No reclaimable junk files were detected in the selected target categories.
                  </p>
                  <div className="pt-1">
                    <ObsidianButton
                      variant="control"
                      size="sm"
                      onClick={() => setScanResult(null)}
                    >
                      Back to Target Rules
                    </ObsidianButton>
                  </div>
                </div>
              ) : (
                <>
                  {/* Filter & Convenience Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="relative flex-1 min-w-[220px] max-w-sm">
                      <Search className="h-3.5 w-3.5 text-[var(--obs-text-subtle)] absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        value={resultSearch}
                        onChange={(e) => setResultSearch(e.target.value)}
                        placeholder="Filter categories, files, or paths..."
                        className="obs-control h-8 w-full pl-8 pr-8 rounded-[9px] text-xs text-[var(--obs-fg)] placeholder:text-[var(--obs-text-subtle)] outline-none focus:ring-1 focus:ring-[var(--obs-accent)]"
                      />
                      {resultSearch && (
                        <button
                          type="button"
                          onClick={() => setResultSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--obs-text-subtle)] hover:text-[var(--obs-fg)]"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <ObsidianButton variant="control" size="sm" onClick={handleToggleExpandAll}>
                        <ChevronsUpDown className="h-3.5 w-3.5" />
                        {expandedCategories.size === scanResult.categories.length
                          ? 'Collapse All'
                          : 'Expand All'}
                      </ObsidianButton>
                      <ObsidianButton
                        variant="control"
                        size="sm"
                        onClick={handleToggleSelectAllScanned}
                      >
                        {selectedItemIds.size === allScannedItemIds.length
                          ? 'Deselect All'
                          : 'Select All'}
                      </ObsidianButton>
                    </div>
                  </div>

                  {/* Category Accordion Cards */}
                  <div className="space-y-2.5">
                    {filteredCategories.map((cat) => {
                      const isExpanded = expandedCategories.has(cat.category_id);
                      const allItemsSelected =
                        cat.items.length > 0 &&
                        cat.items.every((it) => selectedItemIds.has(it.id));
                      const someItemsSelected =
                        cat.items.some((it) => selectedItemIds.has(it.id)) && !allItemsSelected;

                      const checkedState: boolean | 'indeterminate' = allItemsSelected
                        ? true
                        : someItemsSelected
                        ? 'indeterminate'
                        : false;

                      return (
                        <div key={cat.category_id} className="obs-card overflow-hidden">
                          <div
                            onClick={() => toggleCategoryExpand(cat.category_id)}
                            className="px-4 py-3.5 flex items-center justify-between hover:bg-[var(--obs-hover)] transition-colors cursor-pointer select-none"
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <ObsidianCheckbox
                                checked={checkedState}
                                onChange={() => toggleCategorySelection(cat)}
                                stopPropagation
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-[var(--obs-fg)] truncate">
                                    {cat.name}
                                  </span>
                                  <ObsidianBadge tone="neutral" className="font-mono">
                                    {cat.total_files.toLocaleString()} files
                                  </ObsidianBadge>
                                </div>
                                <p className="text-[11px] text-[var(--obs-text-muted)] truncate mt-0.5">
                                  {cat.description}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 pl-4 shrink-0">
                              <span className="text-xs font-bold font-mono text-[var(--obs-accent)] tabular-nums">
                                {formatBytes(cat.total_bytes)}
                              </span>
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-[var(--obs-text-muted)]" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-[var(--obs-text-muted)]" />
                              )}
                            </div>
                          </div>

                          <AnimatePresence initial={false}>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ duration: 0.18 }}
                                className="overflow-hidden border-t border-[var(--obs-border)] bg-[var(--obs-bg)]/50"
                              >
                                <div className="divide-y divide-[var(--obs-border)]/70 max-h-64 overflow-y-auto obs-scroll">
                                  {cat.items.map((item) => {
                                    const isItemSelected = selectedItemIds.has(item.id);
                                    return (
                                      <div
                                        key={item.id}
                                        onClick={() => toggleItemSelection(item.id)}
                                        className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-[var(--obs-hover)] cursor-pointer select-none group"
                                      >
                                        <div className="flex items-center gap-3 min-w-0 flex-1 pl-4">
                                          <ObsidianCheckbox
                                            checked={isItemSelected}
                                            onChange={() => toggleItemSelection(item.id)}
                                            stopPropagation
                                          />
                                          <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                              <span className="text-[var(--obs-fg)] font-mono text-[11px] font-medium truncate block">
                                                {item.name}
                                              </span>
                                              {item.file_count > 1 && (
                                                <span className="text-[10px] font-mono text-[var(--obs-text-subtle)] shrink-0">
                                                  ({item.file_count.toLocaleString()} files)
                                                </span>
                                              )}
                                            </div>
                                            <span className="text-[10px] text-[var(--obs-text-subtle)] font-mono truncate block">
                                              {item.path}
                                            </span>
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 shrink-0">
                                          <span className="font-mono text-[11px] font-medium text-[var(--obs-fg)] tabular-nums mr-1">
                                            {formatBytes(item.size_bytes)}
                                          </span>
                                          <ObsidianButton
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                            onClick={(e) => handleCopySinglePath(item.path, e)}
                                            title="Copy path"
                                          >
                                            <Copy className="h-3 w-3" />
                                          </ObsidianButton>
                                          {cat.category_id !== 'recycle_bin' && (
                                            <ObsidianButton
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                              onClick={(e) => handleLocateItem(item.path, e)}
                                              title="Locate in Windows Explorer"
                                            >
                                              <MapPin className="h-3 w-3" />
                                            </ObsidianButton>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
