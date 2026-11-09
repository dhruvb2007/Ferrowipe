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
    pub skipped_files: Vec<SkippedFile>,
    pub duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CleanRequest {
    pub selected_category_ids: Vec<String>,
    pub selected_item_ids: Vec<String>,
}
