use std::collections::HashSet;
use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};
use windows_sys::Win32::UI::Shell::{
    SHEmptyRecycleBinW, SHQueryRecycleBinW, SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND,
    SHQUERYRBINFO,
};

use crate::models::{
    CategorySummary, CleanProgress, CleanReport, CleanRequest, JunkItem, ScanProgress, ScanResult,
    SkippedFile,
};
use crate::rules::{get_cleanup_rules, matches_extension};

fn to_wide(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

pub fn query_recycle_bin(drive_letter: Option<char>) -> (u64, u64) {
    unsafe {
        let mut info = SHQUERYRBINFO {
            cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32,
            i64Size: 0,
            i64NumItems: 0,
        };

        let path_wide = match drive_letter {
            Some(dl) => to_wide(&format!("{}:\\", dl)),
            None => to_wide("C:\\"),
        };

        let res = SHQueryRecycleBinW(path_wide.as_ptr(), &mut info);
        if res == 0 {
            (info.i64Size.max(0) as u64, info.i64NumItems.max(0) as u64)
        } else {
            (0, 0)
        }
    }
}

pub fn empty_recycle_bin(drive_letter: Option<char>) -> Result<(), String> {
    unsafe {
        let path_wide = match drive_letter {
            Some(dl) => to_wide(&format!("{}:\\", dl)),
            None => vec![0],
        };

        let root_ptr = if drive_letter.is_some() {
            path_wide.as_ptr()
        } else {
            null()
        };

        let flags = SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND;
        let res = SHEmptyRecycleBinW(null_mut(), root_ptr, flags);
        if res == 0 {
            Ok(())
        } else {
            Err(format!("SHEmptyRecycleBinW failed with code {:#x}", res))
        }
    }
}

pub fn run_scan(
    active_categories: Vec<String>,
    cancel_flag: Arc<AtomicBool>,
    app: AppHandle,
) -> ScanResult {
    let start_time = Instant::now();
    let rules = get_cleanup_rules();
    let mut category_summaries = Vec::new();
    let mut total_reclaimable_bytes = 0u64;
    let mut total_reclaimable_files = 0u64;

    let scanned_files_count = Arc::new(AtomicU64::new(0));
    let scanned_bytes_count = Arc::new(AtomicU64::new(0));
    let last_emit = Arc::new(std::sync::Mutex::new(Instant::now()));

    for rule in rules {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        // If categories filter provided, ensure rule is requested
        if !active_categories.is_empty()
            && !active_categories.iter().any(|c| c == rule.category_id)
        {
            continue;
        }

        if rule.is_recycle_bin {
            // Check Recycle bin for drives C, D, E, F
            let mut rb_total_bytes = 0u64;
            let mut rb_total_items = 0u64;
            let mut rb_items = Vec::new();

            for letter in ['C', 'D', 'E', 'F'] {
                let (bytes, count) = query_recycle_bin(Some(letter));
                if count > 0 {
                    rb_total_bytes += bytes;
                    rb_total_items += count;
                    rb_items.push(JunkItem {
                        id: format!("recycle_bin_{}", letter),
                        category_id: rule.category_id.to_string(),
                        name: format!("Recycle Bin ({}:)", letter),
                        path: format!("{}:\\$Recycle.Bin", letter),
                        size_bytes: bytes,
                        file_count: count,
                        is_selected: true,
                    });
                }
            }

            if rb_total_items > 0 {
                total_reclaimable_bytes += rb_total_bytes;
                total_reclaimable_files += rb_total_items;
                category_summaries.push(CategorySummary {
                    category_id: rule.category_id.to_string(),
                    name: rule.name.to_string(),
                    description: rule.description.to_string(),
                    total_bytes: rb_total_bytes,
                    total_files: rb_total_items,
                    items: rb_items,
                    is_selected: true,
                });
            }
            continue;
        }

        let mut cat_bytes = 0u64;
        let mut cat_files = 0u64;
        let mut cat_items = Vec::new();

        for target in &rule.target_paths {
            if cancel_flag.load(Ordering::Relaxed) {
                break;
            }

            if !target.exists() {
                continue;
            }

            // If target is a single file (like MEMORY.DMP)
            if target.is_file() {
                if let Ok(meta) = target.metadata() {
                    let size = meta.len();
                    cat_bytes += size;
                    cat_files += 1;
                    cat_items.push(JunkItem {
                        id: target.to_string_lossy().to_string(),
                        category_id: rule.category_id.to_string(),
                        name: target
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_else(|| "System File".to_string()),
                        path: target.to_string_lossy().to_string(),
                        size_bytes: size,
                        file_count: 1,
                        is_selected: true,
                    });
                }
                continue;
            }

            // Target is a directory. First collect immediate children to form meaningful JunkItems
            if let Ok(entries) = fs::read_dir(target) {
                for entry in entries.flatten() {
                    if cancel_flag.load(Ordering::Relaxed) {
                        break;
                    }

                    let path = entry.path();
                    let file_name = path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();

                    if path.is_file() {
                        if !matches_extension(&path, &rule.file_extensions) {
                            continue;
                        }
                        if let Ok(meta) = entry.metadata() {
                            let size = meta.len();
                            cat_bytes += size;
                            cat_files += 1;
                            scanned_files_count.fetch_add(1, Ordering::Relaxed);
                            scanned_bytes_count.fetch_add(size, Ordering::Relaxed);

                            cat_items.push(JunkItem {
                                id: path.to_string_lossy().to_string(),
                                category_id: rule.category_id.to_string(),
                                name: file_name,
                                path: path.to_string_lossy().to_string(),
                                size_bytes: size,
                                file_count: 1,
                                is_selected: true,
                            });
                        }
                    } else if path.is_dir() {
                        // Recursively scan subfolder using jwalk for maximum multithreaded performance
                        let mut sub_bytes = 0u64;
                        let mut sub_files = 0u64;

                        for walk_res in jwalk::WalkDir::new(&path)
                            .skip_hidden(false)
                            .follow_links(false)
                        {
                            if cancel_flag.load(Ordering::Relaxed) {
                                break;
                            }

                            if let Ok(sub_entry) = walk_res {
                                if sub_entry.file_type().is_file() {
                                    let sub_p = sub_entry.path();
                                    if !matches_extension(&sub_p, &rule.file_extensions) {
                                        continue;
                                    }
                                    if let Ok(sub_meta) = sub_entry.metadata() {
                                        let size = sub_meta.len();
                                        sub_bytes += size;
                                        sub_files += 1;
                                        scanned_files_count.fetch_add(1, Ordering::Relaxed);
                                        scanned_bytes_count.fetch_add(size, Ordering::Relaxed);

                                        // Throttled progress emit
                                        let mut last = last_emit.lock().unwrap();
                                        if last.elapsed() >= Duration::from_millis(60) {
                                            *last = Instant::now();
                                            let _ = app.emit(
                                                "scan:progress",
                                                ScanProgress {
                                                    scanned_files: scanned_files_count
                                                        .load(Ordering::Relaxed),
                                                    scanned_bytes: scanned_bytes_count
                                                        .load(Ordering::Relaxed),
                                                    current_path: sub_p
                                                        .to_string_lossy()
                                                        .to_string(),
                                                },
                                            );
                                        }
                                    }
                                }
                            }
                        }

                        if sub_files > 0 {
                            cat_bytes += sub_bytes;
                            cat_files += sub_files;
                            cat_items.push(JunkItem {
                                id: path.to_string_lossy().to_string(),
                                category_id: rule.category_id.to_string(),
                                name: file_name,
                                path: path.to_string_lossy().to_string(),
                                size_bytes: sub_bytes,
                                file_count: sub_files,
                                is_selected: true,
                            });
                        }
                    }
                }
            }
        }

        if cat_files > 0 {
            total_reclaimable_bytes += cat_bytes;
            total_reclaimable_files += cat_files;
            // Sort items by size descending so largest folders appear first
            cat_items.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));

            category_summaries.push(CategorySummary {
                category_id: rule.category_id.to_string(),
                name: rule.name.to_string(),
                description: rule.description.to_string(),
                total_bytes: cat_bytes,
                total_files: cat_files,
                items: cat_items,
                is_selected: true,
            });
        }
    }

    // Final scan progress emit
    let _ = app.emit(
        "scan:progress",
        ScanProgress {
            scanned_files: scanned_files_count.load(Ordering::Relaxed),
            scanned_bytes: scanned_bytes_count.load(Ordering::Relaxed),
            current_path: "Scan Completed".to_string(),
        },
    );

    ScanResult {
        categories: category_summaries,
        total_reclaimable_bytes,
        total_reclaimable_files,
        scan_duration_ms: start_time.elapsed().as_millis() as u64,
    }
}

pub fn run_clean(
    request: CleanRequest,
    cancel_flag: Arc<AtomicBool>,
    app: AppHandle,
) -> CleanReport {
    let start_time = Instant::now();
    let mut freed_bytes = 0u64;
    let mut removed_files = 0u64;
    let mut skipped_files = Vec::new();

    let selected_categories_set: HashSet<String> =
        request.selected_category_ids.into_iter().collect();
    let selected_items_set: HashSet<String> = request.selected_item_ids.into_iter().collect();

    let last_emit = Arc::new(std::sync::Mutex::new(Instant::now()));

    // 1. Recycle Bin emptying
    if selected_categories_set.contains("recycle_bin") {
        for letter in ['C', 'D', 'E', 'F'] {
            let item_id = format!("recycle_bin_{}", letter);
            if selected_items_set.is_empty() || selected_items_set.contains(&item_id) {
                let (bytes, count) = query_recycle_bin(Some(letter));
                if count > 0 {
                    match empty_recycle_bin(Some(letter)) {
                        Ok(_) => {
                            freed_bytes += bytes;
                            removed_files += count;
                            let _ = app.emit(
                                "clean:progress",
                                CleanProgress {
                                    cleaned_files: removed_files,
                                    freed_bytes,
                                    total_target_bytes: freed_bytes,
                                    current_path: format!("Emptied Recycle Bin ({}:)", letter),
                                },
                            );
                        }
                        Err(e) => {
                            skipped_files.push(SkippedFile {
                                path: format!("{}:\\$Recycle.Bin", letter),
                                category_id: "recycle_bin".to_string(),
                                reason: format!("Recycle Bin API error: {}", e),
                            });
                        }
                    }
                }
            }
        }
    }

    // 2. File / Directory items deletion
    for item_path_str in selected_items_set {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        if item_path_str.starts_with("recycle_bin_") {
            continue;
        }

        let path = PathBuf::from(&item_path_str);
        if !path.exists() {
            continue;
        }

        if path.is_file() {
            let file_size = path.metadata().map(|m| m.len()).unwrap_or(0);
            match fs::remove_file(&path) {
                Ok(_) => {
                    freed_bytes += file_size;
                    removed_files += 1;
                }
                Err(e) => {
                    let reason = match e.kind() {
                        std::io::ErrorKind::PermissionDenied => {
                            "Access denied or file currently locked by running process".to_string()
                        }
                        _ => format!("IO error: {}", e),
                    };
                    skipped_files.push(SkippedFile {
                        path: item_path_str.clone(),
                        category_id: "file".to_string(),
                        reason,
                    });
                }
            }
        } else if path.is_dir() {
            // Delete directory contents safely
            delete_directory_contents(
                &path,
                &mut freed_bytes,
                &mut removed_files,
                &mut skipped_files,
                &cancel_flag,
                &app,
                &last_emit,
            );
        }

        let mut last = last_emit.lock().unwrap();
        if last.elapsed() >= Duration::from_millis(60) {
            *last = Instant::now();
            let _ = app.emit(
                "clean:progress",
                CleanProgress {
                    cleaned_files: removed_files,
                    freed_bytes,
                    total_target_bytes: freed_bytes,
                    current_path: item_path_str,
                },
            );
        }
    }

    CleanReport {
        freed_bytes,
        removed_files,
        skipped_files,
        duration_ms: start_time.elapsed().as_millis() as u64,
    }
}

fn delete_directory_contents(
    dir: &Path,
    freed_bytes: &mut u64,
    removed_files: &mut u64,
    skipped_files: &mut Vec<SkippedFile>,
    cancel_flag: &Arc<AtomicBool>,
    app: &AppHandle,
    last_emit: &Arc<std::sync::Mutex<Instant>>,
) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if cancel_flag.load(Ordering::Relaxed) {
                break;
            }

            let path = entry.path();
            if path.is_file() {
                let size = path.metadata().map(|m| m.len()).unwrap_or(0);
                match fs::remove_file(&path) {
                    Ok(_) => {
                        *freed_bytes += size;
                        *removed_files += 1;
                    }
                    Err(e) => {
                        let reason = match e.kind() {
                            std::io::ErrorKind::PermissionDenied => {
                                "File locked by running process (browser, service, or app)"
                                    .to_string()
                            }
                            _ => format!("Unable to remove: {}", e),
                        };
                        skipped_files.push(SkippedFile {
                            path: path.to_string_lossy().to_string(),
                            category_id: "file".to_string(),
                            reason,
                        });
                    }
                }
            } else if path.is_dir() {
                // Recursively delete inner items
                delete_directory_contents(
                    &path,
                    freed_bytes,
                    removed_files,
                    skipped_files,
                    cancel_flag,
                    app,
                    last_emit,
                );
                // Attempt to remove empty dir
                let _ = fs::remove_dir(&path);
            }

            let mut last = last_emit.lock().unwrap();
            if last.elapsed() >= Duration::from_millis(60) {
                *last = Instant::now();
                let _ = app.emit(
                    "clean:progress",
                    CleanProgress {
                        cleaned_files: *removed_files,
                        freed_bytes: *freed_bytes,
                        total_target_bytes: *freed_bytes,
                        current_path: path.to_string_lossy().to_string(),
                    },
                );
            }
        }
    }
}
