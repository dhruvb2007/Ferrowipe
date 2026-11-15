use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, State};

use crate::cleaner::{query_recycle_bin, run_clean, run_scan};
use crate::drives::get_system_drives;
use crate::folder_analyzer::{
    analyze_directory, analyze_full_disk_tree, execute_delete_folders, get_subfolder_children,
    scan_deep_largest_folders, DeleteFoldersReport, DeleteFoldersRequest, FolderAnalysisResult,
    FolderItem,
};
use crate::models::{CleanReport, CleanRequest, DriveInfo, ScanResult};

pub struct AppState {
    pub scan_cancel_flag: Arc<AtomicBool>,
    pub clean_cancel_flag: Arc<AtomicBool>,
    pub folder_analyze_cancel_flag: Arc<AtomicBool>,
    pub folder_delete_cancel_flag: Arc<AtomicBool>,
    pub disk_cache: Arc<RwLock<HashMap<String, Vec<FolderItem>>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            scan_cancel_flag: Arc::new(AtomicBool::new(false)),
            clean_cancel_flag: Arc::new(AtomicBool::new(false)),
            folder_analyze_cancel_flag: Arc::new(AtomicBool::new(false)),
            folder_delete_cancel_flag: Arc::new(AtomicBool::new(false)),
            disk_cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

#[tauri::command]
pub fn get_drives() -> Result<Vec<DriveInfo>, String> {
    Ok(get_system_drives())
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

    tauri::async_runtime::spawn_blocking(move || run_clean(request, flag, app))
        .await
        .map_err(|e| format!("Clean task failed: {}", e))
}

#[tauri::command]
pub fn cancel_clean(state: State<'_, AppState>) -> Result<(), String> {
    state.clean_cancel_flag.store(true, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub fn query_all_recycle_bins() -> Result<Vec<RecycleBinStat>, String> {
    let mut stats = Vec::new();
    for letter in ['C', 'D', 'E', 'F'] {
        let (bytes, count) = query_recycle_bin(Some(letter));
        stats.push(RecycleBinStat {
            drive: format!("{}:\\", letter),
            bytes,
            items: count,
        });
    }
    Ok(stats)
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
// Large Folder Analyzer & Full Disk Commands
// ----------------------------------------------------

#[tauri::command]
pub async fn analyze_folder(
    target_path: String,
    depth: Option<usize>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<FolderAnalysisResult, String> {
    state
        .folder_analyze_cancel_flag
        .store(false, Ordering::SeqCst);
    let flag = Arc::clone(&state.folder_analyze_cancel_flag);
    let d = depth.unwrap_or(0);

    tauri::async_runtime::spawn_blocking(move || analyze_directory(&target_path, d, flag, app))
        .await
        .map_err(|e| format!("Folder analysis task error: {}", e))?
}

#[tauri::command]
pub async fn analyze_full_disk(
    disk_root: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<FolderAnalysisResult, String> {
    state
        .folder_analyze_cancel_flag
        .store(false, Ordering::SeqCst);
    let flag = Arc::clone(&state.folder_analyze_cancel_flag);
    let cache = Arc::clone(&state.disk_cache);

    tauri::async_runtime::spawn_blocking(move || {
        analyze_full_disk_tree(&disk_root, cache, flag, app)
    })
    .await
    .map_err(|e| format!("Full disk analysis error: {}", e))?
}

#[tauri::command]
pub async fn get_folder_children(
    folder_path: String,
    depth: usize,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<FolderItem>, String> {
    let flag = Arc::clone(&state.folder_analyze_cancel_flag);
    let cache = Arc::clone(&state.disk_cache);

    tauri::async_runtime::spawn_blocking(move || {
        get_subfolder_children(&folder_path, depth, cache, flag, app)
    })
    .await
    .map_err(|e| format!("Get subfolders error: {}", e))?
}

#[tauri::command]
pub fn cancel_folder_analysis(state: State<'_, AppState>) -> Result<(), String> {
    state
        .folder_analyze_cancel_flag
        .store(true, Ordering::SeqCst);
    Ok(())
}

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
    let flag = Arc::clone(&state.folder_analyze_cancel_flag);
    let min_bytes = min_size_mb * 1024 * 1024;

    tauri::async_runtime::spawn_blocking(move || {
        scan_deep_largest_folders(&target_path, min_bytes, top_n, flag, app)
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

    tauri::async_runtime::spawn_blocking(move || execute_delete_folders(request, flag, app))
        .await
        .map_err(|e| format!("Folder delete error: {}", e))
}

#[tauri::command]
pub fn cancel_folder_delete(state: State<'_, AppState>) -> Result<(), String> {
    state
        .folder_delete_cancel_flag
        .store(true, Ordering::SeqCst);
    Ok(())
}
