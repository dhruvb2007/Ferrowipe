import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { toast } from 'sonner';
import {
  CategorySummary,
  CleanerQuickTrigger,
  CleanerStatusSummary,
  CleanProgress,
  CleanReport,
  CleanRequest,
  ScanProgress,
  ScanResult,
} from '@/types';
import { formatBytes, formatDuration } from '@/utils';
import { cn } from '@/lib/utils';
import { ConfirmationModal } from './ConfirmationModal';
import { ReportModal } from './ReportModal';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface JunkCleanerProps {
  quickTrigger?: CleanerQuickTrigger | null;
  onCleanSuccess?: () => void;
  onStatusChange?: (status: CleanerStatusSummary) => void;
}

interface RuleDef {
  id: string;
  name: string;
  desc: string;
  group: 'Temp' | 'Browser' | 'System';
  icon: React.ReactNode;
}

const ALL_RULES: RuleDef[] = [
  {
    id: 'user_temp',
    name: 'User Temp Files',
    desc: 'Temporary user cache (%TEMP%)',
    group: 'Temp',
    icon: <FolderArchive className="h-4 w-4 text-emerald-500" />,
  },
  {
    id: 'windows_temp',
    name: 'Windows Temp',
    desc: 'System temp folder (C:\\Windows\\Temp)',
    group: 'Temp',
    icon: <FolderArchive className="h-4 w-4 text-cyan-500" />,
  },
  {
    id: 'recycle_bin',
    name: 'Recycle Bin',
    desc: 'Per-drive Windows Recycle Bins',
    group: 'Temp',
    icon: <Trash2 className="h-4 w-4 text-rose-500" />,
  },
  {
    id: 'browser_chrome',
    name: 'Google Chrome Cache',
    desc: 'Chrome web cache & code cache',
    group: 'Browser',
    icon: <Globe className="h-4 w-4 text-amber-500" />,
  },
  {
    id: 'browser_edge',
    name: 'Microsoft Edge Cache',
    desc: 'Edge web cache & GPU cache',
    group: 'Browser',
    icon: <Globe className="h-4 w-4 text-blue-500" />,
  },
  {
    id: 'browser_firefox',
    name: 'Firefox Cache',
    desc: 'Mozilla Firefox profile cache2',
    group: 'Browser',
    icon: <Globe className="h-4 w-4 text-orange-500" />,
  },
  {
    id: 'browser_brave',
    name: 'Brave Browser Cache',
    desc: 'Brave web & renderer cache',
    group: 'Browser',
    icon: <Globe className="h-4 w-4 text-amber-600" />,
  },
  {
    id: 'windows_update',
    name: 'Windows Update Cache',
    desc: 'SoftwareDistribution\\Download',
    group: 'System',
    icon: <RefreshCw className="h-4 w-4 text-purple-500" />,
  },
  {
    id: 'thumb_cache',
    name: 'Thumbnails & Icon Cache',
    desc: 'Explorer thumbnail & icon DBs',
    group: 'System',
    icon: <Image className="h-4 w-4 text-teal-500" />,
  },
  {
    id: 'crash_dumps',
    name: 'Crash Dumps & WER',
    desc: 'Memory minidumps & error reports',
    group: 'System',
    icon: <Flame className="h-4 w-4 text-rose-500" />,
  },
  {
    id: 'prefetch_logs',
    name: 'Prefetch & Old Logs',
    desc: 'C:\\Windows\\Prefetch & CBS logs',
    group: 'System',
    icon: <FileCode className="h-4 w-4 text-indigo-500" />,
  },
];

const RULE_PRESETS: { id: string; label: string; ruleIds: string[] }[] = [
  { id: 'all', label: 'All Safe Junk', ruleIds: ALL_RULES.map((r) => r.id) },
  {
    id: 'quick',
    label: 'Quick Clean',
    ruleIds: ['user_temp', 'windows_temp', 'recycle_bin', 'thumb_cache'],
  },
  {
    id: 'browsers',
    label: 'Browsers Only',
    ruleIds: ['browser_chrome', 'browser_edge', 'browser_firefox', 'browser_brave'],
  },
  {
    id: 'system',
    label: 'System & Logs',
    ruleIds: ['windows_temp', 'windows_update', 'crash_dumps', 'prefetch_logs'],
  },
];

export const JunkCleaner: React.FC<JunkCleanerProps> = ({
  quickTrigger,
  onCleanSuccess,
  onStatusChange,
}) => {
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>(ALL_RULES.map((r) => r.id));
  const [isScanning, setIsScanning] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [cleanProgress, setCleanProgress] = useState<CleanProgress | null>(null);

  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [resultSearch, setResultSearch] = useState('');

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [cleanReport, setCleanReport] = useState<CleanReport | null>(null);

  const lastTriggerNonceRef = useRef<number | null>(null);

  // Tauri Event Listeners
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
        // Non-Tauri browser preview
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
      toast.warning('Select at least one target category to scan');
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
      result.categories.slice(0, 2).forEach((c) => initExpanded.add(c.category_id));
      setExpandedCategories(initExpanded);

      if (result.total_reclaimable_bytes > 0) {
        toast.success(
          `Found ${formatBytes(result.total_reclaimable_bytes)} across ${result.total_reclaimable_files.toLocaleString()} items in ${formatDuration(result.scan_duration_ms)}`
        );
      } else {
        toast.info('System is already clean for the selected targets');
      }
    } catch (err) {
      console.error('Scan failed:', err);
      toast.error(`Scan failed: ${String(err)}`);
    } finally {
      setIsScanning(false);
    }
  }, []);

  // Handle quick triggers from Dashboard or Header
  useEffect(() => {
    if (!quickTrigger) return;
    if (lastTriggerNonceRef.current === quickTrigger.nonce) return;
    lastTriggerNonceRef.current = quickTrigger.nonce;

    const targetRules =
      quickTrigger.presetRuleIds && quickTrigger.presetRuleIds.length > 0
        ? quickTrigger.presetRuleIds
        : ALL_RULES.map((r) => r.id);

    setSelectedRuleIds(targetRules);
    if (quickTrigger.autoScan && !isScanning && !isCleaning) {
      runScanWithRules(targetRules);
    }
  }, [quickTrigger, isScanning, isCleaning, runScanWithRules]);

  // Calculate live selected reclaimable space
  const { selectedBytes, selectedFiles, selectedCategories } = useMemo(() => {
    if (!scanResult) {
      return { selectedBytes: 0, selectedFiles: 0, selectedCategories: [] as string[] };
    }
    let bytes = 0;
    let files = 0;
    const catNamesSet = new Set<string>();

    scanResult.categories.forEach((cat) => {
      let catHasSelected = false;
      cat.items.forEach((item) => {
        if (selectedItemIds.has(item.id)) {
          bytes += item.size_bytes;
          files += item.file_count;
          catHasSelected = true;
        }
      });
      if (catHasSelected) {
        catNamesSet.add(cat.name);
      }
    });

    return {
      selectedBytes: bytes,
      selectedFiles: files,
      selectedCategories: Array.from(catNamesSet),
    };
  }, [scanResult, selectedItemIds]);

  // Report live status back to App / Sidebar
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
    if (selectedRuleIds.length === ALL_RULES.length) {
      setSelectedRuleIds([]);
    } else {
      setSelectedRuleIds(ALL_RULES.map((r) => r.id));
    }
  };

  const handleStartScan = () => runScanWithRules(selectedRuleIds);

  const handleCancelScan = async () => {
    try {
      await invoke('cancel_scan');
      toast.info('Scan cancellation requested');
    } catch (err) {
      console.error('Failed to cancel scan:', err);
    }
  };

  const handleCancelClean = async () => {
    try {
      await invoke('cancel_clean');
      toast.info('Cleanup cancellation requested');
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
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItemIds(newSelected);
  };

  const toggleCategoryExpand = (catId: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(catId)) {
      newExpanded.delete(catId);
    } else {
      newExpanded.add(catId);
    }
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

  const handleLocateItem = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke('locate_in_explorer', { path });
    } catch {
      try {
        await invoke('open_in_explorer', { path });
      } catch {
        toast.error('Could not open path in File Explorer');
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
      toast.success(`Freed ${formatBytes(report.freed_bytes)} across ${report.removed_files.toLocaleString()} files`);
      if (onCleanSuccess) onCleanSuccess();
    } catch (err) {
      console.error('Cleaning failed:', err);
      toast.error(`Cleanup failed: ${String(err)}`);
    } finally {
      setIsCleaning(false);
    }
  };

  const activePresetId = useMemo(() => {
    const sortedSel = [...selectedRuleIds].sort().join(',');
    const found = RULE_PRESETS.find((p) => [...p.ruleIds].sort().join(',') === sortedSel);
    return found?.id || null;
  }, [selectedRuleIds]);

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
      />

      <ReportModal
        isOpen={showReportModal}
        report={cleanReport}
        onClose={() => setShowReportModal(false)}
        onScanAgain={handleStartScan}
      />

      <ScrollArea className="flex-1 h-full">
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
          {/* Scanning Progress Card */}
          {isScanning && (
            <Card className="border-primary/40 shadow-md">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        Scanning System Storage...
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Traversing selected junk targets across parallel worker threads
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleCancelScan}
                    className="h-8 text-xs gap-1.5"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Cancel Scan
                  </Button>
                </div>

                {/* Indeterminate animated bar */}
                <div className="h-2 w-full bg-secondary rounded-full overflow-hidden relative">
                  <div className="h-full w-1/3 bg-primary rounded-full animate-indeterminate-bar" />
                </div>

                <div className="flex items-center justify-between gap-4 text-xs">
                  <span className="font-mono text-muted-foreground truncate">
                    {scanProgress?.current_path || 'Scanning...'}
                  </span>
                  <span className="font-semibold text-primary font-mono tabular-nums shrink-0">
                    {formatBytes(scanProgress?.scanned_bytes || 0)} (
                    {(scanProgress?.scanned_files || 0).toLocaleString()} items)
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Cleaning Progress Card */}
          {isCleaning && (
            <Card className="border-destructive/40 shadow-md">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-destructive/15 text-destructive flex items-center justify-center">
                      <Trash2 className="h-4 w-4 animate-pulse" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        Purging Selected Junk Files...
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        Safely reclaiming space while skipping locked system files
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelClean}
                    className="h-8 text-xs gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                  >
                    <XCircle className="h-3.5 w-3.5" />
                    Stop
                  </Button>
                </div>

                <Progress
                  value={cleanPct > 0 ? cleanPct : 15}
                  className="h-2"
                  indicatorClassName="bg-destructive"
                />

                <div className="flex items-center justify-between gap-4 text-xs">
                  <span className="font-mono text-muted-foreground truncate">
                    {cleanProgress?.current_path || 'Purging...'}
                  </span>
                  <span className="font-semibold text-destructive font-mono tabular-nums shrink-0">
                    Freed {formatBytes(cleanProgress?.freed_bytes || 0)} (
                    {(cleanProgress?.cleaned_files || 0).toLocaleString()} files)
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Phase A: Target Selection */}
          {!scanResult && !isScanning && !isCleaning && (
            <div className="space-y-5">
              {/* Presets & Scan Action Bar */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs font-medium text-muted-foreground mr-1">Presets:</span>
                  {RULE_PRESETS.map((preset) => (
                    <Button
                      key={preset.id}
                      size="sm"
                      variant={activePresetId === preset.id ? 'secondary' : 'outline'}
                      onClick={() => setSelectedRuleIds(preset.ruleIds)}
                      className={cn(
                        'h-7 text-xs px-2.5',
                        activePresetId === preset.id &&
                          'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
                      )}
                    >
                      {preset.label}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={toggleSelectAllRules}
                    className="h-7 text-xs px-2 text-muted-foreground"
                  >
                    {selectedRuleIds.length === ALL_RULES.length ? 'Clear All' : 'Select All'}
                  </Button>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <Badge variant="outline" className="font-mono text-xs h-7 px-2.5">
                    {selectedRuleIds.length} / {ALL_RULES.length} selected
                  </Badge>
                  <Button
                    onClick={handleStartScan}
                    disabled={selectedRuleIds.length === 0}
                    className="h-9 gap-2 text-xs font-semibold shadow-sm"
                  >
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Scan Selected Targets
                  </Button>
                </div>
              </div>

              {/* Rules Selection Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {ALL_RULES.map((rule) => {
                  const isChecked = selectedRuleIds.includes(rule.id);
                  return (
                    <Card
                      key={rule.id}
                      onClick={() => toggleRule(rule.id)}
                      className={cn(
                        'cursor-pointer transition-all select-none',
                        isChecked
                          ? 'border-primary/45 bg-card shadow-sm'
                          : 'bg-card/50 hover:bg-card hover:border-border opacity-70 hover:opacity-100'
                      )}
                    >
                      <CardContent className="p-4 flex items-start gap-3">
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={() => toggleRule(rule.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {rule.icon}
                              <h4 className="text-xs font-semibold text-foreground truncate">
                                {rule.name}
                              </h4>
                            </div>
                            <Badge
                              variant="secondary"
                              className="text-[9px] px-1.5 py-0 h-4 font-normal shrink-0"
                            >
                              {rule.group}
                            </Badge>
                          </div>
                          <p className="text-[11px] text-muted-foreground truncate">{rule.desc}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Safety Guarantee Alert */}
              <Alert className="bg-muted/25">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <AlertTitle className="text-xs font-semibold">Zero-Danger Rule Engine</AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground">
                  Ferrowipe scans only verified Windows temporary folders, browser caches, and
                  reclaimable logs. Personal documents, desktop files, and core OS binaries are
                  never touched.
                </AlertDescription>
              </Alert>
            </div>
          )}

          {/* Phase B: Interactive Scan Results Preview */}
          {scanResult && !isScanning && !isCleaning && (
            <div className="space-y-4">
              {/* Summary & Action Card */}
              <Card className="border-primary/30 bg-card shadow-sm">
                <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Selected Reclaimable Space
                      </span>
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        Scanned in {formatDuration(scanResult.scan_duration_ms)}
                      </Badge>
                    </div>
                    <div className="flex items-baseline gap-2.5">
                      <span className="text-3xl font-bold text-primary tracking-tight tabular-nums">
                        {formatBytes(selectedBytes)}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {selectedFiles.toLocaleString()} file{selectedFiles === 1 ? '' : 's'} across{' '}
                        {selectedCategories.length} categor
                        {selectedCategories.length === 1 ? 'y' : 'ies'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setScanResult(null);
                        setSelectedItemIds(new Set());
                      }}
                      className="h-9 text-xs gap-1.5"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                      Edit Targets
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleStartScan}
                      className="h-9 text-xs gap-1.5"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Rescan
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setShowConfirmModal(true)}
                      disabled={selectedItemIds.size === 0}
                      className="h-9 text-xs gap-1.5 font-semibold"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Clean Selected
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Zero Junk State */}
              {scanResult.categories.length === 0 ? (
                <Card>
                  <CardContent className="p-12 text-center space-y-2">
                    <Sparkles className="h-10 w-10 text-primary mx-auto" />
                    <h3 className="text-sm font-semibold text-foreground">Your System is Clean!</h3>
                    <p className="text-xs text-muted-foreground max-w-md mx-auto">
                      No reclaimable junk files were found in the selected categories.
                    </p>
                    <div className="pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setScanResult(null)}
                        className="text-xs"
                      >
                        Back to Target Rules
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <>
                  {/* Filter & Convenience Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="relative flex-1 min-w-[220px] max-w-sm">
                      <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <Input
                        value={resultSearch}
                        onChange={(e) => setResultSearch(e.target.value)}
                        placeholder="Filter categories, files, or paths..."
                        className="h-8 pl-8 pr-8 text-xs"
                      />
                      {resultSearch && (
                        <button
                          onClick={() => setResultSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleToggleExpandAll}
                        className="h-8 text-xs gap-1.5"
                      >
                        <ChevronsUpDown className="h-3.5 w-3.5" />
                        {expandedCategories.size === scanResult.categories.length
                          ? 'Collapse All'
                          : 'Expand All'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleToggleSelectAllScanned}
                        className="h-8 text-xs"
                      >
                        {selectedItemIds.size === allScannedItemIds.length
                          ? 'Deselect All'
                          : 'Select All'}
                      </Button>
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
                        <Card key={cat.category_id} className="overflow-hidden">
                          {/* Category Header */}
                          <div
                            onClick={() => toggleCategoryExpand(cat.category_id)}
                            className="px-4 py-3.5 flex items-center justify-between hover:bg-accent/40 transition-colors cursor-pointer select-none"
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <Checkbox
                                checked={checkedState}
                                onCheckedChange={() => toggleCategorySelection(cat)}
                                onClick={(e) => e.stopPropagation()}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-semibold text-foreground truncate">
                                    {cat.name}
                                  </span>
                                  <Badge
                                    variant="secondary"
                                    className="text-[10px] font-mono h-4 px-1.5"
                                  >
                                    {cat.total_files.toLocaleString()} items
                                  </Badge>
                                </div>
                                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                  {cat.description}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 pl-4 shrink-0">
                              <span className="text-xs font-bold font-mono text-primary tabular-nums">
                                {formatBytes(cat.total_bytes)}
                              </span>
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </div>
                          </div>

                          {/* Sub-Items List */}
                          {isExpanded && (
                            <div className="border-t bg-muted/20 divide-y divide-border/60 max-h-60 overflow-y-auto">
                              {cat.items.map((item) => {
                                const isItemSelected = selectedItemIds.has(item.id);
                                return (
                                  <div
                                    key={item.id}
                                    onClick={() => toggleItemSelection(item.id)}
                                    className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-accent/35 cursor-pointer select-none group"
                                  >
                                    <div className="flex items-center gap-3 min-w-0 flex-1 pl-4">
                                      <Checkbox
                                        checked={isItemSelected}
                                        onCheckedChange={() => toggleItemSelection(item.id)}
                                        onClick={(e) => e.stopPropagation()}
                                      />
                                      <div className="min-w-0 flex-1">
                                        <span className="text-foreground font-mono text-[11px] truncate block">
                                          {item.name}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground font-mono truncate block">
                                          {item.path}
                                        </span>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                      <span className="font-mono text-[11px] font-medium text-foreground tabular-nums">
                                        {formatBytes(item.size_bytes)}
                                      </span>
                                      {cat.category_id !== 'recycle_bin' && (
                                        <Tooltip>
                                          <TooltipTrigger asChild>
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
                                              onClick={(e) => handleLocateItem(item.path, e)}
                                            >
                                              <MapPin className="h-3 w-3" />
                                            </Button>
                                          </TooltipTrigger>
                                          <TooltipContent>Locate in File Explorer</TooltipContent>
                                        </Tooltip>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </Card>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
