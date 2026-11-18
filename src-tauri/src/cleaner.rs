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

use crate::drives::get_system_drives;
use crate::models::{
    CategorySummary, CleanProgress, CleanReport, CleanRequest, JunkItem, ScanProgress, ScanResult,
    SkippedFile,
};
use crate::rules::{get_cleanup_rules, is_protected_user_data_path, matches_extension};

pub fn get_active_drive_letters() -> Vec<char> {
    let drives = get_system_drives();
    let mut letters: Vec<char> = drives
        .into_iter()
        .filter(|d| !d.drive_type.contains("CD") && !d.drive_type.contains("Network"))
        .filter_map(|d| d.mount_point.chars().next())
        .map(|c| c.to_ascii_uppercase())
        .collect();
    if letters.is_empty() {
        letters.push('C');
    }
    letters
}

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

/// Generates a clear human-readable bucket label for browser/IDE/AI cache folders,
/// e.g., `[Default] Service Worker / CacheStorage` or `[Shared] OptGuideOnDeviceModel`.
fn describe_cache_bucket(path: &Path) -> String {
    let s = path.to_string_lossy().replace('/', "\\");
    let lower = s.to_lowercase();

    // Extract profile context for Chromium / Firefox
    if let Some(idx) = lower.find("\\user data\\") {
        let after = &s[idx + "\\user data\\".len()..];
        let parts: Vec<&str> = after.split('\\').filter(|p| !p.is_empty()).collect();
        if parts.len() >= 2 {
            let first = parts[0];
            let is_profile = first.eq_ignore_ascii_case("Default")
                || first.starts_with("Profile ")
                || first.eq_ignore_ascii_case("Guest Profile")
                || first.eq_ignore_ascii_case("System Profile");
            if is_profile {
                return format!("[{}] {}", first, parts[1..].join(" / "));
            }
        }
        return format!("[Shared] {}", parts.join(" / "));
    }

    if let Some(idx) = lower.find("\\profiles\\") {
        let after = &s[idx + "\\profiles\\".len()..];
        let parts: Vec<&str> = after.split('\\').filter(|p| !p.is_empty()).collect();
        if parts.len() >= 2 {
            return format!("[{}] {}", parts[0], parts[1..].join(" / "));
        }
    }

    // For IDE / Gradle / AI folders, show parent + leaf for clarity (e.g. AndroidStudio2024.2 / caches)
    let comps: Vec<String> = path
        .components()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect();
    if comps.len() >= 2 {
        format!("{} / {}", comps[comps.len() - 2], comps[comps.len() - 1])
    } else {
        path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or(s)
    }
}

fn should_bucket_whole_target(category_id: &str) -> bool {
    category_id.starts_with("browser_")
        || category_id.starts_with("ai_")
        || category_id.starts_with("dev_")
        || category_id.starts_with("app_")
        || category_id == "gpu_shader_cache"
}

fn scan_directory_totals(
    dir: &Path,
    file_extensions: &Option<Vec<&'static str>>,
    cancel_flag: &Arc<AtomicBool>,
    scanned_files_count: &Arc<AtomicU64>,
    scanned_bytes_count: &Arc<AtomicU64>,
    last_emit: &Arc<std::sync::Mutex<Instant>>,
    app: &AppHandle,
) -> (u64, u64) {
    let mut sub_bytes = 0u64;
    let mut sub_files = 0u64;

    for walk_res in jwalk::WalkDir::new(dir)
        .skip_hidden(false)
        .follow_links(false)
    {
        if cancel_flag.load(Ordering::Relaxed) {
            break;
        }

        if let Ok(sub_entry) = walk_res {
            if sub_entry.file_type().is_file() {
                let sub_p = sub_entry.path();
                if is_protected_user_data_path(&sub_p) {
                    continue;
                }
                if !matches_extension(&sub_p, file_extensions) {
                    continue;
                }
                if let Ok(sub_meta) = sub_entry.metadata() {
                    let size = sub_meta.len();
                    sub_bytes += size;
                    sub_files += 1;
                    scanned_files_count.fetch_add(1, Ordering::Relaxed);
                    scanned_bytes_count.fetch_add(size, Ordering::Relaxed);

                    if let Ok(mut last) = last_emit.lock() {
                        if last.elapsed() >= Duration::from_millis(60) {
                            *last = Instant::now();
                            let _ = app.emit(
                                "scan:progress",
                                ScanProgress {
                                    scanned_files: scanned_files_count.load(Ordering::Relaxed),
                                    scanned_bytes: scanned_bytes_count.load(Ordering::Relaxed),
                                    current_path: sub_p.to_string_lossy().to_string(),
                                },
                            );
                        }
                    }
                }
            }
        }
    }

    (sub_bytes, sub_files)
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

        if !active_categories.is_empty()
            && !active_categories.iter().any(|c| c == rule.category_id)
        {
            continue;
        }

        if rule.is_recycle_bin {
            let mut rb_total_bytes = 0u64;
            let mut rb_total_items = 0u64;
            let mut rb_items = Vec::new();

            for letter in get_active_drive_letters() {
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
        let bucket_mode = should_bucket_whole_target(rule.category_id);

        for target in &rule.target_paths {
            if cancel_flag.load(Ordering::Relaxed) {
                break;
            }

            if !target.exists() || is_protected_user_data_path(target) {
                continue;
            }

            if target.is_file() {
                if let Ok(meta) = target.metadata() {
                    let size = meta.len();
                    cat_bytes += size;
                    cat_files += 1;
                    scanned_files_count.fetch_add(1, Ordering::Relaxed);
                    scanned_bytes_count.fetch_add(size, Ordering::Relaxed);
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

            if bucket_mode {
                // Scan the entire cache target as one clean, transparent, selectable bucket
                // (avoids 20,000 tiny `f_00xxxx` Chrome cache rows and clearly labels profiles!)
                let (sub_bytes, sub_files) = scan_directory_totals(
                    target,
                    &rule.file_extensions,
                    &cancel_flag,
                    &scanned_files_count,
                    &scanned_bytes_count,
                    &last_emit,
                    &app,
                );
                if sub_files > 0 {
                    cat_bytes += sub_bytes;
                    cat_files += sub_files;
                    cat_items.push(JunkItem {
                        id: target.to_string_lossy().to_string(),
                        category_id: rule.category_id.to_string(),
                        name: describe_cache_bucket(target),
                        path: target.to_string_lossy().to_string(),
                        size_bytes: sub_bytes,
                        file_count: sub_files,
                        is_selected: true,
                    });
                }
                continue;
            }

            // General Temp / System folder: list immediate children
            if let Ok(entries) = fs::read_dir(target) {
                for entry in entries.flatten() {
                    if cancel_flag.load(Ordering::Relaxed) {
                        break;
                    }

                    let path = entry.path();
                    if is_protected_user_data_path(&path) {
                        continue;
                    }
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
                        let (sub_bytes, sub_files) = scan_directory_totals(
                            &path,
                            &rule.file_extensions,
                            &cancel_flag,
                            &scanned_files_count,
                            &scanned_bytes_count,
                            &last_emit,
                            &app,
                        );

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

    category_summaries.sort_by(|a, b| b.total_bytes.cmp(&a.total_bytes));

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
    let mut deleted_paths = Vec::new();
    let mut skipped_files = Vec::new();

    let selected_categories_set: HashSet<String> =
        request.selected_category_ids.into_iter().collect();
    let selected_items_set: HashSet<String> = request.selected_item_ids.into_iter().collect();

    let last_emit = Arc::new(std::sync::Mutex::new(Instant::now()));

    // 1. Recycle Bin emptying across all active drives
    if selected_categories_set.contains("recycle_bin") {
        for letter in get_active_drive_letters() {
            let item_id = format!("recycle_bin_{}", letter);
            if selected_items_set.is_empty() || selected_items_set.contains(&item_id) {
                let (bytes, count) = query_recycle_bin(Some(letter));
                if count > 0 {
                    match empty_recycle_bin(Some(letter)) {
                        Ok(_) => {
                            freed_bytes += bytes;
                            removed_files += count;
                            deleted_paths.push(format!("{}:\\$Recycle.Bin", letter));
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

    // 2. File / Directory items deletion (with hard protected-data safety guard)
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

        if is_protected_user_data_path(&path) {
            skipped_files.push(SkippedFile {
                path: item_path_str.clone(),
                category_id: "protected".to_string(),
                reason: "Blocked by Safety Shield: Critical user data is protected".to_string(),
            });
            continue;
        }

        if path.is_file() {
            let file_size = path.metadata().map(|m| m.len()).unwrap_or(0);
            match fs::remove_file(&path) {
                Ok(_) => {
                    freed_bytes += file_size;
                    removed_files += 1;
                    deleted_paths.push(item_path_str.clone());
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
            let before_removed = removed_files;
            delete_directory_contents(
                &path,
                &mut freed_bytes,
                &mut removed_files,
                &mut skipped_files,
                &cancel_flag,
                &app,
                &last_emit,
            );
            if removed_files > before_removed {
                deleted_paths.push(item_path_str.clone());
            }
        }

        if let Ok(mut last) = last_emit.lock() {
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
    }

    CleanReport {
        freed_bytes,
        removed_files,
        deleted_paths,
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
    if is_protected_user_data_path(dir) {
        return;
    }

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            if cancel_flag.load(Ordering::Relaxed) {
                break;
            }

            let path = entry.path();
            if is_protected_user_data_path(&path) {
                continue;
            }

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
                delete_directory_contents(
                    &path,
                    freed_bytes,
                    removed_files,
                    skipped_files,
                    cancel_flag,
                    app,
                    last_emit,
                );
                let _ = fs::remove_dir(&path);
            }

            if let Ok(mut last) = last_emit.lock() {
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
}
