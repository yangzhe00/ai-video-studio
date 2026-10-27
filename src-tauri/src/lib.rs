mod project;
mod media;
mod export;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            project::create_project,
            project::open_project,
            project::save_project,
            media::import_asset,
            media::audit_assets,
            media::read_asset,
            export::export_project
        ])
        .run(tauri::generate_context!())
        .expect("failed to start AI Video Studio");
}
