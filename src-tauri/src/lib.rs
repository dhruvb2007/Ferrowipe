pub mod cleaner;
pub mod commands;
pub mod disk_index;
pub mod drives;
pub mod folder_analyzer;
pub mod models;
pub mod rules;
pub mod software_scanner;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_drives,
            get_available_cleanup_rules,
            start_initial_sync_all_drives,
            get_installed_software_storage,
            start_scan,
            cancel_scan,
            start_clean,
            cancel_clean,
            query_all_recycle_bins,
            open_in_explorer,
            locate_in_explorer,
            get_indexed_drives_status,
            get_cached_folder_view,
            get_cached_children_batch,
            analyze_folder,
            analyze_full_disk,
            smart_sync_folder,
            verify_and_recalculate_disk,
            get_folder_children,
            cancel_folder_analysis,
            get_deep_largest_folders,
            delete_folders,
            cancel_folder_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ferrowipe application");
}
