import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Package,
  Search,
  RefreshCw,
  Globe,
  Bot,
  Code2,
  Gamepad2,
  MessageSquare,
  Film,
  Cpu,
  FolderTree,
  MapPin,
  Copy,
  ChevronDown,
  ChevronRight,
  HardDrive,
  Database,
  X,
  Info,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { InstalledSoftwareItem, SoftwareStorageReport } from '@/types';
import { formatBytes, formatDuration } from '@/utils';
import { cn } from '@/lib/utils';
import {
  ObsidianBadge,
  ObsidianButton,
  ObsidianProgress,
  ObsidianSelect,
} from '@/components/obsidian/ObsidianPrimitives';
import { obsidianToast } from '@/components/obsidian/ObsidianToast';

interface SoftwareStorageProps {
  isActive: boolean;
  onInspectPath: (path: string) => void;
}

const SORT_OPTIONS = [
  { value: 'total_desc', label: 'Largest First' },
  { value: 'data_desc', label: 'Most Data / Cache' },
  { value: 'total_asc', label: 'Smallest First' },
  { value: 'name_asc', label: 'Name (A–Z)' },
];

function getCategoryIcon(category: string): React.ReactNode {
  switch (category) {
    case 'Browser':
      return <Globe className="h-4 w-4 text-sky-400 shrink-0" />;
    case 'AI & Agents':
      return <Bot className="h-4 w-4 text-violet-400 shrink-0" />;
    case 'IDEs & Dev':
      return <Code2 className="h-4 w-4 text-[var(--obs-accent)] shrink-0" />;
    case 'Gaming':
      return <Gamepad2 className="h-4 w-4 text-emerald-400 shrink-0" />;
    case 'Communication':
      return <MessageSquare className="h-4 w-4 text-indigo-400 shrink-0" />;
    case 'Media & Creative':
      return <Film className="h-4 w-4 text-pink-400 shrink-0" />;
    case 'System & Drivers':
      return <Cpu className="h-4 w-4 text-amber-400 shrink-0" />;
    default:
      return <Package className="h-4 w-4 text-[var(--obs-text-muted)] shrink-0" />;
  }
}

export const SoftwareStorage: React.FC<SoftwareStorageProps> = ({ isActive, onInspectPath }) => {
  const [report, setReport] = useState<SoftwareStorageReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedDrive, setSelectedDrive] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'total_desc' | 'data_desc' | 'total_asc' | 'name_asc'>(
    'total_desc'
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const hasLoadedRef = useRef(false);

  const scanSoftware = useCallback(async (showToast = false) => {
    setIsLoading(true);
    try {
      const data = await invoke<SoftwareStorageReport>('get_installed_software_storage');
      setReport(data);
      if (showToast) {
        obsidianToast.success(
          `Measured ${data.app_count} installed apps (${formatBytes(data.total_bytes)})`,
          { description: `Completed in ${formatDuration(data.duration_ms)}` }
        );
      }
    } catch (err) {
      console.error('Software storage scan failed:', err);
      obsidianToast.error('Could not scan installed software', { description: String(err) });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isActive || hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    scanSoftware(false);
  }, [isActive, scanSoftware]);

  const categoryStats = useMemo(() => {
    if (!report) return [] as { name: string; count: number; bytes: number }[];
    const map = new Map<string, { count: number; bytes: number }>();
    for (const app of report.apps) {
      const cur = map.get(app.category) || { count: 0, bytes: 0 };
      cur.count += 1;
      cur.bytes += app.total_bytes;
      map.set(app.category, cur);
    }
    return Array.from(map.entries())
      .map(([name, st]) => ({ name, count: st.count, bytes: st.bytes }))
      .sort((a, b) => b.bytes - a.bytes);
  }, [report]);

  const availableDrives = useMemo(() => {
    if (!report) return [] as string[];
    const set = new Set<string>();
    report.apps.forEach((a) => {
      if (a.drive) set.add(a.drive.toUpperCase());
    });
    return Array.from(set).sort();
  }, [report]);

  const filteredApps = useMemo(() => {
    if (!report) return [] as InstalledSoftwareItem[];
    const q = searchQuery.trim().toLowerCase();

    const list = report.apps.filter((app) => {
      if (selectedCategory !== 'All' && app.category !== selectedCategory) return false;
      if (selectedDrive !== 'ALL' && app.drive.toUpperCase() !== selectedDrive) return false;
      if (
        q &&
        !app.name.toLowerCase().includes(q) &&
        !app.publisher.toLowerCase().includes(q) &&
        !app.primary_path.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'total_desc') return b.total_bytes - a.total_bytes;
      if (sortBy === 'data_desc') return b.data_bytes - a.data_bytes;
      if (sortBy === 'total_asc') return a.total_bytes - b.total_bytes;
      return a.name.localeCompare(b.name);
    });
  }, [report, searchQuery, selectedCategory, selectedDrive, sortBy]);

  const maxAppBytes = useMemo(() => {
    if (filteredApps.length === 0) return 1;
    return Math.max(...filteredApps.map((a) => a.total_bytes), 1);
  }, [filteredApps]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopyPaths = (paths: string[], label?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const cleaned = paths.filter(Boolean);
    if (cleaned.length === 0) return;
    navigator.clipboard.writeText(cleaned.join('\n'));
    obsidianToast.success(
      cleaned.length === 1
        ? 'Path copied to clipboard'
        : `Copied ${cleaned.length} paths to clipboard`,
      { description: label || cleaned[0] }
    );
  };

  const handleLocatePath = async (path: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!path) return;
    try {
      await invoke('locate_in_explorer', { path });
    } catch {
      try {
        await invoke('open_in_explorer', { path });
      } catch {
        obsidianToast.error('Could not open path in Windows Explorer');
      }
    }
  };

  const driveSelectOptions = useMemo(
    () => [
      { value: 'ALL', label: 'All Drives' },
      ...availableDrives.map((d) => ({ value: d, label: d })),
    ],
    [availableDrives]
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Top Toolbar */}
      <div className="border-b border-[var(--obs-border)] bg-[var(--obs-panel)]/70 px-6 py-3.5 space-y-3 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Search + Filters */}
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="h-3.5 w-3.5 text-[var(--obs-text-subtle)] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search installed software, publisher, or path..."
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

            {availableDrives.length > 1 && (
              <ObsidianSelect
                prefix="Drive:"
                value={selectedDrive}
                options={driveSelectOptions}
                onChange={setSelectedDrive}
              />
            )}

            <ObsidianSelect
              prefix="Sort:"
              value={sortBy}
              options={SORT_OPTIONS}
              onChange={(v) => setSortBy(v as typeof sortBy)}
            />
          </div>

          <ObsidianButton
            variant="accent"
            size="sm"
            onClick={() => scanSoftware(true)}
            disabled={isLoading}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
            {isLoading ? 'Measuring...' : 'Recalculate Sizes'}
          </ObsidianButton>
        </div>

        {/* Dynamic Category Filter Pills */}
        {categoryStats.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <ObsidianButton
              size="xs"
              variant={selectedCategory === 'All' ? 'control' : 'ghost'}
              onClick={() => setSelectedCategory('All')}
              className={cn(
                selectedCategory === 'All' &&
                  'ring-1 ring-[var(--obs-accent-border)] text-[var(--obs-accent)]'
              )}
            >
              All ({report?.app_count ?? 0})
            </ObsidianButton>
            {categoryStats.map((cat) => {
              const active = selectedCategory === cat.name;
              return (
                <ObsidianButton
                  key={cat.name}
                  size="xs"
                  variant={active ? 'control' : 'ghost'}
                  onClick={() => setSelectedCategory(cat.name)}
                  className={cn(
                    active && 'ring-1 ring-[var(--obs-accent-border)] text-[var(--obs-accent)]'
                  )}
                >
                  <span>{cat.name}</span>
                  <span className="font-mono text-[10px] opacity-75">
                    {formatBytes(cat.bytes, 0)}
                  </span>
                </ObsidianButton>
              );
            })}
          </div>
        )}
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 obs-scroll h-full">
        <div className="p-6 space-y-5 max-w-7xl mx-auto">
          {/* Loading State */}
          {isLoading && !report && (
            <div className="obs-card p-6 space-y-4 ring-1 ring-[var(--obs-accent-border)]">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-[var(--obs-accent-soft)] text-[var(--obs-accent)] flex items-center justify-center">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[var(--obs-fg)]">
                    Measuring Installed Software Storage...
                  </h3>
                  <p className="text-xs text-[var(--obs-text-muted)]">
                    Scanning Windows Registry, Program Files, AppData caches, and dev toolchains
                  </p>
                </div>
              </div>
              <div className="h-2 w-full bg-[var(--obs-muted)] rounded-full overflow-hidden relative">
                <div className="h-full w-1/3 bg-[var(--obs-accent)] rounded-full animate-indeterminate-bar" />
              </div>
            </div>
          )}

          {/* Hero KPI Strip */}
          {report && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="obs-card p-4 flex items-center justify-between gap-3 ring-1 ring-[var(--obs-accent-border)]">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--obs-text-subtle)]">
                    Total Software Footprint
                  </p>
                  <p className="text-2xl font-bold text-[var(--obs-accent)] font-mono tabular-nums mt-1">
                    {formatBytes(report.total_bytes)}
                  </p>
                  <p className="text-[11px] text-[var(--obs-text-muted)] mt-0.5">
                    {report.app_count} apps &amp; toolchains • {formatDuration(report.duration_ms)}
                  </p>
                </div>
                <div className="h-10 w-10 rounded-xl bg-[var(--obs-accent-soft)] border border-[var(--obs-accent-border)] text-[var(--obs-accent)] flex items-center justify-center shrink-0">
                  <Package className="h-5 w-5" />
                </div>
              </div>

              <div className="obs-card p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--obs-text-subtle)]">
                    Program &amp; Install Binaries
                  </p>
                  <p className="text-2xl font-bold text-[var(--obs-fg)] font-mono tabular-nums mt-1">
                    {formatBytes(report.total_install_bytes)}
                  </p>
                  <p className="text-[11px] text-[var(--obs-text-muted)] mt-0.5">
                    Program Files &amp; install directories
                  </p>
                </div>
                <div className="h-10 w-10 rounded-xl obs-control text-sky-400 flex items-center justify-center shrink-0">
                  <HardDrive className="h-5 w-5" />
                </div>
              </div>

              <div className="obs-card p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--obs-text-subtle)]">
                    User Data, Profiles &amp; Caches
                  </p>
                  <p className="text-2xl font-bold text-amber-400 font-mono tabular-nums mt-1">
                    {formatBytes(report.total_data_bytes)}
                  </p>
                  <p className="text-[11px] text-[var(--obs-text-muted)] mt-0.5">
                    AppData, browser profiles, SDKs &amp; caches
                  </p>
                </div>
                <div className="h-10 w-10 rounded-xl obs-control text-amber-400 flex items-center justify-center shrink-0">
                  <Database className="h-5 w-5" />
                </div>
              </div>
            </div>
          )}

          {/* Empty State */}
          {report && !isLoading && filteredApps.length === 0 && (
            <div className="obs-card p-12 text-center space-y-2">
              <Info className="h-8 w-8 text-[var(--obs-text-subtle)] mx-auto" />
              <p className="text-sm font-semibold text-[var(--obs-fg)]">No matching software</p>
              <p className="text-xs text-[var(--obs-text-muted)]">
                Try clearing your search filter or selecting All categories.
              </p>
            </div>
          )}

          {/* Installed Software Table */}
          {filteredApps.length > 0 && (
            <div className="obs-card overflow-hidden">
              <div className="px-4 py-2.5 bg-[var(--obs-bg)]/60 border-b border-[var(--obs-border)] flex items-center justify-between text-[11px] font-medium text-[var(--obs-text-subtle)]">
                <span>Software &amp; Footprint Breakdown ({filteredApps.length})</span>
                <div className="flex items-center gap-6 pr-2">
                  <span className="w-28 hidden md:inline text-right">Relative Size</span>
                  <span className="w-24 text-right">Total Space</span>
                  <span className="w-28 text-right">Actions</span>
                </div>
              </div>

              <div className="divide-y divide-[var(--obs-border)]/70">
                {filteredApps.map((app) => {
                  const isExpanded = expandedIds.has(app.id);
                  const relativePct = Math.round((app.total_bytes / maxAppBytes) * 100);
                  const hasPaths = app.paths.length > 0;

                  return (
                    <div key={app.id}>
                      <div
                        onClick={() => hasPaths && toggleExpand(app.id)}
                        className={cn(
                          'px-4 py-3 flex items-center justify-between gap-3 text-xs transition-colors select-none',
                          hasPaths && 'cursor-pointer hover:bg-[var(--obs-hover)]'
                        )}
                      >
                        {/* Left */}
                        <div className="flex items-center gap-2.5 flex-1 min-w-0">
                          <div className="w-5 flex items-center justify-center shrink-0 text-[var(--obs-text-muted)]">
                            {hasPaths ? (
                              isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5 text-[var(--obs-accent)]" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )
                            ) : null}
                          </div>

                          <div className="h-8 w-8 rounded-lg obs-control flex items-center justify-center shrink-0">
                            {getCategoryIcon(app.category)}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-semibold text-[var(--obs-fg)] truncate">
                                {app.name}
                              </span>
                              {app.version && (
                                <span className="text-[10px] font-mono text-[var(--obs-text-subtle)]">
                                  v{app.version}
                                </span>
                              )}
                              <ObsidianBadge tone="neutral" className="text-[9px]">
                                {app.category}
                              </ObsidianBadge>
                              <ObsidianBadge tone="accent" className="font-mono text-[9px]">
                                {app.drive}
                              </ObsidianBadge>
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-[var(--obs-text-muted)] mt-0.5 flex-wrap">
                              <span className="truncate max-w-[200px]">{app.publisher}</span>
                              {app.install_bytes > 0 && app.data_bytes > 0 && (
                                <>
                                  <span>•</span>
                                  <span className="font-mono">
                                    Install {formatBytes(app.install_bytes)}
                                  </span>
                                  <span>+</span>
                                  <span className="font-mono text-amber-400">
                                    Data/Cache {formatBytes(app.data_bytes)}
                                  </span>
                                </>
                              )}
                              {app.size_source === 'registry_estimate' && (
                                <span className="text-[var(--obs-text-subtle)]">
                                  • Registry estimate
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Right */}
                        <div className="flex items-center gap-5 shrink-0">
                          <div className="w-28 hidden md:block">
                            <ObsidianProgress
                              value={relativePct}
                              tone={
                                app.total_bytes >= 10 * 1024 * 1024 * 1024
                                  ? 'danger'
                                  : app.total_bytes >= 3 * 1024 * 1024 * 1024
                                  ? 'warning'
                                  : 'accent'
                              }
                              className="h-1.5"
                            />
                          </div>

                          <div className="text-right w-24 tabular-nums">
                            <span className="font-mono font-bold text-xs text-[var(--obs-accent)] block">
                              {formatBytes(app.total_bytes)}
                            </span>
                            <span className="text-[10px] text-[var(--obs-text-subtle)] font-mono block">
                              {app.paths.length} folder{app.paths.length === 1 ? '' : 's'}
                            </span>
                          </div>

                          <div className="flex items-center justify-end gap-1 w-28">
                            {app.primary_path && (
                              <>
                                <ObsidianButton
                                  variant="control"
                                  size="xs"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onInspectPath(app.primary_path);
                                  }}
                                  title="Inspect largest folder in Space Analyzer"
                                >
                                  <FolderTree className="h-3 w-3 text-[var(--obs-accent)]" />
                                  Inspect
                                </ObsidianButton>
                                <ObsidianButton
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={(e) =>
                                    handleCopyPaths(
                                      app.paths.map((p) => p.path),
                                      app.name,
                                      e
                                    )
                                  }
                                  title="Copy software paths"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </ObsidianButton>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Expanded Path Breakdown Drawer */}
                      <AnimatePresence initial={false}>
                        {isExpanded && app.paths.length > 0 && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.16 }}
                            className="overflow-hidden border-t border-[var(--obs-border)] bg-[var(--obs-bg)]/55"
                          >
                            <div className="px-6 py-2.5 divide-y divide-[var(--obs-border)]/60">
                              {app.paths.map((entry) => (
                                <div
                                  key={entry.path}
                                  className="py-2 flex items-center justify-between gap-3 text-xs"
                                >
                                  <div className="min-w-0 flex-1 pl-5">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-[var(--obs-fg)]">
                                        {entry.label}
                                      </span>
                                      <ObsidianBadge
                                        tone={
                                          entry.kind === 'cache'
                                            ? 'warning'
                                            : entry.kind === 'data'
                                            ? 'accent'
                                            : 'neutral'
                                        }
                                        className="text-[9px]"
                                      >
                                        {entry.kind}
                                      </ObsidianBadge>
                                    </div>
                                    <p className="text-[10px] font-mono text-[var(--obs-text-subtle)] truncate mt-0.5">
                                      {entry.path}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className="font-mono text-[11px] font-semibold text-[var(--obs-fg)] tabular-nums">
                                      {formatBytes(entry.size_bytes)}
                                    </span>
                                    <ObsidianButton
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6"
                                      onClick={(e) => handleCopyPaths([entry.path], entry.label, e)}
                                      title="Copy path"
                                    >
                                      <Copy className="h-3 w-3" />
                                    </ObsidianButton>
                                    <ObsidianButton
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6"
                                      onClick={(e) => handleLocatePath(entry.path, e)}
                                      title="Locate in Windows Explorer"
                                    >
                                      <MapPin className="h-3 w-3" />
                                    </ObsidianButton>
                                    <ObsidianButton
                                      variant="control"
                                      size="xs"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onInspectPath(entry.path);
                                      }}
                                      title="Open this folder in Space Analyzer"
                                    >
                                      <FolderTree className="h-3 w-3 text-[var(--obs-accent)]" />
                                      Analyze
                                    </ObsidianButton>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
