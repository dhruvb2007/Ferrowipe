use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, State};

use crate::cleaner::{query_recycle_bin, run_clean, run_scan};
use crate::drives::get_system_drives;
use crate::models::{CleanReport, CleanRequest, DriveInfo, ScanResult};

pub struct AppState {
    pub scan_cancel_flag: Arc<AtomicBool>,
    pub clean_cancel_flag: Arc<AtomicBool>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            scan_cancel_flag: Arc::new(AtomicBool::new(false)),
            clean_cancel_flag: Arc::new(AtomicBool::new(false)),
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

    // Spawn on blocking threadpool so async runtime isn't blocked
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
    let _ = std::process::Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}
