mod ai;
mod cloud;
mod export;
mod media;
mod project;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(cloud::CloudSession(std::sync::Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            project::create_project,
            project::open_project,
            project::save_project,
            project::backup_project,
            media::import_asset,
            media::audit_assets,
            media::read_asset,
            cloud::cloud_request,
            cloud::cloud_upload_asset,
            cloud::cloud_download_asset,
            export::export_project,
            ai::pricing::quote_shot,
            ai::pricing::check_shot_budget,
            ai::local_config::kling_api_key_status,
            ai::kling::refresh_kling_image_video
        ])
        .run(tauri::generate_context!())
        .expect("failed to start AI Video Studio");
}
