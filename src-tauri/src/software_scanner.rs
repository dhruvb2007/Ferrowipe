use std::collections::{HashMap, HashSet};
use std::env;
use std::ffi::OsString;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::{Path, PathBuf};
use std::ptr::null_mut;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use rayon::prelude::*;
use windows_sys::Win32::Foundation::ERROR_SUCCESS;
use windows_sys::Win32::System::Registry::{
    RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER,
    HKEY_LOCAL_MACHINE, KEY_READ, REG_DWORD, REG_EXPAND_SZ, REG_SZ,
};

use crate::disk_index::{extract_drive_root, normalize_path_key, DiskIndexManager};
use crate::folder_analyzer::compute_directory_metrics;
use crate::models::{InstalledSoftwareItem, SoftwarePathEntry, SoftwareStorageReport};

#[derive(Debug, Clone)]
struct RawRegistryApp {
    name: String,
    publisher: String,
    version: String,
    install_location: Option<PathBuf>,
    estimated_size_bytes: u64,
    install_date: Option<String>,
}

fn to_wide_null(s: &str) -> Vec<u16> {
    std::ffi::OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn read_reg_string(hkey: HKEY, value_name: &str) -> Option<String> {
    let wide_name = to_wide_null(value_name);
    let mut reg_type = 0u32;
    let mut byte_len = 0u32;

    let res = unsafe {
        RegQueryValueExW(
            hkey,
            wide_name.as_ptr(),
            null_mut(),
            &mut reg_type,
            null_mut(),
            &mut byte_len,
        )
    };

    if res != ERROR_SUCCESS || byte_len == 0 || (reg_type != REG_SZ && reg_type != REG_EXPAND_SZ) {
        return None;
    }

    let mut buf: Vec<u16> = vec![0; (byte_len as usize / 2) + 1];
    let res2 = unsafe {
        RegQueryValueExW(
            hkey,
            wide_name.as_ptr(),
            null_mut(),
            &mut reg_type,
            buf.as_mut_ptr() as *mut u8,
            &mut byte_len,
        )
    };

    if res2 != ERROR_SUCCESS {
        return None;
    }

    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    let s = OsString::from_wide(&buf[..end])
        .to_string_lossy()
        .trim()
        .to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn read_reg_dword(hkey: HKEY, value_name: &str) -> Option<u32> {
    let wide_name = to_wide_null(value_name);
    let mut reg_type = 0u32;
    let mut val = 0u32;
    let mut byte_len = std::mem::size_of::<u32>() as u32;

    let res = unsafe {
        RegQueryValueExW(
            hkey,
            wide_name.as_ptr(),
            null_mut(),
            &mut reg_type,
            &mut val as *mut u32 as *mut u8,
            &mut byte_len,
        )
    };

    if res == ERROR_SUCCESS && reg_type == REG_DWORD {
        Some(val)
    } else {
        None
    }
}

/// Extracts an executable or folder path from a registry `DisplayIcon` or `UninstallString`.
fn extract_dir_from_command(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_lowercase();
    if lower.starts_with("msiexec") || lower.contains("msiexec.exe") {
        return None;
    }

    let candidate = if let Some(stripped) = trimmed.strip_prefix('"') {
        stripped.split('"').next().unwrap_or("")
    } else {
        // Strip trailing icon index `,0` or command args
        let before_comma = trimmed.split(',').next().unwrap_or(trimmed);
        if let Some(exe_idx) = before_comma.to_lowercase().find(".exe") {
            &before_comma[..exe_idx + 4]
        } else {
            before_comma.split_whitespace().next().unwrap_or("")
        }
    };

    let p = PathBuf::from(candidate.trim().trim_matches('"'));
    if p.is_dir() {
        Some(p)
    } else if p.is_file() {
        p.parent().map(|par| par.to_path_buf())
    } else {
        None
    }
}

/// Rejects generic shared roots so we never attribute all of `Program Files` or `AppData` to one app.
fn is_too_generic_dir(path: &Path) -> bool {
    let norm = normalize_path_key(&path.to_string_lossy());
    if norm.len() <= 3 {
        return true;
    }
    let blocked_exact = [
        "C:\\WINDOWS",
        "C:\\WINDOWS\\SYSTEM32",
        "C:\\WINDOWS\\SYSWOW64",
        "C:\\WINDOWS\\INSTALLER",
        "C:\\PROGRAM FILES",
        "C:\\PROGRAM FILES (X86)",
        "C:\\PROGRAM FILES\\COMMON FILES",
        "C:\\PROGRAM FILES (X86)\\COMMON FILES",
        "C:\\PROGRAMDATA",
        "C:\\USERS",
    ];
    if blocked_exact.iter().any(|b| norm == *b) {
        return true;
    }

    // Reject exact user profile / AppData roots / Temp
    for env_var in ["USERPROFILE", "LOCALAPPDATA", "APPDATA", "TEMP"] {
        if let Ok(v) = env::var(env_var) {
            let vn = normalize_path_key(&v);
            if norm == vn || norm == format!("{}\\PROGRAMS", vn) {
                return true;
            }
        }
    }

    false
}

fn enumerate_uninstall_hive(root_hive: HKEY, subkey: &str) -> Vec<RawRegistryApp> {
    let mut out = Vec::new();
    let wide_sub = to_wide_null(subkey);
    let mut h_uninstall: HKEY = null_mut();

    let open_res =
        unsafe { RegOpenKeyExW(root_hive, wide_sub.as_ptr(), 0, KEY_READ, &mut h_uninstall) };
    if open_res != ERROR_SUCCESS || h_uninstall.is_null() {
        return out;
    }

    let mut index = 0u32;
    let mut name_buf: [u16; 512] = [0; 512];

    loop {
        let mut name_len = name_buf.len() as u32;
        let enum_res = unsafe {
            RegEnumKeyExW(
                h_uninstall,
                index,
                name_buf.as_mut_ptr(),
                &mut name_len,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
            )
        };
        if enum_res != ERROR_SUCCESS {
            break;
        }
        index += 1;

        let child_name = OsString::from_wide(&name_buf[..name_len as usize])
            .to_string_lossy()
            .to_string();
        let child_wide = to_wide_null(&child_name);

        let mut h_app: HKEY = null_mut();
        let child_open =
            unsafe { RegOpenKeyExW(h_uninstall, child_wide.as_ptr(), 0, KEY_READ, &mut h_app) };
        if child_open != ERROR_SUCCESS || h_app.is_null() {
            continue;
        }

        // Skip hidden system components & sub-patches
        let is_sys = read_reg_dword(h_app, "SystemComponent").unwrap_or(0) == 1;
        let has_parent = read_reg_string(h_app, "ParentKeyName").is_some();

        if !is_sys && !has_parent {
            if let Some(display_name) = read_reg_string(h_app, "DisplayName") {
                let publisher = read_reg_string(h_app, "Publisher").unwrap_or_default();
                let version = read_reg_string(h_app, "DisplayVersion").unwrap_or_default();
                let est_kb = read_reg_dword(h_app, "EstimatedSize").unwrap_or(0) as u64;
                let install_date = read_reg_string(h_app, "InstallDate");

                let mut install_loc = read_reg_string(h_app, "InstallLocation")
                    .map(|s| PathBuf::from(s.trim().trim_matches('"')))
                    .filter(|p| p.is_dir() && !is_too_generic_dir(p));

                if install_loc.is_none() {
                    if let Some(icon) = read_reg_string(h_app, "DisplayIcon") {
                        install_loc = extract_dir_from_command(&icon)
                            .filter(|p| p.is_dir() && !is_too_generic_dir(p));
                    }
                }
                if install_loc.is_none() {
                    if let Some(uninst) = read_reg_string(h_app, "UninstallString") {
                        install_loc = extract_dir_from_command(&uninst)
                            .filter(|p| p.is_dir() && !is_too_generic_dir(p));
                    }
                }

                out.push(RawRegistryApp {
                    name: display_name,
                    publisher,
                    version,
                    install_location: install_loc,
                    estimated_size_bytes: est_kb * 1024,
                    install_date,
                });
            }
        }

        unsafe {
            RegCloseKey(h_app);
        }
    }

    unsafe {
        RegCloseKey(h_uninstall);
    }

    out
}

fn categorize_software(name: &str, publisher: &str) -> &'static str {
    let n = format!("{} {}", name, publisher).to_lowercase();
    if n.contains("chrome")
        || n.contains("edge")
        || n.contains("firefox")
        || n.contains("brave")
        || n.contains("opera")
        || n.contains("vivaldi")
        || n.contains("arc ")
        || n.contains("browser")
    {
        return "Browser";
    }
    if n.contains("antigravity")
        || n.contains("claude")
        || n.contains("codex")
        || n.contains("cursor")
        || n.contains("windsurf")
        || n.contains("ollama")
        || n.contains("chatgpt")
        || n.contains("lm studio")
        || n.contains("copilot")
    {
        return "AI & Agents";
    }
    if n.contains("android studio")
        || n.contains("visual studio")
        || n.contains("vs code")
        || n.contains("jetbrains")
        || n.contains("intellij")
        || n.contains("pycharm")
        || n.contains("webstorm")
        || n.contains("gradle")
        || n.contains("rust")
        || n.contains("cargo")
        || n.contains("python")
        || n.contains("node.js")
        || n.contains("docker")
        || n.contains("git")
        || n.contains("postman")
        || n.contains("java")
        || n.contains("jdk")
        || n.contains("sdk")
        || n.contains("powershell")
        || n.contains("cmake")
        || n.contains("wsl")
        || n.contains("android sdk")
    {
        return "IDEs & Dev";
    }
    if n.contains("steam")
        || n.contains("epic games")
        || n.contains("riot")
        || n.contains("valorant")
        || n.contains("xbox")
        || n.contains("ubisoft")
        || n.contains("ea app")
        || n.contains("battle.net")
        || n.contains("minecraft")
        || n.contains("game")
    {
        return "Gaming";
    }
    if n.contains("discord")
        || n.contains("slack")
        || n.contains("teams")
        || n.contains("zoom")
        || n.contains("telegram")
        || n.contains("whatsapp")
        || n.contains("skype")
    {
        return "Communication";
    }
    if n.contains("spotify")
        || n.contains("vlc")
        || n.contains("obs ")
        || n.contains("adobe")
        || n.contains("blender")
        || n.contains("figma")
        || n.contains("audacity")
        || n.contains("gimp")
        || n.contains("davinci")
        || n.contains("capcut")
    {
        return "Media & Creative";
    }
    if n.contains("nvidia")
        || n.contains("amd ")
        || n.contains("intel")
        || n.contains("realtek")
        || n.contains("visual c++")
        || n.contains(".net")
        || n.contains("webview2")
        || n.contains("driver")
        || n.contains("vulkan")
        || n.contains("directx")
    {
        return "System & Drivers";
    }
    "Application"
}

/// Maps well-known software names to their real AppData / User-Home data & cache directories
/// so apps like Chrome (25 GB in AppData!) show their TRUE total disk footprint.
fn find_known_data_paths(
    name: &str,
    user_profile: &Path,
    local_app_data: &Path,
    roaming_app_data: &Path,
) -> Vec<(String, &'static str, PathBuf)> {
    let lower = name.to_lowercase();
    let mut out = Vec::new();

    let mut push_if_dir = |label: &str, kind: &'static str, p: PathBuf| {
        if p.is_dir() {
            out.push((label.to_string(), kind, p));
        }
    };

    if lower.contains("google chrome") {
        push_if_dir(
            "Chrome User Data & Caches",
            "data",
            local_app_data.join("Google\\Chrome\\User Data"),
        );
    } else if lower.contains("microsoft edge") && !lower.contains("webview") {
        push_if_dir(
            "Edge User Data & Caches",
            "data",
            local_app_data.join("Microsoft\\Edge\\User Data"),
        );
    } else if lower.contains("mozilla firefox") {
        push_if_dir(
            "Firefox Local Caches",
            "cache",
            local_app_data.join("Mozilla\\Firefox"),
        );
        push_if_dir(
            "Firefox Profiles",
            "data",
            roaming_app_data.join("Mozilla\\Firefox"),
        );
    } else if lower.contains("brave") {
        push_if_dir(
            "Brave User Data & Caches",
            "data",
            local_app_data.join("BraveSoftware\\Brave-Browser\\User Data"),
        );
    } else if lower.contains("visual studio code") {
        push_if_dir("VS Code User Data & Cache", "data", roaming_app_data.join("Code"));
        push_if_dir("VS Code Extensions", "data", user_profile.join(".vscode"));
    } else if lower.contains("cursor") {
        push_if_dir("Cursor User Data & Cache", "data", roaming_app_data.join("Cursor"));
        push_if_dir("Cursor Extensions & Config", "data", user_profile.join(".cursor"));
    } else if lower.contains("windsurf") {
        push_if_dir("Windsurf User Data", "data", roaming_app_data.join("Windsurf"));
        push_if_dir("Codeium / Windsurf Data", "data", user_profile.join(".codeium"));
    } else if lower.contains("antigravity") {
        push_if_dir("Antigravity AppData", "data", roaming_app_data.join("Antigravity"));
        push_if_dir("Antigravity Local", "cache", local_app_data.join("Antigravity"));
        push_if_dir("Antigravity Gemini Data", "data", user_profile.join(".gemini\\antigravity"));
    } else if lower.contains("claude") {
        push_if_dir("Claude Desktop Data", "data", roaming_app_data.join("Claude"));
        push_if_dir("Claude Code Data", "data", user_profile.join(".claude"));
    } else if lower.contains("android studio") {
        if let Ok(entries) = std::fs::read_dir(local_app_data.join("Google")) {
            for e in entries.flatten() {
                if e.file_name().to_string_lossy().starts_with("AndroidStudio") && e.path().is_dir() {
                    push_if_dir("Android Studio Caches", "cache", e.path());
                }
            }
        }
        push_if_dir("Android SDK", "data", local_app_data.join("Android\\Sdk"));
        push_if_dir("Android User Profile (.android)", "data", user_profile.join(".android"));
    } else if lower.contains("discord") {
        push_if_dir("Discord Data & Cache", "data", roaming_app_data.join("discord"));
    } else if lower.contains("spotify") {
        push_if_dir("Spotify Storage & Cache", "cache", local_app_data.join("Spotify"));
        push_if_dir("Spotify AppData", "data", roaming_app_data.join("Spotify"));
    } else if lower == "steam" || lower.starts_with("steam ") {
        push_if_dir("Steam Local Cache", "cache", local_app_data.join("Steam"));
    } else if lower.contains("docker desktop") {
        push_if_dir("Docker Local Data & WSL VHDX", "data", local_app_data.join("Docker"));
    } else if lower.contains("ollama") {
        push_if_dir("Ollama Models & Data", "data", user_profile.join(".ollama"));
        push_if_dir("Ollama Local", "cache", local_app_data.join("Ollama"));
    } else if lower.contains("postman") {
        push_if_dir("Postman Data & Cache", "data", roaming_app_data.join("Postman"));
    } else if lower.contains("slack") {
        push_if_dir("Slack Data & Cache", "data", roaming_app_data.join("Slack"));
    } else if lower.contains("notion") {
        push_if_dir("Notion Data & Cache", "data", roaming_app_data.join("Notion"));
    }

    out
}

/// Detects major portable / developer / AI software that may NOT register in Windows Uninstall Registry
/// (e.g., Gradle, Rust/Cargo, Android SDK, Codex CLI, Claude Code, Antigravity, Ollama).
fn detect_standalone_dev_and_ai_software(
    existing_names_lower: &HashSet<String>,
    user_profile: &Path,
    local_app_data: &Path,
    roaming_app_data: &Path,
) -> Vec<(String, String, String, Vec<(String, &'static str, PathBuf)>)> {
    let mut extras = Vec::new();

    let has_match = |needle: &str| existing_names_lower.iter().any(|n| n.contains(needle));

    // Gradle Toolchain & Caches
    let gradle_home = env::var("GRADLE_USER_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| user_profile.join(".gradle"));
    if gradle_home.is_dir() && !has_match("gradle") {
        extras.push((
            "Gradle Build System & Caches".to_string(),
            "Gradle Inc.".to_string(),
            "IDEs & Dev".to_string(),
            vec![("Gradle Home (.gradle)".to_string(), "cache", gradle_home)],
        ));
    }

    // Android SDK (if Android Studio wasn't in registry)
    let android_sdk = local_app_data.join("Android\\Sdk");
    if android_sdk.is_dir() && !has_match("android studio") {
        let mut paths = vec![("Android SDK".to_string(), "data", android_sdk)];
        let dot_android = user_profile.join(".android");
        if dot_android.is_dir() {
            paths.push(("Android AVDs & Cache (.android)".to_string(), "data", dot_android));
        }
        extras.push((
            "Android SDK & Emulators".to_string(),
            "Google".to_string(),
            "IDEs & Dev".to_string(),
            paths,
        ));
    }

    // Rust Toolchain (.rustup + .cargo)
    let cargo_home = user_profile.join(".cargo");
    let rustup_home = user_profile.join(".rustup");
    if (cargo_home.is_dir() || rustup_home.is_dir()) && !has_match("rust") {
        let mut paths = Vec::new();
        if rustup_home.is_dir() {
            paths.push(("Rust Toolchains (.rustup)".to_string(), "install", rustup_home));
        }
        if cargo_home.is_dir() {
            paths.push(("Cargo Crates & Binaries (.cargo)".to_string(), "cache", cargo_home));
        }
        extras.push((
            "Rust Toolchain (rustup & Cargo)".to_string(),
            "Rust Foundation".to_string(),
            "IDEs & Dev".to_string(),
            paths,
        ));
    }

    // Google Antigravity
    let agy_gemini = user_profile.join(".gemini\\antigravity");
    let agy_roaming = roaming_app_data.join("Antigravity");
    let agy_local = local_app_data.join("Antigravity");
    if (agy_gemini.is_dir() || agy_roaming.is_dir() || agy_local.is_dir()) && !has_match("antigravity") {
        let mut paths = Vec::new();
        if agy_local.is_dir() {
            paths.push(("Antigravity Local".to_string(), "install", agy_local));
        }
        if agy_roaming.is_dir() {
            paths.push(("Antigravity AppData".to_string(), "data", agy_roaming));
        }
        if agy_gemini.is_dir() {
            paths.push(("Antigravity Gemini Data".to_string(), "data", agy_gemini));
        }
        extras.push((
            "Google Antigravity".to_string(),
            "Google".to_string(),
            "AI & Agents".to_string(),
            paths,
        ));
    }

    // Claude / Claude Code
    let claude_home = user_profile.join(".claude");
    let claude_roaming = roaming_app_data.join("Claude");
    if (claude_home.is_dir() || claude_roaming.is_dir()) && !has_match("claude") {
        let mut paths = Vec::new();
        if claude_roaming.is_dir() {
            paths.push(("Claude Desktop Data".to_string(), "data", claude_roaming));
        }
        if claude_home.is_dir() {
            paths.push(("Claude Code (.claude)".to_string(), "data", claude_home));
        }
        extras.push((
            "Claude / Claude Code".to_string(),
            "Anthropic".to_string(),
            "AI & Agents".to_string(),
            paths,
        ));
    }

    // OpenAI Codex CLI
    let codex_home = user_profile.join(".codex");
    if codex_home.is_dir() && !has_match("codex") {
        extras.push((
            "OpenAI Codex CLI".to_string(),
            "OpenAI".to_string(),
            "AI & Agents".to_string(),
            vec![("Codex Data (.codex)".to_string(), "data", codex_home)],
        ));
    }

    // Ollama
    let ollama_home = user_profile.join(".ollama");
    if ollama_home.is_dir() && !has_match("ollama") {
        extras.push((
            "Ollama Local LLMs".to_string(),
            "Ollama".to_string(),
            "AI & Agents".to_string(),
            vec![("Ollama Models (.ollama)".to_string(), "data", ollama_home)],
        ));
    }

    extras
}

fn measure_dir_size(path: &Path, disk_index: &Arc<DiskIndexManager>) -> u64 {
    if let Some(fast_size) = disk_index.get_path_size_fast(path) {
        return fast_size;
    }
    let dummy_cancel = AtomicBool::new(false);
    let (bytes, _, _, _, _) = compute_directory_metrics(path, &dummy_cancel);
    bytes
}

/// Scans all installed Windows software + standalone dev/AI toolchains and computes their
/// accurate total disk footprint (Install Size + User Data/Cache Size).
pub fn scan_installed_software(disk_index: Arc<DiskIndexManager>) -> SoftwareStorageReport {
    let start = Instant::now();
    let user_profile = env::var("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("C:\\Users\\Default"));
    let local_app_data = env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| user_profile.join("AppData\\Local"));
    let roaming_app_data = env::var("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| user_profile.join("AppData\\Roaming"));

    // 1. Collect from all 3 Windows Uninstall registry hives
    let mut raw_apps = Vec::new();
    raw_apps.extend(enumerate_uninstall_hive(
        HKEY_LOCAL_MACHINE,
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    ));
    raw_apps.extend(enumerate_uninstall_hive(
        HKEY_LOCAL_MACHINE,
        "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    ));
    raw_apps.extend(enumerate_uninstall_hive(
        HKEY_CURRENT_USER,
        "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    ));

    // 2. Deduplicate by normalized DisplayName (preferring entry with valid InstallLocation)
    let mut deduped: HashMap<String, RawRegistryApp> = HashMap::new();
    for app in raw_apps {
        let key = app.name.trim().to_uppercase();
        if key.is_empty() {
            continue;
        }
        match deduped.get_mut(&key) {
            Some(existing) => {
                if existing.install_location.is_none() && app.install_location.is_some() {
                    existing.install_location = app.install_location;
                }
                if existing.estimated_size_bytes == 0 && app.estimated_size_bytes > 0 {
                    existing.estimated_size_bytes = app.estimated_size_bytes;
                }
                if existing.publisher.is_empty() && !app.publisher.is_empty() {
                    existing.publisher = app.publisher;
                }
                if existing.version.is_empty() && !app.version.is_empty() {
                    existing.version = app.version;
                }
            }
            None => {
                deduped.insert(key, app);
            }
        }
    }

    let existing_names_lower: HashSet<String> = deduped.keys().map(|k| k.to_lowercase()).collect();

    // 3. Measure all registry apps in parallel (instant O(1) lookup for drives already indexed!)
    let reg_list: Vec<RawRegistryApp> = deduped.into_values().collect();
    let idx_clone = Arc::clone(&disk_index);
    let up_c = user_profile.clone();
    let lad_c = local_app_data.clone();
    let rad_c = roaming_app_data.clone();

    let mut apps: Vec<InstalledSoftwareItem> = reg_list
        .into_par_iter()
        .filter_map(|app| {
            let mut path_entries: Vec<SoftwarePathEntry> = Vec::new();
            let mut seen_path_keys: HashSet<String> = HashSet::new();
            let mut install_bytes = 0u64;
            let mut data_bytes = 0u64;

            if let Some(loc) = &app.install_location {
                let norm = normalize_path_key(&loc.to_string_lossy());
                if seen_path_keys.insert(norm) {
                    let sz = measure_dir_size(loc, &idx_clone);
                    install_bytes += sz;
                    path_entries.push(SoftwarePathEntry {
                        label: "Install Directory".to_string(),
                        kind: "install".to_string(),
                        path: loc.to_string_lossy().to_string(),
                        size_bytes: sz,
                    });
                }
            }

            // Attach known AppData / User Data folders (e.g. Chrome's 25 GB User Data!)
            for (label, kind, dp) in find_known_data_paths(&app.name, &up_c, &lad_c, &rad_c) {
                let norm = normalize_path_key(&dp.to_string_lossy());
                // Avoid double-counting if install_location is already an ancestor or same path
                let overlaps = seen_path_keys.iter().any(|existing| {
                    norm == *existing
                        || norm.starts_with(&format!("{}\\", existing))
                        || existing.starts_with(&format!("{}\\", norm))
                });
                if !overlaps && seen_path_keys.insert(norm) {
                    let sz = measure_dir_size(&dp, &idx_clone);
                    data_bytes += sz;
                    path_entries.push(SoftwarePathEntry {
                        label,
                        kind: kind.to_string(),
                        path: dp.to_string_lossy().to_string(),
                        size_bytes: sz,
                    });
                }
            }

            let mut size_source = "exact_disk".to_string();
            if install_bytes + data_bytes == 0 && app.estimated_size_bytes > 0 {
                install_bytes = app.estimated_size_bytes;
                size_source = "registry_estimate".to_string();
            }

            let total_bytes = install_bytes + data_bytes;
            if total_bytes == 0 && path_entries.is_empty() {
                return None;
            }

            path_entries.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
            let primary_path = path_entries
                .first()
                .map(|p| p.path.clone())
                .unwrap_or_default();
            let drive = extract_drive_root(&primary_path)
                .map(|(root, _)| root.replace('\\', ""))
                .unwrap_or_else(|| "C:".to_string());

            let category = categorize_software(&app.name, &app.publisher).to_string();

            Some(InstalledSoftwareItem {
                id: format!("reg:{}", app.name.to_uppercase()),
                name: app.name,
                publisher: if app.publisher.is_empty() {
                    "Unknown Publisher".to_string()
                } else {
                    app.publisher
                },
                version: app.version,
                category,
                drive,
                install_bytes,
                data_bytes,
                total_bytes,
                primary_path,
                paths: path_entries,
                size_source,
                install_date: app.install_date,
            })
        })
        .collect();

    // 4. Add standalone dev & AI toolchains (Gradle, Rust, Android SDK, Antigravity, Claude, Codex, Ollama)
    let standalone = detect_standalone_dev_and_ai_software(
        &existing_names_lower,
        &user_profile,
        &local_app_data,
        &roaming_app_data,
    );
    let idx_clone2 = Arc::clone(&disk_index);
    let extra_items: Vec<InstalledSoftwareItem> = standalone
        .into_par_iter()
        .filter_map(|(name, publisher, category, raw_paths)| {
            let mut entries = Vec::new();
            let mut install_bytes = 0u64;
            let mut data_bytes = 0u64;
            for (label, kind, p) in raw_paths {
                let sz = measure_dir_size(&p, &idx_clone2);
                if kind == "install" {
                    install_bytes += sz;
                } else {
                    data_bytes += sz;
                }
                entries.push(SoftwarePathEntry {
                    label,
                    kind: kind.to_string(),
                    path: p.to_string_lossy().to_string(),
                    size_bytes: sz,
                });
            }
            let total_bytes = install_bytes + data_bytes;
            if total_bytes == 0 {
                return None;
            }
            entries.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes));
            let primary_path = entries.first().map(|e| e.path.clone()).unwrap_or_default();
            let drive = extract_drive_root(&primary_path)
                .map(|(root, _)| root.replace('\\', ""))
                .unwrap_or_else(|| "C:".to_string());

            Some(InstalledSoftwareItem {
                id: format!("tool:{}", name.to_uppercase()),
                name,
                publisher,
                version: String::new(),
                category,
                drive,
                install_bytes,
                data_bytes,
                total_bytes,
                primary_path,
                paths: entries,
                size_source: "exact_disk".to_string(),
                install_date: None,
            })
        })
        .collect();

    apps.extend(extra_items);
    apps.sort_by(|a, b| b.total_bytes.cmp(&a.total_bytes));

    let total_bytes: u64 = apps.iter().map(|a| a.total_bytes).sum();
    let total_install_bytes: u64 = apps.iter().map(|a| a.install_bytes).sum();
    let total_data_bytes: u64 = apps.iter().map(|a| a.data_bytes).sum();
    let app_count = apps.len();

    SoftwareStorageReport {
        apps,
        total_bytes,
        total_install_bytes,
        total_data_bytes,
        app_count,
        duration_ms: start.elapsed().as_millis() as u64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_software_scanner_finds_installed_apps() {
        let mgr = Arc::new(DiskIndexManager::new());
        let report = scan_installed_software(mgr);
        assert!(report.app_count > 0, "Expected to find installed Windows software");
        assert!(report.total_bytes > 0, "Expected non-zero total software disk usage");
    }
}
