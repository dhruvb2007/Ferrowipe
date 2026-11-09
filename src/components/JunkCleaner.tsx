import React, { useState, useEffect } from 'react';
import {
  FolderArchive,
  Trash2,
  Globe,
  RefreshCw,
  Image,
  Flame,
  FileCode,
  CheckSquare,
  Square,
  ChevronDown,
  ChevronRight,
  Play,
  XCircle,
  Sparkles,
  Info,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import {
  CategorySummary,
  CleanProgress,
  CleanReport,
  CleanRequest,
  ScanProgress,
  ScanResult,
} from '../types';
import { formatBytes } from '../utils';
import { ConfirmationModal } from './ConfirmationModal';
import { ReportModal } from './ReportModal';

interface JunkCleanerProps {
  onCleanSuccess?: () => void;
}

export const JunkCleaner: React.FC<JunkCleanerProps> = ({ onCleanSuccess }) => {
  // Available cleanup target rules
  const ALL_RULES = [
    {
      id: 'user_temp',
      name: 'User Temp Files',
      desc: 'Temporary user cache (%TEMP%)',
      icon: <FolderArchive className="w-4 h-4 text-emerald-400" />,
    },
    {
      id: 'windows_temp',
      name: 'Windows Temp',
      desc: 'System temp folder (C:\\Windows\\Temp)',
      icon: <FolderArchive className="w-4 h-4 text-cyan-400" />,
    },
    {
      id: 'recycle_bin',
      name: 'Recycle Bin',
      desc: 'Per-drive recycle bins',
      icon: <Trash2 className="w-4 h-4 text-red-400" />,
    },
    {
      id: 'browser_chrome',
      name: 'Google Chrome Cache',
      desc: 'Chrome web cache & code cache',
      icon: <Globe className="w-4 h-4 text-amber-400" />,
    },
    {
      id: 'browser_edge',
      name: 'Microsoft Edge Cache',
      desc: 'Edge web cache & GPU cache',
      icon: <Globe className="w-4 h-4 text-blue-400" />,
    },
    {
      id: 'browser_firefox',
      name: 'Firefox Cache',
      desc: 'Mozilla Firefox profile cache',
      icon: <Globe className="w-4 h-4 text-orange-400" />,
    },
    {
      id: 'browser_brave',
      name: 'Brave Browser Cache',
      desc: 'Brave web cache',
      icon: <Globe className="w-4 h-4 text-amber-500" />,
    },
    {
      id: 'windows_update',
      name: 'Windows Update Cache',
      desc: 'SoftwareDistribution\\Download',
      icon: <RefreshCw className="w-4 h-4 text-purple-400" />,
    },
    {
      id: 'thumb_cache',
      name: 'Thumbnails & Icon Cache',
      desc: 'Explorer thumbnail & icon DBs',
      icon: <Image className="w-4 h-4 text-teal-400" />,
    },
    {
      id: 'crash_dumps',
      name: 'Crash Dumps & WER',
      desc: 'Memory minidumps & error reports',
      icon: <Flame className="w-4 h-4 text-rose-400" />,
    },
    {
      id: 'prefetch_logs',
      name: 'Prefetch & Old Logs',
      desc: 'C:\\Windows\\Prefetch & CBS logs',
      icon: <FileCode className="w-4 h-4 text-indigo-400" />,
    },
  ];

  // State
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>(
    ALL_RULES.map((r) => r.id)
  );
  const [isScanning, setIsScanning] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [cleanProgress, setCleanProgress] = useState<CleanProgress | null>(null);

  // Scan results & selection state
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Modals
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [cleanReport, setCleanReport] = useState<CleanReport | null>(null);

  // Tauri Event Listeners
  useEffect(() => {
    let unlistenScan: UnlistenFn | undefined;
    let unlistenClean: UnlistenFn | undefined;

    const setupListeners = async () => {
      unlistenScan = await listen<ScanProgress>('scan:progress', (event) => {
        setScanProgress(event.payload);
      });

      unlistenClean = await listen<CleanProgress>('clean:progress', (event) => {
        setCleanProgress(event.payload);
      });
    };

    setupListeners();

    return () => {
      if (unlistenScan) unlistenScan();
      if (unlistenClean) unlistenClean();
    };
  }, []);

  // Toggle rule filter before scanning
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

  // Start Scan
  const handleStartScan = async () => {
    setIsScanning(true);
    setScanProgress({ scanned_files: 0, scanned_bytes: 0, current_path: 'Starting scan...' });
    setScanResult(null);

    try {
      const result = await invoke<ScanResult>('start_scan', {
        activeCategories: selectedRuleIds,
      });

      setScanResult(result);

      // By default select all scanned items
      const itemIds = new Set<string>();
      result.categories.forEach((cat) => {
        cat.items.forEach((item) => itemIds.add(item.id));
      });
      setSelectedItemIds(itemIds);

      // Auto-expand first 2 categories
      const initExpanded = new Set<string>();
      result.categories.slice(0, 2).forEach((c) => initExpanded.add(c.category_id));
      setExpandedCategories(initExpanded);
    } catch (err) {
      console.error('Scan failed:', err);
    } finally {
      setIsScanning(false);
    }
  };

  // Cancel Scan
  const handleCancelScan = async () => {
    try {
      await invoke('cancel_scan');
    } catch (err) {
      console.error('Failed to cancel scan:', err);
    }
  };

  // Category & Item selection handlers
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

  // Calculate live selected reclaimable space
  const calculateSelectedSpace = () => {
    if (!scanResult) return { bytes: 0, files: 0, categoryNames: [] as string[] };
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

    return { bytes, files, categoryNames: Array.from(catNamesSet) };
  };

  const { bytes: selectedBytes, files: selectedFiles, categoryNames: selectedCategories } =
    calculateSelectedSpace();

  // Trigger Confirmation Modal
  const handleCleanClick = () => {
    if (selectedItemIds.size === 0) return;
    setShowConfirmModal(true);
  };

  // Execute Clean
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
      if (onCleanSuccess) onCleanSuccess();
    } catch (err) {
      console.error('Cleaning failed:', err);
    } finally {
      setIsCleaning(false);
    }
  };

  // Cancel Clean
  const handleCancelClean = async () => {
    try {
      await invoke('cancel_clean');
    } catch (err) {
      console.error('Failed to cancel clean:', err);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Modals */}
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

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-8 space-y-6">
        {/* Scanning Overlay / Card */}
        {isScanning && (
          <div className="p-6 rounded-2xl bg-surface-900 border border-emerald-500/40 shadow-xl shadow-emerald-950/20 space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center animate-spin">
                  <RefreshCw className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Scanning System Storage...</h3>
                  <p className="text-xs text-slate-400">
                    Traversing directories with multithreaded worker threads
                  </p>
                </div>
              </div>
              <button
                onClick={handleCancelScan}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-400 hover:text-white bg-red-950/40 hover:bg-red-900/60 border border-red-800/60 rounded-xl transition-all"
              >
                <XCircle className="w-3.5 h-3.5" />
                Cancel Scan
              </button>
            </div>

            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full animate-pulse w-full" />
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-mono truncate max-w-[70%]">
                {scanProgress?.current_path || 'Scanning...'}
              </span>
              <span className="font-semibold text-emerald-400">
                {formatBytes(scanProgress?.scanned_bytes || 0)} (
                {(scanProgress?.scanned_files || 0).toLocaleString()} items)
              </span>
            </div>
          </div>
        )}

        {/* Cleaning Progress Overlay */}
        {isCleaning && (
          <div className="p-6 rounded-2xl bg-surface-900 border border-red-500/40 shadow-xl shadow-red-950/20 space-y-4 animate-in fade-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-red-500/20 text-red-400 flex items-center justify-center animate-bounce">
                  <Trash2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Purging Selected Junk Files...</h3>
                  <p className="text-xs text-slate-400">
                    Reclaiming disk space safely without touching system binaries
                  </p>
                </div>
              </div>
              <button
                onClick={handleCancelClean}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-400 hover:text-white bg-red-950/40 hover:bg-red-900/60 border border-red-800/60 rounded-xl transition-all"
              >
                <XCircle className="w-3.5 h-3.5" />
                Cancel Clean
              </button>
            </div>

            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-red-500 to-rose-500 rounded-full animate-pulse w-full" />
            </div>

            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-mono truncate max-w-[70%]">
                {cleanProgress?.current_path || 'Purging...'}
              </span>
              <span className="font-semibold text-red-400">
                Freed: {formatBytes(cleanProgress?.freed_bytes || 0)} (
                {(cleanProgress?.cleaned_files || 0).toLocaleString()} files)
              </span>
            </div>
          </div>
        )}

        {/* Phase A: Target Selection (Before Scan) */}
        {!scanResult && !isScanning && !isCleaning && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white tracking-tight">Rule-Based Junk Cleaner</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Select target caches and temporary storage locations to analyze.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleSelectAllRules}
                  className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {selectedRuleIds.length === ALL_RULES.length ? 'Deselect All' : 'Select All'}
                </button>
                <button
                  onClick={handleStartScan}
                  disabled={selectedRuleIds.length === 0}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-950/50 transition-all disabled:opacity-50"
                >
                  <Play className="w-4 h-4 fill-current" />
                  Scan Selected Targets
                </button>
              </div>
            </div>

            {/* Rules Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {ALL_RULES.map((rule) => {
                const isChecked = selectedRuleIds.includes(rule.id);
                return (
                  <div
                    key={rule.id}
                    onClick={() => toggleRule(rule.id)}
                    className={`p-4 rounded-xl border cursor-pointer transition-all flex items-start gap-3 select-none ${
                      isChecked
                        ? 'bg-slate-900/90 border-emerald-500/50 shadow-sm'
                        : 'bg-surface-900/50 border-slate-800/80 hover:border-slate-700 opacity-60'
                    }`}
                  >
                    <div className="mt-0.5">
                      {isChecked ? (
                        <CheckSquare className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-500" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {rule.icon}
                        <h4 className="text-xs font-bold text-white truncate">{rule.name}</h4>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 truncate">{rule.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Explanatory Help Card */}
            <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80 flex items-start gap-3 text-xs text-slate-400">
              <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <p>
                <strong>Zero Danger Cleaning:</strong> Ferrowipe scans only rule-verified junk
                directories. It never touches essential Windows system files, personal documents, or
                active application states.
              </p>
            </div>
          </div>
        )}

        {/* Phase B: Preview & Confirmation Screen (After Scan) */}
        {scanResult && !isScanning && !isCleaning && (
          <div className="space-y-6">
            {/* Action Bar Header */}
            <div className="p-5 rounded-2xl bg-surface-900 border border-slate-800 flex items-center justify-between shadow-lg">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Total Reclaimable Space
                </span>
                <div className="text-2xl font-black text-emerald-400 tracking-tight">
                  {formatBytes(selectedBytes)}
                  <span className="text-xs font-normal text-slate-400 ml-2">
                    ({selectedFiles.toLocaleString()} files selected)
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleStartScan}
                  className="px-4 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700/80 rounded-xl transition-all"
                >
                  Rescan
                </button>
                <button
                  onClick={handleCleanClick}
                  disabled={selectedItemIds.size === 0}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-red-950/50 transition-all disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  Clean Selected Files
                </button>
              </div>
            </div>

            {/* Zero Junk Found State */}
            {scanResult.categories.length === 0 && (
              <div className="p-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800 text-slate-400">
                <Sparkles className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-white">Your System is Clean!</h3>
                <p className="text-xs mt-1">No junk files were detected in the selected target categories.</p>
              </div>
            )}

            {/* Category Breakdown Accordions */}
            <div className="space-y-3">
              {scanResult.categories.map((cat) => {
                const isExpanded = expandedCategories.has(cat.category_id);
                const allItemsSelected = cat.items.every((it) => selectedItemIds.has(it.id));
                const someItemsSelected =
                  cat.items.some((it) => selectedItemIds.has(it.id)) && !allItemsSelected;

                return (
                  <div
                    key={cat.category_id}
                    className="border border-slate-800 rounded-xl overflow-hidden bg-surface-900/70"
                  >
                    {/* Category Header */}
                    <div className="p-4 flex items-center justify-between hover:bg-slate-800/40 transition-colors">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {/* Checkbox */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCategorySelection(cat);
                          }}
                          className="text-slate-400 hover:text-white"
                        >
                          {allItemsSelected ? (
                            <CheckSquare className="w-4 h-4 text-emerald-400" />
                          ) : someItemsSelected ? (
                            <div className="w-4 h-4 bg-emerald-500/30 border border-emerald-400 rounded-sm flex items-center justify-center">
                              <div className="w-2 h-0.5 bg-emerald-400" />
                            </div>
                          ) : (
                            <Square className="w-4 h-4 text-slate-500" />
                          )}
                        </button>

                        {/* Title & Info */}
                        <div
                          onClick={() => toggleCategoryExpand(cat.category_id)}
                          className="cursor-pointer flex-1 min-w-0"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-white truncate">
                              {cat.name}
                            </span>
                            <span className="text-[11px] text-slate-400 font-mono">
                              ({cat.total_files.toLocaleString()} items)
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400 truncate">{cat.description}</p>
                        </div>
                      </div>

                      {/* Right size badge & chevron */}
                      <div
                        onClick={() => toggleCategoryExpand(cat.category_id)}
                        className="flex items-center gap-3 cursor-pointer pl-4"
                      >
                        <span className="text-xs font-bold font-mono text-emerald-400">
                          {formatBytes(cat.total_bytes)}
                        </span>
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-slate-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        )}
                      </div>
                    </div>

                    {/* Sub-Items List (Accordion Body) */}
                    {isExpanded && (
                      <div className="border-t border-slate-800 bg-slate-950/60 divide-y divide-slate-800/60 max-h-56 overflow-y-auto">
                        {cat.items.map((item) => {
                          const isItemSelected = selectedItemIds.has(item.id);
                          return (
                            <div
                              key={item.id}
                              onClick={() => toggleItemSelection(item.id)}
                              className="px-4 py-2.5 flex items-center justify-between text-xs hover:bg-slate-900/60 cursor-pointer select-none"
                            >
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <div>
                                  {isItemSelected ? (
                                    <CheckSquare className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <Square className="w-3.5 h-3.5 text-slate-600" />
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <span className="text-slate-300 font-mono text-[11px] truncate block">
                                    {item.name}
                                  </span>
                                  <span className="text-[10px] text-slate-500 font-mono truncate block">
                                    {item.path}
                                  </span>
                                </div>
                              </div>

                              <div className="text-right pl-3 shrink-0">
                                <span className="font-mono text-[11px] font-semibold text-slate-300">
                                  {formatBytes(item.size_bytes)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
