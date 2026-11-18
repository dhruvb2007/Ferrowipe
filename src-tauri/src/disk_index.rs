use std::collections::{HashMap, HashSet, VecDeque};
use std::env;
use std::ffi::OsString;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_ACCESS_DENIED, FILETIME, HANDLE, INVALID_HANDLE_VALUE,
    WAIT_OBJECT_0,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FindClose, FindExInfoBasic, FindExSearchNameMatch, FindFirstFileExW,
    FindNextFileW, GetVolumeInformationW, ReadDirectoryChangesW, FILE_ATTRIBUTE_DIRECTORY,
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OVERLAPPED,
    FILE_LIST_DIRECTORY, FILE_NOTIFY_CHANGE_DIR_NAME, FILE_NOTIFY_CHANGE_FILE_NAME,
    FILE_NOTIFY_CHANGE_LAST_WRITE, FILE_NOTIFY_CHANGE_SIZE, FILE_NOTIFY_INFORMATION,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FIND_FIRST_EX_LARGE_FETCH,
    OPEN_EXISTING, WIN32_FIND_DATAW,
};
use windows_sys::Win32::System::Threading::{
    CreateEventW, ResetEvent, SetEvent, WaitForMultipleObjects, INFINITE,
};
use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};

use crate::drives::get_system_drives;
use crate::folder_analyzer::{
    is_junction_or_symlink, AnalyzeProgress, FolderAnalysisResult, FolderItem,
};
use crate::models::StartupSyncProgress;

const SNAPSHOT_MAGIC: &[u8; 8] = b"FWIPE02\0";

#[derive(Debug, Clone)]
pub struct FileEntry {
    pub name: String,
    pub size_bytes: u64,
    pub last_modified: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct DirNode {
    pub path: String,
    pub name: String,
    pub parent_key: Option<String>,
    pub direct_bytes: u64,
    pub direct_files: u64,
    pub total_bytes: u64,
    pub total_files: u64,
    pub total_subfolders: u64,
    pub last_modified: Option<u64>,
    pub is_junction: bool,
    pub is_access_denied: bool,
    pub child_dirs: HashSet<String>,
    pub direct_file_entries: HashMap<String, FileEntry>,
}

impl DirNode {
    fn new(
        path: String,
        name: String,
        parent_key: Option<String>,
        last_modified: Option<u64>,
        is_junction: bool,
        is_access_denied: bool,
    ) -> Self {
        Self {
            path,
            name,
            parent_key,
            direct_bytes: 0,
            direct_files: 0,
            total_bytes: 0,
            total_files: 0,
            total_subfolders: 0,
            last_modified,
            is_junction,
            is_access_denied,
            child_dirs: HashSet::new(),
            direct_file_entries: HashMap::new(),
        }
    }
}

pub struct DriveIndex {
    pub drive_root: String,
    pub root_key: String,
    pub volume_serial: u32,
    pub nodes: HashMap<String, DirNode>,
    pub revision: u64,
    pub indexed_at_ms: u64,
    pub last_updated_ms: u64,
    pub is_watching: bool,
    pub is_syncing: bool,
    pub from_cache: bool,
    pub last_sync_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriveIndexStatus {
    pub drive_root: String,
    pub is_indexed: bool,
    pub is_watching: bool,
    pub is_syncing: bool,
    pub total_bytes: u64,
    pub total_files: u64,
    pub total_folders: u64,
    pub last_updated_ms: u64,
    pub revision: u64,
    pub from_cache: bool,
    pub last_sync_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreeUpdateEvent {
    pub drive_root: String,
    pub revision: u64,
    pub total_bytes: u64,
    pub total_files: u64,
    pub total_folders: u64,
    pub changed_paths: Vec<String>,
    pub changes_applied: u64,
    pub byte_delta: i64,
    pub sync_mode: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiskVerificationReport {
    pub drive_root: String,
    pub disk_total_bytes: u64,
    pub disk_used_bytes: u64,
    pub disk_free_bytes: u64,
    pub scanned_bytes_before: u64,
    pub scanned_bytes_after: u64,
    pub difference_bytes: i64,
    pub abs_difference_bytes: u64,
    pub match_percentage: f64,
    pub tolerance_bytes: u64,
    pub matched_before: bool,
    pub matched_after: bool,
    pub recalculated: bool,
    pub access_denied_folders: u64,
    pub junction_folders: u64,
    pub duration_ms: u64,
    pub summary: String,
    pub analysis_result: FolderAnalysisResult,
}

#[derive(Debug, Clone, Copy)]
pub struct DiskSizeMatchCheck {
    pub matched: bool,
    pub difference_bytes: i64,
    pub abs_difference_bytes: u64,
    pub match_percentage: f64,
    pub tolerance_bytes: u64,
}

/// Evaluates whether the scanned index size reasonably matches OS-reported disk used space.
/// Tolerance is 1.5% of OS used bytes clamped to [128 MB, 1.5 GB] to absorb normal NTFS metadata
/// ($MFT/$LogFile) while reliably catching missing, stale, or corrupted folder totals.
pub fn evaluate_disk_size_match(
    disk_total_bytes: u64,
    disk_used_bytes: u64,
    scanned_bytes: u64,
) -> DiskSizeMatchCheck {
    let difference_bytes = scanned_bytes as i64 - disk_used_bytes as i64;
    let abs_difference_bytes = difference_bytes.unsigned_abs();
    let pct_tol = (disk_used_bytes as f64 * 0.015) as u64;
    let tolerance_bytes = pct_tol.clamp(128 * 1024 * 1024, 1536 * 1024 * 1024);

    let match_percentage = if disk_used_bytes > 0 {
        ((scanned_bytes as f64 / disk_used_bytes as f64) * 1000.0).round() / 10.0
    } else if scanned_bytes == 0 {
        100.0
    } else {
        0.0
    };

    let exceeds_disk_capacity = disk_total_bytes > 0 && scanned_bytes > disk_total_bytes;
    let matched = if disk_used_bytes == 0 {
        scanned_bytes == 0
    } else {
        !exceeds_disk_capacity && abs_difference_bytes <= tolerance_bytes
    };

    DiskSizeMatchCheck {
        matched,
        difference_bytes,
        abs_difference_bytes,
        match_percentage,
        tolerance_bytes,
    }
}

#[derive(Debug, Clone, Default)]
pub struct ReconcileStats {
    pub changes_applied: u64,
    pub byte_delta: i64,
    pub changed_ancestors: HashSet<String>,
}

struct WatcherControl {
    stop_flag: Arc<AtomicBool>,
    stop_event: isize,
}

impl Drop for WatcherControl {
    fn drop(&mut self) {
        self.stop();
    }
}

impl WatcherControl {
    fn stop(&self) {
        self.stop_flag.store(true, Ordering::SeqCst);
        if self.stop_event != 0 {
            unsafe {
                SetEvent(self.stop_event as HANDLE);
            }
        }
    }
}

type InFlightWaiter = Arc<(Mutex<Option<Result<(), String>>>, Condvar)>;

#[derive(Clone)]
struct StartupEmitContext {
    current_drive: String,
    current_index: usize,
    total_drives: usize,
    completed_drives: Vec<String>,
    stage: String,
}

pub struct DiskIndexManager {
    drives: Arc<RwLock<HashMap<String, Arc<RwLock<DriveIndex>>>>>,
    watchers: Arc<Mutex<HashMap<String, WatcherControl>>>,
    in_flight: Arc<Mutex<HashMap<String, InFlightWaiter>>>,
    startup_ctx: Arc<RwLock<Option<StartupEmitContext>>>,
    snapshot_dirty: Arc<Mutex<HashMap<String, Instant>>>,
    auto_recalculated_drives: Arc<Mutex<HashSet<String>>>,
    startup_sync_running: Arc<AtomicBool>,
    startup_sync_done: Arc<AtomicBool>,
}

impl Default for DiskIndexManager {
    fn default() -> Self {
        Self::new()
    }
}

impl DiskIndexManager {
    pub fn new() -> Self {
        Self {
            drives: Arc::new(RwLock::new(HashMap::new())),
            watchers: Arc::new(Mutex::new(HashMap::new())),
            in_flight: Arc::new(Mutex::new(HashMap::new())),
            startup_ctx: Arc::new(RwLock::new(None)),
            snapshot_dirty: Arc::new(Mutex::new(HashMap::new())),
            auto_recalculated_drives: Arc::new(Mutex::new(HashSet::new())),
            startup_sync_running: Arc::new(AtomicBool::new(false)),
            startup_sync_done: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Instant O(1) folder size lookup from the live per-drive index if that drive is indexed.
    pub fn get_path_size_fast(&self, path: &Path) -> Option<u64> {
        let path_str = path.to_string_lossy();
        let (_, drive_key) = extract_drive_root(&path_str)?;
        let drive_arc = self.get_drive_index(&drive_key)?;
        let idx = drive_arc.read().ok()?;
        let norm = normalize_path_key(&path_str);
        if let Some(node) = idx.nodes.get(&norm) {
            return Some(node.total_bytes);
        }
        // Check if it's a direct file inside a cached parent directory
        let parent = path.parent()?;
        let fname = path.file_name()?.to_string_lossy().to_uppercase();
        let parent_norm = normalize_path_key(&parent.to_string_lossy());
        idx.nodes
            .get(&parent_norm)?
            .direct_file_entries
            .get(&fname)
            .map(|f| f.size_bytes)
    }

    /// Sequentially syncs ALL local mounted drives one-by-one on first app start.
    /// Uses persisted snapshots + smart delta sync when available, or fast parallel full indexing
    /// on first-ever launch, and arms real-time watchers on every drive.
    pub fn start_initial_sync_all_drives(self: &Arc<Self>, app: AppHandle, force: bool) -> bool {
        if !force && self.startup_sync_done.load(Ordering::SeqCst) {
            return false;
        }
        if self
            .startup_sync_running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return false;
        }

        let mgr = Arc::clone(self);
        thread::spawn(move || {
            let mut local_drives: Vec<String> = get_system_drives()
                .into_iter()
                .filter(|d| !d.drive_type.contains("CD") && !d.drive_type.contains("Network"))
                .map(|d| d.mount_point)
                .collect();

            // Prioritize C:\ first, then D:\, E:\, etc.
            local_drives.sort_by(|a, b| {
                let a_c = a.to_uppercase().starts_with("C:");
                let b_c = b.to_uppercase().starts_with("C:");
                b_c.cmp(&a_c).then_with(|| a.cmp(b))
            });

            let total_drives = local_drives.len();
            let mut completed_drives = Vec::new();

            for (idx_num, mount) in local_drives.iter().enumerate() {
                let (_, drive_key) = match extract_drive_root(mount) {
                    Some(v) => v,
                    None => continue,
                };

                let has_snapshot = snapshot_path_for_drive(&drive_key)
                    .map(|p| p.is_file())
                    .unwrap_or(false);

                let stage = if has_snapshot && !force {
                    "delta_sync"
                } else {
                    "indexing"
                };

                if let Ok(mut ctx) = mgr.startup_ctx.write() {
                    *ctx = Some(StartupEmitContext {
                        current_drive: mount.clone(),
                        current_index: idx_num + 1,
                        total_drives,
                        completed_drives: completed_drives.clone(),
                        stage: stage.to_string(),
                    });
                }

                let _ = app.emit(
                    "startup:sync-progress",
                    StartupSyncProgress {
                        is_active: true,
                        current_drive: mount.clone(),
                        current_index: idx_num + 1,
                        total_drives,
                        completed_drives: completed_drives.clone(),
                        stage: stage.to_string(),
                        message: if has_snapshot && !force {
                            format!("Syncing {} ({}/{}) from snapshot...", mount, idx_num + 1, total_drives)
                        } else {
                            format!("Indexing {} ({}/{})...", mount, idx_num + 1, total_drives)
                        },
                        items_per_sec: 0,
                        folders_scanned: 0,
                        files_scanned: 0,
                        bytes_scanned: 0,
                    },
                );

                // Sync one drive completely before moving to the next (never cancelled!)
                if mgr.ensure_drive_and_get_view(mount, force, app.clone()).is_ok() {
                    completed_drives.push(mount.clone());
                }
            }

            if let Ok(mut ctx) = mgr.startup_ctx.write() {
                *ctx = None;
            }
            mgr.startup_sync_done.store(true, Ordering::SeqCst);
            mgr.startup_sync_running.store(false, Ordering::SeqCst);

            let _ = app.emit(
                "startup:sync-progress",
                StartupSyncProgress {
                    is_active: false,
                    current_drive: String::new(),
                    current_index: total_drives,
                    total_drives,
                    completed_drives: completed_drives.clone(),
                    stage: "done".to_string(),
                    message: format!(
                        "All {} drive{} synced & live watching",
                        completed_drives.len(),
                        if completed_drives.len() == 1 { "" } else { "s" }
                    ),
                    items_per_sec: 0,
                    folders_scanned: 0,
                    files_scanned: 0,
                    bytes_scanned: 0,
                },
            );
        });

        true
    }

    /// Disk syncs are intentionally unstoppable so switching drives or UI actions never break indexing.
    pub fn cancel_all_scans(&self) {}

    /// Acquires the per-drive in-flight slot.
    /// Returns `Ok(waiter)` if THIS caller owns the scan and must run + signal it.
    /// Returns `Err(existing_waiter)` if ANOTHER thread is already scanning this drive (caller should wait on it!).
    fn acquire_or_join_scan(&self, drive_key: &str) -> Result<InFlightWaiter, InFlightWaiter> {
        let mut map = self.in_flight.lock().unwrap();
        if let Some(existing) = map.get(drive_key) {
            return Err(Arc::clone(existing));
        }
        let waiter: InFlightWaiter = Arc::new((Mutex::new(None), Condvar::new()));
        map.insert(drive_key.to_string(), Arc::clone(&waiter));
        Ok(waiter)
    }

    fn finish_scan(&self, drive_key: &str, waiter: &InFlightWaiter, outcome: Result<(), String>) {
        if let Ok(mut map) = self.in_flight.lock() {
            if let Some(cur) = map.get(drive_key) {
                if Arc::ptr_eq(cur, waiter) {
                    map.remove(drive_key);
                }
            }
        }
        let (lock, cvar) = &**waiter;
        if let Ok(mut guard) = lock.lock() {
            *guard = Some(outcome);
            cvar.notify_all();
        }
    }

    fn wait_for_in_flight(waiter: &InFlightWaiter) -> Result<(), String> {
        let (lock, cvar) = &**waiter;
        let mut guard = lock.lock().map_err(|_| "Waiter lock poisoned".to_string())?;
        while guard.is_none() {
            guard = cvar
                .wait(guard)
                .map_err(|_| "Waiter condvar poisoned".to_string())?;
        }
        guard.clone().unwrap_or(Ok(()))
    }

    pub fn get_drive_index(&self, drive_key: &str) -> Option<Arc<RwLock<DriveIndex>>> {
        self.drives
            .read()
            .ok()
            .and_then(|map| map.get(drive_key).cloned())
    }

    pub fn insert_drive_index(&self, index: DriveIndex) -> Arc<RwLock<DriveIndex>> {
        let key = index.root_key.clone();
        let arc = Arc::new(RwLock::new(index));
        if let Ok(mut map) = self.drives.write() {
            map.insert(key, Arc::clone(&arc));
        }
        arc
    }

    /// Returns status of all indexed drives currently in memory.
    pub fn list_statuses(&self) -> Vec<DriveIndexStatus> {
        let mut out = Vec::new();
        if let Ok(map) = self.drives.read() {
            for drive_arc in map.values() {
                if let Ok(idx) = drive_arc.read() {
                    let (tb, tf, td) = idx.root_totals();
                    out.push(DriveIndexStatus {
                        drive_root: idx.drive_root.clone(),
                        is_indexed: true,
                        is_watching: idx.is_watching,
                        is_syncing: idx.is_syncing,
                        total_bytes: tb,
                        total_files: tf,
                        total_folders: td,
                        last_updated_ms: idx.last_updated_ms,
                        revision: idx.revision,
                        from_cache: idx.from_cache,
                        last_sync_summary: idx.last_sync_summary.clone(),
                    });
                }
            }
        }
        out.sort_by(|a, b| a.drive_root.cmp(&b.drive_root));
        out
    }

    /// Queries an already-indexed path in memory (O(children), < 1ms).
    pub fn get_view_for_path(
        &self,
        path_str: &str,
        depth: usize,
    ) -> Option<FolderAnalysisResult> {
        let (_, drive_key) = extract_drive_root(path_str)?;
        let drive_arc = self.get_drive_index(&drive_key)?;
        let idx = drive_arc.read().ok()?;
        idx.build_analysis_result(path_str, depth, 0)
    }

    /// Queries immediate children of a folder from its drive's live index (< 1ms).
    pub fn get_children_for_path(&self, path_str: &str, depth: usize) -> Option<Vec<FolderItem>> {
        let (_, drive_key) = extract_drive_root(path_str)?;
        let drive_arc = self.get_drive_index(&drive_key)?;
        let idx = drive_arc.read().ok()?;
        idx.build_children_items(path_str, depth)
    }

    /// Queries deepest/largest folders across ALL depths in memory (< 5ms).
    pub fn query_deep_largest_folders(
        &self,
        target_path: &str,
        min_size_bytes: u64,
        top_n: usize,
    ) -> Option<Vec<FolderItem>> {
        let (_, drive_key) = extract_drive_root(target_path)?;
        let drive_arc = self.get_drive_index(&drive_key)?;
        let idx = drive_arc.read().ok()?;
        Some(idx.query_largest_folders(target_path, min_size_bytes, top_n))
    }

    /// Smart entry point for opening any path or switching drives:
    /// 1. If the drive is ALREADY in memory -> return instantly (0 recalculation, live watcher keeps it fresh!).
    /// 2. Else if a valid persistent snapshot exists on disk -> load instantly (< 100ms),
    ///    attach live `ReadDirectoryChangesW` watcher FIRST, then kick off a non-blocking
    ///    background Smart Delta Sync that ONLY updates what changed since last visit!
    /// 3. Else -> run full parallel disk indexing, attach live watcher, and persist snapshot!
    pub fn ensure_drive_and_get_view(
        self: &Arc<Self>,
        target_path: &str,
        force_full_reindex: bool,
        app: AppHandle,
    ) -> Result<FolderAnalysisResult, String> {
        let (drive_root, drive_key) = extract_drive_root(target_path)
            .ok_or_else(|| format!("Invalid Windows drive path: {}", target_path))?;

        let target_pb = PathBuf::from(target_path);
        if !target_pb.exists() {
            return Err(format!("Path does not exist: {}", target_path));
        }

        // Case 1: Already indexed in memory and not forcing a full reindex
        if !force_full_reindex {
            if let Some(drive_arc) = self.get_drive_index(&drive_key) {
                self.ensure_watcher_running(&drive_root, &drive_key, &drive_arc, app.clone());
                if let Ok(idx) = drive_arc.read() {
                    if let Some(res) = idx.build_analysis_result(target_path, 0, 0) {
                        return Ok(res);
                    }
                }
                // Path might have been just created right before watcher flushed; reconcile just this path!
                self.reconcile_paths_now(&[target_pb.clone()], "realtime", &app);
                if let Ok(idx) = drive_arc.read() {
                    if let Some(res) = idx.build_analysis_result(target_path, 0, 0) {
                        return Ok(res);
                    }
                }
            }
        }

        // Case 2: Try loading persisted snapshot from disk (cold revisit!)
        if !force_full_reindex {
            let current_serial = get_volume_serial(&drive_root);
            if let Some(mut cached_idx) = load_drive_snapshot(&drive_key, current_serial) {
                let start = Instant::now();
                cached_idx.from_cache = true;
                cached_idx.is_syncing = true;
                cached_idx.last_sync_summary =
                    Some("Loaded cached index — checking for changes...".to_string());

                let drive_arc = self.insert_drive_index(cached_idx);

                // Start live watcher BEFORE delta sync so zero changes are missed during sync!
                self.ensure_watcher_running(&drive_root, &drive_key, &drive_arc, app.clone());

                // Spawn background smart delta sync (only reconciles what actually changed!)
                let mgr = Arc::clone(self);
                let sync_root = drive_root.clone();
                let sync_key = drive_key.clone();
                let sync_arc = Arc::clone(&drive_arc);
                let app_bg = app.clone();
                thread::spawn(move || {
                    mgr.run_smart_delta_sync(&sync_root, &sync_key, &sync_arc, &app_bg);
                });

                let elapsed = start.elapsed().as_millis() as u64;
                let cached_res = drive_arc
                    .read()
                    .ok()
                    .and_then(|idx| idx.build_analysis_result(target_path, 0, elapsed));
                if let Some(res) = cached_res {
                    return Ok(res);
                }
            }
        }

        // Case 3: Unstoppable, joinable full parallel native Win32 disk index
        match self.acquire_or_join_scan(&drive_key) {
            Err(existing_waiter) => {
                // Another thread (e.g., startup sync) is ALREADY scanning this drive —
                // NEVER cancel it! Wait cleanly for it to finish, then return the fresh view.
                Self::wait_for_in_flight(&existing_waiter)?;
                if let Some(drive_arc) = self.get_drive_index(&drive_key) {
                    self.ensure_watcher_running(&drive_root, &drive_key, &drive_arc, app);
                    let idx = drive_arc
                        .read()
                        .map_err(|_| "Index lock poisoned".to_string())?;
                    return idx
                        .build_analysis_result(target_path, 0, 0)
                        .ok_or_else(|| format!("Path not found in disk index: {}", target_path));
                }
                return Err(format!("Drive index unavailable for {}", drive_root));
            }
            Ok(my_waiter) => {
                // Double-check if another thread completed just before we acquired the slot
                if !force_full_reindex {
                    if let Some(drive_arc) = self.get_drive_index(&drive_key) {
                        self.finish_scan(&drive_key, &my_waiter, Ok(()));
                        self.ensure_watcher_running(
                            &drive_root,
                            &drive_key,
                            &drive_arc,
                            app.clone(),
                        );
                        let idx = drive_arc
                            .read()
                            .map_err(|_| "Index lock poisoned".to_string())?;
                        if let Some(res) = idx.build_analysis_result(target_path, 0, 0) {
                            return Ok(res);
                        }
                    }
                }

                let start = Instant::now();
                let startup_ctx_opt = self.startup_ctx.read().ok().and_then(|g| g.clone());
                let built = build_full_drive_index_native(
                    &drive_root,
                    &app,
                    startup_ctx_opt.as_ref(),
                );

                match built {
                    Err(err) => {
                        self.finish_scan(&drive_key, &my_waiter, Err(err.clone()));
                        return Err(err);
                    }
                    Ok(mut new_index) => {
                        new_index.from_cache = false;
                        new_index.last_sync_summary =
                            Some("Full disk indexed • Live sync active".to_string());

                        let drive_arc = self.insert_drive_index(new_index);
                        self.ensure_watcher_running(
                            &drive_root,
                            &drive_key,
                            &drive_arc,
                            app.clone(),
                        );

                        // Wake any waiting callers immediately
                        self.finish_scan(&drive_key, &my_waiter, Ok(()));

                        // Persist snapshot in background (serializes in memory briefly, writes to disk with ZERO locks held!)
                        let snap_arc = Arc::clone(&drive_arc);
                        thread::spawn(move || {
                            let _ = save_drive_snapshot_nonblocking(&snap_arc);
                        });

                        let elapsed = start.elapsed().as_millis() as u64;
                        let result = {
                            let idx = drive_arc
                                .read()
                                .map_err(|_| "Index lock poisoned".to_string())?;
                            idx.build_analysis_result(target_path, 0, elapsed).ok_or_else(|| {
                                format!("Path not found in disk index: {}", target_path)
                            })?
                        };

                        if let Ok(idx) = drive_arc.read() {
                            let (tb, tf, td) = idx.root_totals();
                            let _ = app.emit(
                                "analyzer:tree-updated",
                                TreeUpdateEvent {
                                    drive_root: idx.drive_root.clone(),
                                    revision: idx.revision,
                                    total_bytes: tb,
                                    total_files: tf,
                                    total_folders: td,
                                    changed_paths: vec![idx.drive_root.clone()],
                                    changes_applied: 0,
                                    byte_delta: 0,
                                    sync_mode: "full_index".to_string(),
                                    summary: "Full disk indexed".to_string(),
                                },
                            );
                        }

                        Ok(result)
                    }
                }
            }
        }
    }

    /// Smart incremental sync on a specific folder or entire drive:
    /// Compares live filesystem entries against the cached `DriveIndex` and ONLY updates
    /// what was added, deleted, or modified — never recalculating unchanged folders!
    pub fn smart_sync_path(
        self: &Arc<Self>,
        target_path: &str,
        app: AppHandle,
    ) -> Result<FolderAnalysisResult, String> {
        let (drive_root, drive_key) = extract_drive_root(target_path)
            .ok_or_else(|| format!("Invalid Windows path: {}", target_path))?;

        let drive_arc = match self.get_drive_index(&drive_key) {
            Some(arc) => arc,
            None => return self.ensure_drive_and_get_view(target_path, false, app),
        };

        let start = Instant::now();
        self.run_smart_delta_sync(target_path, &drive_key, &drive_arc, &app);
        self.ensure_watcher_running(&drive_root, &drive_key, &drive_arc, app);

        let elapsed = start.elapsed().as_millis() as u64;
        let idx = drive_arc
            .read()
            .map_err(|_| "Index lock poisoned".to_string())?;
        idx.build_analysis_result(target_path, 0, elapsed)
            .ok_or_else(|| format!("Path no longer exists: {}", target_path))
    }

    /// Compares the drive's OS-reported full & used size (live from `GetDiskFreeSpaceExW`)
    /// against the scanned index size. If they do not match (or if `force_recalculate` is true),
    /// performs a complete fresh whole-disk recalculation and re-verifies the result.
    pub fn verify_and_recalculate_disk(
        self: &Arc<Self>,
        target_path: &str,
        force_recalculate: bool,
        app: AppHandle,
    ) -> Result<DiskVerificationReport, String> {
        let start = Instant::now();
        let (drive_root, drive_key) = extract_drive_root(target_path)
            .ok_or_else(|| format!("Invalid Windows drive path: {}", target_path))?;

        // 1. Query fresh OS disk capacity & used space via GetDiskFreeSpaceExW
        let fresh_drives_before = get_system_drives();
        let _ = app.emit("drives:updated", &fresh_drives_before);
        let drive_info_before = fresh_drives_before
            .iter()
            .find(|d| d.mount_point.eq_ignore_ascii_case(&drive_root));

        let (disk_total_before, disk_used_before, disk_free_before) = match drive_info_before {
            Some(d) => (d.total_bytes, d.used_bytes, d.available_bytes),
            None => (0, 0, 0),
        };

        // 2. Read current scanned size (0 if not indexed yet)
        let (was_indexed, scanned_bytes_before) = match self.get_drive_index(&drive_key) {
            Some(arc) => {
                let bytes = arc.read().map(|idx| idx.root_totals().0).unwrap_or(0);
                (true, bytes)
            }
            None => (false, 0),
        };

        let check_before =
            evaluate_disk_size_match(disk_total_before, disk_used_before, scanned_bytes_before);
        let matched_before = was_indexed && check_before.matched;

        // Mark this drive as verified in this session so background delta sync won't duplicate work
        if let Ok(mut set) = self.auto_recalculated_drives.lock() {
            set.insert(drive_key.clone());
        }

        // 3. Recalculate whole disk if forced, not yet indexed, or size does NOT match OS used space
        let recalculated = force_recalculate || !matched_before;
        if recalculated {
            self.ensure_drive_and_get_view(&drive_root, true, app.clone())?;
        } else if let Some(drive_arc) = self.get_drive_index(&drive_key) {
            self.ensure_watcher_running(&drive_root, &drive_key, &drive_arc, app.clone());
        }

        // 4. Refresh OS disk stats right after scan so comparison uses live post-scan numbers
        let (disk_total_bytes, disk_used_bytes, disk_free_bytes) = if recalculated {
            let fresh_drives_after = get_system_drives();
            let _ = app.emit("drives:updated", &fresh_drives_after);
            fresh_drives_after
                .iter()
                .find(|d| d.mount_point.eq_ignore_ascii_case(&drive_root))
                .map(|d| (d.total_bytes, d.used_bytes, d.available_bytes))
                .unwrap_or((disk_total_before, disk_used_before, disk_free_before))
        } else {
            (disk_total_before, disk_used_before, disk_free_before)
        };

        // 5. Build final view & count protected/junction folders
        let drive_arc = self
            .get_drive_index(&drive_key)
            .ok_or_else(|| format!("Drive index unavailable for {}", drive_root))?;

        let elapsed = start.elapsed().as_millis() as u64;
        let (scanned_bytes_after, access_denied_folders, junction_folders, analysis_result) = {
            let idx = drive_arc
                .read()
                .map_err(|_| "Index lock poisoned".to_string())?;
            let (tb, _, _) = idx.root_totals();
            let mut denied = 0u64;
            let mut junctions = 0u64;
            for node in idx.nodes.values() {
                if node.is_access_denied {
                    denied += 1;
                }
                if node.is_junction {
                    junctions += 1;
                }
            }
            let view = idx
                .build_analysis_result(target_path, 0, elapsed)
                .or_else(|| idx.build_analysis_result(&drive_root, 0, elapsed))
                .ok_or_else(|| format!("Unable to build view for {}", target_path))?;
            (tb, denied, junctions, view)
        };

        let check_after =
            evaluate_disk_size_match(disk_total_bytes, disk_used_bytes, scanned_bytes_after);

        let summary = if !recalculated && check_after.matched {
            format!(
                "Verified: Scanned size ({}) matches OS disk used space ({} • {:.1}%) — no recalculation needed",
                format_bytes_short(scanned_bytes_after),
                format_bytes_short(disk_used_bytes),
                check_after.match_percentage
            )
        } else if recalculated && check_after.matched {
            format!(
                "Recalculated {} — scanned size ({}) now matches OS used space ({} • {:.1}%)",
                drive_root,
                format_bytes_short(scanned_bytes_after),
                format_bytes_short(disk_used_bytes),
                check_after.match_percentage
            )
        } else if check_after.difference_bytes < 0 {
            format!(
                "Recalculated {} — {} unaccounted vs OS used space (likely {} protected system folder{}, Volume Shadow Copies, or NTFS metadata)",
                drive_root,
                format_bytes_short(check_after.abs_difference_bytes),
                access_denied_folders,
                if access_denied_folders == 1 { "" } else { "s" }
            )
        } else {
            format!(
                "Recalculated {} — scanned size is {} above OS used space due to NTFS hardlinks or file compression (e.g. Windows\\WinSxS)",
                drive_root,
                format_bytes_short(check_after.abs_difference_bytes)
            )
        };

        Ok(DiskVerificationReport {
            drive_root,
            disk_total_bytes,
            disk_used_bytes,
            disk_free_bytes,
            scanned_bytes_before,
            scanned_bytes_after,
            difference_bytes: check_after.difference_bytes,
            abs_difference_bytes: check_after.abs_difference_bytes,
            match_percentage: check_after.match_percentage,
            tolerance_bytes: check_after.tolerance_bytes,
            matched_before,
            matched_after: check_after.matched,
            recalculated,
            access_denied_folders,
            junction_folders,
            duration_ms: elapsed,
            summary,
            analysis_result,
        })
    }

    /// Immediately reconciles specific paths (e.g., right after Ferrowipe deletes folders or cleans junk).
    pub fn reconcile_paths_now(
        &self,
        paths: &[PathBuf],
        sync_mode: &str,
        app: &AppHandle,
    ) {
        let mut by_drive: HashMap<String, Vec<PathBuf>> = HashMap::new();
        for p in paths {
            if let Some((_, drive_key)) = extract_drive_root(&p.to_string_lossy()) {
                by_drive.entry(drive_key).or_default().push(p.clone());
            }
        }

        for (drive_key, drive_paths) in by_drive {
            if let Some(drive_arc) = self.get_drive_index(&drive_key) {
                let event_opt = {
                    if let Ok(mut idx) = drive_arc.write() {
                        let stats = idx.reconcile_changed_paths(&drive_paths);
                        if stats.changes_applied > 0 {
                            idx.revision += 1;
                            idx.last_updated_ms = now_ms();
                            let summary = format_delta_summary(stats.changes_applied, stats.byte_delta);
                            idx.last_sync_summary = Some(summary.clone());
                            let (tb, tf, td) = idx.root_totals();
                            let changed_paths: Vec<String> = stats
                                .changed_ancestors
                                .into_iter()
                                .take(64)
                                .map(|k| idx.display_path_for_key(&k))
                                .collect();
                            Some(TreeUpdateEvent {
                                drive_root: idx.drive_root.clone(),
                                revision: idx.revision,
                                total_bytes: tb,
                                total_files: tf,
                                total_folders: td,
                                changed_paths,
                                changes_applied: stats.changes_applied,
                                byte_delta: stats.byte_delta,
                                sync_mode: sync_mode.to_string(),
                                summary,
                            })
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                };

                if let Some(evt) = event_opt {
                    let _ = app.emit("analyzer:tree-updated", &evt);
                    self.mark_snapshot_dirty(&drive_key, &drive_arc);
                }
            }
        }
    }

    /// Parallel Smart Delta Sync:
    /// 1. Briefly clones lightweight cached directory signatures (zero long write lock).
    /// 2. Walks `sync_root` in parallel comparing live entries against cached signatures.
    /// 3. Applies ONLY detected adds/deletes/modifications under a brief write lock and bubbles deltas up!
    fn run_smart_delta_sync(
        self: &Arc<Self>,
        sync_root: &str,
        drive_key: &str,
        drive_arc: &Arc<RwLock<DriveIndex>>,
        app: &AppHandle,
    ) {
        let sync_norm = normalize_path_key(sync_root);
        let is_full_drive = sync_norm == drive_key;

        if let Ok(mut idx) = drive_arc.write() {
            idx.is_syncing = true;
        }

        // Snapshot lightweight signatures for all cached directories under sync_norm
        let cached_sigs: HashMap<String, CachedDirSig> = {
            match drive_arc.read() {
                Ok(idx) => {
                    let prefix = format!("{}\\", sync_norm);
                    idx.nodes
                        .iter()
                        .filter(|(k, _)| {
                            is_full_drive || *k == &sync_norm || k.starts_with(&prefix)
                        })
                        .map(|(k, node)| {
                            let files = node
                                .direct_file_entries
                                .iter()
                                .map(|(fn_key, fe)| (fn_key.clone(), (fe.size_bytes, fe.last_modified)))
                                .collect();
                            (
                                k.clone(),
                                CachedDirSig {
                                    path: node.path.clone(),
                                    is_junction: node.is_junction,
                                    child_dirs: node.child_dirs.clone(),
                                    files,
                                },
                            )
                        })
                        .collect()
                }
                Err(_) => HashMap::new(),
            }
        };

        let changed_paths: Arc<Mutex<HashSet<PathBuf>>> = Arc::new(Mutex::new(HashSet::new()));
        let root_pb = PathBuf::from(sync_root);

        if root_pb.exists() {
            // Walk cached directories in parallel (rayon) checking ONLY for actual differences
            let sig_entries: Vec<(String, CachedDirSig)> = cached_sigs.into_iter().collect();
            let changed_clone = Arc::clone(&changed_paths);

            sig_entries.into_par_iter().for_each(|(_dir_key, sig)| {
                if sig.is_junction {
                    return;
                }
                let dir_pb = PathBuf::from(&sig.path);
                if !dir_pb.exists() {
                    if let Ok(mut set) = changed_clone.lock() {
                        set.insert(dir_pb);
                    }
                    return;
                }

                let Ok(entries) = fs::read_dir(&dir_pb) else {
                    return;
                };

                let mut seen_files: HashSet<String> = HashSet::with_capacity(sig.files.len());
                let mut seen_dirs: HashSet<String> = HashSet::with_capacity(sig.child_dirs.len());
                let mut local_changes: Vec<PathBuf> = Vec::new();

                for entry in entries.flatten() {
                    let p = entry.path();
                    let Ok(ft) = entry.file_type() else {
                        continue;
                    };

                    if ft.is_dir() {
                        let child_key = normalize_path_key(&p.to_string_lossy());
                        seen_dirs.insert(child_key.clone());
                        if !sig.child_dirs.contains(&child_key) {
                            // Brand new directory!
                            local_changes.push(p);
                        }
                    } else if ft.is_file() {
                        let fname = entry.file_name().to_string_lossy().to_uppercase();
                        seen_files.insert(fname.clone());
                        if let Ok(meta) = entry.metadata() {
                            let size = meta.len();
                            let mtime = metadata_mtime_secs(&meta);
                            match sig.files.get(&fname) {
                                Some(&(old_size, old_mtime))
                                    if old_size == size && old_mtime == mtime =>
                                {
                                    // Unchanged — skip completely!
                                }
                                _ => {
                                    local_changes.push(p);
                                }
                            }
                        }
                    }
                }

                // Check for deleted files
                for old_fname in sig.files.keys() {
                    if !seen_files.contains(old_fname) {
                        local_changes.push(dir_pb.join(old_fname));
                    }
                }

                // Check for deleted subdirectories
                for old_child_key in &sig.child_dirs {
                    if !seen_dirs.contains(old_child_key) {
                        local_changes.push(PathBuf::from(old_child_key));
                    }
                }

                if !local_changes.is_empty() {
                    if let Ok(mut set) = changed_clone.lock() {
                        for p in local_changes {
                            set.insert(p);
                        }
                    }
                }
            });
        } else if let Ok(mut set) = changed_paths.lock() {
            set.insert(root_pb);
        }

        let batch: Vec<PathBuf> = changed_paths
            .lock()
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default();

        let event_to_emit = {
            if let Ok(mut idx) = drive_arc.write() {
                let stats = if !batch.is_empty() {
                    idx.reconcile_changed_paths(&batch)
                } else {
                    ReconcileStats::default()
                };

                idx.is_syncing = false;
                idx.last_updated_ms = now_ms();
                if stats.changes_applied > 0 {
                    idx.revision += 1;
                    idx.from_cache = false;
                }

                let summary = if stats.changes_applied > 0 {
                    format!(
                        "Synced {} change{}",
                        stats.changes_applied,
                        if stats.changes_applied == 1 { "" } else { "s" }
                    )
                } else {
                    "Up to date (0 changes)".to_string()
                };
                idx.last_sync_summary = Some(summary.clone());

                let (tb, tf, td) = idx.root_totals();
                let changed_display: Vec<String> = stats
                    .changed_ancestors
                    .into_iter()
                    .take(64)
                    .map(|k| idx.display_path_for_key(&k))
                    .collect();

                Some(TreeUpdateEvent {
                    drive_root: idx.drive_root.clone(),
                    revision: idx.revision,
                    total_bytes: tb,
                    total_files: tf,
                    total_folders: td,
                    changed_paths: changed_display,
                    changes_applied: stats.changes_applied,
                    byte_delta: stats.byte_delta,
                    sync_mode: "delta_sync".to_string(),
                    summary,
                })
            } else {
                None
            }
        };

        if let Some(evt) = event_to_emit {
            let _ = app.emit("analyzer:tree-updated", &evt);
            if evt.changes_applied > 0 {
                self.mark_snapshot_dirty(drive_key, drive_arc);
                if evt.byte_delta != 0 {
                    let drives = get_system_drives();
                    let _ = app.emit("drives:updated", drives);
                }
            }

            // Automatic post-delta-sync size verification (at most once per drive per session):
            // Compare scanned root total vs OS-reported disk used space; if mismatched, recalculate whole disk!
            if is_full_drive {
                let should_check = self
                    .auto_recalculated_drives
                    .lock()
                    .map(|mut set| set.insert(drive_key.to_string()))
                    .unwrap_or(false);

                if should_check {
                    let drives = get_system_drives();
                    if let Some(d_info) = drives
                        .iter()
                        .find(|d| d.mount_point.eq_ignore_ascii_case(&evt.drive_root))
                    {
                        let check = evaluate_disk_size_match(
                            d_info.total_bytes,
                            d_info.used_bytes,
                            evt.total_bytes,
                        );
                        if !check.matched {
                            let _ = self.ensure_drive_and_get_view(
                                &evt.drive_root,
                                true,
                                app.clone(),
                            );
                            let refreshed = get_system_drives();
                            let _ = app.emit("drives:updated", refreshed);
                        }
                    }
                }
            }
        }
    }

    fn mark_snapshot_dirty(&self, drive_key: &str, drive_arc: &Arc<RwLock<DriveIndex>>) {
        let should_spawn = {
            if let Ok(mut dirty) = self.snapshot_dirty.lock() {
                let already_scheduled = dirty.contains_key(drive_key);
                dirty.insert(drive_key.to_string(), Instant::now());
                !already_scheduled
            } else {
                false
            }
        };

        if should_spawn {
            let dirty_map = Arc::clone(&self.snapshot_dirty);
            let key = drive_key.to_string();
            let arc = Arc::clone(drive_arc);
            thread::spawn(move || loop {
                thread::sleep(Duration::from_secs(4));
                let ready = {
                    if let Ok(mut map) = dirty_map.lock() {
                        if let Some(last_ts) = map.get(&key) {
                            if last_ts.elapsed() >= Duration::from_secs(4) {
                                map.remove(&key);
                                true
                            } else {
                                false
                            }
                        } else {
                            return;
                        }
                    } else {
                        return;
                    }
                };
                if ready {
                    let _ = save_drive_snapshot_nonblocking(&arc);
                    return;
                }
            });
        }
    }

    /// Starts a live recursive Windows `ReadDirectoryChangesW` watcher for `drive_root`
    /// if one is not already running.
    fn ensure_watcher_running(
        self: &Arc<Self>,
        drive_root: &str,
        drive_key: &str,
        drive_arc: &Arc<RwLock<DriveIndex>>,
        app: AppHandle,
    ) {
        {
            if let Ok(watchers) = self.watchers.lock() {
                if watchers.contains_key(drive_key) {
                    if let Ok(mut idx) = drive_arc.write() {
                        idx.is_watching = true;
                    }
                    return;
                }
            }
        }

        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_event = unsafe { CreateEventW(null_mut(), 1, 0, null_mut()) };
        if stop_event.is_null() {
            return;
        }

        let control = WatcherControl {
            stop_flag: Arc::clone(&stop_flag),
            stop_event: stop_event as isize,
        };

        if let Ok(mut watchers) = self.watchers.lock() {
            if watchers.contains_key(drive_key) {
                drop(control);
                return;
            }
            watchers.insert(drive_key.to_string(), control);
        }

        if let Ok(mut idx) = drive_arc.write() {
            idx.is_watching = true;
        }

        let (tx, rx) = mpsc::channel::<WatchMsg>();

        // 1. Spawn Windows ReadDirectoryChangesW producer thread
        let watch_root = drive_root.to_string();
        let stop_flag_prod = Arc::clone(&stop_flag);
        let stop_event_raw = stop_event as isize;
        let cache_dir_norm = snapshot_cache_dir()
            .map(|p| normalize_path_key(&p.to_string_lossy()))
            .unwrap_or_default();

        thread::spawn(move || {
            run_windows_directory_watcher(
                &watch_root,
                &cache_dir_norm,
                stop_flag_prod,
                stop_event_raw,
                tx,
            );
        });

        // 2. Spawn Debounced Real-Time Delta Applicator thread
        let mgr = Arc::clone(self);
        let d_root = drive_root.to_string();
        let d_key = drive_key.to_string();
        let stop_flag_cons = Arc::clone(&stop_flag);

        thread::spawn(move || {
            let mut pending_paths: HashSet<PathBuf> = HashSet::new();
            let mut needs_overflow_sync = false;
            let mut batch_started: Option<Instant> = None;
            let mut last_drive_refresh = Instant::now();

            loop {
                if stop_flag_cons.load(Ordering::Relaxed) {
                    break;
                }

                let timeout = if batch_started.is_some() {
                    Duration::from_millis(320)
                } else {
                    Duration::from_secs(2)
                };

                match rx.recv_timeout(timeout) {
                    Ok(WatchMsg::Changed(path)) => {
                        if batch_started.is_none() {
                            batch_started = Some(Instant::now());
                        }
                        pending_paths.insert(path);

                        // Drain immediately available burst events
                        while let Ok(msg) = rx.try_recv() {
                            match msg {
                                WatchMsg::Changed(p) => {
                                    pending_paths.insert(p);
                                }
                                WatchMsg::Overflow => {
                                    needs_overflow_sync = true;
                                }
                            }
                            if pending_paths.len() >= 2000 {
                                break;
                            }
                        }

                        // Flush if batch has been accumulating for > 900ms under heavy write load
                        let force_flush = batch_started
                            .map(|t| t.elapsed() >= Duration::from_millis(900))
                            .unwrap_or(false)
                            || pending_paths.len() >= 2000;

                        if !force_flush {
                            continue;
                        }
                    }
                    Ok(WatchMsg::Overflow) => {
                        needs_overflow_sync = true;
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        if pending_paths.is_empty() && !needs_overflow_sync {
                            continue;
                        }
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        break;
                    }
                }

                // Flush accumulated changes against the CURRENT live DriveIndex (survives full reindex!)
                batch_started = None;

                let Some(d_arc) = mgr.get_drive_index(&d_key) else {
                    pending_paths.clear();
                    needs_overflow_sync = false;
                    continue;
                };

                if needs_overflow_sync {
                    needs_overflow_sync = false;
                    pending_paths.clear();
                    mgr.run_smart_delta_sync(&d_root, &d_key, &d_arc, &app);
                    continue;
                }

                if pending_paths.is_empty() {
                    continue;
                }

                let batch: Vec<PathBuf> = pending_paths.drain().collect();
                let event_opt = {
                    if let Ok(mut idx) = d_arc.write() {
                        let stats = idx.reconcile_changed_paths(&batch);
                        if stats.changes_applied > 0 {
                            idx.revision += 1;
                            idx.last_updated_ms = now_ms();
                            let summary = format_delta_summary(stats.changes_applied, stats.byte_delta);
                            idx.last_sync_summary = Some(summary.clone());
                            let (tb, tf, td) = idx.root_totals();
                            let changed_display: Vec<String> = stats
                                .changed_ancestors
                                .into_iter()
                                .take(64)
                                .map(|k| idx.display_path_for_key(&k))
                                .collect();
                            Some(TreeUpdateEvent {
                                drive_root: idx.drive_root.clone(),
                                revision: idx.revision,
                                total_bytes: tb,
                                total_files: tf,
                                total_folders: td,
                                changed_paths: changed_display,
                                changes_applied: stats.changes_applied,
                                byte_delta: stats.byte_delta,
                                sync_mode: "realtime".to_string(),
                                summary,
                            })
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                };

                if let Some(evt) = event_opt {
                    let _ = app.emit("analyzer:tree-updated", &evt);
                    mgr.mark_snapshot_dirty(&d_key, &d_arc);

                    if evt.byte_delta.abs() >= 1_048_576
                        && last_drive_refresh.elapsed() >= Duration::from_secs(5)
                    {
                        last_drive_refresh = Instant::now();
                        let drives = get_system_drives();
                        let _ = app.emit("drives:updated", drives);
                    }
                }
            }
        });
    }
}

struct CachedDirSig {
    path: String,
    is_junction: bool,
    child_dirs: HashSet<String>,
    files: HashMap<String, (u64, Option<u64>)>,
}

enum WatchMsg {
    Changed(PathBuf),
    Overflow,
}

fn run_windows_directory_watcher(
    drive_root: &str,
    cache_dir_norm: &str,
    stop_flag: Arc<AtomicBool>,
    stop_event_raw: isize,
    tx: mpsc::Sender<WatchMsg>,
) {
    let wide_root = to_wide_null(drive_root);
    let dir_handle = unsafe {
        CreateFileW(
            wide_root.as_ptr(),
            FILE_LIST_DIRECTORY,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            null_mut(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OVERLAPPED,
            null_mut(),
        )
    };

    if dir_handle == INVALID_HANDLE_VALUE || dir_handle.is_null() {
        return;
    }

    let io_event = unsafe { CreateEventW(null_mut(), 1, 0, null_mut()) };
    if io_event.is_null() {
        unsafe { CloseHandle(dir_handle) };
        return;
    }

    // 128 KB 4-byte aligned buffer for FILE_NOTIFY_INFORMATION records
    let mut buffer: Vec<u32> = vec![0u32; 32768];
    let buffer_bytes_len = (buffer.len() * std::mem::size_of::<u32>()) as u32;
    let notify_filter = FILE_NOTIFY_CHANGE_FILE_NAME
        | FILE_NOTIFY_CHANGE_DIR_NAME
        | FILE_NOTIFY_CHANGE_SIZE
        | FILE_NOTIFY_CHANGE_LAST_WRITE;

    let base_path = PathBuf::from(drive_root);

    while !stop_flag.load(Ordering::Relaxed) {
        unsafe {
            ResetEvent(io_event);
        }

        let mut overlapped: OVERLAPPED = unsafe { std::mem::zeroed() };
        overlapped.hEvent = io_event;

        let ok = unsafe {
            ReadDirectoryChangesW(
                dir_handle,
                buffer.as_mut_ptr() as *mut _,
                buffer_bytes_len,
                1, // bWatchSubtree = TRUE (watches entire drive recursively!)
                notify_filter,
                null_mut(),
                &mut overlapped,
                None,
            )
        };

        if ok == 0 {
            thread::sleep(Duration::from_millis(500));
            continue;
        }

        let wait_handles = [io_event, stop_event_raw as HANDLE];
        let wait_res = unsafe { WaitForMultipleObjects(2, wait_handles.as_ptr(), 0, INFINITE) };

        if wait_res != WAIT_OBJECT_0 {
            // Stop event signaled or error -> cancel pending I/O and exit cleanly
            unsafe {
                CancelIoEx(dir_handle, &overlapped);
            }
            break;
        }

        let mut bytes_returned: u32 = 0;
        let res = unsafe { GetOverlappedResult(dir_handle, &overlapped, &mut bytes_returned, 0) };

        if res == 0 {
            continue;
        }

        if bytes_returned == 0 {
            // Buffer overflowed under huge burst -> notify debouncer to run delta sync
            let _ = tx.send(WatchMsg::Overflow);
            continue;
        }

        // Parse linked FILE_NOTIFY_INFORMATION entries
        let raw_bytes = unsafe {
            std::slice::from_raw_parts(buffer.as_ptr() as *const u8, bytes_returned as usize)
        };
        let mut offset = 0usize;

        while offset + std::mem::size_of::<FILE_NOTIFY_INFORMATION>() <= raw_bytes.len() {
            let info = unsafe { &*(raw_bytes.as_ptr().add(offset) as *const FILE_NOTIFY_INFORMATION) };
            let name_bytes = info.FileNameLength as usize;
            let name_chars = name_bytes / 2;

            let name_offset_in_struct = offset + 12; // NextEntryOffset(4) + Action(4) + FileNameLength(4)
            if name_chars > 0 && name_offset_in_struct + name_bytes <= raw_bytes.len() {
                let wide_slice =
                    unsafe { std::slice::from_raw_parts(info.FileName.as_ptr(), name_chars) };
                let rel_name = OsString::from_wide(wide_slice);
                let full_path = base_path.join(rel_name);
                let norm = normalize_path_key(&full_path.to_string_lossy());

                // Ignore Ferrowipe's own snapshot cache directory, NTFS internal metadata,
                // and noisy high-churn Windows ETW/Defender/log files that cause constant write storms
                let is_ignored = (!cache_dir_norm.is_empty() && norm.starts_with(cache_dir_norm))
                    || norm.ends_with("\\$MFT")
                    || norm.ends_with("\\$LOGFILE")
                    || norm.ends_with("\\$USNJRNL")
                    || norm.ends_with("\\PAGEFILE.SYS")
                    || norm.ends_with("\\SWAPFILE.SYS")
                    || norm.ends_with("\\HIBERFIL.SYS")
                    || norm.contains("\\WINDOWS\\SYSTEM32\\WINEVT\\")
                    || norm.contains("\\WINDOWS\\LOGS\\")
                    || norm.contains("\\WINDOWS\\PREFETCH\\")
                    || norm.contains("\\PROGRAMDATA\\MICROSOFT\\WINDOWS DEFENDER\\")
                    || norm.contains("\\SYSTEM VOLUME INFORMATION\\");

                if !is_ignored {
                    if tx.send(WatchMsg::Changed(full_path)).is_err() {
                        unsafe {
                            CloseHandle(io_event);
                            CloseHandle(dir_handle);
                        }
                        return;
                    }
                }
            }

            if info.NextEntryOffset == 0 {
                break;
            }
            offset += info.NextEntryOffset as usize;
        }
    }

    unsafe {
        CloseHandle(io_event);
        CloseHandle(dir_handle);
    }
}

impl DriveIndex {
    pub fn root_totals(&self) -> (u64, u64, u64) {
        if let Some(root) = self.nodes.get(&self.root_key) {
            (
                root.total_bytes,
                root.total_files,
                self.nodes.len().saturating_sub(1) as u64,
            )
        } else {
            (0, 0, 0)
        }
    }

    pub fn display_path_for_key(&self, key: &str) -> String {
        if let Some(node) = self.nodes.get(key) {
            node.path.clone()
        } else if key.ends_with(':') {
            format!("{}\\", key)
        } else {
            key.to_string()
        }
    }

    pub fn build_children_items(&self, folder_path: &str, depth: usize) -> Option<Vec<FolderItem>> {
        let norm = normalize_path_key(folder_path);
        let node = self.nodes.get(&norm)?;
        let parent_total = node.total_bytes;

        let mut items = Vec::with_capacity(node.child_dirs.len() + node.direct_file_entries.len());

        // 1. Subdirectories
        for child_key in &node.child_dirs {
            if let Some(child) = self.nodes.get(child_key) {
                let pct = if parent_total > 0 {
                    ((child.total_bytes as f64 / parent_total as f64) * 1000.0).round() / 10.0
                } else {
                    0.0
                };
                items.push(FolderItem {
                    id: child.path.clone(),
                    name: child.name.clone(),
                    path: child.path.clone(),
                    parent_path: Some(node.path.clone()),
                    size_bytes: child.total_bytes,
                    file_count: child.total_files,
                    subfolder_count: child.total_subfolders,
                    is_dir: true,
                    last_modified: child.last_modified,
                    percentage: pct,
                    depth,
                    has_subfolders: !child.child_dirs.is_empty() || !child.direct_file_entries.is_empty(),
                    is_junction: child.is_junction,
                    is_access_denied: child.is_access_denied,
                });
            }
        }

        // 2. Direct files inside this directory
        for file_entry in node.direct_file_entries.values() {
            let full_path = if node.path.ends_with('\\') {
                format!("{}{}", node.path, file_entry.name)
            } else {
                format!("{}\\{}", node.path, file_entry.name)
            };
            let pct = if parent_total > 0 {
                ((file_entry.size_bytes as f64 / parent_total as f64) * 1000.0).round() / 10.0
            } else {
                0.0
            };
            items.push(FolderItem {
                id: full_path.clone(),
                name: file_entry.name.clone(),
                path: full_path,
                parent_path: Some(node.path.clone()),
                size_bytes: file_entry.size_bytes,
                file_count: 1,
                subfolder_count: 0,
                is_dir: false,
                last_modified: file_entry.last_modified,
                percentage: pct,
                depth,
                has_subfolders: false,
                is_junction: false,
                is_access_denied: false,
            });
        }

        items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
        Some(items)
    }

    pub fn build_analysis_result(
        &self,
        target_path: &str,
        depth: usize,
        duration_ms: u64,
    ) -> Option<FolderAnalysisResult> {
        let norm = normalize_path_key(target_path);
        let node = self.nodes.get(&norm)?;
        let items = self.build_children_items(target_path, depth)?;

        Some(FolderAnalysisResult {
            target_path: node.path.clone(),
            total_bytes: node.total_bytes,
            total_files: node.total_files,
            total_folders: node.total_subfolders,
            items,
            duration_ms,
            is_full_disk: true,
            from_cache: self.from_cache,
            is_watching: self.is_watching,
            is_syncing: self.is_syncing,
            revision: self.revision,
            last_sync_summary: self.last_sync_summary.clone(),
        })
    }

    /// Queries the largest folders across ALL depths under `target_path` in memory.
    pub fn query_largest_folders(
        &self,
        target_path: &str,
        min_size_bytes: u64,
        top_n: usize,
    ) -> Vec<FolderItem> {
        let target_norm = normalize_path_key(target_path);
        let prefix = format!("{}\\", target_norm);
        let target_total = self
            .nodes
            .get(&target_norm)
            .map(|n| n.total_bytes)
            .unwrap_or(0);

        let mut matches: Vec<&DirNode> = self
            .nodes
            .iter()
            .filter(|(k, node)| {
                *k != &target_norm
                    && k.starts_with(&prefix)
                    && !node.is_junction
                    && node.total_bytes >= min_size_bytes
            })
            .map(|(_, node)| node)
            .collect();

        matches.sort_by(|a, b| b.total_bytes.cmp(&a.total_bytes));
        matches.truncate(top_n);

        let denom = if target_total > 0 {
            target_total
        } else {
            matches.first().map(|m| m.total_bytes).unwrap_or(1)
        };

        matches
            .into_iter()
            .map(|node| {
                let pct = if denom > 0 {
                    ((node.total_bytes as f64 / denom as f64) * 1000.0).round() / 10.0
                } else {
                    0.0
                };
                FolderItem {
                    id: node.path.clone(),
                    name: node.name.clone(),
                    path: node.path.clone(),
                    parent_path: node
                        .parent_key
                        .as_ref()
                        .map(|pk| self.display_path_for_key(pk)),
                    size_bytes: node.total_bytes,
                    file_count: node.total_files,
                    subfolder_count: node.total_subfolders,
                    is_dir: true,
                    last_modified: node.last_modified,
                    percentage: pct,
                    depth: 0,
                    has_subfolders: !node.child_dirs.is_empty() || !node.direct_file_entries.is_empty(),
                    is_junction: node.is_junction,
                    is_access_denied: node.is_access_denied,
                }
            })
            .collect()
    }

    fn bubble_delta(
        &mut self,
        start_key: &str,
        delta_bytes: i64,
        delta_files: i64,
        delta_subfolders: i64,
        changed_ancestors: &mut HashSet<String>,
    ) {
        let mut cursor = Some(start_key.to_string());
        while let Some(key) = cursor {
            if let Some(node) = self.nodes.get_mut(&key) {
                node.total_bytes = apply_signed_delta(node.total_bytes, delta_bytes);
                node.total_files = apply_signed_delta(node.total_files, delta_files);
                node.total_subfolders = apply_signed_delta(node.total_subfolders, delta_subfolders);
                changed_ancestors.insert(key);
                cursor = node.parent_key.clone();
            } else {
                break;
            }
        }
    }

    /// Ensures every directory in the ancestor chain from `dir_path` up to `self.root_key`
    /// exists in `self.nodes` and is linked to its parent.
    fn ensure_dir_chain(
        &mut self,
        dir_path: &Path,
        changed_ancestors: &mut HashSet<String>,
    ) -> Option<String> {
        let dir_key = normalize_path_key(&dir_path.to_string_lossy());
        if !dir_key.starts_with(&self.root_key) {
            return None;
        }
        if self.nodes.contains_key(&dir_key) {
            return Some(dir_key);
        }

        // Collect missing ancestors from leaf up to first existing ancestor
        let mut chain: Vec<PathBuf> = Vec::new();
        let mut cur = dir_path.to_path_buf();
        loop {
            let k = normalize_path_key(&cur.to_string_lossy());
            if self.nodes.contains_key(&k) || k == self.root_key {
                break;
            }
            chain.push(cur.clone());
            match cur.parent() {
                Some(p) if p != cur => cur = p.to_path_buf(),
                _ => break,
            }
        }

        // Insert from top-most missing ancestor downward
        for p in chain.into_iter().rev() {
            let k = normalize_path_key(&p.to_string_lossy());
            let parent_key = p.parent().map(|par| normalize_path_key(&par.to_string_lossy()));
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| p.to_string_lossy().to_string());
            let last_mod = fs::symlink_metadata(&p)
                .ok()
                .and_then(|m| metadata_mtime_secs(&m));

            self.nodes.insert(
                k.clone(),
                DirNode::new(
                    p.to_string_lossy().to_string(),
                    name,
                    parent_key.clone(),
                    last_mod,
                    false,
                    false,
                ),
            );

            if let Some(pk) = parent_key {
                if let Some(parent_node) = self.nodes.get_mut(&pk) {
                    if parent_node.child_dirs.insert(k.clone()) {
                        self.bubble_delta(&pk, 0, 0, 1, changed_ancestors);
                    }
                }
            }
        }

        Some(dir_key)
    }

    fn remove_dir_subtree(
        &mut self,
        dir_key: &str,
        changed_ancestors: &mut HashSet<String>,
    ) -> Option<(u64, u64, u64)> {
        if dir_key == self.root_key {
            return None;
        }
        let (removed_bytes, removed_files, removed_desc_subs, parent_key) = {
            let node = self.nodes.get(dir_key)?;
            (
                node.total_bytes,
                node.total_files,
                node.total_subfolders,
                node.parent_key.clone(),
            )
        };

        // Collect entire subtree keys via BFS
        let mut to_remove = Vec::new();
        let mut stack = vec![dir_key.to_string()];
        while let Some(k) = stack.pop() {
            if let Some(n) = self.nodes.get(&k) {
                for child in &n.child_dirs {
                    stack.push(child.clone());
                }
            }
            to_remove.push(k);
        }

        for k in to_remove {
            self.nodes.remove(&k);
        }

        if let Some(pk) = parent_key {
            if let Some(parent_node) = self.nodes.get_mut(&pk) {
                parent_node.child_dirs.remove(dir_key);
            }
            self.bubble_delta(
                &pk,
                -(removed_bytes as i64),
                -(removed_files as i64),
                -((1 + removed_desc_subs) as i64),
                changed_ancestors,
            );
        }

        Some((removed_bytes, removed_files, 1 + removed_desc_subs))
    }

    fn remove_file_entry(
        &mut self,
        parent_key: &str,
        file_name_upper: &str,
        changed_ancestors: &mut HashSet<String>,
    ) -> Option<u64> {
        let removed_size = {
            let parent = self.nodes.get_mut(parent_key)?;
            let entry = parent.direct_file_entries.remove(file_name_upper)?;
            parent.direct_bytes = parent.direct_bytes.saturating_sub(entry.size_bytes);
            parent.direct_files = parent.direct_files.saturating_sub(1);
            entry.size_bytes
        };

        self.bubble_delta(parent_key, -(removed_size as i64), -1, 0, changed_ancestors);
        Some(removed_size)
    }

    fn upsert_file_entry(
        &mut self,
        file_path: &Path,
        size_bytes: u64,
        last_modified: Option<u64>,
        changed_ancestors: &mut HashSet<String>,
    ) -> (bool, i64) {
        let Some(parent) = file_path.parent() else {
            return (false, 0);
        };
        let Some(parent_key) = self.ensure_dir_chain(parent, changed_ancestors) else {
            return (false, 0);
        };
        let Some(name) = file_path.file_name().map(|n| n.to_string_lossy().to_string()) else {
            return (false, 0);
        };
        let name_upper = name.to_uppercase();

        let (changed, delta_bytes, delta_files) = {
            let Some(parent_node) = self.nodes.get_mut(&parent_key) else {
                return (false, 0);
            };
            match parent_node.direct_file_entries.get_mut(&name_upper) {
                Some(existing) => {
                    if existing.size_bytes == size_bytes
                        && existing.last_modified == last_modified
                        && existing.name == name
                    {
                        (false, 0i64, 0i64)
                    } else {
                        let d_bytes = size_bytes as i64 - existing.size_bytes as i64;
                        parent_node.direct_bytes =
                            apply_signed_delta(parent_node.direct_bytes, d_bytes);
                        existing.name = name;
                        existing.size_bytes = size_bytes;
                        existing.last_modified = last_modified;
                        (true, d_bytes, 0i64)
                    }
                }
                None => {
                    parent_node.direct_file_entries.insert(
                        name_upper,
                        FileEntry {
                            name,
                            size_bytes,
                            last_modified,
                        },
                    );
                    parent_node.direct_bytes += size_bytes;
                    parent_node.direct_files += 1;
                    (true, size_bytes as i64, 1i64)
                }
            }
        };

        if changed {
            self.bubble_delta(&parent_key, delta_bytes, delta_files, 0, changed_ancestors);
        }

        (changed, delta_bytes)
    }

    fn insert_new_dir_subtree(
        &mut self,
        dir_path: &Path,
        changed_ancestors: &mut HashSet<String>,
    ) -> (u64, u64, u64) {
        let dir_key = normalize_path_key(&dir_path.to_string_lossy());
        if self.nodes.contains_key(&dir_key) {
            return (0, 0, 0);
        }

        let parent_key = match dir_path.parent() {
            Some(p) => match self.ensure_dir_chain(p, changed_ancestors) {
                Some(pk) => pk,
                None => return (0, 0, 0),
            },
            None => return (0, 0, 0),
        };

        let is_junc = is_junction_or_symlink(dir_path);
        let dir_name = dir_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| dir_path.to_string_lossy().to_string());
        let dir_mtime = fs::symlink_metadata(dir_path)
            .ok()
            .and_then(|m| metadata_mtime_secs(&m));

        if is_junc {
            self.nodes.insert(
                dir_key.clone(),
                DirNode::new(
                    dir_path.to_string_lossy().to_string(),
                    dir_name,
                    Some(parent_key.clone()),
                    dir_mtime,
                    true,
                    false,
                ),
            );
            if let Some(pnode) = self.nodes.get_mut(&parent_key) {
                pnode.child_dirs.insert(dir_key);
            }
            self.bubble_delta(&parent_key, 0, 0, 1, changed_ancestors);
            return (0, 0, 1);
        }

        // Scan ONLY this new subtree iteratively using native Win32 FindFirstFileExW (zero rayon deadlock!)
        let mut sub_nodes: HashMap<String, DirNode> = HashMap::new();
        let mut stack: Vec<(String, String, String, Option<String>, Option<u64>, usize)> = vec![(
            dir_path.to_string_lossy().to_string(),
            dir_key.clone(),
            dir_name,
            Some(parent_key.clone()),
            dir_mtime,
            0,
        )];

        while let Some((cur_path, cur_key, cur_name, cur_parent, cur_mtime, depth)) = stack.pop() {
            if depth > MAX_SCAN_DEPTH {
                sub_nodes.insert(
                    cur_key,
                    DirNode::new(cur_path, cur_name, cur_parent, cur_mtime, false, false),
                );
                continue;
            }
            let pattern = to_extended_wildcard_wide(&cur_path);
            let mut find_data: WIN32_FIND_DATAW = unsafe { std::mem::zeroed() };
            let handle = unsafe {
                FindFirstFileExW(
                    pattern.as_ptr(),
                    FindExInfoBasic,
                    &mut find_data as *mut _ as *mut _,
                    FindExSearchNameMatch,
                    null_mut(),
                    FIND_FIRST_EX_LARGE_FETCH,
                )
            };

            if handle == INVALID_HANDLE_VALUE || handle.is_null() {
                let is_denied = unsafe { GetLastError() } == ERROR_ACCESS_DENIED;
                sub_nodes.insert(
                    cur_key,
                    DirNode::new(cur_path, cur_name, cur_parent, cur_mtime, false, is_denied),
                );
                continue;
            }

            let mut direct_files_map: HashMap<String, FileEntry> = HashMap::new();
            let mut direct_bytes = 0u64;
            let mut direct_files = 0u64;
            let mut child_dirs: HashSet<String> = HashSet::new();
            let ends_slash = cur_path.ends_with('\\');

            loop {
                let nb = &find_data.cFileName;
                let is_dot = nb[0] == b'.' as u16
                    && (nb[1] == 0 || (nb[1] == b'.' as u16 && nb[2] == 0));
                if !is_dot {
                    let len = nb.iter().position(|&c| c == 0).unwrap_or(nb.len());
                    let ename = OsString::from_wide(&nb[..len]).to_string_lossy().into_owned();
                    let attrs = find_data.dwFileAttributes;
                    let mtime = filetime_to_unix_secs(find_data.ftLastWriteTime);

                    if (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0 {
                        let cp = if ends_slash {
                            format!("{}{}", cur_path, ename)
                        } else {
                            format!("{}\\{}", cur_path, ename)
                        };
                        let ck = format!("{}\\{}", cur_key, ename.to_uppercase());
                        child_dirs.insert(ck.clone());
                        if is_non_traversable_reparse_dir(attrs, find_data.dwReserved0) {
                            sub_nodes.insert(
                                ck,
                                DirNode::new(cp, ename, Some(cur_key.clone()), mtime, true, false),
                            );
                        } else {
                            stack.push((cp, ck, ename, Some(cur_key.clone()), mtime, depth + 1));
                        }
                    } else {
                        let size = effective_local_file_size(&find_data);
                        direct_bytes += size;
                        direct_files += 1;
                        direct_files_map.insert(
                            ename.to_uppercase(),
                            FileEntry {
                                name: ename,
                                size_bytes: size,
                                last_modified: mtime,
                            },
                        );
                    }
                }
                if unsafe { FindNextFileW(handle, &mut find_data) } == 0 {
                    break;
                }
            }
            unsafe {
                FindClose(handle);
            }

            let mut node = DirNode::new(cur_path, cur_name, cur_parent, cur_mtime, false, false);
            node.direct_bytes = direct_bytes;
            node.direct_files = direct_files;
            node.child_dirs = child_dirs;
            node.direct_file_entries = direct_files_map;
            sub_nodes.insert(cur_key, node);
        }

        aggregate_bottom_up(&mut sub_nodes);

        let (sub_bytes, sub_files, sub_desc) = sub_nodes
            .get(&dir_key)
            .map(|n| (n.total_bytes, n.total_files, n.total_subfolders))
            .unwrap_or((0, 0, 0));

        // Merge into main DriveIndex
        for (k, n) in sub_nodes {
            self.nodes.insert(k, n);
        }
        if let Some(pnode) = self.nodes.get_mut(&parent_key) {
            pnode.child_dirs.insert(dir_key);
        }

        self.bubble_delta(
            &parent_key,
            sub_bytes as i64,
            sub_files as i64,
            (1 + sub_desc) as i64,
            changed_ancestors,
        );

        (sub_bytes, sub_files, 1 + sub_desc)
    }

    fn reconcile_single_dir_immediate(
        &mut self,
        dir_path: &Path,
        changed_ancestors: &mut HashSet<String>,
    ) -> (u64, i64) {
        let dir_key = normalize_path_key(&dir_path.to_string_lossy());
        let (cached_files, cached_dirs) = match self.nodes.get(&dir_key) {
            Some(node) => {
                if node.is_junction {
                    return (0, 0);
                }
                (
                    node.direct_file_entries
                        .keys()
                        .cloned()
                        .collect::<HashSet<String>>(),
                    node.child_dirs.clone(),
                )
            }
            None => return (0, 0),
        };

        let entries = match fs::read_dir(dir_path) {
            Ok(e) => e,
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
                if let Some(n) = self.nodes.get_mut(&dir_key) {
                    n.is_access_denied = true;
                }
                return (0, 0);
            }
            Err(_) => return (0, 0),
        };

        let mut seen_files = HashSet::new();
        let mut seen_dirs = HashSet::new();
        let mut changes = 0u64;
        let mut byte_delta = 0i64;

        for entry in entries.flatten() {
            let p = entry.path();
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_dir() {
                let ck = normalize_path_key(&p.to_string_lossy());
                seen_dirs.insert(ck.clone());
                if !cached_dirs.contains(&ck) {
                    let (b, _, _) = self.insert_new_dir_subtree(&p, changed_ancestors);
                    changes += 1;
                    byte_delta += b as i64;
                }
            } else if ft.is_file() {
                let fname_upper = entry.file_name().to_string_lossy().to_uppercase();
                seen_files.insert(fname_upper);
                if let Ok(meta) = entry.metadata() {
                    let size = meta.len();
                    let mtime = metadata_mtime_secs(&meta);
                    let (changed, d_bytes) =
                        self.upsert_file_entry(&p, size, mtime, changed_ancestors);
                    if changed {
                        changes += 1;
                        byte_delta += d_bytes;
                    }
                }
            }
        }

        // Remove missing files
        for old_f in cached_files {
            if !seen_files.contains(&old_f) {
                if let Some(removed_sz) = self.remove_file_entry(&dir_key, &old_f, changed_ancestors)
                {
                    changes += 1;
                    byte_delta -= removed_sz as i64;
                }
            }
        }

        // Remove missing child dirs
        for old_d in cached_dirs {
            if !seen_dirs.contains(&old_d) {
                if let Some((removed_b, _, _)) = self.remove_dir_subtree(&old_d, changed_ancestors) {
                    changes += 1;
                    byte_delta -= removed_b as i64;
                }
            }
        }

        // Update dir mtime
        if let Ok(meta) = fs::symlink_metadata(dir_path) {
            if let Some(n) = self.nodes.get_mut(&dir_key) {
                n.last_modified = metadata_mtime_secs(&meta);
            }
        }

        (changes, byte_delta)
    }

    /// Reconciles a batch of filesystem paths (from real-time watcher or delta diff)
    /// into this `DriveIndex` incrementally, bubbling all deltas up to root.
    pub fn reconcile_changed_paths(&mut self, paths: &[PathBuf]) -> ReconcileStats {
        let mut stats = ReconcileStats::default();
        if paths.is_empty() {
            return stats;
        }

        // Deduplicate & sort parents before children
        let mut norm_pairs: Vec<(String, PathBuf)> = paths
            .iter()
            .filter_map(|p| {
                let norm = normalize_path_key(&p.to_string_lossy());
                if norm.starts_with(&self.root_key) {
                    Some((norm, p.clone()))
                } else {
                    None
                }
            })
            .collect();

        norm_pairs.sort_by(|a, b| a.0.len().cmp(&b.0.len()).then_with(|| a.0.cmp(&b.0)));
        norm_pairs.dedup_by(|a, b| a.0 == b.0);

        // Track subtrees already fully removed or freshly scanned in this batch
        let mut covered_prefixes: Vec<String> = Vec::new();

        for (norm, path) in norm_pairs {
            if covered_prefixes
                .iter()
                .any(|pref| norm == *pref || norm.starts_with(&format!("{}\\", pref)))
            {
                continue;
            }

            match fs::symlink_metadata(&path) {
                Err(_) => {
                    // Path no longer exists on disk -> deleted or moved away!
                    if self.nodes.contains_key(&norm) {
                        if let Some((removed_b, _, _)) =
                            self.remove_dir_subtree(&norm, &mut stats.changed_ancestors)
                        {
                            stats.changes_applied += 1;
                            stats.byte_delta -= removed_b as i64;
                            covered_prefixes.push(norm);
                        }
                    } else if let (Some(parent), Some(fname)) = (path.parent(), path.file_name()) {
                        let pk = normalize_path_key(&parent.to_string_lossy());
                        let fupper = fname.to_string_lossy().to_uppercase();
                        if let Some(removed_sz) =
                            self.remove_file_entry(&pk, &fupper, &mut stats.changed_ancestors)
                        {
                            stats.changes_applied += 1;
                            stats.byte_delta -= removed_sz as i64;
                        }
                    }
                }
                Ok(meta) => {
                    let ft = meta.file_type();
                    if ft.is_dir() {
                        if !self.nodes.contains_key(&norm) {
                            let (added_b, _, _) =
                                self.insert_new_dir_subtree(&path, &mut stats.changed_ancestors);
                            stats.changes_applied += 1;
                            stats.byte_delta += added_b as i64;
                            covered_prefixes.push(norm);
                        } else {
                            let (c, d) = self.reconcile_single_dir_immediate(
                                &path,
                                &mut stats.changed_ancestors,
                            );
                            stats.changes_applied += c;
                            stats.byte_delta += d;
                        }
                    } else if ft.is_file() {
                        let size = meta.len();
                        let mtime = metadata_mtime_secs(&meta);
                        let (changed, d_bytes) = self.upsert_file_entry(
                            &path,
                            size,
                            mtime,
                            &mut stats.changed_ancestors,
                        );
                        if changed {
                            stats.changes_applied += 1;
                            stats.byte_delta += d_bytes;
                        }
                    }
                }
            }
        }

        stats
    }
}

const NUM_SHARDS: usize = 32;
const MAX_SCAN_DEPTH: usize = 64;
const FILE_ATTRIBUTE_RECALL_ON_OPEN: u32 = 0x0004_0000;
const FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS: u32 = 0x0040_0000;

/// Returns true if a directory with `FILE_ATTRIBUTE_REPARSE_POINT` is a junction/symlink/mount
/// point that must NOT be descended. Allows Windows Cloud Files (OneDrive/iCloud) placeholder
/// directories (`IO_REPARSE_TAG_CLOUD*`, `0x9000x01A`) so local user files inside OneDrive are
/// properly scanned and counted.
#[inline]
fn is_non_traversable_reparse_dir(attrs: u32, reparse_tag: u32) -> bool {
    if (attrs & FILE_ATTRIBUTE_REPARSE_POINT) == 0 {
        return false;
    }
    let is_cloud_dir = (reparse_tag & 0xFFFF_0FFF) == 0x9000_001A;
    !is_cloud_dir
}

/// Returns local disk byte usage for a file entry; dehydrated online-only cloud placeholders
/// occupy 0 bytes locally on disk.
#[inline]
fn effective_local_file_size(find_data: &WIN32_FIND_DATAW) -> u64 {
    if (find_data.dwFileAttributes
        & (FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS | FILE_ATTRIBUTE_RECALL_ON_OPEN))
        != 0
    {
        return 0;
    }
    ((find_data.nFileSizeHigh as u64) << 32) | (find_data.nFileSizeLow as u64)
}

struct NativeScanContext {
    shards: Vec<Mutex<Vec<(String, DirNode)>>>,
    scanned_files: Arc<AtomicU64>,
    scanned_folders: Arc<AtomicU64>,
    scanned_bytes: Arc<AtomicU64>,
    latest_folder: Arc<Mutex<String>>,
}

#[inline]
fn fast_shard_index(key: &str) -> usize {
    let mut h: u64 = 14695981039346656037;
    for &b in key.as_bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    (h as usize) & (NUM_SHARDS - 1)
}

#[inline]
fn filetime_to_unix_secs(ft: FILETIME) -> Option<u64> {
    const WINDOWS_TO_UNIX_TICKS: u64 = 116_444_736_000_000_000;
    let ticks = ((ft.dwHighDateTime as u64) << 32) | (ft.dwLowDateTime as u64);
    if ticks >= WINDOWS_TO_UNIX_TICKS {
        Some((ticks - WINDOWS_TO_UNIX_TICKS) / 10_000_000)
    } else {
        None
    }
}

fn to_extended_wildcard_wide(dir_path: &str) -> Vec<u16> {
    let mut wide = Vec::with_capacity(dir_path.len() + 8);
    if !dir_path.starts_with("\\\\?\\") {
        for &ch in &[b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16] {
            wide.push(ch);
        }
    }
    wide.extend(std::ffi::OsStr::new(dir_path).encode_wide());
    if wide.last().copied() != Some(b'\\' as u16) {
        wide.push(b'\\' as u16);
    }
    wide.push(b'*' as u16);
    wide.push(0);
    wide
}

/// Recursive, work-stealing native Win32 `FindFirstFileExW(FindExInfoBasic, FIND_FIRST_EX_LARGE_FETCH)`
/// directory scanner. Reads attributes, reparse flags, sizes, and mtimes in ONE kernel call per directory
/// with ZERO extra `stat` syscalls and computes bottom-up totals in parallel!
fn scan_dir_native_parallel(
    dir_path: String,
    dir_key: String,
    dir_name: String,
    parent_key: Option<String>,
    dir_mtime: Option<u64>,
    depth: usize,
    ctx: &NativeScanContext,
) -> (u64, u64, u64) {
    if depth > MAX_SCAN_DEPTH {
        let node = DirNode::new(dir_path, dir_name, parent_key, dir_mtime, false, false);
        let shard = fast_shard_index(&dir_key);
        if let Ok(mut bucket) = ctx.shards[shard].lock() {
            bucket.push((dir_key, node));
        }
        return (0, 0, 0);
    }
    let pattern = to_extended_wildcard_wide(&dir_path);
    let mut find_data: WIN32_FIND_DATAW = unsafe { std::mem::zeroed() };

    let handle = unsafe {
        FindFirstFileExW(
            pattern.as_ptr(),
            FindExInfoBasic,
            &mut find_data as *mut _ as *mut _,
            FindExSearchNameMatch,
            null_mut(),
            FIND_FIRST_EX_LARGE_FETCH,
        )
    };

    if handle == INVALID_HANDLE_VALUE || handle.is_null() {
        let is_denied = unsafe { GetLastError() } == ERROR_ACCESS_DENIED;
        let node = DirNode::new(dir_path, dir_name, parent_key, dir_mtime, false, is_denied);
        let shard = fast_shard_index(&dir_key);
        if let Ok(mut bucket) = ctx.shards[shard].lock() {
            bucket.push((dir_key, node));
        }
        ctx.scanned_folders.fetch_add(1, Ordering::Relaxed);
        return (0, 0, 0);
    }

    let mut direct_file_entries: HashMap<String, FileEntry> = HashMap::new();
    let mut direct_bytes = 0u64;
    let mut direct_files = 0u64;
    let mut child_dirs: HashSet<String> = HashSet::new();
    let mut subdirs_to_walk: Vec<(String, String, String, Option<u64>)> = Vec::new();
    let mut junction_children: Vec<(String, DirNode)> = Vec::new();

    let path_ends_with_slash = dir_path.ends_with('\\');

    loop {
        let name_buf = &find_data.cFileName;
        // Zero-allocation check for "." and ".."
        let is_dot = name_buf[0] == b'.' as u16
            && (name_buf[1] == 0 || (name_buf[1] == b'.' as u16 && name_buf[2] == 0));

        if !is_dot {
            let name_len = name_buf.iter().position(|&c| c == 0).unwrap_or(name_buf.len());
            let entry_name = OsString::from_wide(&name_buf[..name_len])
                .to_string_lossy()
                .into_owned();
            let attrs = find_data.dwFileAttributes;
            let mtime = filetime_to_unix_secs(find_data.ftLastWriteTime);

            if (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0 {
                let child_path = if path_ends_with_slash {
                    format!("{}{}", dir_path, entry_name)
                } else {
                    format!("{}\\{}", dir_path, entry_name)
                };
                let child_key = format!("{}\\{}", dir_key, entry_name.to_uppercase());
                child_dirs.insert(child_key.clone());

                if is_non_traversable_reparse_dir(attrs, find_data.dwReserved0) {
                    // NTFS Junction / Symlink: record as 0 B and NEVER descend!
                    junction_children.push((
                        child_key,
                        DirNode::new(
                            child_path,
                            entry_name,
                            Some(dir_key.clone()),
                            mtime,
                            true,
                            false,
                        ),
                    ));
                } else {
                    subdirs_to_walk.push((child_path, child_key, entry_name, mtime));
                }
            } else {
                let size = effective_local_file_size(&find_data);
                let upper = entry_name.to_uppercase();
                direct_bytes += size;
                direct_files += 1;
                direct_file_entries.insert(
                    upper,
                    FileEntry {
                        name: entry_name,
                        size_bytes: size,
                        last_modified: mtime,
                    },
                );
            }
        }

        let next_ok = unsafe { FindNextFileW(handle, &mut find_data) };
        if next_ok == 0 {
            break;
        }
    }

    unsafe {
        FindClose(handle);
    }

    // Batch-update atomic progress counters ONCE per directory (zero lock overhead!)
    ctx.scanned_folders.fetch_add(1 + junction_children.len() as u64, Ordering::Relaxed);
    if direct_files > 0 {
        ctx.scanned_files.fetch_add(direct_files, Ordering::Relaxed);
        ctx.scanned_bytes.fetch_add(direct_bytes, Ordering::Relaxed);
    }
    if let Ok(mut latest) = ctx.latest_folder.try_lock() {
        *latest = dir_name.clone();
    }

    // Store junction child nodes
    let junction_count = junction_children.len() as u64;
    for (jk, jnode) in junction_children {
        let shard = fast_shard_index(&jk);
        if let Ok(mut bucket) = ctx.shards[shard].lock() {
            bucket.push((jk, jnode));
        }
    }

    // Walk subdirectories in parallel using bounded Rayon work-stealing (only split above depth 6 for efficiency)
    let child_totals: (u64, u64, u64) = if subdirs_to_walk.len() > 1 && depth < 12 {
        let parent_ref = dir_key.clone();
        subdirs_to_walk
            .into_par_iter()
            .map(|(cp, ck, cn, cm)| {
                let (b, f, s) = scan_dir_native_parallel(
                    cp,
                    ck,
                    cn,
                    Some(parent_ref.clone()),
                    cm,
                    depth + 1,
                    ctx,
                );
                (b, f, 1 + s)
            })
            .reduce(|| (0, 0, 0), |a, b| (a.0 + b.0, a.1 + b.1, a.2 + b.2))
    } else {
        let mut tot = (0u64, 0u64, 0u64);
        for (cp, ck, cn, cm) in subdirs_to_walk {
            let (b, f, s) =
                scan_dir_native_parallel(cp, ck, cn, Some(dir_key.clone()), cm, depth + 1, ctx);
            tot.0 += b;
            tot.1 += f;
            tot.2 += 1 + s;
        }
        tot
    };

    let total_bytes = direct_bytes + child_totals.0;
    let total_files = direct_files + child_totals.1;
    let total_subfolders = junction_count + child_totals.2;

    let mut node = DirNode::new(dir_path, dir_name, parent_key, dir_mtime, false, false);
    node.direct_bytes = direct_bytes;
    node.direct_files = direct_files;
    node.total_bytes = total_bytes;
    node.total_files = total_files;
    node.total_subfolders = total_subfolders;
    node.child_dirs = child_dirs;
    node.direct_file_entries = direct_file_entries;

    let shard = fast_shard_index(&dir_key);
    if let Ok(mut bucket) = ctx.shards[shard].lock() {
        bucket.push((dir_key, node));
    }

    (total_bytes, total_files, total_subfolders)
}

/// Ultra-fast, unstoppable Full Disk Index builder powered by native Win32 `FindFirstFileExW`
/// (`FindExInfoBasic` + `FIND_FIRST_EX_LARGE_FETCH`) + `rayon` parallel work-stealing,
/// with a dedicated 120ms rolling-window real-time speed telemetry thread.
fn build_full_drive_index_native(
    drive_root_str: &str,
    app: &AppHandle,
    startup_ctx: Option<&StartupEmitContext>,
) -> Result<DriveIndex, String> {
    let start_time = Instant::now();
    let root_path = PathBuf::from(drive_root_str);
    if !root_path.exists() {
        return Err(format!("Disk root does not exist: {}", drive_root_str));
    }

    let root_norm = normalize_path_key(drive_root_str);
    let display_root = if drive_root_str.ends_with('\\') {
        drive_root_str.to_string()
    } else {
        format!("{}\\", drive_root_str)
    };
    let root_mtime = fs::symlink_metadata(&root_path)
        .ok()
        .and_then(|m| metadata_mtime_secs(&m));

    let scanned_files = Arc::new(AtomicU64::new(0));
    let scanned_bytes = Arc::new(AtomicU64::new(0));
    let scanned_folders = Arc::new(AtomicU64::new(0));
    let latest_folder = Arc::new(Mutex::new(display_root.clone()));
    let done_flag = Arc::new(AtomicBool::new(false));

    // Dedicated real-time speed telemetry ticker (120ms sampling, 480ms rolling window)
    let ticker_files = Arc::clone(&scanned_files);
    let ticker_folders = Arc::clone(&scanned_folders);
    let ticker_bytes = Arc::clone(&scanned_bytes);
    let ticker_latest = Arc::clone(&latest_folder);
    let ticker_done = Arc::clone(&done_flag);
    let ticker_app = app.clone();
    let ticker_drive = display_root.clone();
    let ticker_startup = startup_ctx.cloned();

    let ticker_handle = thread::spawn(move || {
        let mut window: VecDeque<(Instant, u64, u64, u64)> = VecDeque::with_capacity(8);
        window.push_back((start_time, 0, 0, 0));

        while !ticker_done.load(Ordering::Relaxed) {
            thread::sleep(Duration::from_millis(120));
            if ticker_done.load(Ordering::Relaxed) {
                break;
            }

            let now = Instant::now();
            let cur_folders = ticker_folders.load(Ordering::Relaxed);
            let cur_files = ticker_files.load(Ordering::Relaxed);
            let cur_bytes = ticker_bytes.load(Ordering::Relaxed);

            // Keep ~480ms rolling window for responsive instantaneous throughput
            while window.len() > 1 {
                if let Some(&(oldest_ts, _, _, _)) = window.front() {
                    if now.duration_since(oldest_ts) > Duration::from_millis(480) {
                        window.pop_front();
                    } else {
                        break;
                    }
                }
            }

            let (base_ts, base_folders, base_files, base_bytes) =
                window.front().copied().unwrap_or((start_time, 0, 0, 0));
            let dt_secs = now.duration_since(base_ts).as_secs_f64().max(0.05);

            let folders_per_sec =
                ((cur_folders.saturating_sub(base_folders)) as f64 / dt_secs) as u64;
            let files_per_sec = ((cur_files.saturating_sub(base_files)) as f64 / dt_secs) as u64;
            let items_per_sec = folders_per_sec + files_per_sec;
            let bytes_per_sec = ((cur_bytes.saturating_sub(base_bytes)) as f64 / dt_secs) as u64;

            window.push_back((now, cur_folders, cur_files, cur_bytes));

            let current_folder = ticker_latest
                .lock()
                .map(|s| s.clone())
                .unwrap_or_default();

            let _ = ticker_app.emit(
                "analyze:progress",
                AnalyzeProgress {
                    current_folder,
                    drive_root: ticker_drive.clone(),
                    folders_scanned: cur_folders,
                    files_scanned: cur_files,
                    bytes_scanned: cur_bytes,
                    items_per_sec,
                    folders_per_sec,
                    files_per_sec,
                    bytes_per_sec,
                    elapsed_ms: start_time.elapsed().as_millis() as u64,
                },
            );

            if let Some(ref sctx) = ticker_startup {
                if sctx.current_drive.eq_ignore_ascii_case(&ticker_drive) {
                    let _ = ticker_app.emit(
                        "startup:sync-progress",
                        StartupSyncProgress {
                            is_active: true,
                            current_drive: sctx.current_drive.clone(),
                            current_index: sctx.current_index,
                            total_drives: sctx.total_drives,
                            completed_drives: sctx.completed_drives.clone(),
                            stage: sctx.stage.clone(),
                            message: format!(
                                "Indexing {} ({}/{})...",
                                sctx.current_drive, sctx.current_index, sctx.total_drives
                            ),
                            items_per_sec,
                            folders_scanned: cur_folders,
                            files_scanned: cur_files,
                            bytes_scanned: cur_bytes,
                        },
                    );
                }
            }
        }
    });

    let shards: Vec<Mutex<Vec<(String, DirNode)>>> =
        (0..NUM_SHARDS).map(|_| Mutex::new(Vec::with_capacity(2048))).collect();

    let ctx = NativeScanContext {
        shards,
        scanned_files: Arc::clone(&scanned_files),
        scanned_folders: Arc::clone(&scanned_folders),
        scanned_bytes: Arc::clone(&scanned_bytes),
        latest_folder: Arc::clone(&latest_folder),
    };

    // Run parallel scan on a dedicated bounded Rayon pool (2..=6 threads, 4 MB stack)
    // so NTFS saturates cleanly WITHOUT starving WebView2 UI or Windows message loop!
    let pool_threads = thread::available_parallelism()
        .map(|n| (n.get() / 2).clamp(2, 6))
        .unwrap_or(4);
    let scan_pool = rayon::ThreadPoolBuilder::new()
        .num_threads(pool_threads)
        .stack_size(4 * 1024 * 1024)
        .build()
        .map_err(|e| format!("Failed to build scan thread pool: {}", e))?;

    let (root_bytes, root_files, root_subfolders) = scan_pool.install(|| {
        scan_dir_native_parallel(
            display_root.clone(),
            root_norm.clone(),
            display_root.clone(),
            None,
            root_mtime,
            0,
            &ctx,
        )
    });

    done_flag.store(true, Ordering::SeqCst);
    let _ = ticker_handle.join();

    // Merge all 32 shards into one pre-sized HashMap
    let total_nodes: usize = ctx
        .shards
        .iter()
        .map(|s| s.lock().map(|v| v.len()).unwrap_or(0))
        .sum();
    let mut nodes: HashMap<String, DirNode> = HashMap::with_capacity(total_nodes + 16);
    for shard in ctx.shards {
        if let Ok(vec) = shard.into_inner() {
            for (k, v) in vec {
                nodes.insert(k, v);
            }
        }
    }

    let elapsed_ms = start_time.elapsed().as_millis() as u64;
    let avg_secs = (elapsed_ms as f64 / 1000.0).max(0.01);
    let avg_folders_sec = (root_subfolders as f64 / avg_secs) as u64;
    let avg_files_sec = (root_files as f64 / avg_secs) as u64;
    let avg_bytes_sec = (root_bytes as f64 / avg_secs) as u64;

    let _ = app.emit(
        "analyze:progress",
        AnalyzeProgress {
            current_folder: "Full Disk Index Completed".to_string(),
            drive_root: display_root.clone(),
            folders_scanned: root_subfolders,
            files_scanned: root_files,
            bytes_scanned: root_bytes,
            items_per_sec: avg_folders_sec + avg_files_sec,
            folders_per_sec: avg_folders_sec,
            files_per_sec: avg_files_sec,
            bytes_per_sec: avg_bytes_sec,
            elapsed_ms,
        },
    );

    let ts = now_ms();
    Ok(DriveIndex {
        drive_root: display_root.clone(),
        root_key: root_norm,
        volume_serial: get_volume_serial(&display_root),
        nodes,
        revision: 1,
        indexed_at_ms: ts,
        last_updated_ms: ts,
        is_watching: false,
        is_syncing: false,
        from_cache: false,
        last_sync_summary: Some("Full disk indexed".to_string()),
    })
}

fn aggregate_bottom_up(nodes: &mut HashMap<String, DirNode>) {
    // Ensure parent -> child_dirs links are complete
    let links: Vec<(String, String)> = nodes
        .iter()
        .filter_map(|(k, n)| n.parent_key.as_ref().map(|pk| (pk.clone(), k.clone())))
        .collect();

    for (pk, ck) in links {
        if let Some(pnode) = nodes.get_mut(&pk) {
            pnode.child_dirs.insert(ck);
        }
    }

    // Sort keys deepest-first
    let mut keys: Vec<String> = nodes.keys().cloned().collect();
    keys.sort_by(|a, b| {
        let da = a.matches('\\').count();
        let db = b.matches('\\').count();
        db.cmp(&da)
    });

    for key in &keys {
        let child_keys: Vec<String> = nodes
            .get(key)
            .map(|n| n.child_dirs.iter().cloned().collect())
            .unwrap_or_default();

        let mut child_bytes = 0u64;
        let mut child_files = 0u64;
        let mut child_subs = 0u64;

        for ck in &child_keys {
            if let Some(cn) = nodes.get(ck) {
                child_bytes += cn.total_bytes;
                child_files += cn.total_files;
                child_subs += 1 + cn.total_subfolders;
            }
        }

        if let Some(node) = nodes.get_mut(key) {
            node.total_bytes = node.direct_bytes + child_bytes;
            node.total_files = node.direct_files + child_files;
            node.total_subfolders = child_subs;
        }
    }
}

// =========================================================================
// Compact Binary Snapshot Persistence (Instant Cold Revisit!)
// =========================================================================

fn snapshot_cache_dir() -> Option<PathBuf> {
    let local = env::var("LOCALAPPDATA").ok()?;
    Some(PathBuf::from(local).join("Ferrowipe").join("cache"))
}

fn snapshot_path_for_drive(drive_key: &str) -> Option<PathBuf> {
    let dir = snapshot_cache_dir()?;
    let letter = drive_key.chars().next()?.to_ascii_uppercase();
    Some(dir.join(format!("drive_{}.fwidx", letter)))
}

/// Serializes `DriveIndex` to an in-memory buffer under a brief read lock, releases the lock
/// immediately, and writes to disk with ZERO locks held so UI reads are never stalled.
pub fn save_drive_snapshot_nonblocking(arc: &Arc<RwLock<DriveIndex>>) -> Result<(), String> {
    let (root_key, bytes) = {
        let idx = arc.read().map_err(|_| "Index lock poisoned".to_string())?;
        let mut buf = Vec::with_capacity(idx.nodes.len() * 64);
        write_snapshot_to_writer(&idx, &mut buf).map_err(|e| e.to_string())?;
        (idx.root_key.clone(), buf)
    };

    let path = snapshot_path_for_drive(&root_key)
        .ok_or_else(|| "Unable to determine snapshot cache directory".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let tmp_path = path.with_extension("fwidx.tmp");
    {
        let mut file = File::create(&tmp_path).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
    }

    let _ = fs::remove_file(&path);
    fs::rename(&tmp_path, &path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn save_drive_snapshot(index: &DriveIndex) -> Result<(), String> {
    let path = snapshot_path_for_drive(&index.root_key)
        .ok_or_else(|| "Unable to determine snapshot cache directory".to_string())?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let tmp_path = path.with_extension("fwidx.tmp");
    {
        let file = File::create(&tmp_path).map_err(|e| e.to_string())?;
        let mut w = BufWriter::with_capacity(128 * 1024, file);
        write_snapshot_to_writer(index, &mut w).map_err(|e| e.to_string())?;
        w.flush().map_err(|e| e.to_string())?;
    }

    let _ = fs::remove_file(&path);
    fs::rename(&tmp_path, &path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_drive_snapshot(drive_key: &str, expected_serial: u32) -> Option<DriveIndex> {
    let path = snapshot_path_for_drive(drive_key)?;
    if !path.is_file() {
        return None;
    }
    let file = File::open(&path).ok()?;
    let mut r = BufReader::with_capacity(128 * 1024, file);
    let idx = read_snapshot_from_reader(&mut r).ok()?;

    if idx.root_key != drive_key {
        return None;
    }
    if expected_serial != 0 && idx.volume_serial != 0 && idx.volume_serial != expected_serial {
        return None;
    }
    Some(idx)
}

fn write_snapshot_to_writer<W: Write>(index: &DriveIndex, w: &mut W) -> std::io::Result<()> {
    w.write_all(SNAPSHOT_MAGIC)?;
    w.write_all(&index.volume_serial.to_le_bytes())?;
    w.write_all(&index.indexed_at_ms.to_le_bytes())?;
    write_str(w, &index.drive_root)?;
    write_str(w, &index.root_key)?;
    w.write_all(&(index.nodes.len() as u32).to_le_bytes())?;

    for (key, node) in &index.nodes {
        write_str(w, key)?;
        write_str(w, &node.path)?;
        write_str(w, &node.name)?;
        match &node.parent_key {
            Some(pk) => {
                w.write_all(&[1u8])?;
                write_str(w, pk)?;
            }
            None => w.write_all(&[0u8])?,
        }
        write_opt_u64(w, node.last_modified)?;
        let flags = (node.is_junction as u8) | ((node.is_access_denied as u8) << 1);
        w.write_all(&[flags])?;
        w.write_all(&(node.direct_file_entries.len() as u32).to_le_bytes())?;
        for fe in node.direct_file_entries.values() {
            write_str(w, &fe.name)?;
            w.write_all(&fe.size_bytes.to_le_bytes())?;
            write_opt_u64(w, fe.last_modified)?;
        }
    }

    Ok(())
}

fn read_snapshot_from_reader<R: Read>(r: &mut R) -> std::io::Result<DriveIndex> {
    let mut magic = [0u8; 8];
    r.read_exact(&mut magic)?;
    if &magic != SNAPSHOT_MAGIC {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "Invalid snapshot magic",
        ));
    }

    let volume_serial = read_u32(r)?;
    let indexed_at_ms = read_u64(r)?;
    let drive_root = read_str(r)?;
    let root_key = read_str(r)?;
    let node_count = read_u32(r)? as usize;

    let mut nodes: HashMap<String, DirNode> = HashMap::with_capacity(node_count);

    for _ in 0..node_count {
        let key = read_str(r)?;
        let path = read_str(r)?;
        let name = read_str(r)?;
        let has_parent = read_u8(r)?;
        let parent_key = if has_parent != 0 {
            Some(read_str(r)?)
        } else {
            None
        };
        let last_modified = read_opt_u64(r)?;
        let flags = read_u8(r)?;
        let is_junction = (flags & 1) != 0;
        let is_access_denied = (flags & 2) != 0;

        let file_count = read_u32(r)? as usize;
        let mut direct_file_entries = HashMap::with_capacity(file_count);
        let mut direct_bytes = 0u64;
        for _ in 0..file_count {
            let fname = read_str(r)?;
            let size_bytes = read_u64(r)?;
            let fmtime = read_opt_u64(r)?;
            direct_bytes += size_bytes;
            direct_file_entries.insert(
                fname.to_uppercase(),
                FileEntry {
                    name: fname,
                    size_bytes,
                    last_modified: fmtime,
                },
            );
        }

        let mut node = DirNode::new(path, name, parent_key, last_modified, is_junction, is_access_denied);
        node.direct_bytes = direct_bytes;
        node.direct_files = direct_file_entries.len() as u64;
        node.direct_file_entries = direct_file_entries;

        nodes.insert(key, node);
    }

    aggregate_bottom_up(&mut nodes);

    Ok(DriveIndex {
        drive_root,
        root_key,
        volume_serial,
        nodes,
        revision: 1,
        indexed_at_ms,
        last_updated_ms: now_ms(),
        is_watching: false,
        is_syncing: false,
        from_cache: true,
        last_sync_summary: Some("Loaded from snapshot".to_string()),
    })
}

fn write_str<W: Write>(w: &mut W, s: &str) -> std::io::Result<()> {
    let bytes = s.as_bytes();
    w.write_all(&(bytes.len() as u32).to_le_bytes())?;
    w.write_all(bytes)
}

fn read_str<R: Read>(r: &mut R) -> std::io::Result<String> {
    let len = read_u32(r)? as usize;
    let mut buf = vec![0u8; len];
    r.read_exact(&mut buf)?;
    String::from_utf8(buf)
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidData, "Invalid UTF-8"))
}

fn write_opt_u64<W: Write>(w: &mut W, val: Option<u64>) -> std::io::Result<()> {
    match val {
        Some(v) => {
            w.write_all(&[1u8])?;
            w.write_all(&v.to_le_bytes())
        }
        None => w.write_all(&[0u8]),
    }
}

fn read_opt_u64<R: Read>(r: &mut R) -> std::io::Result<Option<u64>> {
    if read_u8(r)? != 0 {
        Ok(Some(read_u64(r)?))
    } else {
        Ok(None)
    }
}

fn read_u8<R: Read>(r: &mut R) -> std::io::Result<u8> {
    let mut b = [0u8; 1];
    r.read_exact(&mut b)?;
    Ok(b[0])
}

fn read_u32<R: Read>(r: &mut R) -> std::io::Result<u32> {
    let mut b = [0u8; 4];
    r.read_exact(&mut b)?;
    Ok(u32::from_le_bytes(b))
}

fn read_u64<R: Read>(r: &mut R) -> std::io::Result<u64> {
    let mut b = [0u8; 8];
    r.read_exact(&mut b)?;
    Ok(u64::from_le_bytes(b))
}

// =========================================================================
// Utility Functions
// =========================================================================

pub fn normalize_path_key(s: &str) -> String {
    let clean = s
        .trim()
        .trim_start_matches("\\\\?\\")
        .replace('/', "\\")
        .to_uppercase();
    clean.trim_end_matches('\\').to_string()
}

pub fn extract_drive_root(path: &str) -> Option<(String, String)> {
    let norm = normalize_path_key(path);
    let bytes = norm.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        let letter = bytes[0] as char;
        Some((format!("{}:\\", letter), format!("{}:", letter)))
    } else {
        None
    }
}

fn apply_signed_delta(base: u64, delta: i64) -> u64 {
    if delta >= 0 {
        base.saturating_add(delta as u64)
    } else {
        base.saturating_sub(delta.unsigned_abs())
    }
}

fn metadata_mtime_secs(meta: &fs::Metadata) -> Option<u64> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn to_wide_null(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn get_volume_serial(drive_root: &str) -> u32 {
    let wide = to_wide_null(drive_root);
    let mut serial = 0u32;
    let mut max_comp = 0u32;
    let mut flags = 0u32;
    let ok = unsafe {
        GetVolumeInformationW(
            wide.as_ptr(),
            null_mut(),
            0,
            &mut serial,
            &mut max_comp,
            &mut flags,
            null_mut(),
            0,
        )
    };
    if ok != 0 {
        serial
    } else {
        0
    }
}

fn format_delta_summary(changes: u64, byte_delta: i64) -> String {
    let unit = if changes == 1 { "change" } else { "changes" };
    if byte_delta == 0 {
        format!("Synced {} {}", changes, unit)
    } else {
        let abs = byte_delta.unsigned_abs();
        let sign = if byte_delta > 0 { "+" } else { "-" };
        format!("Synced {} {} ({}{})", changes, unit, sign, format_bytes_short(abs))
    }
}

fn format_bytes_short(bytes: u64) -> String {
    const KB: f64 = 1024.0;
    const MB: f64 = KB * 1024.0;
    const GB: f64 = MB * 1024.0;
    let b = bytes as f64;
    if b >= GB {
        format!("{:.1} GB", b / GB)
    } else if b >= MB {
        format!("{:.1} MB", b / MB)
    } else if b >= KB {
        format!("{:.1} KB", b / KB)
    } else {
        format!("{} B", bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn make_temp_test_root(name: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("ferrowipe_idx_test_{}_{}", name, now_ms()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn test_incremental_reconcile_add_modify_delete() {
        let root = make_temp_test_root("reconcile");
        let sub = root.join("subA");
        fs::create_dir_all(&sub).unwrap();
        let f1 = sub.join("a.bin");
        fs::write(&f1, vec![1u8; 1000]).unwrap();

        let root_str = root.to_string_lossy().to_string();
        let root_norm = normalize_path_key(&root_str);

        let mut nodes = HashMap::new();
        nodes.insert(
            root_norm.clone(),
            DirNode::new(root_str.clone(), "root".to_string(), None, None, false, false),
        );

        let mut idx = DriveIndex {
            drive_root: root_str.clone(),
            root_key: root_norm.clone(),
            volume_serial: 123,
            nodes,
            revision: 1,
            indexed_at_ms: 0,
            last_updated_ms: 0,
            is_watching: false,
            is_syncing: false,
            from_cache: false,
            last_sync_summary: None,
        };

        // 1. Add subtree subA
        let stats = idx.reconcile_changed_paths(&[sub.clone()]);
        assert_eq!(stats.byte_delta, 1000);
        assert_eq!(idx.nodes.get(&root_norm).unwrap().total_bytes, 1000);
        assert_eq!(idx.nodes.get(&root_norm).unwrap().total_files, 1);
        assert_eq!(idx.nodes.get(&root_norm).unwrap().total_subfolders, 1);

        // 2. Modify file size (grow by +500 bytes)
        fs::write(&f1, vec![2u8; 1500]).unwrap();
        let stats2 = idx.reconcile_changed_paths(&[f1.clone()]);
        assert_eq!(stats2.byte_delta, 500);
        assert_eq!(idx.nodes.get(&root_norm).unwrap().total_bytes, 1500);

        // 3. Manually delete entire folder subA
        fs::remove_dir_all(&sub).unwrap();
        let stats3 = idx.reconcile_changed_paths(&[sub.clone()]);
        assert_eq!(stats3.byte_delta, -1500);
        assert_eq!(idx.nodes.get(&root_norm).unwrap().total_bytes, 0);
        assert_eq!(idx.nodes.get(&root_norm).unwrap().total_files, 0);
        assert_eq!(idx.nodes.get(&root_norm).unwrap().total_subfolders, 0);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn test_binary_snapshot_roundtrip() {
        let mut nodes = HashMap::new();
        let mut root = DirNode::new("D:\\".to_string(), "D:\\".to_string(), None, Some(100), false, false);
        root.direct_file_entries.insert(
            "README.TXT".to_string(),
            FileEntry {
                name: "readme.txt".to_string(),
                size_bytes: 420,
                last_modified: Some(111),
            },
        );
        root.direct_bytes = 420;
        root.direct_files = 1;
        nodes.insert("D:".to_string(), root);

        let mut child = DirNode::new(
            "D:\\Games".to_string(),
            "Games".to_string(),
            Some("D:".to_string()),
            Some(200),
            false,
            false,
        );
        child.direct_file_entries.insert(
            "DATA.PAK".to_string(),
            FileEntry {
                name: "data.pak".to_string(),
                size_bytes: 10_000,
                last_modified: Some(222),
            },
        );
        child.direct_bytes = 10_000;
        child.direct_files = 1;
        nodes.insert("D:\\GAMES".to_string(), child);

        aggregate_bottom_up(&mut nodes);

        let orig = DriveIndex {
            drive_root: "D:\\".to_string(),
            root_key: "D:".to_string(),
            volume_serial: 9999,
            nodes,
            revision: 5,
            indexed_at_ms: 123456,
            last_updated_ms: 123456,
            is_watching: false,
            is_syncing: false,
            from_cache: false,
            last_sync_summary: None,
        };

        let mut buf = Vec::new();
        write_snapshot_to_writer(&orig, &mut buf).unwrap();
        let loaded = read_snapshot_from_reader(&mut Cursor::new(buf)).unwrap();

        assert_eq!(loaded.root_key, "D:");
        assert_eq!(loaded.volume_serial, 9999);
        assert_eq!(loaded.nodes.get("D:").unwrap().total_bytes, 10_420);
        assert_eq!(loaded.nodes.get("D:").unwrap().total_files, 2);
        assert_eq!(loaded.nodes.get("D:").unwrap().total_subfolders, 1);
        assert_eq!(loaded.nodes.get("D:\\GAMES").unwrap().total_bytes, 10_000);
    }

    #[test]
    fn test_windows_realtime_watcher_detects_manual_delete() {
        let root = make_temp_test_root("watcher");
        let file = root.join("manual_delete_me.txt");
        fs::write(&file, vec![7u8; 256]).unwrap();

        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_event = unsafe { CreateEventW(null_mut(), 1, 0, null_mut()) };
        assert!(!stop_event.is_null());

        let (tx, rx) = mpsc::channel();
        let root_str = format!("{}\\", root.to_string_lossy().trim_end_matches('\\'));
        let sf = Arc::clone(&stop_flag);
        let se = stop_event as isize;
        let handle = thread::spawn(move || {
            run_windows_directory_watcher(&root_str, "", sf, se, tx);
        });

        // Give watcher 100ms to arm ReadDirectoryChangesW
        thread::sleep(Duration::from_millis(100));

        // Simulate manual deletion
        fs::remove_file(&file).unwrap();

        // Expect event within 2 seconds
        let mut saw_file = false;
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if let Ok(WatchMsg::Changed(p)) = rx.recv_timeout(Duration::from_millis(100)) {
                if normalize_path_key(&p.to_string_lossy())
                    == normalize_path_key(&file.to_string_lossy())
                {
                    saw_file = true;
                    break;
                }
            }
        }

        stop_flag.store(true, Ordering::SeqCst);
        unsafe {
            SetEvent(stop_event);
        }
        let _ = handle.join();
        unsafe {
            CloseHandle(stop_event);
        }
        let _ = fs::remove_dir_all(&root);

        assert!(saw_file, "ReadDirectoryChangesW should detect manual file deletion in real-time");
    }

    #[test]
    fn test_native_win32_parallel_scanner() {
        let root = make_temp_test_root("native_scan");
        let a = root.join("alpha");
        let b = root.join("beta").join("nested");
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        fs::write(root.join("top.bin"), vec![1u8; 300]).unwrap();
        fs::write(a.join("f1.bin"), vec![2u8; 700]).unwrap();
        fs::write(b.join("f2.bin"), vec![3u8; 1000]).unwrap();

        let root_str = root.to_string_lossy().to_string();
        let root_norm = normalize_path_key(&root_str);

        let ctx = NativeScanContext {
            shards: (0..NUM_SHARDS).map(|_| Mutex::new(Vec::new())).collect(),
            scanned_files: Arc::new(AtomicU64::new(0)),
            scanned_folders: Arc::new(AtomicU64::new(0)),
            scanned_bytes: Arc::new(AtomicU64::new(0)),
            latest_folder: Arc::new(Mutex::new(String::new())),
        };

        let (total_bytes, total_files, total_subfolders) = scan_dir_native_parallel(
            root_str,
            root_norm,
            "root".to_string(),
            None,
            None,
            0,
            &ctx,
        );

        let _ = fs::remove_dir_all(&root);

        assert_eq!(total_bytes, 2000);
        assert_eq!(total_files, 3);
        assert_eq!(total_subfolders, 3); // alpha, beta, nested
        assert_eq!(ctx.scanned_files.load(Ordering::Relaxed), 3);
        assert_eq!(ctx.scanned_bytes.load(Ordering::Relaxed), 2000);
    }

    #[test]
    fn test_evaluate_disk_size_match() {
        let gb = 1024u64 * 1024 * 1024;
        // Within tolerance (0.4 GB diff on 120 GB used) -> matched
        let ok = evaluate_disk_size_match(500 * gb, 120 * gb, 120 * gb - 400 * 1024 * 1024);
        assert!(ok.matched);
        assert!(ok.match_percentage >= 99.0);

        // 20 GB missing -> NOT matched (should trigger recalculation)
        let missing = evaluate_disk_size_match(500 * gb, 120 * gb, 100 * gb);
        assert!(!missing.matched);
        assert_eq!(missing.difference_bytes, -(20 * gb as i64));

        // Corrupted scan exceeding full disk capacity -> NEVER matched
        let corrupted = evaluate_disk_size_match(500 * gb, 499 * gb, 505 * gb);
        assert!(!corrupted.matched);
    }

    #[test]
    fn test_reparse_dir_classification() {
        // Junction (mount point) -> non-traversable
        assert!(is_non_traversable_reparse_dir(
            FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT,
            0xA000_0003
        ));
        // Symlink -> non-traversable
        assert!(is_non_traversable_reparse_dir(
            FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT,
            0xA000_000C
        ));
        // OneDrive Cloud Files placeholder directory -> traversable!
        assert!(!is_non_traversable_reparse_dir(
            FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT,
            0x9000_001A
        ));
        assert!(!is_non_traversable_reparse_dir(
            FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT,
            0x9000_301A
        ));
    }
}
