use crate::diagnostics;
use crate::event_parser::parse_event_line;
use crate::storage::SessionStore;
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::env;
use std::fs;
use std::io::{self, BufRead, BufReader, Read};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;

const BRIDGE_EVENT_NAME: &str = "bridge-event";
const CAPTURE_STATUS_EVENT_NAME: &str = "capture-status";
const BACKEND_WARNING_EVENT_NAME: &str = "backend-warning";
const DEFAULT_BODY_LIMIT: u64 = 1_000_000;
const MAX_BODY_LIMIT: u64 = 100_000_000;
const PROXY_START_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CaptureStatus {
    Stopped,
    Starting,
    Running,
    Stopping,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureConfig {
    pub host: String,
    pub port: u16,
    pub body_limit: u64,
}

impl Default for CaptureConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_owned(),
            port: 8080,
            body_limit: DEFAULT_BODY_LIMIT,
        }
    }
}

impl CaptureConfig {
    fn validate(&self) -> Result<(), String> {
        if self.host != "127.0.0.1" && self.host != "0.0.0.0" {
            return Err("Proxy host must be 127.0.0.1 or 0.0.0.0.".to_owned());
        }
        if self.port == 0 {
            return Err("Proxy port must be between 1 and 65535.".to_owned());
        }
        if self.body_limit == 0 || self.body_limit > MAX_BODY_LIMIT {
            return Err(format!(
                "Body limit must be between 1 byte and {MAX_BODY_LIMIT} bytes."
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStatusSnapshot {
    pub status: CaptureStatus,
    pub pid: Option<u32>,
    pub host: String,
    pub port: u16,
    pub message: Option<String>,
}

#[cfg(windows)]
struct ProcessJob(isize);

#[cfg(windows)]
impl Drop for ProcessJob {
    fn drop(&mut self) {
        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};

        unsafe {
            CloseHandle(self.0 as HANDLE);
        }
    }
}

#[cfg(not(windows))]
struct ProcessJob;

struct CaptureRuntime {
    status: CaptureStatus,
    child: Option<Child>,
    process_job: Option<ProcessJob>,
    pid: Option<u32>,
    config: CaptureConfig,
    message: Option<String>,
    generation: u64,
}

impl Default for CaptureRuntime {
    fn default() -> Self {
        Self {
            status: CaptureStatus::Stopped,
            child: None,
            process_job: None,
            pid: None,
            config: CaptureConfig::default(),
            message: None,
            generation: 0,
        }
    }
}

#[derive(Clone, Default)]
pub struct CaptureManager {
    runtime: Arc<Mutex<CaptureRuntime>>,
}

impl CaptureManager {
    pub fn snapshot(&self) -> CaptureStatusSnapshot {
        let runtime = self.lock_runtime();
        snapshot_from_runtime(&runtime)
    }

    pub fn start(
        &self,
        app: AppHandle,
        config: CaptureConfig,
    ) -> Result<CaptureStatusSnapshot, String> {
        diagnostics::write_info(
            &app,
            "capture",
            &format!(
                "Start requested; host={}; port={}; body_limit={}",
                config.host, config.port, config.body_limit
            ),
        );
        config.validate().inspect_err(|message| {
            self.mark_failed(&app, message.clone());
        })?;

        {
            let mut runtime = self.lock_runtime();
            if matches!(
                runtime.status,
                CaptureStatus::Starting | CaptureStatus::Running | CaptureStatus::Stopping
            ) {
                let message = "Capture is already active or changing state.".to_owned();
                diagnostics::write_warn(&app, "capture", &message);
                return Err(message);
            }
            runtime.status = CaptureStatus::Starting;
            runtime.config = config.clone();
            runtime.message = None;
            runtime.generation = runtime.generation.wrapping_add(1);
        }
        self.emit_status(&app);

        if TcpListener::bind((config.host.as_str(), config.port)).is_err() {
            let message = format!(
                "Cannot start capture because {}:{} is already in use or unavailable.",
                config.host, config.port
            );
            self.mark_failed(&app, message.clone());
            return Err(message);
        }

        let executable = resolve_mitmdump_path(&app).inspect_err(|message| {
            self.mark_failed(&app, message.clone());
        })?;
        let bridge_path = resolve_bridge_path(&app).inspect_err(|message| {
            self.mark_failed(&app, message.clone());
        })?;
        diagnostics::write_info(
            &app,
            "capture",
            &format!(
                "Runtime resolved; proxy={}; bridge={}",
                executable.display(),
                bridge_path.display()
            ),
        );
        let runtime_directory = app_runtime_directory(&app).inspect_err(|message| {
            self.mark_failed(&app, message.clone());
        })?;
        let conf_directory = runtime_directory.join("mitmproxy");
        fs::create_dir_all(&conf_directory).map_err(|error| {
            let message = format!("Cannot create certificate directory: {error}");
            self.mark_failed(&app, message.clone());
            message
        })?;

        let mut command = Command::new(executable);
        command
            .arg("--listen-host")
            .arg(&config.host)
            .arg("--listen-port")
            .arg(config.port.to_string())
            .arg("--set")
            .arg(format!("confdir={}", conf_directory.display()))
            .arg("--set")
            .arg(format!("appdbg_body_limit={}", config.body_limit))
            .arg("--set")
            .arg("appdbg_redact_sensitive=true")
            .arg("--set")
            .arg("termlog_verbosity=error")
            .arg("-s")
            .arg(&bridge_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_hidden_process(&mut command);

        let mut child = command.spawn().map_err(|error| {
            let message = format!("Cannot start mitmdump: {error}");
            self.mark_failed(&app, message.clone());
            message
        })?;
        diagnostics::write_info(
            &app,
            "capture",
            &format!("Proxy process spawned; pid={}", child.id()),
        );
        let process_job = match attach_kill_on_close_job(&child) {
            Ok(process_job) => process_job,
            Err(message) => {
                let _ = child.kill();
                let _ = child.wait();
                self.mark_failed(&app, message.clone());
                return Err(message);
            }
        };
        let pid = child.id();
        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let _ = child.kill();
                let _ = child.wait();
                let message = "Cannot read mitmdump stdout.".to_owned();
                self.mark_failed(&app, message.clone());
                return Err(message);
            }
        };
        let stderr = match child.stderr.take() {
            Some(stderr) => stderr,
            None => {
                let _ = child.kill();
                let _ = child.wait();
                let message = "Cannot read mitmdump stderr.".to_owned();
                self.mark_failed(&app, message.clone());
                return Err(message);
            }
        };

        spawn_stdout_reader(app.clone(), stdout);
        spawn_stderr_reader(app.clone(), stderr);

        if let Err(message) = wait_for_proxy_ready(&mut child, config.port, PROXY_START_TIMEOUT) {
            let _ = child.kill();
            let _ = child.wait();
            self.mark_failed(&app, message.clone());
            return Err(message);
        }
        diagnostics::write_info(
            &app,
            "capture",
            &format!(
                "Proxy is accepting connections on {}:{}.",
                config.host, config.port
            ),
        );

        if let Err(error) = app.state::<SessionStore>().start_session() {
            let _ = child.kill();
            let _ = child.wait();
            self.mark_failed(&app, error.clone());
            return Err(error);
        }

        let generation = {
            let mut runtime = self.lock_runtime();
            runtime.child = Some(child);
            runtime.process_job = Some(process_job);
            runtime.pid = Some(pid);
            runtime.status = CaptureStatus::Running;
            runtime.message = None;
            runtime.generation
        };

        self.spawn_exit_monitor(app.clone(), generation);
        self.emit_status(&app);
        diagnostics::write_info(&app, "capture", &format!("Capture is running; pid={pid}."));

        Ok(self.snapshot())
    }

    pub fn stop(&self, app: Option<&AppHandle>) -> Result<CaptureStatusSnapshot, String> {
        if let Some(app) = app {
            diagnostics::write_info(app, "capture", "Stop requested.");
        }
        let (child, process_job) = {
            let mut runtime = self.lock_runtime();
            if runtime.status == CaptureStatus::Stopped {
                if let Some(app) = app {
                    diagnostics::write_info(app, "capture", "Capture was already stopped.");
                }
                return Ok(snapshot_from_runtime(&runtime));
            }
            runtime.status = CaptureStatus::Stopping;
            runtime.message = None;
            (runtime.child.take(), runtime.process_job.take())
        };

        if let Some(app) = app {
            self.emit_status(app);
        }

        let mut stop_result = if let Some(mut child) = child {
            match child.try_wait() {
                Ok(Some(_)) => Ok(()),
                Ok(None) => child
                    .kill()
                    .and_then(|()| child.wait().map(|_| ()))
                    .map_err(|error| format!("Cannot stop mitmdump: {error}")),
                Err(error) => Err(format!("Cannot inspect mitmdump before stopping: {error}")),
            }
        } else {
            Ok(())
        };
        drop(process_job);

        let session_result = app.map_or(Ok(()), |app| {
            app.state::<SessionStore>().end_active_session()
        });
        if stop_result.is_ok() {
            stop_result = session_result;
        }

        {
            let mut runtime = self.lock_runtime();
            runtime.pid = None;
            runtime.status = if stop_result.is_ok() {
                CaptureStatus::Stopped
            } else {
                CaptureStatus::Failed
            };
            runtime.message = stop_result.as_ref().err().cloned();
        }

        if let Some(app) = app {
            self.emit_status(app);
            match &stop_result {
                Ok(()) => diagnostics::write_info(app, "capture", "Capture stopped."),
                Err(error) => diagnostics::write_error(app, "capture", error),
            }
        }

        stop_result.map(|()| self.snapshot())
    }

    pub fn restart(
        &self,
        app: AppHandle,
        config: CaptureConfig,
    ) -> Result<CaptureStatusSnapshot, String> {
        self.stop(Some(&app))?;
        self.start(app, config)
    }

    pub fn shutdown(&self, app: &AppHandle) {
        diagnostics::write_info(app, "capture", "Capture shutdown cleanup started.");
        let _ = self.stop(Some(app));
    }

    fn mark_failed(&self, app: &AppHandle, message: String) {
        diagnostics::write_error(app, "capture", &message);
        {
            let mut runtime = self.lock_runtime();
            runtime.status = CaptureStatus::Failed;
            runtime.pid = None;
            runtime.child = None;
            runtime.process_job = None;
            runtime.message = Some(message);
        }
        self.emit_status(app);
    }

    fn emit_status(&self, app: &AppHandle) {
        let _ = app.emit(CAPTURE_STATUS_EVENT_NAME, self.snapshot());
    }

    fn spawn_exit_monitor(&self, app: AppHandle, generation: u64) {
        let manager = self.clone();
        thread::spawn(move || {
            loop {
                thread::sleep(Duration::from_millis(250));

                let terminal_status = {
                    let mut runtime = manager.lock_runtime();
                    if runtime.generation != generation {
                        return;
                    }

                    let Some(child) = runtime.child.as_mut() else {
                        if matches!(
                            runtime.status,
                            CaptureStatus::Stopped | CaptureStatus::Failed
                        ) {
                            return;
                        }
                        continue;
                    };

                    match child.try_wait() {
                        Ok(Some(exit_status)) => {
                            runtime.child = None;
                            runtime.process_job = None;
                            runtime.pid = None;
                            let failed =
                                runtime.status != CaptureStatus::Stopping && !exit_status.success();
                            if failed {
                                runtime.status = CaptureStatus::Failed;
                                runtime.message =
                                    Some(format!("mitmdump exited unexpectedly: {exit_status}"));
                            } else {
                                runtime.status = CaptureStatus::Stopped;
                                runtime.message = None;
                            }
                            Some((
                                snapshot_from_runtime(&runtime),
                                failed,
                                format!("Proxy process exited; status={exit_status}."),
                            ))
                        }
                        Ok(None) => None,
                        Err(error) => {
                            runtime.child = None;
                            runtime.process_job = None;
                            runtime.pid = None;
                            runtime.status = CaptureStatus::Failed;
                            runtime.message =
                                Some(format!("Cannot monitor mitmdump process: {error}"));
                            Some((
                                snapshot_from_runtime(&runtime),
                                true,
                                format!("Cannot monitor proxy process: {error}"),
                            ))
                        }
                    }
                };

                if let Some((snapshot, failed, diagnostic_message)) = terminal_status {
                    if failed {
                        diagnostics::write_error(&app, "capture", &diagnostic_message);
                    } else {
                        diagnostics::write_info(&app, "capture", &diagnostic_message);
                    }
                    let _ = app.emit(CAPTURE_STATUS_EVENT_NAME, snapshot);
                    return;
                }
            }
        });
    }

    fn lock_runtime(&self) -> MutexGuard<'_, CaptureRuntime> {
        self.runtime
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn wait_for_proxy_ready(child: &mut Child, port: u16, timeout: Duration) -> Result<(), String> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + timeout;

    loop {
        match child.try_wait() {
            Ok(Some(exit_status)) => {
                return Err(format!(
                    "mitmdump exited before the proxy was ready: {exit_status}"
                ));
            }
            Ok(None) => {}
            Err(error) => {
                return Err(format!(
                    "Cannot inspect mitmdump while waiting for startup: {error}"
                ));
            }
        }

        if TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_ok() {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "mitmdump did not start listening on 127.0.0.1:{port} within {} seconds.",
                timeout.as_secs()
            ));
        }

        thread::sleep(Duration::from_millis(100));
    }
}

fn snapshot_from_runtime(runtime: &CaptureRuntime) -> CaptureStatusSnapshot {
    CaptureStatusSnapshot {
        status: runtime.status,
        pid: runtime.pid,
        host: runtime.config.host.clone(),
        port: runtime.config.port,
        message: runtime.message.clone(),
    }
}

fn spawn_stdout_reader(app: AppHandle, stdout: impl std::io::Read + Send + 'static) {
    thread::spawn(move || {
        let read_result = read_output_lines(stdout, |line, had_invalid_utf8| {
            if had_invalid_utf8 {
                diagnostics::write_warn(
                    &app,
                    "proxy",
                    "mitmdump stdout contained invalid UTF-8; replacement characters were used",
                );
            }

            match parse_event_line(line) {
                Ok(Some(event)) => {
                    if let Err(error) = app.state::<SessionStore>().persist_event(&event) {
                        diagnostics::write_error(
                            &app,
                            "storage",
                            &format!("Cannot persist captured event: {error}"),
                        );
                        let _ = app.emit(
                            BACKEND_WARNING_EVENT_NAME,
                            "A captured event could not be saved to history.",
                        );
                    }
                    let _ = app.emit(BRIDGE_EVENT_NAME, event);
                }
                Ok(None) => {}
                Err(error) => {
                    diagnostics::write_error(
                        &app,
                        "bridge",
                        &format!("Cannot parse bridge event: {error}"),
                    );
                    let _ = app.emit(
                        BACKEND_WARNING_EVENT_NAME,
                        "A malformed bridge event was ignored.",
                    );
                }
            }
        });

        if let Err(error) = read_result {
            diagnostics::write_error(&app, "proxy", &format!("Cannot read proxy stdout: {error}"));
        }
    });
}

fn spawn_stderr_reader(app: AppHandle, stderr: impl std::io::Read + Send + 'static) {
    thread::spawn(move || {
        let read_result = read_output_lines(stderr, |line, had_invalid_utf8| {
            if had_invalid_utf8 {
                diagnostics::write_warn(
                    &app,
                    "proxy",
                    "mitmdump stderr contained invalid UTF-8; replacement characters were used",
                );
            }
            diagnostics::write_error(&app, "proxy", line);
        });

        if let Err(error) = read_result {
            diagnostics::write_error(&app, "proxy", &format!("Cannot read proxy stderr: {error}"));
        }
    });
}

fn read_output_lines(output: impl Read, mut handle_line: impl FnMut(&str, bool)) -> io::Result<()> {
    let mut reader = BufReader::new(output);
    let mut buffer = Vec::new();

    loop {
        buffer.clear();
        if reader.read_until(b'\n', &mut buffer)? == 0 {
            return Ok(());
        }

        if buffer.last() == Some(&b'\n') {
            buffer.pop();
        }
        if buffer.last() == Some(&b'\r') {
            buffer.pop();
        }

        let line = String::from_utf8_lossy(&buffer);
        let had_invalid_utf8 = matches!(&line, Cow::Owned(_));
        handle_line(line.as_ref(), had_invalid_utf8);
    }
}

fn app_runtime_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve application data directory: {error}"))?
        .join("runtime");
    fs::create_dir_all(&path)
        .map_err(|error| format!("Cannot create runtime directory: {error}"))?;
    Ok(path)
}

fn resolve_bridge_path(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_path = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Cannot resolve resource directory: {error}"))?
        .join("addons")
        .join("bridge.py");
    if resource_path.is_file() {
        return Ok(resource_path);
    }

    let development_path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("addons")
        .join("bridge.py");
    if development_path.is_file() {
        return Ok(development_path);
    }

    Err("bridge.py was not found in development or packaged resources.".to_owned())
}

fn resolve_mitmdump_path(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("APPDBG_MITMDUMP_PATH").map(PathBuf::from) {
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "APPDBG_MITMDUMP_PATH does not point to a file: {}",
            path.display()
        ));
    }

    let resource_path = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Cannot resolve resource directory: {error}"))?
        .join("bin")
        .join(if cfg!(windows) {
            "mitmdump.exe"
        } else {
            "mitmdump"
        });
    if resource_path.is_file() {
        return Ok(resource_path);
    }

    let project_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Cannot resolve project root.".to_owned())?;
    let development_path = if cfg!(windows) {
        project_root
            .join(".venv")
            .join("Scripts")
            .join("mitmdump.exe")
    } else {
        project_root.join(".venv").join("bin").join("mitmdump")
    };
    if development_path.is_file() {
        return Ok(development_path);
    }

    let executable_name = if cfg!(windows) {
        "mitmdump.exe"
    } else {
        "mitmdump"
    };
    if let Some(path) = find_on_path(executable_name) {
        return Ok(path);
    }

    Err("mitmdump binary not found in packaged resources, the development .venv, or PATH. Set APPDBG_MITMDUMP_PATH to override it.".to_owned())
}

fn find_on_path(executable_name: &str) -> Option<PathBuf> {
    env::var_os("PATH").and_then(|paths| {
        env::split_paths(&paths)
            .map(|directory| directory.join(executable_name))
            .find(|candidate| candidate.is_file())
    })
}

#[cfg(windows)]
fn attach_kill_on_close_job(child: &Child) -> Result<ProcessJob, String> {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject,
    };

    let handle = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
    if handle.is_null() {
        return Err(format!(
            "Cannot create a Windows process job for mitmdump: {}",
            io::Error::last_os_error()
        ));
    }
    let process_job = ProcessJob(handle as isize);

    let mut job_information: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
    job_information.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let configured = unsafe {
        SetInformationJobObject(
            handle,
            JobObjectExtendedLimitInformation,
            &job_information as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const c_void,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if configured == 0 {
        return Err(format!(
            "Cannot configure mitmdump process cleanup: {}",
            io::Error::last_os_error()
        ));
    }

    let assigned = unsafe { AssignProcessToJobObject(handle, child.as_raw_handle() as HANDLE) };
    if assigned == 0 {
        return Err(format!(
            "Cannot attach mitmdump to the application lifecycle: {}",
            io::Error::last_os_error()
        ));
    }

    Ok(process_job)
}

#[cfg(not(windows))]
fn attach_kill_on_close_job(_child: &Child) -> Result<ProcessJob, String> {
    Ok(ProcessJob)
}

#[cfg(windows)]
fn configure_hidden_process(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn configure_hidden_process(_command: &mut Command) {}

#[tauri::command]
pub fn start_capture(
    app: AppHandle,
    manager: tauri::State<'_, CaptureManager>,
    config: CaptureConfig,
) -> Result<CaptureStatusSnapshot, String> {
    manager.start(app, config)
}

#[tauri::command]
pub fn stop_capture(
    app: AppHandle,
    manager: tauri::State<'_, CaptureManager>,
) -> Result<CaptureStatusSnapshot, String> {
    manager.stop(Some(&app))
}

#[tauri::command]
pub fn restart_capture(
    app: AppHandle,
    manager: tauri::State<'_, CaptureManager>,
    config: CaptureConfig,
) -> Result<CaptureStatusSnapshot, String> {
    manager.restart(app, config)
}

#[tauri::command]
pub fn get_capture_status(manager: tauri::State<'_, CaptureManager>) -> CaptureStatusSnapshot {
    manager.snapshot()
}

#[tauri::command]
pub fn get_proxy_config(manager: tauri::State<'_, CaptureManager>) -> CaptureConfig {
    manager.lock_runtime().config.clone()
}

#[cfg(test)]
mod tests {
    use super::{
        CaptureConfig, CaptureManager, CaptureStatus, DEFAULT_BODY_LIMIT, MAX_BODY_LIMIT,
        read_output_lines,
    };

    #[cfg(windows)]
    use super::{attach_kill_on_close_job, configure_hidden_process};
    #[cfg(windows)]
    use std::process::{Command, Stdio};
    #[cfg(windows)]
    use std::thread;
    #[cfg(windows)]
    use std::time::{Duration, Instant};

    #[test]
    fn default_config_is_local_and_valid() {
        let config = CaptureConfig::default();
        assert_eq!(config.host, "127.0.0.1");
        assert_eq!(config.port, 8080);
        assert_eq!(config.body_limit, DEFAULT_BODY_LIMIT);
        assert!(config.validate().is_ok());
    }

    #[test]
    fn validates_bind_host() {
        let config = CaptureConfig {
            host: "192.168.1.10".to_owned(),
            ..CaptureConfig::default()
        };
        assert!(config.validate().is_err());
    }

    #[test]
    fn validates_port_and_body_limit() {
        let invalid_port = CaptureConfig {
            port: 0,
            ..CaptureConfig::default()
        };
        assert!(invalid_port.validate().is_err());

        let invalid_limit = CaptureConfig {
            body_limit: MAX_BODY_LIMIT + 1,
            ..CaptureConfig::default()
        };
        assert!(invalid_limit.validate().is_err());
    }

    #[test]
    fn stopping_an_idle_manager_is_idempotent() {
        let manager = CaptureManager::default();
        let snapshot = manager.stop(None).expect("idle stop should succeed");
        assert_eq!(snapshot.status, CaptureStatus::Stopped);
        assert!(snapshot.pid.is_none());
    }

    #[test]
    fn output_reader_continues_after_invalid_utf8() {
        let input = b"first\r\nbad:\x95\nlast";
        let mut lines = Vec::new();

        read_output_lines(input.as_slice(), |line, had_invalid_utf8| {
            lines.push((line.to_owned(), had_invalid_utf8));
        })
        .expect("in-memory output should be readable");

        assert_eq!(
            lines,
            vec![
                ("first".to_owned(), false),
                ("bad:\u{fffd}".to_owned(), true),
                ("last".to_owned(), false),
            ]
        );
    }

    #[cfg(windows)]
    #[test]
    fn process_job_terminates_child_when_guard_is_dropped() {
        let mut command = Command::new("ping.exe");
        command
            .args(["-t", "127.0.0.1"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        configure_hidden_process(&mut command);

        let mut child = command.spawn().expect("test child should start");
        let process_job =
            attach_kill_on_close_job(&child).expect("test child should join the process job");
        drop(process_job);

        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if child
                .try_wait()
                .expect("test child status should be readable")
                .is_some()
            {
                break;
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("dropping the process job did not terminate its child");
            }
            thread::sleep(Duration::from_millis(25));
        }
    }
}
