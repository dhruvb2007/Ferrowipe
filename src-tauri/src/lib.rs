pub mod cleaner;
pub mod commands;
pub mod drives;
pub mod folder_analyzer;
pub mod models;
pub mod rules;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_drives,
            start_scan,
            cancel_scan,
            start_clean,
            cancel_clean,
            query_all_recycle_bins,
            open_in_explorer,
            locate_in_explorer,
            analyze_folder,
            analyze_full_disk,
            get_folder_children,
            cancel_folder_analysis,
            get_deep_largest_folders,
            delete_folders,
            cancel_folder_delete
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ferrowipe application");
}
