pub mod diagnostics;
pub mod event_parser;
pub mod file_commands;
pub mod network_info;
pub mod process_manager;
pub mod storage;

use diagnostics::{get_diagnostic_log_info, reveal_diagnostic_log, write_frontend_diagnostic};
use file_commands::save_captured_body;
use network_info::get_network_info;
use process_manager::{
    CaptureManager, get_capture_status, get_proxy_config, restart_capture, start_capture,
    stop_capture,
};
use storage::{SessionStore, delete_session, list_sessions, load_session_events, rename_session};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(CaptureManager::default())
        .setup(|app| {
            diagnostics::initialize(app.handle()).map_err(std::io::Error::other)?;
            let store = SessionStore::initialize(app.handle()).map_err(|error| {
                diagnostics::write_error(app.handle(), "storage", &error);
                std::io::Error::other(error)
            })?;
            app.manage(store);
            diagnostics::write_info(app.handle(), "storage", "Session storage initialized.");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_capture,
            stop_capture,
            restart_capture,
            get_capture_status,
            get_proxy_config,
            get_network_info,
            save_captured_body,
            list_sessions,
            load_session_events,
            rename_session,
            delete_session,
            get_diagnostic_log_info,
            reveal_diagnostic_log,
            write_frontend_diagnostic
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    application.run(|app, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
            diagnostics::write_info(app, "app", "Application exit requested.");
            app.state::<CaptureManager>().shutdown(app);
            diagnostics::mark_clean_shutdown(app);
        }
    });
}
