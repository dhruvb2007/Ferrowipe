use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::DetectedCleanupRule;

#[derive(Debug, Clone)]
pub struct CleanupRule {
    pub category_id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub group: &'static str, // "Temp" | "Browser" | "AI & Agents" | "IDEs & Dev" | "Apps" | "System"
    pub icon_key: &'static str,
    pub is_recycle_bin: bool,
    pub target_paths: Vec<PathBuf>,
    pub file_extensions: Option<Vec<&'static str>>,
    pub profile_count: usize,
    pub safe_note: Option<&'static str>,
}

fn normalize_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_uppercase()
}

fn dedup_existing_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for p in paths {
        if !p.exists() {
            continue;
        }
        let key = normalize_key(&p);
        if seen.insert(key) {
            out.push(p);
        }
    }
    out
}

/// Finds all profile directories (`Default`, `Profile *`, `Guest Profile`, `System Profile`)
/// inside a Chromium-based browser's `User Data` folder.
fn find_chromium_profiles(user_data_dir: &Path) -> Vec<PathBuf> {
    let mut profiles = Vec::new();
    if !user_data_dir.is_dir() {
        return profiles;
    }

    if let Ok(entries) = fs::read_dir(user_data_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let is_profile_name = name == "Default"
                || name.starts_with("Profile ")
                || name == "Guest Profile"
                || name == "System Profile";

            if !is_profile_name {
                continue;
            }

            let looks_like_profile = path.join("Preferences").exists()
                || path.join("Cache").exists()
                || path.join("Code Cache").exists()
                || path.join("GPUCache").exists()
                || path.join("Network").exists()
                || path.join("Service Worker").exists();

            if looks_like_profile {
                profiles.push(path);
            }
        }
    }
    profiles
}

/// Safe web, code, GPU, metrics, crashpad & CRX installer caches for any Chromium browser.
/// STRICTLY avoids Passwords, Cookies, Bookmarks, History, Extensions, Sessions, Local Storage, IndexedDB.
fn detect_chromium_core_caches(user_data_dir: &Path) -> Option<(Vec<PathBuf>, usize)> {
    if !user_data_dir.is_dir() {
        return None;
    }

    let profiles = find_chromium_profiles(user_data_dir);
    let mut targets = Vec::new();

    // Shared root-level safe caches & diagnostics
    for shared in [
        "ShaderCache",
        "GrShaderCache",
        "GraphiteDawnCache",
        "BrowserMetrics",
        "Crashpad\\reports",
        "Crashpad\\completed",
        "component_crx_cache",
        "extensions_crx_cache",
    ] {
        let p = user_data_dir.join(shared);
        if p.exists() {
            targets.push(p);
        }
    }

    for profile in &profiles {
        for sub in [
            "Cache\\Cache_Data",
            "Cache",
            "Code Cache",
            "GPUCache",
            "DawnCache",
            "DawnGraphiteCache",
            "DawnWebGPUCache",
            "Media Cache",
            "Application Cache",
            "blob_storage",
        ] {
            if sub == "Cache" && profile.join("Cache\\Cache_Data").exists() {
                continue;
            }
            let candidate = profile.join(sub);
            if candidate.exists() {
                targets.push(candidate);
            }
        }
    }

    let targets = dedup_existing_paths(targets);
    if profiles.is_empty() && targets.is_empty() {
        return None;
    }

    Some((targets, profiles.len().max(1)))
}

/// Detects Chromium Service Worker CacheStorage & ScriptCache (often 5–15+ GB from PWAs like YouTube, Docs, Figma).
/// Safe to clear — does NOT sign you out or remove passwords/bookmarks/cookies.
fn detect_chromium_service_worker_caches(user_data_dir: &Path) -> Option<(Vec<PathBuf>, usize)> {
    if !user_data_dir.is_dir() {
        return None;
    }
    let profiles = find_chromium_profiles(user_data_dir);
    let mut targets = Vec::new();
    for profile in &profiles {
        for sub in [
            "Service Worker\\CacheStorage",
            "Service Worker\\ScriptCache",
            "CacheStorage",
        ] {
            let p = profile.join(sub);
            if p.exists() {
                targets.push(p);
            }
        }
    }
    let targets = dedup_existing_paths(targets);
    if targets.is_empty() {
        return None;
    }
    Some((targets, profiles.len().max(1)))
}

/// Detects Chrome's downloaded On-Device ML / Gemini Nano / Prediction Models (often 3–8 GB in User Data).
/// Completely safe to reclaim; Chrome re-downloads automatically if an AI feature needs them.
fn detect_chrome_ai_models(user_data_dir: &Path) -> Option<Vec<PathBuf>> {
    if !user_data_dir.is_dir() {
        return None;
    }
    let candidates = vec![
        user_data_dir.join("OptGuideOnDeviceModel"),
        user_data_dir.join("OptimizationGuidePredictionModels"),
        user_data_dir.join("OnDeviceHeadSuggestModel"),
        user_data_dir.join("ScreenAI"),
        user_data_dir.join("OptimizationHints"),
    ];
    let targets = dedup_existing_paths(candidates);
    if targets.is_empty() {
        return None;
    }
    Some(targets)
}

fn detect_firefox(local_app_data: &Path, roaming_app_data: &Path) -> Option<(Vec<PathBuf>, usize)> {
    let local_profiles = local_app_data.join("Mozilla\\Firefox\\Profiles");
    let roaming_profiles = roaming_app_data.join("Mozilla\\Firefox\\Profiles");

    if !local_profiles.is_dir() && !roaming_profiles.is_dir() {
        return None;
    }

    let mut targets = Vec::new();
    let mut profiles = 0usize;

    if local_profiles.is_dir() {
        if let Ok(entries) = fs::read_dir(&local_profiles) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    profiles += 1;
                    for sub in ["cache2", "startupCache", "jumpListCache", "thumbnails"] {
                        let c = path.join(sub);
                        if c.exists() {
                            targets.push(c);
                        }
                    }
                }
            }
        }
    }

    if profiles == 0 && roaming_profiles.is_dir() {
        if let Ok(entries) = fs::read_dir(&roaming_profiles) {
            profiles = entries.flatten().filter(|e| e.path().is_dir()).count();
        }
    }

    let targets = dedup_existing_paths(targets);
    if profiles == 0 && targets.is_empty() {
        return None;
    }

    Some((targets, profiles.max(1)))
}

fn detect_opera_variant(
    local_app_data: &Path,
    roaming_app_data: &Path,
    folder_name: &str,
) -> Option<Vec<PathBuf>> {
    let local_dir = local_app_data.join("Opera Software").join(folder_name);
    let roaming_dir = roaming_app_data.join("Opera Software").join(folder_name);

    if !local_dir.is_dir() && !roaming_dir.is_dir() {
        return None;
    }

    let mut candidates = Vec::new();
    for base in [&local_dir, &roaming_dir] {
        if base.is_dir() {
            for sub in [
                "Cache\\Cache_Data",
                "Cache",
                "Code Cache",
                "GPUCache",
                "System Cache",
                "ShaderCache",
            ] {
                if sub == "Cache" && base.join("Cache\\Cache_Data").exists() {
                    continue;
                }
                let p = base.join(sub);
                if p.exists() {
                    candidates.push(p);
                }
            }
        }
    }

    Some(dedup_existing_paths(candidates))
}

fn collect_electron_caches(base: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    if !base.is_dir() {
        return out;
    }
    for sub in [
        "Cache\\Cache_Data",
        "Cache",
        "CachedData",
        "CachedExtensionVSIXs",
        "Code Cache",
        "GPUCache",
        "DawnCache",
        "DawnGraphiteCache",
        "DawnWebGPUCache",
        "logs",
        "Crashpad\\reports",
        "Crashpad\\completed",
    ] {
        if sub == "Cache" && base.join("Cache\\Cache_Data").exists() {
            continue;
        }
        let p = base.join(sub);
        if p.exists() {
            out.push(p);
        }
    }
    dedup_existing_paths(out)
}

fn find_matching_subdirs(parent: &Path, prefix: &str) -> Vec<PathBuf> {
    let mut matches = Vec::new();
    if !parent.is_dir() {
        return matches;
    }
    let pref_upper = prefix.to_uppercase();
    if let Ok(entries) = fs::read_dir(parent) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                let name = entry.file_name().to_string_lossy().to_uppercase();
                if name.starts_with(&pref_upper) {
                    matches.push(p);
                }
            }
        }
    }
    matches
}

/// Returns ONLY cleanup rules that are actually detected / installed on this Windows PC.
pub fn get_cleanup_rules() -> Vec<CleanupRule> {
    let user_profile = env::var("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("C:\\Users\\Default"));
    let local_app_data = env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| user_profile.join("AppData\\Local"));
    let roaming_app_data = env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| user_profile.join("AppData\\Roaming"));
    let temp_dir = env::var("TEMP")
        .map(PathBuf::from)
        .unwrap_or_else(|_| local_app_data.join("Temp"));
    let program_data = env::var("PROGRAMDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("C:\\ProgramData"));
    let program_files_x86 = env::var("ProgramFiles(x86)")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("C:\\Program Files (x86)"));
    let win_dir = env::var("SystemRoot")
        .or_else(|_| env::var("windir"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("C:\\Windows"));

    let mut rules = Vec::new();

    // =========================================================
    // 1. TEMP & RECYCLE BIN (Core Windows)
    // =========================================================

    let user_temp_paths = dedup_existing_paths(vec![temp_dir, local_app_data.join("Temp")]);
    if !user_temp_paths.is_empty() {
        rules.push(CleanupRule {
            category_id: "user_temp",
            name: "User Temporary Files",
            description: "Temporary data created by applications in your user profile (%TEMP%)",
            group: "Temp",
            icon_key: "user_temp",
            is_recycle_bin: false,
            target_paths: user_temp_paths,
            file_extensions: None,
            profile_count: 0,
            safe_note: Some("Safe: Locked files in active use are automatically skipped"),
        });
    }

    let win_temp_paths = dedup_existing_paths(vec![win_dir.join("Temp")]);
    if !win_temp_paths.is_empty() {
        rules.push(CleanupRule {
            category_id: "windows_temp",
            name: "Windows System Temp",
            description: "Temporary files created by Windows services and installers",
            group: "Temp",
            icon_key: "windows_temp",
            is_recycle_bin: false,
            target_paths: win_temp_paths,
            file_extensions: None,
            profile_count: 0,
            safe_note: None,
        });
    }

    rules.push(CleanupRule {
        category_id: "recycle_bin",
        name: "Recycle Bin",
        description: "Deleted files held across all mounted local Windows Recycle Bins",
        group: "Temp",
        icon_key: "recycle_bin",
        is_recycle_bin: true,
        target_paths: vec![],
        file_extensions: None,
        profile_count: 0,
        safe_note: None,
    });

    // =========================================================
    // 2. BROWSERS (Granular & Ultra-Safe — ONLY if installed!)
    // =========================================================

    let chrome_user_data = local_app_data.join("Google\\Chrome\\User Data");
    if let Some((targets, profiles)) = detect_chromium_core_caches(&chrome_user_data) {
        rules.push(CleanupRule {
            category_id: "browser_chrome",
            name: "Chrome — Web, Code & GPU Cache",
            description: "HTTP cache, V8 bytecode cache, GPU shaders, CRX installer cache & metrics",
            group: "Browser",
            icon_key: "browser_chrome",
            is_recycle_bin: false,
            target_paths: targets,
            file_extensions: None,
            profile_count: profiles,
            safe_note: Some(
                "Protected: Keeps passwords, cookies, logins, bookmarks, history, tabs & extensions",
            ),
        });
    }

    if let Some((sw_targets, profiles)) = detect_chromium_service_worker_caches(&chrome_user_data) {
        rules.push(CleanupRule {
            category_id: "browser_chrome_sw",
            name: "Chrome — Service Worker & PWA Cache",
            description: "Large cached offline assets from YouTube, Docs, Figma & web apps",
            group: "Browser",
            icon_key: "browser_chrome",
            is_recycle_bin: false,
            target_paths: sw_targets,
            file_extensions: None,
            profile_count: profiles,
            safe_note: Some(
                "Protected: Never touches IndexedDB, Local Storage, cookies, logins or bookmarks",
            ),
        });
    }

    if let Some(ai_targets) = detect_chrome_ai_models(&chrome_user_data) {
        rules.push(CleanupRule {
            category_id: "browser_chrome_ai_models",
            name: "Chrome — On-Device AI & ML Models",
            description: "Multi-GB downloaded local Gemini/OptGuide prediction models (re-downloadable)",
            group: "Browser",
            icon_key: "browser_chrome",
            is_recycle_bin: false,
            target_paths: ai_targets,
            file_extensions: None,
            profile_count: 0,
            safe_note: Some(
                "Safe: Chrome re-downloads automatically if an on-device AI feature needs them",
            ),
        });
    }

    // Microsoft Edge
    let edge_user_data = local_app_data.join("Microsoft\\Edge\\User Data");
    if let Some((targets, profiles)) = detect_chromium_core_caches(&edge_user_data) {
        rules.push(CleanupRule {
            category_id: "browser_edge",
            name: "Microsoft Edge Cache",
            description: "Web cache, V8 code cache, GPU shaders & metrics across Edge profiles",
            group: "Browser",
            icon_key: "browser_edge",
            is_recycle_bin: false,
            target_paths: targets,
            file_extensions: None,
            profile_count: profiles,
            safe_note: Some("Protected: Keeps passwords, cookies, logins, bookmarks & extensions"),
        });
    }

    if let Some((sw_targets, profiles)) = detect_chromium_service_worker_caches(&edge_user_data) {
        rules.push(CleanupRule {
            category_id: "browser_edge_sw",
            name: "Edge — Service Worker Cache",
            description: "Cached web app bundles & offline PWA assets across Edge profiles",
            group: "Browser",
            icon_key: "browser_edge",
            is_recycle_bin: false,
            target_paths: sw_targets,
            file_extensions: None,
            profile_count: profiles,
            safe_note: Some("Protected: Keeps logins, cookies, bookmarks & Local Storage"),
        });
    }

    // Mozilla Firefox
    if let Some((targets, profiles)) = detect_firefox(&local_app_data, &roaming_app_data) {
        rules.push(CleanupRule {
            category_id: "browser_firefox",
            name: "Mozilla Firefox Cache",
            description: "HTTP cache2 entries and startup caches from detected Firefox profiles",
            group: "Browser",
            icon_key: "browser_firefox",
            is_recycle_bin: false,
            target_paths: targets,
            file_extensions: None,
            profile_count: profiles,
            safe_note: Some("Protected: Keeps bookmarks, passwords, cookies & add-ons"),
        });
    }

    // Brave Browser (ONLY if installed)
    let brave_user_data = local_app_data.join("BraveSoftware\\Brave-Browser\\User Data");
    if let Some((mut targets, profiles)) = detect_chromium_core_caches(&brave_user_data) {
        if let Some((sw, _)) = detect_chromium_service_worker_caches(&brave_user_data) {
            targets.extend(sw);
        }
        rules.push(CleanupRule {
            category_id: "browser_brave",
            name: "Brave Browser Cache",
            description: "Web cache, code cache, GPU shaders & Service Worker caches from Brave",
            group: "Browser",
            icon_key: "browser_brave",
            is_recycle_bin: false,
            target_paths: dedup_existing_paths(targets),
            file_extensions: None,
            profile_count: profiles,
            safe_note: Some("Protected: Keeps Brave Rewards, passwords, cookies & bookmarks"),
        });
    }

    // Opera & Opera GX (ONLY if installed)
    if let Some(targets) =
        detect_opera_variant(&local_app_data, &roaming_app_data, "Opera Stable")
    {
        rules.push(CleanupRule {
            category_id: "browser_opera",
            name: "Opera Browser Cache",
            description: "Cached web resources and GPU cache from Opera",
            group: "Browser",
            icon_key: "browser_opera",
            is_recycle_bin: false,
            target_paths: targets,
            file_extensions: None,
            profile_count: 1,
            safe_note: Some("Protected: Keeps logins, bookmarks & workspaces"),
        });
    }

    if let Some(targets) =
        detect_opera_variant(&local_app_data, &roaming_app_data, "Opera GX Stable")
    {
        rules.push(CleanupRule {
            category_id: "browser_opera_gx",
            name: "Opera GX Cache",
            description: "Cached web resources and shader cache from Opera GX",
            group: "Browser",
            icon_key: "browser_opera",
            is_recycle_bin: false,
            target_paths: targets,
            file_extensions: None,
            profile_count: 1,
            safe_note: Some("Protected: Keeps logins, bookmarks & GX settings"),
        });
    }

    // Vivaldi (ONLY if installed)
    if let Some((targets, profiles)) =
        detect_chromium_core_caches(&local_app_data.join("Vivaldi\\User Data"))
    {
        rules.push(CleanupRule {
            category_id: "browser_vivaldi",
            name: "Vivaldi Browser Cache",
            description: "Cached web resources and code cache across Vivaldi profiles",
            group: "Browser",
            icon_key: "browser_vivaldi",
            is_recycle_bin: false,
            target_paths: targets,
            file_extensions: None,
            profile_count: profiles,
            safe_note: Some("Protected: Keeps passwords, cookies, notes & bookmarks"),
        });
    }

    // =========================================================
    // 3. AI AGENTS & AI IDEs (Strictly detected — ONLY if installed!)
    // =========================================================

    // Antigravity (Google Antigravity IDE / Agent)
    let agy_roaming = roaming_app_data.join("Antigravity");
    let agy_local = local_app_data.join("Antigravity");
    let agy_gemini = user_profile.join(".gemini\\antigravity");
    if agy_roaming.is_dir() || agy_local.is_dir() || agy_gemini.is_dir() {
        let mut targets = collect_electron_caches(&agy_roaming);
        targets.extend(collect_electron_caches(&agy_local));
        for extra in [
            user_profile.join(".gemini\\tmp"),
            agy_gemini.join("logs"),
            agy_gemini.join("cache"),
            agy_gemini.join("Crashpad"),
        ] {
            if extra.exists() {
                targets.push(extra);
            }
        }
        let targets = dedup_existing_paths(targets);
        if !targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "ai_antigravity",
                name: "Antigravity AI Cache & Logs",
                description: "Renderer caches, GPU shaders, crash dumps & temp logs from Antigravity",
                group: "AI & Agents",
                icon_key: "ai_agent",
                is_recycle_bin: false,
                target_paths: targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: Some("Protected: Never touches brain artifacts, knowledge, skills or auth"),
            });
        }
    }

    // Claude Desktop & Claude Code CLI
    let claude_roaming = roaming_app_data.join("Claude");
    let claude_home = user_profile.join(".claude");
    if claude_roaming.is_dir() || claude_home.is_dir() {
        let mut targets = collect_electron_caches(&claude_roaming);
        for sub in ["debug", "logs", "cache", "statsig", "shell-snapshots"] {
            let p = claude_home.join(sub);
            if p.exists() {
                targets.push(p);
            }
        }
        let targets = dedup_existing_paths(targets);
        if !targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "ai_claude",
                name: "Claude / Claude Code Temp",
                description: "Electron caches, debug logs & temporary snapshots from Claude",
                group: "AI & Agents",
                icon_key: "ai_agent",
                is_recycle_bin: false,
                target_paths: targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: Some("Protected: Keeps settings.json, credentials, projects & conversations"),
            });
        }
    }

    // OpenAI Codex CLI
    let codex_home = user_profile.join(".codex");
    let codex_local = local_app_data.join("codex");
    if codex_home.is_dir() || codex_local.is_dir() {
        let targets = dedup_existing_paths(vec![
            codex_home.join("log"),
            codex_home.join("logs"),
            codex_home.join("tmp"),
            codex_home.join("cache"),
            codex_local.join("cache"),
            codex_local.join("logs"),
        ]);
        if !targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "ai_codex",
                name: "OpenAI Codex Temp & Logs",
                description: "Temporary files, run logs & caches from Codex CLI",
                group: "AI & Agents",
                icon_key: "ai_agent",
                is_recycle_bin: false,
                target_paths: targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: Some("Protected: Keeps config.toml, auth.json, skills & session history"),
            });
        }
    }

    // Cursor AI IDE
    let cursor_roaming = roaming_app_data.join("Cursor");
    if cursor_roaming.is_dir() {
        let targets = collect_electron_caches(&cursor_roaming);
        if !targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "ai_cursor",
                name: "Cursor AI IDE Cache",
                description: "Cached V8 bytecode, old extension VSIXs, GPU cache & logs from Cursor",
                group: "AI & Agents",
                icon_key: "ai_ide",
                is_recycle_bin: false,
                target_paths: targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: Some("Protected: Keeps workspace settings, rules, extensions & login"),
            });
        }
    }

    // Windsurf AI IDE
    let windsurf_roaming = roaming_app_data.join("Windsurf");
    if windsurf_roaming.is_dir() {
        let targets = collect_electron_caches(&windsurf_roaming);
        if !targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "ai_windsurf",
                name: "Windsurf AI IDE Cache",
                description: "Renderer caches, GPU shaders & diagnostic logs from Windsurf",
                group: "AI & Agents",
                icon_key: "ai_ide",
                is_recycle_bin: false,
                target_paths: targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: Some("Protected: Keeps IDE settings, keybindings & auth"),
            });
        }
    }

    // Ollama Logs (never deletes local LLM models!)
    let ollama_local = local_app_data.join("Ollama");
    let ollama_home = user_profile.join(".ollama");
    if ollama_local.is_dir() || ollama_home.is_dir() {
        let targets = dedup_existing_paths(vec![
            ollama_local.join("logs"),
            ollama_home.join("logs"),
            ollama_local.join("tmp"),
        ]);
        if !targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "ai_ollama",
                name: "Ollama Server Logs & Temp",
                description: "Runtime server logs & temp files from Ollama",
                group: "AI & Agents",
                icon_key: "ai_agent",
                is_recycle_bin: false,
                target_paths: targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: Some("Protected: Never deletes your downloaded LLM model weights"),
            });
        }
    }

    // ChatGPT Desktop
    let chatgpt_roaming = roaming_app_data.join("ChatGPT");
    let chatgpt_pkg_dirs = find_matching_subdirs(&local_app_data.join("Packages"), "OpenAI.ChatGPT");
    if chatgpt_roaming.is_dir() || !chatgpt_pkg_dirs.is_empty() {
        let mut targets = collect_electron_caches(&chatgpt_roaming);
        for pkg in chatgpt_pkg_dirs {
            targets.extend(collect_electron_caches(&pkg.join("LocalCache\\Roaming\\ChatGPT")));
            targets.extend(collect_electron_caches(&pkg.join("LocalCache\\Local\\ChatGPT")));
        }
        let targets = dedup_existing_paths(targets);
        if !targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "ai_chatgpt",
                name: "ChatGPT Desktop Cache",
                description: "Renderer caches & logs from ChatGPT Desktop app",
                group: "AI & Agents",
                icon_key: "ai_agent",
                is_recycle_bin: false,
                target_paths: targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: Some("Protected: Keeps login session & preferences"),
            });
        }
    }

    // =========================================================
    // 4. CODING IDEs & DEV TOOLCHAINS (ONLY if installed!)
    // =========================================================

    // Android Studio (detects all installed versions dynamically!)
    let as_dirs = find_matching_subdirs(&local_app_data.join("Google"), "AndroidStudio");
    let dot_android = user_profile.join(".android");
    if !as_dirs.is_empty() || dot_android.is_dir() {
        let mut targets = Vec::new();
        for dir in &as_dirs {
            for sub in ["caches", "log", "tmp", "compile-server", "index"] {
                let p = dir.join(sub);
                if p.exists() {
                    targets.push(p);
                }
            }
        }
        for sub in ["cache", "build-cache"] {
            let p = dot_android.join(sub);
            if p.exists() {
                targets.push(p);
            }
        }
        let targets = dedup_existing_paths(targets);
        if !targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "dev_android_studio",
                name: "Android Studio Temp & Caches",
                description: "IDE caches, compile-server, build-cache & logs across installed versions",
                group: "IDEs & Dev",
                icon_key: "android_studio",
                is_recycle_bin: false,
                target_paths: targets,
                file_extensions: None,
                profile_count: as_dirs.len(),
                safe_note: Some("Protected: Never touches Android SDKs, AVDs, emulators or keystores"),
            });
        }
    }

    // Gradle Build & Transform Caches
    let gradle_home = env::var("GRADLE_USER_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| user_profile.join(".gradle"));
    if gradle_home.is_dir() {
        let gradle_caches = gradle_home.join("caches");
        let mut targets = vec![
            gradle_home.join("daemon"),
            gradle_caches.join("build-cache-1"),
            gradle_caches.join("transforms-2"),
            gradle_caches.join("transforms-3"),
            gradle_caches.join("transforms-4"),
            gradle_caches.join("journal-1"),
            gradle_caches.join("jars-9"),
            gradle_caches.join("modules-2"),
        ];
        // Also detect any versioned transform/build-cache dirs
        targets.extend(find_matching_subdirs(&gradle_caches, "transforms-"));
        targets.extend(find_matching_subdirs(&gradle_caches, "build-cache-"));
        let targets = dedup_existing_paths(targets);
        if !targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "dev_gradle",
                name: "Gradle Temp & Build Cache",
                description: "Rebuildable Gradle transforms, build caches, daemon logs & dependency cache",
                group: "IDEs & Dev",
                icon_key: "gradle",
                is_recycle_bin: false,
                target_paths: targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: Some("Protected: Keeps gradle.properties, init scripts & JDKs"),
            });
        }
    }

    // JetBrains IDEs (IntelliJ, PyCharm, WebStorm, Rider, CLion, GoLand, etc.)
    let jetbrains_local = local_app_data.join("JetBrains");
    if jetbrains_local.is_dir() {
        let mut targets = Vec::new();
        let mut ide_count = 0usize;
        if let Ok(entries) = fs::read_dir(&jetbrains_local) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    let mut found_any = false;
                    for sub in ["caches", "log", "tmp", "compile-server"] {
                        let cand = p.join(sub);
                        if cand.exists() {
                            targets.push(cand);
                            found_any = true;
                        }
                    }
                    if found_any {
                        ide_count += 1;
                    }
                }
            }
        }
        let targets = dedup_existing_paths(targets);
        if !targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "dev_jetbrains",
                name: "JetBrains IDEs Cache & Logs",
                description: "Caches, compile-server & logs for installed IntelliJ / PyCharm / WebStorm IDEs",
                group: "IDEs & Dev",
                icon_key: "ide",
                is_recycle_bin: false,
                target_paths: targets,
                file_extensions: None,
                profile_count: ide_count,
                safe_note: Some("Protected: Keeps IDE configs, plugins, licenses & projects"),
            });
        }
    }

    // Visual Studio Code
    let vscode_root = roaming_app_data.join("Code");
    if vscode_root.is_dir() {
        let targets = collect_electron_caches(&vscode_root);
        if !targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "app_vscode",
                name: "VS Code Cache & Logs",
                description: "Cached V8 bytecode, old extension VSIXs, GPU cache & logs from VS Code",
                group: "IDEs & Dev",
                icon_key: "app_vscode",
                is_recycle_bin: false,
                target_paths: targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: Some("Protected: Keeps settings.json, keybindings & installed extensions"),
            });
        }
    }

    // Visual Studio Component Cache
    let vs_local = local_app_data.join("Microsoft\\VisualStudio");
    if vs_local.is_dir() {
        let mut targets = Vec::new();
        if let Ok(entries) = fs::read_dir(&vs_local) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    for sub in ["ComponentModelCache", "ImageLibrary", "VTCache", "Extensions\\Temp"] {
                        let c = p.join(sub);
                        if c.exists() {
                            targets.push(c);
                        }
                    }
                }
            }
        }
        let targets = dedup_existing_paths(targets);
        if !targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "dev_visualstudio",
                name: "Visual Studio Component Cache",
                description: "MEF ComponentModelCache, image library & temporary extension caches",
                group: "IDEs & Dev",
                icon_key: "ide",
                is_recycle_bin: false,
                target_paths: targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: Some("Safe: Visual Studio automatically rebuilds component caches"),
            });
        }
    }

    // npm Cache
    let npm_targets = dedup_existing_paths(vec![
        local_app_data.join("npm-cache"),
        roaming_app_data.join("npm-cache"),
    ]);
    if !npm_targets.is_empty() {
        rules.push(CleanupRule {
            category_id: "dev_npm",
            name: "npm Package Cache",
            description: "Downloaded Node.js package tarballs cached by npm",
            group: "IDEs & Dev",
            icon_key: "dev_cache",
            is_recycle_bin: false,
            target_paths: npm_targets,
            file_extensions: None,
            profile_count: 0,
            safe_note: Some("Safe: Does not delete node_modules in your projects"),
        });
    }

    // pnpm & Yarn Caches
    let pnpm_targets = dedup_existing_paths(vec![local_app_data.join("pnpm-cache")]);
    if !pnpm_targets.is_empty() {
        rules.push(CleanupRule {
            category_id: "dev_pnpm",
            name: "pnpm Metadata Cache",
            description: "Cached registry metadata from pnpm",
            group: "IDEs & Dev",
            icon_key: "dev_cache",
            is_recycle_bin: false,
            target_paths: pnpm_targets,
            file_extensions: None,
            profile_count: 0,
            safe_note: None,
        });
    }

    let yarn_targets = dedup_existing_paths(vec![local_app_data.join("Yarn\\Cache")]);
    if !yarn_targets.is_empty() {
        rules.push(CleanupRule {
            category_id: "dev_yarn",
            name: "Yarn Package Cache",
            description: "Cached JavaScript package archives from Yarn",
            group: "IDEs & Dev",
            icon_key: "dev_cache",
            is_recycle_bin: false,
            target_paths: yarn_targets,
            file_extensions: None,
            profile_count: 0,
            safe_note: None,
        });
    }

    // Python pip & uv Caches
    let pip_targets = dedup_existing_paths(vec![local_app_data.join("pip\\Cache")]);
    if !pip_targets.is_empty() {
        rules.push(CleanupRule {
            category_id: "dev_pip",
            name: "Python pip Cache",
            description: "Cached Python wheels and HTTP downloads from pip",
            group: "IDEs & Dev",
            icon_key: "dev_cache",
            is_recycle_bin: false,
            target_paths: pip_targets,
            file_extensions: None,
            profile_count: 0,
            safe_note: Some("Safe: Keeps all installed Python packages & virtualenvs"),
        });
    }

    let uv_targets = dedup_existing_paths(vec![local_app_data.join("uv\\cache")]);
    if !uv_targets.is_empty() {
        rules.push(CleanupRule {
            category_id: "dev_uv",
            name: "Python uv Cache",
            description: "Cached wheels & archives from Astral uv package manager",
            group: "IDEs & Dev",
            icon_key: "dev_cache",
            is_recycle_bin: false,
            target_paths: uv_targets,
            file_extensions: None,
            profile_count: 0,
            safe_note: None,
        });
    }

    // Rust Cargo Registry Cache
    let cargo_home = env::var("CARGO_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| user_profile.join(".cargo"));
    if cargo_home.is_dir() {
        let cargo_targets = dedup_existing_paths(vec![
            cargo_home.join("registry\\cache"),
            cargo_home.join("registry\\src"),
        ]);
        if !cargo_targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "dev_cargo",
                name: "Rust Cargo Crate Cache",
                description: "Downloaded crate tarballs & extracted sources in ~/.cargo/registry",
                group: "IDEs & Dev",
                icon_key: "dev_cache",
                is_recycle_bin: false,
                target_paths: cargo_targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: Some("Protected: Keeps cargo bin/ tools & credentials"),
            });
        }
    }

    // NuGet Cache
    let nuget_targets = dedup_existing_paths(vec![
        local_app_data.join("NuGet\\v3-cache"),
        local_app_data.join("NuGet\\plugins-cache"),
    ]);
    if !nuget_targets.is_empty() {
        rules.push(CleanupRule {
            category_id: "dev_nuget",
            name: ".NET NuGet HTTP Cache",
            description: "Downloaded NuGet v3 HTTP & plugin caches",
            group: "IDEs & Dev",
            icon_key: "dev_cache",
            is_recycle_bin: false,
            target_paths: nuget_targets,
            file_extensions: None,
            profile_count: 0,
            safe_note: None,
        });
    }

    // Docker Desktop Logs
    let docker_logs = dedup_existing_paths(vec![local_app_data.join("Docker\\log")]);
    if !docker_logs.is_empty() {
        rules.push(CleanupRule {
            category_id: "dev_docker",
            name: "Docker Desktop Logs",
            description: "Archived Docker Desktop host & VM diagnostic logs",
            group: "IDEs & Dev",
            icon_key: "dev_cache",
            is_recycle_bin: false,
            target_paths: docker_logs,
            file_extensions: None,
            profile_count: 0,
            safe_note: Some("Protected: Never touches Docker images, containers or volumes"),
        });
    }

    // =========================================================
    // 5. INSTALLED DESKTOP APPS (ONLY if installed!)
    // =========================================================

    let discord_root = roaming_app_data.join("discord");
    if discord_root.is_dir() {
        let targets = collect_electron_caches(&discord_root);
        if !targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "app_discord",
                name: "Discord Cache",
                description: "Cached media previews, images & renderer cache from Discord",
                group: "Apps",
                icon_key: "app_discord",
                is_recycle_bin: false,
                target_paths: targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: Some("Protected: Keeps login token & server settings"),
            });
        }
    }

    let spotify_root = local_app_data.join("Spotify");
    if spotify_root.is_dir() {
        let spotify_targets = dedup_existing_paths(vec![
            spotify_root.join("Storage"),
            spotify_root.join("Data"),
        ]);
        if !spotify_targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "app_spotify",
                name: "Spotify Audio Cache",
                description: "Cached streaming audio segments and album artwork from Spotify",
                group: "Apps",
                icon_key: "app_spotify",
                is_recycle_bin: false,
                target_paths: spotify_targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: None,
            });
        }
    }

    let steam_local = local_app_data.join("Steam");
    let steam_prog = program_files_x86.join("Steam");
    if steam_local.is_dir() || steam_prog.is_dir() {
        let steam_targets = dedup_existing_paths(vec![
            steam_local.join("htmlcache"),
            steam_prog.join("appcache\\httpcache"),
            steam_prog.join("logs"),
        ]);
        if !steam_targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "app_steam",
                name: "Steam Web & HTTP Cache",
                description: "Storefront browser cache, HTTP cache & log files from Steam",
                group: "Apps",
                icon_key: "app_steam",
                is_recycle_bin: false,
                target_paths: steam_targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: Some("Protected: Never touches installed games or saves"),
            });
        }
    }

    let slack_root = roaming_app_data.join("Slack");
    if slack_root.is_dir() {
        let targets = collect_electron_caches(&slack_root);
        if !targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "app_slack",
                name: "Slack Cache",
                description: "Cached workspace media & renderer cache from Slack",
                group: "Apps",
                icon_key: "app_discord",
                is_recycle_bin: false,
                target_paths: targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: None,
            });
        }
    }

    let postman_root = roaming_app_data.join("Postman");
    if postman_root.is_dir() {
        let targets = collect_electron_caches(&postman_root);
        if !targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "app_postman",
                name: "Postman Cache & Logs",
                description: "Renderer caches & logs from Postman",
                group: "Apps",
                icon_key: "ide",
                is_recycle_bin: false,
                target_paths: targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: Some("Protected: Keeps collections, environments & workspaces"),
            });
        }
    }

    let notion_root = roaming_app_data.join("Notion");
    if notion_root.is_dir() {
        let targets = collect_electron_caches(&notion_root);
        if !targets.is_empty() {
            rules.push(CleanupRule {
                category_id: "app_notion",
                name: "Notion Cache",
                description: "Cached page assets & GPU shader cache from Notion Desktop",
                group: "Apps",
                icon_key: "app_vscode",
                is_recycle_bin: false,
                target_paths: targets,
                file_extensions: None,
                profile_count: 0,
                safe_note: None,
            });
        }
    }

    // =========================================================
    // 6. SYSTEM & GPU CACHES (Detected dynamically)
    // =========================================================

    let wu_targets = dedup_existing_paths(vec![win_dir.join("SoftwareDistribution\\Download")]);
    if !wu_targets.is_empty() {
        rules.push(CleanupRule {
            category_id: "windows_update",
            name: "Windows Update Cache",
            description: "Downloaded installation packages in SoftwareDistribution\\Download",
            group: "System",
            icon_key: "windows_update",
            is_recycle_bin: false,
            target_paths: wu_targets,
            file_extensions: None,
            profile_count: 0,
            safe_note: None,
        });
    }

    let gpu_targets = dedup_existing_paths(vec![
        local_app_data.join("D3DSCache"),
        local_app_data.join("NVIDIA\\DXCache"),
        local_app_data.join("NVIDIA\\GLCache"),
        local_app_data.join("AMD\\DxCache"),
        local_app_data.join("AMD\\GLCache"),
    ]);
    if !gpu_targets.is_empty() {
        rules.push(CleanupRule {
            category_id: "gpu_shader_cache",
            name: "DirectX & GPU Shader Cache",
            description: "Compiled DirectX, NVIDIA, and AMD graphics shader caches",
            group: "System",
            icon_key: "gpu_cache",
            is_recycle_bin: false,
            target_paths: gpu_targets,
            file_extensions: None,
            profile_count: 0,
            safe_note: None,
        });
    }

    let thumb_targets = dedup_existing_paths(vec![
        local_app_data.join("Microsoft\\Windows\\Explorer"),
    ]);
    if !thumb_targets.is_empty() {
        rules.push(CleanupRule {
            category_id: "thumb_cache",
            name: "Thumbnails & Icon Cache",
            description: "File preview thumbnail databases and cached Explorer icons",
            group: "System",
            icon_key: "thumb_cache",
            is_recycle_bin: false,
            target_paths: thumb_targets,
            file_extensions: Some(vec!["db", "tmp"]),
            profile_count: 0,
            safe_note: None,
        });
    }

    let crash_targets = dedup_existing_paths(vec![
        local_app_data.join("CrashDumps"),
        program_data.join("Microsoft\\Windows\\WER"),
        win_dir.join("Minidump"),
        win_dir.join("MEMORY.DMP"),
    ]);
    if !crash_targets.is_empty() {
        rules.push(CleanupRule {
            category_id: "crash_dumps",
            name: "Crash Dumps & WER",
            description: "Memory crash dumps (Minidump) and Windows Error Reporting archives",
            group: "System",
            icon_key: "crash_dumps",
            is_recycle_bin: false,
            target_paths: crash_targets,
            file_extensions: None,
            profile_count: 0,
            safe_note: None,
        });
    }

    let prefetch_targets = dedup_existing_paths(vec![
        win_dir.join("Prefetch"),
        win_dir.join("Logs\\CBS"),
        win_dir.join("Logs\\DISM"),
    ]);
    if !prefetch_targets.is_empty() {
        rules.push(CleanupRule {
            category_id: "prefetch_logs",
            name: "Prefetch & Old System Logs",
            description: "Stale Windows prefetch binaries and archived CBS/DISM log files",
            group: "System",
            icon_key: "prefetch_logs",
            is_recycle_bin: false,
            target_paths: prefetch_targets,
            file_extensions: Some(vec!["pf", "log", "bak", "old"]),
            profile_count: 0,
            safe_note: None,
        });
    }

    rules
}

pub fn get_detected_cleanup_rules() -> Vec<DetectedCleanupRule> {
    get_cleanup_rules()
        .into_iter()
        .map(|r| DetectedCleanupRule {
            id: r.category_id.to_string(),
            name: r.name.to_string(),
            description: r.description.to_string(),
            group: r.group.to_string(),
            icon_key: r.icon_key.to_string(),
            detected_paths: r
                .target_paths
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect(),
            profile_count: r.profile_count,
            is_recycle_bin: r.is_recycle_bin,
            safe_note: r.safe_note.map(|s| s.to_string()),
        })
        .collect()
}

/// Hard backend safety guard: guarantees critical browser/AI/IDE user data is NEVER deleted,
/// even if a future rule accidentally points near a profile root.
pub fn is_protected_user_data_path(path: &Path) -> bool {
    let norm = path.to_string_lossy().replace('/', "\\").to_uppercase();
    let protected_segments = [
        "\\LOGIN DATA",
        "\\COOKIES",
        "\\BOOKMARKS",
        "\\HISTORY",
        "\\PREFERENCES",
        "\\SECURE PREFERENCES",
        "\\WEB DATA",
        "\\LOCAL STORAGE",
        "\\INDEXEDDB",
        "\\SESSIONS",
        "\\EXTENSIONS\\",
        "\\SYNC DATA",
        "\\AUTH.JSON",
        "\\CONFIG.TOML",
        "\\SETTINGS.JSON",
        "\\DEBUG.KEYSTORE",
        "\\.GEMINI\\ANTIGRAVITY\\BRAIN",
        "\\.GEMINI\\ANTIGRAVITY\\KNOWLEDGE",
    ];
    protected_segments.iter().any(|seg| norm.contains(seg))
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
    fn test_dynamic_rules_detection() {
        let rules = get_cleanup_rules();
        assert!(!rules.is_empty(), "Expected at least core Windows cleanup rules");

        let rule_ids: Vec<&str> = rules.iter().map(|r| r.category_id).collect();
        assert!(rule_ids.contains(&"user_temp"), "Missing user_temp rule");
        assert!(rule_ids.contains(&"recycle_bin"), "Missing recycle_bin rule");

        for rule in &rules {
            if !rule.is_recycle_bin {
                let mut seen = HashSet::new();
                for p in &rule.target_paths {
                    assert!(
                        p.exists(),
                        "Rule {} returned non-existent path {:?}",
                        rule.category_id,
                        p
                    );
                    assert!(
                        seen.insert(normalize_key(p)),
                        "Duplicate path in rule {}",
                        rule.category_id
                    );
                    assert!(
                        !is_protected_user_data_path(p),
                        "Rule {} pointed to protected user data {:?}",
                        rule.category_id,
                        p
                    );
                }
            }
        }
    }

    #[test]
    fn test_protected_user_data_guard() {
        assert!(is_protected_user_data_path(Path::new(
            "C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data"
        )));
        assert!(is_protected_user_data_path(Path::new(
            "C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cookies"
        )));
        assert!(is_protected_user_data_path(Path::new(
            "C:\\Users\\u\\.codex\\auth.json"
        )));
        assert!(!is_protected_user_data_path(Path::new(
            "C:\\Users\\u\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Service Worker\\CacheStorage"
        )));
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
