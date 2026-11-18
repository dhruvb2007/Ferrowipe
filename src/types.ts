export type NavTab = 'dashboard' | 'cleaner' | 'apps' | 'analyzer';

export interface DriveInfo {
  mount_point: string;
  volume_name: string;
  fs_type: string;
  total_bytes: number;
  available_bytes: number;
  used_bytes: number;
  usage_percentage: number;
  drive_type: string;
  is_low_space: boolean;
}

export interface RecycleBinStat {
  drive: string;
  bytes: number;
  items: number;
}

export interface JunkItem {
  id: string;
  category_id: string;
  name: string;
  path: string;
  size_bytes: number;
  file_count: number;
  is_selected: boolean;
}

export interface CategorySummary {
  category_id: string;
  name: string;
  description: string;
  total_bytes: number;
  total_files: number;
  items: JunkItem[];
  is_selected: boolean;
}

export interface ScanResult {
  categories: CategorySummary[];
  total_reclaimable_bytes: number;
  total_reclaimable_files: number;
  scan_duration_ms: number;
}

export interface ScanProgress {
  scanned_files: number;
  scanned_bytes: number;
  current_path: string;
}

export interface CleanProgress {
  cleaned_files: number;
  freed_bytes: number;
  total_target_bytes: number;
  current_path: string;
}

export interface SkippedFile {
  path: string;
  category_id: string;
  reason: string;
}

export interface CleanReport {
  freed_bytes: number;
  removed_files: number;
  deleted_paths: string[];
  skipped_files: SkippedFile[];
  duration_ms: number;
}

export interface CleanRequest {
  selected_category_ids: string[];
  selected_item_ids: string[];
}

export interface DetectedCleanupRule {
  id: string;
  name: string;
  description: string;
  group: 'Temp' | 'Browser' | 'AI & Agents' | 'IDEs & Dev' | 'Apps' | 'System' | string;
  icon_key: string;
  detected_paths: string[];
  profile_count: number;
  is_recycle_bin: boolean;
  safe_note: string | null;
}

export interface StartupSyncProgress {
  is_active: boolean;
  current_drive: string;
  current_index: number;
  total_drives: number;
  completed_drives: string[];
  stage: 'indexing' | 'delta_sync' | 'done' | string;
  message: string;
  items_per_sec: number;
  folders_scanned: number;
  files_scanned: number;
  bytes_scanned: number;
}

export interface SoftwarePathEntry {
  label: string;
  kind: 'install' | 'data' | 'cache' | string;
  path: string;
  size_bytes: number;
}

export interface InstalledSoftwareItem {
  id: string;
  name: string;
  publisher: string;
  version: string;
  category: string;
  drive: string;
  install_bytes: number;
  data_bytes: number;
  total_bytes: number;
  primary_path: string;
  paths: SoftwarePathEntry[];
  size_source: 'exact_disk' | 'registry_estimate' | string;
  install_date: string | null;
}

export interface SoftwareStorageReport {
  apps: InstalledSoftwareItem[];
  total_bytes: number;
  total_install_bytes: number;
  total_data_bytes: number;
  app_count: number;
  duration_ms: number;
}

export interface FolderItem {
  id: string;
  name: string;
  path: string;
  parent_path: string | null;
  size_bytes: number;
  file_count: number;
  subfolder_count: number;
  is_dir: boolean;
  last_modified: number | null;
  percentage: number;
  depth: number;
  has_subfolders: boolean;
  is_junction: boolean;
  is_access_denied: boolean;
}

export interface FolderAnalysisResult {
  target_path: string;
  total_bytes: number;
  total_files: number;
  total_folders: number;
  items: FolderItem[];
  duration_ms: number;
  is_full_disk: boolean;
  from_cache: boolean;
  is_watching: boolean;
  is_syncing: boolean;
  revision: number;
  last_sync_summary: string | null;
}

export interface DriveIndexStatus {
  drive_root: string;
  is_indexed: boolean;
  is_watching: boolean;
  is_syncing: boolean;
  total_bytes: number;
  total_files: number;
  total_folders: number;
  last_updated_ms: number;
  revision: number;
  from_cache: boolean;
  last_sync_summary: string | null;
}

export interface DiskVerificationReport {
  drive_root: string;
  disk_total_bytes: number;
  disk_used_bytes: number;
  disk_free_bytes: number;
  scanned_bytes_before: number;
  scanned_bytes_after: number;
  difference_bytes: number;
  abs_difference_bytes: number;
  match_percentage: number;
  tolerance_bytes: number;
  matched_before: boolean;
  matched_after: boolean;
  recalculated: boolean;
  access_denied_folders: number;
  junction_folders: number;
  duration_ms: number;
  summary: string;
  analysis_result: FolderAnalysisResult;
}

export interface TreeUpdateEvent {
  drive_root: string;
  revision: number;
  total_bytes: number;
  total_files: number;
  total_folders: number;
  changed_paths: string[];
  changes_applied: number;
  byte_delta: number;
  sync_mode: 'realtime' | 'delta_sync' | 'full_index' | string;
  summary: string;
}

export interface AnalyzeProgress {
  current_folder: string;
  drive_root: string;
  folders_scanned: number;
  files_scanned: number;
  bytes_scanned: number;
  items_per_sec: number;
  folders_per_sec: number;
  files_per_sec: number;
  bytes_per_sec: number;
  elapsed_ms: number;
}

export interface DeleteFoldersRequest {
  paths: string[];
  permanent: boolean;
}

export interface DeleteFoldersReport {
  deleted_paths: string[];
  failed_paths: SkippedFile[];
  freed_bytes: number;
  duration_ms: number;
}

export interface AnalyzerNavigationRequest {
  path: string;
  mode?: 'tree' | 'deep_scan';
  autoFullDisk?: boolean;
  minSizeMb?: number;
  nonce: number;
}

export interface CleanerQuickTrigger {
  presetRuleIds?: string[];
  autoScan?: boolean;
  nonce: number;
}

export interface CleanerStatusSummary {
  isScanning: boolean;
  isCleaning: boolean;
  reclaimableBytes: number;
  reclaimableFiles: number;
}
