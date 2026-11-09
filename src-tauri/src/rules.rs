use std::env;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct CleanupRule {
    pub category_id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub is_recycle_bin: bool,
    pub target_paths: Vec<PathBuf>,
    pub file_extensions: Option<Vec<&'static str>>,
}

pub fn get_cleanup_rules() -> Vec<CleanupRule> {
    let local_app_data = env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("C:\\Users\\Default\\AppData\\Local"));
    let temp_dir = env::var("TEMP")
        .map(PathBuf::from)
        .unwrap_or_else(|_| local_app_data.join("Temp"));
    let program_data = env::var("PROGRAMDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("C:\\ProgramData"));
    let win_dir = env::var("SystemRoot")
        .or_else(|_| env::var("windir"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("C:\\Windows"));

    let mut rules = Vec::new();

    // 1. User Temp
    rules.push(CleanupRule {
        category_id: "user_temp",
        name: "User Temporary Files",
        description: "Temporary data created by applications in your user profile",
        is_recycle_bin: false,
        target_paths: vec![temp_dir, local_app_data.join("Temp")],
        file_extensions: None,
    });

    // 2. Windows Temp
    rules.push(CleanupRule {
        category_id: "windows_temp",
        name: "Windows System Temp",
        description: "Temporary files created by Windows system processes and installers",
        is_recycle_bin: false,
        target_paths: vec![win_dir.join("Temp")],
        file_extensions: None,
    });

    // 3. Recycle Bin
    rules.push(CleanupRule {
        category_id: "recycle_bin",
        name: "Recycle Bin",
        description: "Files and folders previously deleted and held in the Recycle Bin",
        is_recycle_bin: true,
        target_paths: vec![],
        file_extensions: None,
    });

    // 4. Google Chrome Cache
    let chrome_base = local_app_data.join("Google\\Chrome\\User Data");
    let chrome_targets = vec![
        chrome_base.join("Default\\Cache"),
        chrome_base.join("Default\\Code Cache"),
        chrome_base.join("Default\\GPUCache"),
        chrome_base.join("ShaderCache"),
    ];
    rules.push(CleanupRule {
        category_id: "browser_chrome",
        name: "Google Chrome Cache",
        description: "Web cache, code cache, and media temporary files from Chrome",
        is_recycle_bin: false,
        target_paths: chrome_targets,
        file_extensions: None,
    });

    // 5. Microsoft Edge Cache
    let edge_base = local_app_data.join("Microsoft\\Edge\\User Data");
    let edge_targets = vec![
        edge_base.join("Default\\Cache"),
        edge_base.join("Default\\Code Cache"),
        edge_base.join("Default\\GPUCache"),
        edge_base.join("ShaderCache"),
    ];
    rules.push(CleanupRule {
        category_id: "browser_edge",
        name: "Microsoft Edge Cache",
        description: "Cached webpages, images, and script files from Edge",
        is_recycle_bin: false,
        target_paths: edge_targets,
        file_extensions: None,
    });

    // 6. Mozilla Firefox Cache
    let firefox_base = local_app_data.join("Mozilla\\Firefox\\Profiles");
    let mut firefox_targets = Vec::new();
    if firefox_base.exists() {
        if let Ok(entries) = std::fs::read_dir(&firefox_base) {
            for entry in entries.flatten() {
                let cache_dir = entry.path().join("cache2");
                if cache_dir.exists() {
                    firefox_targets.push(cache_dir);
                }
            }
        }
    }
    if firefox_targets.is_empty() {
        firefox_targets.push(firefox_base);
    }
    rules.push(CleanupRule {
        category_id: "browser_firefox",
        name: "Mozilla Firefox Cache",
        description: "HTTP cache entries and cached web resources from Firefox profiles",
        is_recycle_bin: false,
        target_paths: firefox_targets,
        file_extensions: None,
    });

    // 7. Brave Browser Cache
    let brave_base = local_app_data.join("BraveSoftware\\Brave-Browser\\User Data");
    let brave_targets = vec![
        brave_base.join("Default\\Cache"),
        brave_base.join("Default\\Code Cache"),
        brave_base.join("Default\\GPUCache"),
    ];
    rules.push(CleanupRule {
        category_id: "browser_brave",
        name: "Brave Browser Cache",
        description: "Cached web data and temporary renderer files from Brave",
        is_recycle_bin: false,
        target_paths: brave_targets,
        file_extensions: None,
    });

    // 8. Windows Update Download Cache
    rules.push(CleanupRule {
        category_id: "windows_update",
        name: "Windows Update Download Cache",
        description: "Downloaded installation packages for completed Windows Updates",
        is_recycle_bin: false,
        target_paths: vec![win_dir.join("SoftwareDistribution\\Download")],
        file_extensions: None,
    });

    // 9. Thumbnail & Icon Caches
    let explorer_cache = local_app_data.join("Microsoft\\Windows\\Explorer");
    rules.push(CleanupRule {
        category_id: "thumb_cache",
        name: "Thumbnails & Icon Cache",
        description: "File preview thumbnail databases and cached application icons",
        is_recycle_bin: false,
        target_paths: vec![explorer_cache],
        file_extensions: Some(vec!["db", "tmp"]),
    });

    // 10. Crash Dumps & Windows Error Reporting (WER)
    rules.push(CleanupRule {
        category_id: "crash_dumps",
        name: "Crash Dumps & Error Reports",
        description: "Memory crash dumps (Minidump) and Windows Error Reporting logs",
        is_recycle_bin: false,
        target_paths: vec![
            local_app_data.join("CrashDumps"),
            program_data.join("Microsoft\\Windows\\WER"),
            win_dir.join("Minidump"),
            win_dir.join("MEMORY.DMP"),
        ],
        file_extensions: None,
    });

    // 11. Prefetch & Old System Logs
    rules.push(CleanupRule {
        category_id: "prefetch_logs",
        name: "Prefetch & Old System Logs",
        description: "Stale Windows prefetch binaries and archived Windows log files",
        is_recycle_bin: false,
        target_paths: vec![
            win_dir.join("Prefetch"),
            win_dir.join("Logs\\CBS"),
            win_dir.join("Logs\\DISM"),
        ],
        file_extensions: Some(vec!["pf", "log", "bak", "old"]),
    });

    rules
}

pub fn matches_extension(path: &Path, extensions: &Option<Vec<&'static str>>) -> bool {
    match extensions {
        None => true,
        Some(exts) => {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                exts.iter().any(|&allowed| allowed.eq_ignore_ascii_case(ext))
            } else {
                false
            }
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rules_coverage() {
        let rules = get_cleanup_rules();
        assert!(rules.len() >= 10, "Expected at least 10 cleanup rules");

        let rule_ids: Vec<&str> = rules.iter().map(|r| r.category_id).collect();
        assert!(rule_ids.contains(&"user_temp"), "Missing user_temp rule");
        assert!(rule_ids.contains(&"windows_temp"), "Missing windows_temp rule");
        assert!(rule_ids.contains(&"recycle_bin"), "Missing recycle_bin rule");
        assert!(rule_ids.contains(&"browser_chrome"), "Missing browser_chrome rule");
        assert!(rule_ids.contains(&"browser_edge"), "Missing browser_edge rule");
        assert!(rule_ids.contains(&"browser_firefox"), "Missing browser_firefox rule");
        assert!(rule_ids.contains(&"browser_brave"), "Missing browser_brave rule");
        assert!(rule_ids.contains(&"windows_update"), "Missing windows_update rule");
        assert!(rule_ids.contains(&"thumb_cache"), "Missing thumb_cache rule");
        assert!(rule_ids.contains(&"crash_dumps"), "Missing crash_dumps rule");
        assert!(rule_ids.contains(&"prefetch_logs"), "Missing prefetch_logs rule");
    }

    #[test]
    fn test_extension_filter() {
        let exts = Some(vec!["log", "pf"]);
        assert!(matches_extension(Path::new("test.log"), &exts));
        assert!(matches_extension(Path::new("test.pf"), &exts));
        assert!(matches_extension(Path::new("test.PF"), &exts));
        assert!(!matches_extension(Path::new("test.exe"), &exts));
    }
}
