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
  skipped_files: SkippedFile[];
  duration_ms: number;
}

export interface CleanRequest {
  selected_category_ids: string[];
  selected_item_ids: string[];
}


export interface FolderItem {
  id: string;
  name: string;
  path: string;
  size_bytes: number;
  file_count: number;
  subfolder_count: number;
  is_dir: boolean;
  last_modified: number | null;
  percentage: number;
}

export interface FolderAnalysisResult {
  target_path: string;
  total_bytes: number;
  total_files: number;
  total_folders: number;
  items: FolderItem[];
  duration_ms: number;
}

export interface AnalyzeProgress {
  current_folder: string;
  folders_scanned: number;
  files_scanned: number;
  bytes_scanned: number;
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
