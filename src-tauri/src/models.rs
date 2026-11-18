use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveInfo {
    pub mount_point: String,
    pub volume_name: String,
    pub fs_type: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub usage_percentage: f64,
    pub drive_type: String,
    pub is_low_space: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JunkItem {
    pub id: String,
    pub category_id: String,
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub file_count: u64,
    pub is_selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategorySummary {
    pub category_id: String,
    pub name: String,
    pub description: String,
    pub total_bytes: u64,
    pub total_files: u64,
    pub items: Vec<JunkItem>,
    pub is_selected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub categories: Vec<CategorySummary>,
    pub total_reclaimable_bytes: u64,
    pub total_reclaimable_files: u64,
    pub scan_duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanProgress {
    pub scanned_files: u64,
    pub scanned_bytes: u64,
    pub current_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanProgress {
    pub cleaned_files: u64,
    pub freed_bytes: u64,
    pub total_target_bytes: u64,
    pub current_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkippedFile {
    pub path: String,
    pub category_id: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanReport {
    pub freed_bytes: u64,
    pub removed_files: u64,
    pub deleted_paths: Vec<String>,
    pub skipped_files: Vec<SkippedFile>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanRequest {
    pub selected_category_ids: Vec<String>,
    pub selected_item_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedCleanupRule {
    pub id: String,
    pub name: String,
    pub description: String,
    pub group: String,
    pub icon_key: String,
    pub detected_paths: Vec<String>,
    pub profile_count: usize,
    pub is_recycle_bin: bool,
    pub safe_note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupSyncProgress {
    pub is_active: bool,
    pub current_drive: String,
    pub current_index: usize,
    pub total_drives: usize,
    pub completed_drives: Vec<String>,
    pub stage: String,
    pub message: String,
    pub items_per_sec: u64,
    pub folders_scanned: u64,
    pub files_scanned: u64,
    pub bytes_scanned: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoftwarePathEntry {
    pub label: String,
    pub kind: String, // "install" | "data" | "cache"
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledSoftwareItem {
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub version: String,
    pub category: String,
    pub drive: String,
    pub install_bytes: u64,
    pub data_bytes: u64,
    pub total_bytes: u64,
    pub primary_path: String,
    pub paths: Vec<SoftwarePathEntry>,
    pub size_source: String, // "exact_disk" | "registry_estimate"
    pub install_date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoftwareStorageReport {
    pub apps: Vec<InstalledSoftwareItem>,
    pub total_bytes: u64,
    pub total_install_bytes: u64,
    pub total_data_bytes: u64,
    pub app_count: usize,
    pub duration_ms: u64,
}
