use serde::Serialize;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::sync::Mutex;
#[cfg(not(windows))]
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const LOG_FILE_NAME: &str = "app-network-debugger.log";
const PREVIOUS_LOG_FILE_NAME: &str = "app-network-debugger.previous.log";
const RUNNING_MARKER_FILE_NAME: &str = "app-network-debugger.running";
const MAX_LOG_SIZE: u64 = 5 * 1024 * 1024;
const MAX_MESSAGE_LENGTH: usize = 16_384;

static LOG_WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticLogInfo {
    pub file_path: String,
    pub directory_path: String,
    pub previous_file_path: String,
    pub max_size_bytes: u64,
}

pub fn initialize(app: &AppHandle) -> Result<DiagnosticLogInfo, String> {
    let info = diagnostic_log_info(app)?;
    let marker_path = Path::new(&info.directory_path).join(RUNNING_MARKER_FILE_NAME);
    let previous_session_was_unclean = marker_path.is_file();

    fs::write(
        &marker_path,
        format!("pid={}\nstarted_at={}\n", std::process::id(), timestamp()),
    )
    .map_err(|error| format!("Cannot create diagnostic session marker: {error}"))?;

    append_entry(
        Path::new(&info.file_path),
        "INFO",
        "app",
        &format!(
            "Session started; version={}; pid={}; platform={}-{}",
            app.package_info().version,
            std::process::id(),
            std::env::consts::OS,
            std::env::consts::ARCH
        ),
    )
    .map_err(|error| format!("Cannot initialize diagnostic log: {error}"))?;

    if previous_session_was_unclean {
        write_warn(
            app,
            "app",
            "The previous application session did not shut down cleanly.",
        );
    }

    Ok(info)
}

pub fn write_info(app: &AppHandle, component: &str, message: &str) {
    write_entry(app, "INFO", component, message);
}

pub fn write_warn(app: &AppHandle, component: &str, message: &str) {
    write_entry(app, "WARN", component, message);
}

pub fn write_error(app: &AppHandle, component: &str, message: &str) {
    write_entry(app, "ERROR", component, message);
}

pub fn mark_clean_shutdown(app: &AppHandle) {
    write_info(app, "app", "Session ended cleanly.");

    let Ok(info) = diagnostic_log_info(app) else {
        return;
    };
    let marker_path = Path::new(&info.directory_path).join(RUNNING_MARKER_FILE_NAME);
    if let Err(error) = fs::remove_file(&marker_path)
        && error.kind() != io::ErrorKind::NotFound
    {
        write_warn(
            app,
            "app",
            &format!("Cannot remove diagnostic session marker: {error}"),
        );
    }
}

#[tauri::command]
pub fn get_diagnostic_log_info(app: AppHandle) -> Result<DiagnosticLogInfo, String> {
    diagnostic_log_info(&app)
}

#[tauri::command]
pub fn reveal_diagnostic_log(app: AppHandle) -> Result<DiagnosticLogInfo, String> {
    let info = diagnostic_log_info(&app)?;
    if let Err(error) = app.opener().reveal_item_in_dir(&info.file_path) {
        let message = format!(
            "Cannot open the diagnostic log location: {error}. The log is at {}.",
            info.file_path
        );
        write_error(&app, "app", &message);
        return Err(message);
    }
    write_info(&app, "app", "Diagnostic log revealed in the file explorer.");
    Ok(info)
}

#[tauri::command]
pub fn write_frontend_diagnostic(
    app: AppHandle,
    level: String,
    message: String,
) -> Result<(), String> {
    let level = match level.as_str() {
        "info" => "INFO",
        "warn" => "WARN",
        "error" => "ERROR",
        _ => return Err("Unsupported diagnostic log level.".to_owned()),
    };
    let info = diagnostic_log_info(&app)?;
    append_entry(Path::new(&info.file_path), level, "frontend", &message)
        .map_err(|error| format!("Cannot write frontend diagnostic log: {error}"))
}

fn diagnostic_log_info(app: &AppHandle) -> Result<DiagnosticLogInfo, String> {
    let directory = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("Cannot resolve diagnostic log directory: {error}"))?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Cannot create diagnostic log directory: {error}"))?;

    let file_path = directory.join(LOG_FILE_NAME);
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .map_err(|error| format!("Cannot create diagnostic log file: {error}"))?;

    Ok(DiagnosticLogInfo {
        file_path: file_path.to_string_lossy().into_owned(),
        directory_path: directory.to_string_lossy().into_owned(),
        previous_file_path: directory
            .join(PREVIOUS_LOG_FILE_NAME)
            .to_string_lossy()
            .into_owned(),
        max_size_bytes: MAX_LOG_SIZE,
    })
}

fn write_entry(app: &AppHandle, level: &str, component: &str, message: &str) {
    let Ok(info) = diagnostic_log_info(app) else {
        return;
    };
    let _ = append_entry(Path::new(&info.file_path), level, component, message);
}

fn append_entry(log_path: &Path, level: &str, component: &str, message: &str) -> io::Result<()> {
    let _guard = LOG_WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    rotate_if_needed(log_path)?;

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)?;
    writeln!(
        file,
        "{} {:<5} {:<10} {}",
        timestamp(),
        sanitize_field(level),
        sanitize_field(component),
        sanitize_message(message)
    )
}

fn rotate_if_needed(log_path: &Path) -> io::Result<()> {
    let Ok(metadata) = fs::metadata(log_path) else {
        return Ok(());
    };
    if metadata.len() < MAX_LOG_SIZE {
        return Ok(());
    }

    let previous_path = log_path.with_file_name(PREVIOUS_LOG_FILE_NAME);
    if previous_path.is_file() {
        fs::remove_file(&previous_path)?;
    }
    fs::rename(log_path, previous_path)
}

fn sanitize_field(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
        .take(16)
        .collect()
}

fn sanitize_message(message: &str) -> String {
    message
        .replace('\r', "\\r")
        .replace('\n', "\\n")
        .chars()
        .take(MAX_MESSAGE_LENGTH)
        .collect()
}

#[cfg(windows)]
fn timestamp() -> String {
    use std::mem::zeroed;
    use windows_sys::Win32::Foundation::SYSTEMTIME;
    use windows_sys::Win32::System::SystemInformation::GetLocalTime;

    let mut value: SYSTEMTIME = unsafe { zeroed() };
    unsafe {
        GetLocalTime(&mut value);
    }
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}",
        value.wYear,
        value.wMonth,
        value.wDay,
        value.wHour,
        value.wMinute,
        value.wSecond,
        value.wMilliseconds
    )
}

#[cfg(not(windows))]
fn timestamp() -> String {
    let milliseconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis());
    format!("unix-ms:{milliseconds}")
}

#[cfg(test)]
mod tests {
    use super::{MAX_LOG_SIZE, PREVIOUS_LOG_FILE_NAME, rotate_if_needed, sanitize_message};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn diagnostic_messages_stay_on_one_line() {
        assert_eq!(
            sanitize_message("first\r\nsecond"),
            "first\\r\\nsecond".to_owned()
        );
    }

    #[test]
    fn oversized_log_is_rotated() {
        let directory = tempdir().expect("temporary directory should exist");
        let log_path = directory.path().join("app-network-debugger.log");
        let file = fs::File::create(&log_path).expect("log should be created");
        file.set_len(MAX_LOG_SIZE)
            .expect("test log should reach rotation size");
        drop(file);

        rotate_if_needed(&log_path).expect("rotation should succeed");

        assert!(!log_path.exists());
        assert!(directory.path().join(PREVIOUS_LOG_FILE_NAME).is_file());
    }
}
