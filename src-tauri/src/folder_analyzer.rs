use std::collections::HashMap;
use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use windows_sys::Win32::UI::Shell::{
    SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_DELETE,
    SHFILEOPSTRUCTW,
};

use crate::models::SkippedFile;

const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub parent_path: Option<String>,
    pub size_bytes: u64,
    pub file_count: u64,
    pub subfolder_count: u64,
    pub is_dir: bool,
    pub last_modified: Option<u64>,
    pub percentage: f64,
    pub depth: usize,
    pub has_subfolders: bool,
    pub is_junction: bool,
    pub is_access_denied: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FolderAnalysisResult {
    pub target_path: String,
    pub total_bytes: u64,
    pub total_files: u64,
    pub total_folders: u64,
    pub items: Vec<FolderItem>,
    pub duration_ms: u64,
    pub is_full_disk: bool,
    pub from_cache: bool,
    pub is_watching: bool,
    pub is_syncing: bool,
    pub revision: u64,
    pub last_sync_summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyzeProgress {
    pub current_folder: String,
    pub drive_root: String,
    pub folders_scanned: u64,
    pub files_scanned: u64,
    pub bytes_scanned: u64,
    pub items_per_sec: u64,
    pub folders_per_sec: u64,
    pub files_per_sec: u64,
    pub bytes_per_sec: u64,
    pub elapsed_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteFoldersRequest {
    pub paths: Vec<String>,
    pub permanent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeleteFoldersReport {
    pub deleted_paths: Vec<String>,
    pub failed_paths: Vec<SkippedFile>,
    pub freed_bytes: u64,
    pub duration_ms: u64,
}

fn to_double_null_wide(s: &str) -> Vec<u16> {
    let mut wide: Vec<u16> = std::ffi::OsStr::new(s).encode_wide().collect();
    wide.push(0);
    wide.push(0);
    wide
}

pub fn is_junction_or_symlink(path: &Path) -> bool {
    if let Ok(meta) = fs::symlink_metadata(path) {
        meta.file_type().is_symlink() || (meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT) != 0
    } else {
        false
    }
}

pub fn is_protected_path(path: &Path) -> bool {
    let clean = path.to_string_lossy().replace('/', "\\").to_uppercase();
    let trimmed = clean.trim_end_matches('\\');

    // Protect root drives e.g. "C:", "D:"
    if trimmed.len() <= 3 && trimmed.ends_with(':') {
        return true;
    }

    let protected = [
        "C:\\WINDOWS",
        "C:\\WINDOWS\\SYSTEM32",
        "C:\\WINDOWS\\SYSWOW64",
        "C:\\USERS",
        "C:\\PROGRAM FILES",
        "C:\\PROGRAM FILES (x86)",
    ];

    for p in protected {
        if trimmed == p {
            return true;
        }
    }

    false
}

/// Recursively computes directory size and file count using jwalk
pub fn compute_directory_metrics(
    dir: &Path,
    cancel_flag: &AtomicBool,
) -> (u64, u64, u64, bool, bool) {
    if is_junction_or_symlink(dir) {
        return (0, 0, 0, true, false);
    }

    // Check read access
    match fs::read_dir(dir) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            return (0, 0, 0, false, true);
        }
        Err(_) => {}
    }

    let mut total_bytes = 0u64;
    let mut file_count = 0u64;
    let mut subfolder_count = 0u64;
    let mut is_denied = false;

    let walker = jwalk::WalkDir::new(dir)
        .skip_hidden(false)
        .follow_links(false)
        .process_read_dir(|_depth, _path, _state, children| {
            for child_res in children.iter_mut() {
                if let Ok(entry) = child_res {
                    if entry.file_type.is_dir() && is_junction_or_symlink(&entry.path()) {
                        entry.read_children_path = None;
                    }
                }
            }
        });

    for entry_res in walker {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        match entry_res {
            Ok(entry) => {
                if entry.depth == 0 {
                    continue;
                }

                let file_type = entry.file_type();
                if file_type.is_dir() {
                    subfolder_count += 1;
                } else if file_type.is_file() {
                    file_count += 1;
                    if let Ok(meta) = entry.metadata() {
                        total_bytes += meta.len();
                    }
                }
            }
            Err(e) => {
                if let Some(io_err) = e.io_error() {
                    if io_err.kind() == std::io::ErrorKind::PermissionDenied {
                        is_denied = true;
                    }
                }
            }
        }
    }

    (total_bytes, file_count, subfolder_count, false, is_denied)
}

/// Analyzes immediate children of `target_path` in parallel, returning FolderItems
pub fn analyze_directory(
    target_path_str: &str,
    depth: usize,
    cancel_flag: Arc<AtomicBool>,
    app: AppHandle,
) -> Result<FolderAnalysisResult, String> {
    let start_time = Instant::now();
    let target_path = PathBuf::from(target_path_str);

    if !target_path.exists() {
        return Err(format!("Path does not exist: {}", target_path_str));
    }

    let entries = match fs::read_dir(&target_path) {
        Ok(e) => e,
        Err(err) => return Err(format!("Unable to access directory: {}", err)),
    };

    let mut direct_files = Vec::new();
    let mut direct_dirs = Vec::new();

    for entry in entries.flatten() {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }
        let path = entry.path();
        if let Ok(file_type) = entry.file_type() {
            if file_type.is_dir() {
                direct_dirs.push(path);
            } else if file_type.is_file() {
                direct_files.push(path);
            }
        }
    }

    let total_scanned_bytes = Arc::new(AtomicU64::new(0));
    let total_scanned_files = Arc::new(AtomicU64::new(0));
    let total_scanned_dirs = Arc::new(AtomicU64::new(direct_dirs.len() as u64));
    let last_emit = Arc::new(std::sync::Mutex::new(Instant::now()));

    // Process immediate subfolders in parallel using Rayon
    let cancel_flag_clone = Arc::clone(&cancel_flag);
    let total_bytes_clone = Arc::clone(&total_scanned_bytes);
    let total_files_clone = Arc::clone(&total_scanned_files);
    let last_emit_clone = Arc::clone(&last_emit);
    let app_clone = app.clone();
    let parent_str = Some(target_path.to_string_lossy().to_string());

    let mut folder_items: Vec<FolderItem> = direct_dirs
        .into_par_iter()
        .filter_map(|dir_path| {
            if cancel_flag_clone.load(Ordering::Relaxed) {
                return None;
            }

            let name = dir_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| dir_path.to_string_lossy().to_string());

            let (size_bytes, file_count, subfolder_count, is_junction, is_access_denied) =
                compute_directory_metrics(&dir_path, &cancel_flag_clone);

            total_bytes_clone.fetch_add(size_bytes, Ordering::Relaxed);
            total_files_clone.fetch_add(file_count, Ordering::Relaxed);

            // Throttled progress emit
            if let Ok(mut last) = last_emit_clone.lock() {
                if last.elapsed() >= Duration::from_millis(60) {
                    *last = Instant::now();
                    let _ = app_clone.emit(
                        "analyze:progress",
                        AnalyzeProgress {
                            current_folder: name.clone(),
                            drive_root: target_path.to_string_lossy().to_string(),
                            folders_scanned: total_scanned_dirs.load(Ordering::Relaxed),
                            files_scanned: total_files_clone.load(Ordering::Relaxed),
                            bytes_scanned: total_bytes_clone.load(Ordering::Relaxed),
                            items_per_sec: 0,
                            folders_per_sec: 0,
                            files_per_sec: 0,
                            bytes_per_sec: 0,
                            elapsed_ms: start_time.elapsed().as_millis() as u64,
                        },
                    );
                }
            }

            let last_modified = dir_path
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());

            Some(FolderItem {
                id: dir_path.to_string_lossy().to_string(),
                name,
                path: dir_path.to_string_lossy().to_string(),
                parent_path: parent_str.clone(),
                size_bytes,
                file_count,
                subfolder_count,
                is_dir: true,
                last_modified,
                percentage: 0.0,
                depth,
                has_subfolders: subfolder_count > 0,
                is_junction,
                is_access_denied,
            })
        })
        .collect();

    // Process immediate files
    for file_path in direct_files {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        if let Ok(meta) = file_path.metadata() {
            let size = meta.len();
            total_scanned_bytes.fetch_add(size, Ordering::Relaxed);
            total_scanned_files.fetch_add(1, Ordering::Relaxed);

            let last_modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());

            let name = file_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| file_path.to_string_lossy().to_string());

            folder_items.push(FolderItem {
                id: file_path.to_string_lossy().to_string(),
                name,
                path: file_path.to_string_lossy().to_string(),
                parent_path: Some(target_path.to_string_lossy().to_string()),
                size_bytes: size,
                file_count: 1,
                subfolder_count: 0,
                is_dir: false,
                last_modified,
                percentage: 0.0,
                depth,
                has_subfolders: false,
                is_junction: false,
                is_access_denied: false,
            });
        }
    }

    let overall_bytes = total_scanned_bytes.load(Ordering::Relaxed);

    // Calculate percentage and sort descending by size
    for item in &mut folder_items {
        if overall_bytes > 0 {
            item.percentage =
                ((item.size_bytes as f64 / overall_bytes as f64) * 1000.0).round() / 10.0;
        }
    }

    folder_items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

    let _ = app.emit(
        "analyze:progress",
        AnalyzeProgress {
            current_folder: "Analysis Complete".to_string(),
            drive_root: target_path.to_string_lossy().to_string(),
            folders_scanned: total_scanned_dirs.load(Ordering::Relaxed),
            files_scanned: total_scanned_files.load(Ordering::Relaxed),
            bytes_scanned: overall_bytes,
            items_per_sec: 0,
            folders_per_sec: 0,
            files_per_sec: 0,
            bytes_per_sec: 0,
            elapsed_ms: start_time.elapsed().as_millis() as u64,
        },
    );

    Ok(FolderAnalysisResult {
        target_path: target_path.to_string_lossy().to_string(),
        total_bytes: overall_bytes,
        total_files: total_scanned_files.load(Ordering::Relaxed),
        total_folders: total_scanned_dirs.load(Ordering::Relaxed),
        items: folder_items,
        duration_ms: start_time.elapsed().as_millis() as u64,
        is_full_disk: false,
        from_cache: false,
        is_watching: false,
        is_syncing: false,
        revision: 0,
        last_sync_summary: None,
    })
}

/// Helper structure for full disk bottom-up aggregation
struct RawDirNode {
    path: PathBuf,
    name: String,
    parent_path: Option<String>,
    direct_bytes: u64,
    direct_files: u64,
    total_bytes: u64,
    total_files: u64,
    subfolder_count: u64,
    last_modified: Option<u64>,
    is_junction: bool,
    is_access_denied: bool,
}

/// High-speed Full Disk Analysis: walks the entire drive, aggregates sizes bottom-up,
/// and populates the in-memory cache for instant hierarchical tree expansion.
pub fn analyze_full_disk_tree(
    disk_root_str: &str,
    cache: Arc<RwLock<HashMap<String, Vec<FolderItem>>>>,
    cancel_flag: Arc<AtomicBool>,
    app: AppHandle,
) -> Result<FolderAnalysisResult, String> {
    let start_time = Instant::now();
    let root_path = PathBuf::from(disk_root_str);

    if !root_path.exists() {
        return Err(format!("Disk root does not exist: {}", disk_root_str));
    }

    let scanned_files = Arc::new(AtomicU64::new(0));
    let scanned_bytes = Arc::new(AtomicU64::new(0));
    let scanned_folders = Arc::new(AtomicU64::new(0));
    let last_emit = Arc::new(std::sync::Mutex::new(Instant::now()));

    let mut raw_nodes: HashMap<String, RawDirNode> = HashMap::new();

    // Initialize root node
    let root_norm = normalize_path_str(&root_path.to_string_lossy());
    raw_nodes.insert(
        root_norm.clone(),
        RawDirNode {
            path: root_path.clone(),
            name: disk_root_str.to_string(),
            parent_path: None,
            direct_bytes: 0,
            direct_files: 0,
            total_bytes: 0,
            total_files: 0,
            subfolder_count: 0,
            last_modified: None,
            is_junction: false,
            is_access_denied: false,
        },
    );

    // Parallel walk using jwalk
    for entry_res in jwalk::WalkDir::new(&root_path)
        .skip_hidden(false)
        .follow_links(false)
    {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("Full disk analysis canceled by user".to_string());
        }

        match entry_res {
            Ok(entry) => {
                if entry.depth == 0 {
                    continue;
                }

                let path = entry.path();
                let file_type = entry.file_type();

                if file_type.is_dir() {
                    scanned_folders.fetch_add(1, Ordering::Relaxed);
                    let path_norm = normalize_path_str(&path.to_string_lossy());
                    let parent_norm = path
                        .parent()
                        .map(|p| normalize_path_str(&p.to_string_lossy()));

                    let name = path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| path.to_string_lossy().to_string());

                    let last_mod = entry
                        .metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                        .map(|d| d.as_secs());

                    let is_junc = is_junction_or_symlink(&path);

                    // Ensure directory node exists and update its fields
                    let dir_node = raw_nodes.entry(path_norm.clone()).or_insert_with(|| {
                        RawDirNode {
                            path: path.clone(),
                            name: name.clone(),
                            parent_path: parent_norm.clone(),
                            direct_bytes: 0,
                            direct_files: 0,
                            total_bytes: 0,
                            total_files: 0,
                            subfolder_count: 0,
                            last_modified: last_mod,
                            is_junction: is_junc,
                            is_access_denied: false,
                        }
                    });
                    dir_node.path = path.clone();
                    dir_node.name = name;
                    dir_node.parent_path = parent_norm;
                    if dir_node.last_modified.is_none() {
                        dir_node.last_modified = last_mod;
                    }
                    dir_node.is_junction = is_junc;
                } else if file_type.is_file() {
                    scanned_files.fetch_add(1, Ordering::Relaxed);
                    let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    scanned_bytes.fetch_add(size, Ordering::Relaxed);

                    if let Some(parent) = path.parent() {
                        let parent_norm = normalize_path_str(&parent.to_string_lossy());
                        // Ensure parent node exists so NO file size is ever dropped!
                        let parent_node = raw_nodes.entry(parent_norm.clone()).or_insert_with(|| {
                            let parent_name = parent
                                .file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_else(|| parent_norm.clone());
                            let grand_parent_norm = parent
                                .parent()
                                .map(|p| normalize_path_str(&p.to_string_lossy()));
                            RawDirNode {
                                path: parent.to_path_buf(),
                                name: parent_name,
                                parent_path: grand_parent_norm,
                                direct_bytes: 0,
                                direct_files: 0,
                                total_bytes: 0,
                                total_files: 0,
                                subfolder_count: 0,
                                last_modified: None,
                                is_junction: false,
                                is_access_denied: false,
                            }
                        });
                        parent_node.direct_bytes += size;
                        parent_node.direct_files += 1;
                    }
                }

                // Throttled progress emit
                if let Ok(mut last) = last_emit.lock() {
                    if last.elapsed() >= Duration::from_millis(60) {
                        *last = Instant::now();
                        let _ = app.emit(
                            "analyze:progress",
                            AnalyzeProgress {
                                current_folder: path
                                    .file_name()
                                    .map(|n| n.to_string_lossy().to_string())
                                    .unwrap_or_default(),
                                drive_root: disk_root_str.to_string(),
                                folders_scanned: scanned_folders.load(Ordering::Relaxed),
                                files_scanned: scanned_files.load(Ordering::Relaxed),
                                bytes_scanned: scanned_bytes.load(Ordering::Relaxed),
                                items_per_sec: 0,
                                folders_per_sec: 0,
                                files_per_sec: 0,
                                bytes_per_sec: 0,
                                elapsed_ms: start_time.elapsed().as_millis() as u64,
                            },
                        );
                    }
                }
            }
            Err(e) => {
                // If a top-level directory has permission denied (e.g. System Volume Information)
                if let Some(io_err) = e.io_error() {
                    if io_err.kind() == std::io::ErrorKind::PermissionDenied {
                        if let Some(p) = e.path() {
                            let p_norm = normalize_path_str(&p.to_string_lossy());
                            let p_parent = p.parent().map(|par| normalize_path_str(&par.to_string_lossy()));
                            let p_name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| p_norm.clone());

                            raw_nodes.entry(p_norm).or_insert_with(|| {
                                RawDirNode {
                                    path: p.to_path_buf(),
                                    name: p_name,
                                    parent_path: p_parent,
                                    direct_bytes: 0,
                                    direct_files: 0,
                                    total_bytes: 0,
                                    total_files: 0,
                                    subfolder_count: 0,
                                    last_modified: None,
                                    is_junction: false,
                                    is_access_denied: true,
                                }
                            });
                        }
                    }
                }
            }
        }
    }

    // Sort paths by depth descending for bottom-up aggregation
    let mut sorted_keys: Vec<String> = raw_nodes.keys().cloned().collect();
    sorted_keys.sort_by(|a, b| {
        let depth_a = a.matches('\\').count();
        let depth_b = b.matches('\\').count();
        depth_b.cmp(&depth_a)
    });

    // Count subfolders and accumulate sizes bottom-up
    for key in &sorted_keys {
        let (total_b, total_f, parent_opt) = {
            let node = raw_nodes.get_mut(key).unwrap();
            node.total_bytes += node.direct_bytes;
            node.total_files += node.direct_files;
            (node.total_bytes, node.total_files, node.parent_path.clone())
        };

        if let Some(parent_key) = parent_opt {
            if let Some(parent_node) = raw_nodes.get_mut(&parent_key) {
                parent_node.total_bytes += total_b;
                parent_node.total_files += total_f;
                parent_node.subfolder_count += 1;
            }
        }
    }

    // Build the hierarchical cache: parent_norm -> Vec<FolderItem>
    let mut new_cache: HashMap<String, Vec<FolderItem>> = HashMap::new();

    for (norm_path, node) in &raw_nodes {
        if let Some(parent_key) = &node.parent_path {
            let parent_total = raw_nodes
                .get(parent_key)
                .map(|p| p.total_bytes)
                .unwrap_or(node.total_bytes);

            let pct = if parent_total > 0 {
                ((node.total_bytes as f64 / parent_total as f64) * 1000.0).round() / 10.0
            } else {
                0.0
            };

            let depth = norm_path.matches('\\').count();

            let item = FolderItem {
                id: node.path.to_string_lossy().to_string(),
                name: node.name.clone(),
                path: node.path.to_string_lossy().to_string(),
                parent_path: Some(parent_key.clone()),
                size_bytes: node.total_bytes,
                file_count: node.total_files,
                subfolder_count: node.subfolder_count,
                is_dir: true,
                last_modified: node.last_modified,
                percentage: pct,
                depth,
                has_subfolders: node.subfolder_count > 0,
                is_junction: node.is_junction,
                is_access_denied: node.is_access_denied,
            };

            new_cache
                .entry(parent_key.clone())
                .or_default()
                .push(item);
        }
    }

    // Sort every parent's child list by size descending
    for items in new_cache.values_mut() {
        items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    }

    // Populate global disk cache
    if let Ok(mut c) = cache.write() {
        *c = new_cache.clone();
    }

    let root_items = new_cache.get(&root_norm).cloned().unwrap_or_default();
    let root_total_bytes = raw_nodes.get(&root_norm).map(|r| r.total_bytes).unwrap_or(0);
    let root_total_files = raw_nodes.get(&root_norm).map(|r| r.total_files).unwrap_or(0);
    let root_total_folders = raw_nodes.len() as u64;

    let _ = app.emit(
        "analyze:progress",
        AnalyzeProgress {
            current_folder: "Full Disk Scan Completed".to_string(),
            drive_root: disk_root_str.to_string(),
            folders_scanned: root_total_folders,
            files_scanned: root_total_files,
            bytes_scanned: root_total_bytes,
            items_per_sec: 0,
            folders_per_sec: 0,
            files_per_sec: 0,
            bytes_per_sec: 0,
            elapsed_ms: start_time.elapsed().as_millis() as u64,
        },
    );

    Ok(FolderAnalysisResult {
        target_path: disk_root_str.to_string(),
        total_bytes: root_total_bytes,
        total_files: root_total_files,
        total_folders: root_total_folders,
        items: root_items,
        duration_ms: start_time.elapsed().as_millis() as u64,
        is_full_disk: true,
        from_cache: false,
        is_watching: false,
        is_syncing: false,
        revision: 1,
        last_sync_summary: None,
    })
}

/// Retrieves child items for a folder. Uses cached results if available,
/// otherwise dynamically scans immediate children in parallel.
pub fn get_subfolder_children(
    folder_path_str: &str,
    depth: usize,
    cache: Arc<RwLock<HashMap<String, Vec<FolderItem>>>>,
    cancel_flag: Arc<AtomicBool>,
    app: AppHandle,
) -> Result<Vec<FolderItem>, String> {
    let norm = normalize_path_str(folder_path_str);

    // 1. Check cache first
    if let Ok(c) = cache.read() {
        if let Some(items) = c.get(&norm) {
            return Ok(items.clone());
        }
    }

    // 2. If not cached, dynamically scan immediate level
    let result = analyze_directory(folder_path_str, depth, cancel_flag, app)?;

    // Cache dynamic result
    if let Ok(mut c) = cache.write() {
        c.insert(norm, result.items.clone());
    }

    Ok(result.items)
}

fn normalize_path_str(s: &str) -> String {
    let clean = s.replace('/', "\\").to_uppercase();
    let trimmed = clean.trim_end_matches('\\');
    if trimmed.ends_with(':') {
        trimmed.to_string()
    } else {
        trimmed.to_string()
    }
}

/// Deep scan: Finds the largest directories across the entire target tree
pub fn scan_deep_largest_folders(
    target_path_str: &str,
    min_size_bytes: u64,
    top_n: usize,
    cancel_flag: Arc<AtomicBool>,
    app: AppHandle,
) -> Result<Vec<FolderItem>, String> {
    let target = PathBuf::from(target_path_str);
    if !target.exists() {
        return Err(format!("Target does not exist: {}", target_path_str));
    }

    let last_emit = Arc::new(std::sync::Mutex::new(Instant::now()));
    let scanned_count = Arc::new(AtomicU64::new(0));

    let mut candidate_dirs = Vec::new();
    if let Ok(entries) = fs::read_dir(&target) {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type() {
                if ft.is_dir() {
                    let p = entry.path();
                    candidate_dirs.push(p.clone());
                    if let Ok(sub_entries) = fs::read_dir(&p) {
                        for sub in sub_entries.flatten() {
                            if let Ok(sft) = sub.file_type() {
                                if sft.is_dir() {
                                    candidate_dirs.push(sub.path());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let cancel_clone = Arc::clone(&cancel_flag);
    let app_clone = app.clone();
    let last_emit_clone = Arc::clone(&last_emit);
    let scanned_clone = Arc::clone(&scanned_count);

    let mut results: Vec<FolderItem> = candidate_dirs
        .into_par_iter()
        .filter_map(|dir_path| {
            if cancel_clone.load(Ordering::Relaxed) {
                return None;
            }

            let (size, files, subfolders, is_junction, is_access_denied) =
                compute_directory_metrics(&dir_path, &cancel_clone);
            scanned_clone.fetch_add(1, Ordering::Relaxed);

            if let Ok(mut last) = last_emit_clone.lock() {
                if last.elapsed() >= Duration::from_millis(60) {
                    *last = Instant::now();
                    let _ = app_clone.emit(
                        "analyze:progress",
                        AnalyzeProgress {
                            current_folder: dir_path
                                .file_name()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_default(),
                            drive_root: target_path_str.to_string(),
                            folders_scanned: scanned_clone.load(Ordering::Relaxed),
                            files_scanned: files,
                            bytes_scanned: size,
                            items_per_sec: 0,
                            folders_per_sec: 0,
                            files_per_sec: 0,
                            bytes_per_sec: 0,
                            elapsed_ms: 0,
                        },
                    );
                }
            }

            if size >= min_size_bytes {
                let name = dir_path
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();
                let last_mod = dir_path
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs());

                Some(FolderItem {
                    id: dir_path.to_string_lossy().to_string(),
                    name,
                    path: dir_path.to_string_lossy().to_string(),
                    parent_path: dir_path
                        .parent()
                        .map(|p| p.to_string_lossy().to_string()),
                    size_bytes: size,
                    file_count: files,
                    subfolder_count: subfolders,
                    is_dir: true,
                    last_modified: last_mod,
                    percentage: 0.0,
                    depth: 0,
                    has_subfolders: subfolders > 0,
                    is_junction,
                    is_access_denied,
                })
            } else {
                None
            }
        })
        .collect();

    results.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
    results.truncate(top_n);

    let max_size = results.first().map(|r| r.size_bytes).unwrap_or(1);
    for item in &mut results {
        item.percentage = ((item.size_bytes as f64 / max_size as f64) * 1000.0).round() / 10.0;
    }

    Ok(results)
}

/// Executes safe deletion of folders, supporting Recycle Bin and permanent deletion
pub fn execute_delete_folders(
    request: DeleteFoldersRequest,
    cancel_flag: Arc<AtomicBool>,
    _app: AppHandle,
) -> DeleteFoldersReport {
    let start_time = Instant::now();
    let mut deleted_paths = Vec::new();
    let mut failed_paths = Vec::new();
    let mut freed_bytes = 0u64;

    for path_str in request.paths {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        let path = PathBuf::from(&path_str);
        if !path.exists() {
            continue;
        }

        // 1. Safety check
        if is_protected_path(&path) {
            failed_paths.push(SkippedFile {
                path: path_str,
                category_id: "folder".to_string(),
                reason: "Action Blocked: Critical Windows system directory is protected."
                    .to_string(),
            });
            continue;
        }

        // Measure size before deleting
        let item_size = if path.is_dir() {
            let (bytes, _, _, _, _) = compute_directory_metrics(&path, &cancel_flag);
            bytes
        } else {
            path.metadata().map(|m| m.len()).unwrap_or(0)
        };

        if request.permanent {
            let delete_res = if path.is_dir() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };

            match delete_res {
                Ok(_) => {
                    freed_bytes += item_size;
                    deleted_paths.push(path_str);
                }
                Err(e) => {
                    failed_paths.push(SkippedFile {
                        path: path_str,
                        category_id: "folder".to_string(),
                        reason: format!("Failed to delete: {}", e),
                    });
                }
            }
        } else {
            let wide_path = to_double_null_wide(&path_str);
            let mut file_op = SHFILEOPSTRUCTW {
                hwnd: null_mut(),
                wFunc: FO_DELETE,
                pFrom: wide_path.as_ptr(),
                pTo: null_mut(),
                fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI) as u16,
                fAnyOperationsAborted: 0,
                hNameMappings: null_mut(),
                lpszProgressTitle: null_mut(),
            };

            let res = unsafe { SHFileOperationW(&mut file_op) };
            if res == 0 && file_op.fAnyOperationsAborted == 0 {
                freed_bytes += item_size;
                deleted_paths.push(path_str);
            } else {
                failed_paths.push(SkippedFile {
                    path: path_str,
                    category_id: "folder".to_string(),
                    reason: format!("Recycle Bin operation failed with code {}", res),
                });
            }
        }
    }

    DeleteFoldersReport {
        deleted_paths,
        failed_paths,
        freed_bytes,
        duration_ms: start_time.elapsed().as_millis() as u64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_protected_paths() {
        assert!(is_protected_path(Path::new("C:\\")));
        assert!(is_protected_path(Path::new("C:")));
        assert!(is_protected_path(Path::new("C:\\Windows")));
        assert!(is_protected_path(Path::new("C:\\WINDOWS\\System32")));
        assert!(is_protected_path(Path::new("C:\\Program Files")));
        assert!(!is_protected_path(Path::new("C:\\Users\\dhruv\\Downloads")));
        assert!(!is_protected_path(Path::new("D:\\Projects\\Ferrowipe")));
    }

    #[test]
    fn test_junction_detection() {
        let p = Path::new("C:\\Users\\All Users");
        if p.exists() {
            let is_junc = is_junction_or_symlink(p);
            println!("C:\\Users\\All Users is junction: {}", is_junc);
            assert!(is_junc);
        }
    }
}
