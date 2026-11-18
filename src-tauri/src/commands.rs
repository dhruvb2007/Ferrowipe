use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::cleaner::{get_active_drive_letters, query_recycle_bin, run_clean, run_scan};
use crate::disk_index::{DiskIndexManager, DiskVerificationReport, DriveIndexStatus};
use crate::drives::get_system_drives;
use crate::folder_analyzer::{
    analyze_directory, execute_delete_folders, DeleteFoldersReport, DeleteFoldersRequest,
    FolderAnalysisResult, FolderItem,
};
use crate::models::{
    CleanReport, CleanRequest, DetectedCleanupRule, DriveInfo, ScanResult, SoftwareStorageReport,
};
use crate::rules::get_detected_cleanup_rules;
use crate::software_scanner::scan_installed_software;

pub struct AppState {
    pub scan_cancel_flag: Arc<AtomicBool>,
    pub clean_cancel_flag: Arc<AtomicBool>,
    pub folder_analyze_cancel_flag: Arc<AtomicBool>,
    pub folder_delete_cancel_flag: Arc<AtomicBool>,
    pub disk_index: Arc<DiskIndexManager>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            scan_cancel_flag: Arc::new(AtomicBool::new(false)),
            clean_cancel_flag: Arc::new(AtomicBool::new(false)),
            folder_analyze_cancel_flag: Arc::new(AtomicBool::new(false)),
            folder_delete_cancel_flag: Arc::new(AtomicBool::new(false)),
            disk_index: Arc::new(DiskIndexManager::new()),
        }
    }
}

#[tauri::command]
pub async fn get_drives() -> Result<Vec<DriveInfo>, String> {
    tauri::async_runtime::spawn_blocking(get_system_drives)
        .await
        .map_err(|e| format!("Failed to query drives: {}", e))
}

#[tauri::command]
pub async fn get_available_cleanup_rules() -> Result<Vec<DetectedCleanupRule>, String> {
    tauri::async_runtime::spawn_blocking(get_detected_cleanup_rules)
        .await
        .map_err(|e| format!("Failed to detect cleanup rules: {}", e))
}

#[tauri::command]
pub fn start_initial_sync_all_drives(
    force: Option<bool>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    Ok(state
        .disk_index
        .start_initial_sync_all_drives(app, force.unwrap_or(false)))
}

#[tauri::command]
pub async fn get_installed_software_storage(
    state: State<'_, AppState>,
) -> Result<SoftwareStorageReport, String> {
    let disk_index = Arc::clone(&state.disk_index);
    tauri::async_runtime::spawn_blocking(move || scan_installed_software(disk_index))
        .await
        .map_err(|e| format!("Software storage scan failed: {}", e))
}

#[tauri::command]
pub async fn start_scan(
    active_categories: Vec<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ScanResult, String> {
    state.scan_cancel_flag.store(false, Ordering::SeqCst);
    let flag = Arc::clone(&state.scan_cancel_flag);

    tauri::async_runtime::spawn_blocking(move || run_scan(active_categories, flag, app))
        .await
        .map_err(|e| format!("Scan task failed: {}", e))
}

#[tauri::command]
pub fn cancel_scan(state: State<'_, AppState>) -> Result<(), String> {
    state.scan_cancel_flag.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn start_clean(
    request: CleanRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<CleanReport, String> {
    state.clean_cancel_flag.store(false, Ordering::SeqCst);
    let flag = Arc::clone(&state.clean_cancel_flag);
    let disk_index = Arc::clone(&state.disk_index);
    let touched_paths: Vec<PathBuf> = request
        .selected_item_ids
        .iter()
        .filter(|id| !id.starts_with("recycle_bin_"))
        .map(PathBuf::from)
        .collect();

    let app_for_reconcile = app.clone();
    let report = tauri::async_runtime::spawn_blocking(move || run_clean(request, flag, app))
        .await
        .map_err(|e| format!("Clean task failed: {}", e))?;

    if !touched_paths.is_empty() {
        tauri::async_runtime::spawn_blocking(move || {
            disk_index.reconcile_paths_now(&touched_paths, "realtime", &app_for_reconcile);
        });
    }

    Ok(report)
}

#[tauri::command]
pub fn cancel_clean(state: State<'_, AppState>) -> Result<(), String> {
    state.clean_cancel_flag.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn query_all_recycle_bins() -> Result<Vec<RecycleBinStat>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut stats = Vec::new();
        for letter in get_active_drive_letters() {
            let (bytes, count) = query_recycle_bin(Some(letter));
            stats.push(RecycleBinStat {
                drive: format!("{}:\\", letter),
                bytes,
                items: count,
            });
        }
        stats
    })
    .await
    .map_err(|e| format!("Failed to query recycle bins: {}", e))
}

#[derive(serde::Serialize)]
pub struct RecycleBinStat {
    pub drive: String,
    pub bytes: u64,
    pub items: u64,
}

#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    let clean_path = path.replace('/', "\\");
    let _ = std::process::Command::new("explorer.exe")
        .arg(&clean_path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn locate_in_explorer(path: String) -> Result<(), String> {
    let clean_path = path.replace('/', "\\");
    let _ = std::process::Command::new("explorer.exe")
        .arg(format!("/select,{}", clean_path))
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ----------------------------------------------------
// Smart Real-Time Multi-Drive Space Analyzer Commands
// ----------------------------------------------------

#[tauri::command]
pub async fn get_indexed_drives_status(
    state: State<'_, AppState>,
) -> Result<Vec<DriveIndexStatus>, String> {
    let disk_index = Arc::clone(&state.disk_index);
    tauri::async_runtime::spawn_blocking(move || disk_index.list_statuses())
        .await
        .map_err(|e| format!("Failed to get drive statuses: {}", e))
}

#[tauri::command]
pub async fn get_cached_folder_view(
    target_path: String,
    depth: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Option<FolderAnalysisResult>, String> {
    let disk_index = Arc::clone(&state.disk_index);
    let d = depth.unwrap_or(0);
    tauri::async_runtime::spawn_blocking(move || disk_index.get_view_for_path(&target_path, d))
        .await
        .map_err(|e| format!("Failed to read cached folder view: {}", e))
}

#[derive(serde::Deserialize)]
pub struct FolderPathDepth {
    pub path: String,
    pub depth: usize,
}

#[tauri::command]
pub async fn get_cached_children_batch(
    requests: Vec<FolderPathDepth>,
    state: State<'_, AppState>,
) -> Result<HashMap<String, Vec<FolderItem>>, String> {
    let disk_index = Arc::clone(&state.disk_index);
    tauri::async_runtime::spawn_blocking(move || {
        let mut out = HashMap::with_capacity(requests.len());
        for req in requests {
            if let Some(items) = disk_index.get_children_for_path(&req.path, req.depth) {
                out.insert(req.path, items);
            }
        }
        out
    })
    .await
    .map_err(|e| format!("Failed to read cached children batch: {}", e))
}

/// Smart folder analysis:
/// - If drive is already indexed in memory (with live watcher), returns in < 1ms (zero recalculation!)
/// - If persisted snapshot exists on disk, loads instantly and syncs ONLY what changed in background!
/// - Otherwise indexes the entire drive cleanly, attaches live watcher, and persists snapshot.
#[tauri::command]
pub async fn analyze_folder(
    target_path: String,
    depth: Option<usize>,
    force_rescan: Option<bool>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<FolderAnalysisResult, String> {
    let _ = depth;
    state
        .folder_analyze_cancel_flag
        .store(false, Ordering::SeqCst);
    let disk_index = Arc::clone(&state.disk_index);
    let force = force_rescan.unwrap_or(false);

    tauri::async_runtime::spawn_blocking(move || {
        disk_index.ensure_drive_and_get_view(&target_path, force, app)
    })
    .await
    .map_err(|e| format!("Folder analysis task error: {}", e))?
}

/// Explicitly rebuilds (or loads if force_reindex=false) the complete drive index and starts live watching.
#[tauri::command]
pub async fn analyze_full_disk(
    disk_root: String,
    force_reindex: Option<bool>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<FolderAnalysisResult, String> {
    state
        .folder_analyze_cancel_flag
        .store(false, Ordering::SeqCst);
    let disk_index = Arc::clone(&state.disk_index);
    let force = force_reindex.unwrap_or(true);

    tauri::async_runtime::spawn_blocking(move || {
        disk_index.ensure_drive_and_get_view(&disk_root, force, app)
    })
    .await
    .map_err(|e| format!("Full disk analysis error: {}", e))?
}

/// Runs a smart incremental diff on `target_path` ONLY updating added/deleted/modified entries.
#[tauri::command]
pub async fn smart_sync_folder(
    target_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<FolderAnalysisResult, String> {
    let disk_index = Arc::clone(&state.disk_index);

    tauri::async_runtime::spawn_blocking(move || disk_index.smart_sync_path(&target_path, app))
        .await
        .map_err(|e| format!("Smart sync error: {}", e))?
}

/// Compares the drive's live OS full/used size against the scanned index size.
/// Automatically recalculates the entire disk if they don't match (or if `force_recalculate = true`).
#[tauri::command]
pub async fn verify_and_recalculate_disk(
    target_path: String,
    force_recalculate: Option<bool>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DiskVerificationReport, String> {
    let disk_index = Arc::clone(&state.disk_index);
    let force = force_recalculate.unwrap_or(false);

    tauri::async_runtime::spawn_blocking(move || {
        disk_index.verify_and_recalculate_disk(&target_path, force, app)
    })
    .await
    .map_err(|e| format!("Disk verification error: {}", e))?
}

#[tauri::command]
pub async fn get_folder_children(
    folder_path: String,
    depth: usize,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<FolderItem>, String> {
    // 1. Instant read from live per-drive index (< 1ms)
    if let Some(items) = state.disk_index.get_children_for_path(&folder_path, depth) {
        return Ok(items);
    }

    // 2. Fallback dynamic scan if drive is not yet indexed
    let flag = Arc::clone(&state.folder_analyze_cancel_flag);
    tauri::async_runtime::spawn_blocking(move || {
        let res = analyze_directory(&folder_path, depth, flag, app)?;
        Ok(res.items)
    })
    .await
    .map_err(|e| format!("Get subfolders error: {}", e))?
}

#[tauri::command]
pub fn cancel_folder_analysis(state: State<'_, AppState>) -> Result<(), String> {
    state
        .folder_analyze_cancel_flag
        .store(true, Ordering::SeqCst);
    state.disk_index.cancel_all_scans();
    Ok(())
}

/// Top Space Hogs powered by the live multi-drive index (searches ALL depths in < 5ms!).
#[tauri::command]
pub async fn get_deep_largest_folders(
    target_path: String,
    min_size_mb: u64,
    top_n: usize,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<FolderItem>, String> {
    state
        .folder_analyze_cancel_flag
        .store(false, Ordering::SeqCst);
    let disk_index = Arc::clone(&state.disk_index);
    let min_bytes = min_size_mb * 1024 * 1024;

    tauri::async_runtime::spawn_blocking(move || {
        // Ensure drive is indexed (returns instantly if already in memory or cached!)
        disk_index.ensure_drive_and_get_view(&target_path, false, app)?;
        disk_index
            .query_deep_largest_folders(&target_path, min_bytes, top_n)
            .ok_or_else(|| format!("Unable to query space hogs for {}", target_path))
    })
    .await
    .map_err(|e| format!("Deep scan error: {}", e))?
}

#[tauri::command]
pub async fn delete_folders(
    request: DeleteFoldersRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DeleteFoldersReport, String> {
    state
        .folder_delete_cancel_flag
        .store(false, Ordering::SeqCst);
    let flag = Arc::clone(&state.folder_delete_cancel_flag);
    let disk_index = Arc::clone(&state.disk_index);
    let app_for_reconcile = app.clone();

    let report =
        tauri::async_runtime::spawn_blocking(move || execute_delete_folders(request, flag, app))
            .await
            .map_err(|e| format!("Folder delete error: {}", e))?;

    // Immediately reconcile deleted paths in DriveIndex so UI updates instantaneously
    if !report.deleted_paths.is_empty() {
        let deleted_pbs: Vec<PathBuf> = report.deleted_paths.iter().map(PathBuf::from).collect();
        tauri::async_runtime::spawn_blocking(move || {
            disk_index.reconcile_paths_now(&deleted_pbs, "realtime", &app_for_reconcile);
        })
        .await
        .ok();
    }

    Ok(report)
}

#[tauri::command]
pub fn cancel_folder_delete(state: State<'_, AppState>) -> Result<(), String> {
    state
        .folder_delete_cancel_flag
        .store(true, Ordering::SeqCst);
    Ok(())
}
