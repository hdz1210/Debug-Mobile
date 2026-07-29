use crate::event_parser::{BodyFormat, BridgeEvent, CapturedBody, HeaderEntry, WebSocketDirection};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub id: String,
    pub started_at: f64,
    pub ended_at: Option<f64>,
    pub name: Option<String>,
    pub flow_count: u64,
    pub total_size: u64,
}

struct StorageInner {
    connection: Connection,
    body_root: PathBuf,
    active_session_id: Option<String>,
}

#[derive(Clone)]
pub struct SessionStore {
    inner: Arc<Mutex<StorageInner>>,
}

impl SessionStore {
    pub fn initialize(app: &AppHandle) -> Result<Self, String> {
        let data_directory = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Cannot resolve application data directory: {error}"))?;
        Self::initialize_at(&data_directory)
    }

    fn initialize_at(data_directory: &Path) -> Result<Self, String> {
        fs::create_dir_all(data_directory)
            .map_err(|error| format!("Cannot create application data directory: {error}"))?;

        let body_root = data_directory.join("sessions");
        fs::create_dir_all(&body_root)
            .map_err(|error| format!("Cannot create session body directory: {error}"))?;

        let connection = Connection::open(data_directory.join("history.sqlite3"))
            .map_err(|error| format!("Cannot open session database: {error}"))?;
        connection
            .execute_batch(
                "
                PRAGMA foreign_keys = ON;
                PRAGMA journal_mode = WAL;

                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    started_at REAL NOT NULL,
                    ended_at REAL,
                    name TEXT
                );

                CREATE TABLE IF NOT EXISTS flows (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    method TEXT,
                    url TEXT,
                    host TEXT,
                    port INTEGER,
                    scheme TEXT,
                    http_version TEXT,
                    status_code INTEGER,
                    reason TEXT,
                    request_headers_json TEXT,
                    response_headers_json TEXT,
                    request_body_path TEXT,
                    request_body_format TEXT,
                    request_body_content_type TEXT,
                    request_body_size INTEGER,
                    request_body_truncated INTEGER,
                    response_body_path TEXT,
                    response_body_format TEXT,
                    response_body_content_type TEXT,
                    response_body_size INTEGER,
                    response_body_truncated INTEGER,
                    request_started_at REAL,
                    request_ended_at REAL,
                    response_started_at REAL,
                    response_ended_at REAL,
                    duration_ms REAL,
                    error TEXT,
                    state TEXT NOT NULL DEFAULT 'requesting',
                    FOREIGN KEY(session_id) REFERENCES sessions(id)
                );

                CREATE TABLE IF NOT EXISTS websocket_messages (
                    id TEXT PRIMARY KEY,
                    flow_id TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    format TEXT NOT NULL,
                    body_path TEXT,
                    body_text TEXT,
                    size INTEGER NOT NULL,
                    timestamp REAL NOT NULL,
                    FOREIGN KEY(flow_id) REFERENCES flows(id)
                );

                CREATE INDEX IF NOT EXISTS idx_flows_session
                    ON flows(session_id, request_started_at);
                CREATE INDEX IF NOT EXISTS idx_websocket_flow
                    ON websocket_messages(flow_id, timestamp);
                ",
            )
            .map_err(|error| format!("Cannot initialize session database: {error}"))?;
        connection
            .execute(
                "UPDATE sessions SET ended_at=?1 WHERE ended_at IS NULL",
                params![unix_timestamp()],
            )
            .map_err(|error| format!("Cannot close interrupted sessions: {error}"))?;

        Ok(Self {
            inner: Arc::new(Mutex::new(StorageInner {
                connection,
                body_root,
                active_session_id: None,
            })),
        })
    }

    pub fn start_session(&self) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();
        let started_at = unix_timestamp();
        let mut inner = self.lock_inner();
        inner
            .connection
            .execute(
                "INSERT INTO sessions (id, started_at) VALUES (?1, ?2)",
                params![session_id, started_at],
            )
            .map_err(|error| format!("Cannot create capture session: {error}"))?;
        fs::create_dir_all(inner.body_root.join(&session_id).join("bodies"))
            .map_err(|error| format!("Cannot create capture session body directory: {error}"))?;
        inner.active_session_id = Some(session_id.clone());
        Ok(session_id)
    }

    pub fn end_active_session(&self) -> Result<(), String> {
        let mut inner = self.lock_inner();
        let Some(session_id) = inner.active_session_id.take() else {
            return Ok(());
        };
        inner
            .connection
            .execute(
                "UPDATE sessions SET ended_at = ?1 WHERE id = ?2",
                params![unix_timestamp(), session_id],
            )
            .map_err(|error| format!("Cannot close capture session: {error}"))?;
        Ok(())
    }

    pub fn persist_event(&self, event: &BridgeEvent) -> Result<(), String> {
        let inner = self.lock_inner();
        let session_id = inner
            .active_session_id
            .as_deref()
            .ok_or_else(|| "No active capture session.".to_owned())?;

        ensure_flow(&inner.connection, session_id, event.flow_id())?;

        match event {
            BridgeEvent::RequestStarted {
                flow_id,
                method,
                url,
                host,
                port,
                scheme,
                http_version,
                headers,
                started_at,
            } => {
                let headers_json = serde_json::to_string(headers)
                    .map_err(|error| format!("Cannot serialize request headers: {error}"))?;
                inner.connection.execute(
                    "UPDATE flows SET method=?1, url=?2, host=?3, port=?4, scheme=?5,
                     http_version=?6, request_headers_json=?7, request_started_at=?8,
                     state='requesting' WHERE id=?9",
                    params![
                        method,
                        url,
                        host,
                        i64::from(*port),
                        scheme,
                        http_version,
                        headers_json,
                        started_at,
                        flow_id
                    ],
                )
            }
            BridgeEvent::RequestCompleted {
                flow_id,
                body,
                ended_at,
            } => {
                let stored = store_body(&inner.body_root, session_id, flow_id, "request", body)?;
                inner.connection.execute(
                    "UPDATE flows SET request_body_path=?1, request_body_format=?2,
                     request_body_content_type=?3, request_body_size=?4,
                     request_body_truncated=?5, request_ended_at=?6, state='waiting'
                     WHERE id=?7",
                    params![
                        stored.path,
                        stored.format,
                        stored.content_type,
                        stored.size,
                        stored.truncated,
                        ended_at,
                        flow_id
                    ],
                )
            }
            BridgeEvent::ResponseStarted {
                flow_id,
                status_code,
                reason,
                http_version,
                headers,
                started_at,
            } => {
                let headers_json = serde_json::to_string(headers)
                    .map_err(|error| format!("Cannot serialize response headers: {error}"))?;
                inner.connection.execute(
                    "UPDATE flows SET status_code=?1, reason=?2, http_version=?3,
                     response_headers_json=?4, response_started_at=?5, state='waiting'
                     WHERE id=?6",
                    params![
                        i64::from(*status_code),
                        reason,
                        http_version,
                        headers_json,
                        started_at,
                        flow_id
                    ],
                )
            }
            BridgeEvent::ResponseCompleted {
                flow_id,
                status_code,
                body,
                ended_at,
                duration_ms,
            } => {
                let stored = store_body(&inner.body_root, session_id, flow_id, "response", body)?;
                inner.connection.execute(
                    "UPDATE flows SET status_code=?1, response_body_path=?2,
                     response_body_format=?3, response_body_content_type=?4,
                     response_body_size=?5, response_body_truncated=?6,
                     response_ended_at=?7, duration_ms=?8, state='completed'
                     WHERE id=?9",
                    params![
                        i64::from(*status_code),
                        stored.path,
                        stored.format,
                        stored.content_type,
                        stored.size,
                        stored.truncated,
                        ended_at,
                        duration_ms,
                        flow_id
                    ],
                )
            }
            BridgeEvent::FlowError { flow_id, message } => inner.connection.execute(
                "UPDATE flows SET error=?1, state='failed' WHERE id=?2",
                params![message, flow_id],
            ),
            BridgeEvent::WebsocketMessage {
                flow_id,
                direction,
                format,
                data,
                size,
                timestamp,
            } => {
                let (body_path, body_text) = if *format == BodyFormat::Text {
                    (None, Some(data.clone()))
                } else {
                    let message_id = Uuid::new_v4().to_string();
                    let relative_path = PathBuf::from(session_id)
                        .join("bodies")
                        .join(format!("{message_id}-websocket.bin"));
                    let bytes = STANDARD
                        .decode(data)
                        .map_err(|error| format!("Cannot decode WebSocket body: {error}"))?;
                    fs::write(inner.body_root.join(&relative_path), bytes)
                        .map_err(|error| format!("Cannot write WebSocket body: {error}"))?;
                    (Some(path_to_database_string(&relative_path)?), None)
                };
                inner.connection.execute(
                    "INSERT INTO websocket_messages
                     (id, flow_id, direction, format, body_path, body_text, size, timestamp)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        Uuid::new_v4().to_string(),
                        flow_id,
                        direction_to_str(direction),
                        body_format_to_str(format),
                        body_path,
                        body_text,
                        u64_to_i64(*size)?,
                        timestamp
                    ],
                )
            }
        }
        .map_err(|error| format!("Cannot persist capture event: {error}"))?;
        Ok(())
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionSummary>, String> {
        let inner = self.lock_inner();
        let mut statement = inner
            .connection
            .prepare(
                "SELECT s.id, s.started_at, s.ended_at, s.name,
                        COUNT(f.id),
                        COALESCE(SUM(COALESCE(f.request_body_size, 0) +
                                     COALESCE(f.response_body_size, 0)), 0)
                 FROM sessions s
                 LEFT JOIN flows f ON f.session_id = s.id
                 GROUP BY s.id
                 ORDER BY s.started_at DESC",
            )
            .map_err(|error| format!("Cannot query sessions: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok(SessionSummary {
                    id: row.get(0)?,
                    started_at: row.get(1)?,
                    ended_at: row.get(2)?,
                    name: row.get(3)?,
                    flow_count: i64_to_u64(row.get(4)?),
                    total_size: i64_to_u64(row.get(5)?),
                })
            })
            .map_err(|error| format!("Cannot read sessions: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Cannot decode sessions: {error}"))
    }

    pub fn load_session_events(&self, session_id: &str) -> Result<Vec<BridgeEvent>, String> {
        validate_session_id(session_id)?;
        let inner = self.lock_inner();
        let exists = inner
            .connection
            .query_row(
                "SELECT 1 FROM sessions WHERE id=?1",
                params![session_id],
                |_| Ok(()),
            )
            .optional()
            .map_err(|error| format!("Cannot query session: {error}"))?
            .is_some();
        if !exists {
            return Err("The selected session does not exist.".to_owned());
        }

        let mut statement = inner
            .connection
            .prepare(
                "SELECT id, method, url, host, port, scheme, http_version,
                        status_code, reason, request_headers_json,
                        response_headers_json, request_body_path,
                        request_body_format, request_body_content_type,
                        request_body_size, request_body_truncated,
                        response_body_path, response_body_format,
                        response_body_content_type, response_body_size,
                        response_body_truncated, request_started_at,
                        request_ended_at, response_started_at, response_ended_at,
                        duration_ms, error
                 FROM flows WHERE session_id=?1
                 ORDER BY COALESCE(request_started_at, 0), rowid",
            )
            .map_err(|error| format!("Cannot prepare session flows: {error}"))?;
        let records = statement
            .query_map(params![session_id], FlowRecord::from_row)
            .map_err(|error| format!("Cannot query session flows: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Cannot decode session flows: {error}"))?;

        let mut events = Vec::new();
        for record in records {
            events.extend(record.to_events(&inner.body_root)?);
            events.extend(load_websocket_events(
                &inner.connection,
                &inner.body_root,
                &record.id,
            )?);
        }
        Ok(events)
    }

    pub fn rename_session(&self, session_id: &str, name: &str) -> Result<(), String> {
        validate_session_id(session_id)?;
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 100 {
            return Err("Session name must contain 1 to 100 characters.".to_owned());
        }
        let inner = self.lock_inner();
        let updated = inner
            .connection
            .execute(
                "UPDATE sessions SET name=?1 WHERE id=?2",
                params![name, session_id],
            )
            .map_err(|error| format!("Cannot rename session: {error}"))?;
        if updated == 0 {
            return Err("The selected session does not exist.".to_owned());
        }
        Ok(())
    }

    pub fn delete_session(&self, session_id: &str) -> Result<(), String> {
        validate_session_id(session_id)?;
        let mut inner = self.lock_inner();
        if inner.active_session_id.as_deref() == Some(session_id) {
            return Err("Stop capture before deleting the active session.".to_owned());
        }

        let transaction = inner
            .connection
            .transaction()
            .map_err(|error| format!("Cannot start session deletion: {error}"))?;
        transaction
            .execute(
                "DELETE FROM websocket_messages
                 WHERE flow_id IN (SELECT id FROM flows WHERE session_id=?1)",
                params![session_id],
            )
            .and_then(|_| {
                transaction.execute("DELETE FROM flows WHERE session_id=?1", params![session_id])
            })
            .and_then(|_| {
                transaction.execute("DELETE FROM sessions WHERE id=?1", params![session_id])
            })
            .map_err(|error| format!("Cannot delete session records: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Cannot commit session deletion: {error}"))?;

        let session_directory = inner.body_root.join(session_id);
        if session_directory.is_dir() {
            fs::remove_dir_all(&session_directory)
                .map_err(|error| format!("Cannot delete session body files: {error}"))?;
        }
        Ok(())
    }

    fn lock_inner(&self) -> MutexGuard<'_, StorageInner> {
        self.inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

struct StoredBody {
    path: Option<String>,
    format: Option<String>,
    content_type: Option<String>,
    size: Option<i64>,
    truncated: Option<i64>,
}

fn store_body(
    body_root: &Path,
    session_id: &str,
    flow_id: &str,
    direction: &str,
    body: &Option<CapturedBody>,
) -> Result<StoredBody, String> {
    let Some(body) = body else {
        return Ok(StoredBody {
            path: None,
            format: None,
            content_type: None,
            size: None,
            truncated: None,
        });
    };
    let safe_flow_id = safe_file_component(flow_id);
    let relative_path = PathBuf::from(session_id)
        .join("bodies")
        .join(format!("{safe_flow_id}-{direction}.bin"));
    let bytes = match &body.format {
        BodyFormat::Text => body.data.as_bytes().to_vec(),
        BodyFormat::Base64 => STANDARD
            .decode(&body.data)
            .map_err(|error| format!("Cannot decode captured body: {error}"))?,
    };
    fs::write(body_root.join(&relative_path), bytes)
        .map_err(|error| format!("Cannot write captured body: {error}"))?;
    Ok(StoredBody {
        path: Some(path_to_database_string(&relative_path)?),
        format: Some(body_format_to_str(&body.format).to_owned()),
        content_type: body.content_type.clone(),
        size: Some(u64_to_i64(body.size)?),
        truncated: Some(if body.truncated { 1 } else { 0 }),
    })
}

fn ensure_flow(connection: &Connection, session_id: &str, flow_id: &str) -> Result<(), String> {
    connection
        .execute(
            "INSERT OR IGNORE INTO flows (id, session_id) VALUES (?1, ?2)",
            params![flow_id, session_id],
        )
        .map_err(|error| format!("Cannot initialize captured flow: {error}"))?;
    Ok(())
}

struct FlowRecord {
    id: String,
    method: Option<String>,
    url: Option<String>,
    host: Option<String>,
    port: Option<i64>,
    scheme: Option<String>,
    http_version: Option<String>,
    status_code: Option<i64>,
    reason: Option<String>,
    request_headers: Option<String>,
    response_headers: Option<String>,
    request_body: BodyRecord,
    response_body: BodyRecord,
    request_started_at: Option<f64>,
    request_ended_at: Option<f64>,
    response_started_at: Option<f64>,
    response_ended_at: Option<f64>,
    duration_ms: Option<f64>,
    error: Option<String>,
}

struct BodyRecord {
    path: Option<String>,
    format: Option<String>,
    content_type: Option<String>,
    size: Option<i64>,
    truncated: Option<i64>,
}

impl FlowRecord {
    fn from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            id: row.get(0)?,
            method: row.get(1)?,
            url: row.get(2)?,
            host: row.get(3)?,
            port: row.get(4)?,
            scheme: row.get(5)?,
            http_version: row.get(6)?,
            status_code: row.get(7)?,
            reason: row.get(8)?,
            request_headers: row.get(9)?,
            response_headers: row.get(10)?,
            request_body: BodyRecord {
                path: row.get(11)?,
                format: row.get(12)?,
                content_type: row.get(13)?,
                size: row.get(14)?,
                truncated: row.get(15)?,
            },
            response_body: BodyRecord {
                path: row.get(16)?,
                format: row.get(17)?,
                content_type: row.get(18)?,
                size: row.get(19)?,
                truncated: row.get(20)?,
            },
            request_started_at: row.get(21)?,
            request_ended_at: row.get(22)?,
            response_started_at: row.get(23)?,
            response_ended_at: row.get(24)?,
            duration_ms: row.get(25)?,
            error: row.get(26)?,
        })
    }

    fn to_events(&self, body_root: &Path) -> Result<Vec<BridgeEvent>, String> {
        let mut events = Vec::new();
        if let Some(started_at) = self.request_started_at {
            events.push(BridgeEvent::RequestStarted {
                flow_id: self.id.clone(),
                method: self.method.clone().unwrap_or_default(),
                url: self.url.clone().unwrap_or_default(),
                host: self.host.clone().unwrap_or_default(),
                port: u16::try_from(self.port.unwrap_or_default()).unwrap_or_default(),
                scheme: self.scheme.clone().unwrap_or_default(),
                http_version: self.http_version.clone().unwrap_or_default(),
                headers: parse_headers(self.request_headers.as_deref())?,
                started_at,
            });
        }
        if self.request_ended_at.is_some() || self.request_body.path.is_some() {
            events.push(BridgeEvent::RequestCompleted {
                flow_id: self.id.clone(),
                body: load_body(body_root, &self.request_body)?,
                ended_at: self.request_ended_at,
            });
        }
        if let (Some(status_code), Some(started_at)) = (self.status_code, self.response_started_at)
        {
            events.push(BridgeEvent::ResponseStarted {
                flow_id: self.id.clone(),
                status_code: u16::try_from(status_code).unwrap_or_default(),
                reason: self.reason.clone().unwrap_or_default(),
                http_version: self.http_version.clone().unwrap_or_default(),
                headers: parse_headers(self.response_headers.as_deref())?,
                started_at,
            });
        }
        if self.response_ended_at.is_some() || self.response_body.path.is_some() {
            events.push(BridgeEvent::ResponseCompleted {
                flow_id: self.id.clone(),
                status_code: u16::try_from(self.status_code.unwrap_or_default())
                    .unwrap_or_default(),
                body: load_body(body_root, &self.response_body)?,
                ended_at: self.response_ended_at,
                duration_ms: self.duration_ms,
            });
        }
        if let Some(error) = &self.error {
            events.push(BridgeEvent::FlowError {
                flow_id: self.id.clone(),
                message: error.clone(),
            });
        }
        Ok(events)
    }
}

fn load_body(body_root: &Path, body: &BodyRecord) -> Result<Option<CapturedBody>, String> {
    let (Some(relative_path), Some(format), Some(size)) = (&body.path, &body.format, body.size)
    else {
        return Ok(None);
    };
    let bytes = read_relative_body(body_root, relative_path)?;
    let format = parse_body_format(format)?;
    let data = match format {
        BodyFormat::Text => String::from_utf8_lossy(&bytes).into_owned(),
        BodyFormat::Base64 => STANDARD.encode(bytes),
    };
    Ok(Some(CapturedBody {
        format,
        content_type: body.content_type.clone(),
        data,
        size: i64_to_u64(size),
        truncated: body.truncated.unwrap_or_default() != 0,
    }))
}

fn load_websocket_events(
    connection: &Connection,
    body_root: &Path,
    flow_id: &str,
) -> Result<Vec<BridgeEvent>, String> {
    let mut statement = connection
        .prepare(
            "SELECT direction, format, body_path, body_text, size, timestamp
             FROM websocket_messages WHERE flow_id=?1 ORDER BY timestamp, rowid",
        )
        .map_err(|error| format!("Cannot prepare WebSocket messages: {error}"))?;
    let records = statement
        .query_map(params![flow_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, f64>(5)?,
            ))
        })
        .map_err(|error| format!("Cannot query WebSocket messages: {error}"))?;

    let mut events = Vec::new();
    for record in records {
        let (direction, format, path, text, size, timestamp) =
            record.map_err(|error| format!("Cannot decode WebSocket message: {error}"))?;
        let format = parse_body_format(&format)?;
        let data = match (format.clone(), path, text) {
            (BodyFormat::Text, _, Some(text)) => text,
            (BodyFormat::Base64, Some(path), _) => {
                STANDARD.encode(read_relative_body(body_root, &path)?)
            }
            _ => String::new(),
        };
        events.push(BridgeEvent::WebsocketMessage {
            flow_id: flow_id.to_owned(),
            direction: parse_direction(&direction)?,
            format,
            data,
            size: i64_to_u64(size),
            timestamp,
        });
    }
    Ok(events)
}

fn read_relative_body(body_root: &Path, relative_path: &str) -> Result<Vec<u8>, String> {
    let relative = PathBuf::from(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err("Unsafe body file path in session database.".to_owned());
    }
    fs::read(body_root.join(relative))
        .map_err(|error| format!("Cannot read captured body file: {error}"))
}

fn parse_headers(value: Option<&str>) -> Result<Vec<HeaderEntry>, String> {
    match value {
        Some(value) => serde_json::from_str(value)
            .map_err(|error| format!("Cannot decode stored headers: {error}")),
        None => Ok(Vec::new()),
    }
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    Uuid::parse_str(session_id)
        .map(|_| ())
        .map_err(|_| "Invalid session identifier.".to_owned())
}

fn safe_file_component(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn path_to_database_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "Body file path is not valid Unicode.".to_owned())
}

fn body_format_to_str(format: &BodyFormat) -> &'static str {
    match format {
        BodyFormat::Text => "text",
        BodyFormat::Base64 => "base64",
    }
}

fn parse_body_format(value: &str) -> Result<BodyFormat, String> {
    match value {
        "text" => Ok(BodyFormat::Text),
        "base64" => Ok(BodyFormat::Base64),
        _ => Err(format!("Unsupported stored body format: {value}")),
    }
}

fn direction_to_str(direction: &WebSocketDirection) -> &'static str {
    match direction {
        WebSocketDirection::ClientToServer => "client_to_server",
        WebSocketDirection::ServerToClient => "server_to_client",
    }
}

fn parse_direction(value: &str) -> Result<WebSocketDirection, String> {
    match value {
        "client_to_server" => Ok(WebSocketDirection::ClientToServer),
        "server_to_client" => Ok(WebSocketDirection::ServerToClient),
        _ => Err(format!("Unsupported WebSocket direction: {value}")),
    }
}

fn unix_timestamp() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0.0, |duration| duration.as_secs_f64())
}

fn u64_to_i64(value: u64) -> Result<i64, String> {
    i64::try_from(value).map_err(|_| "Captured size exceeds SQLite integer range.".to_owned())
}

fn i64_to_u64(value: i64) -> u64 {
    u64::try_from(value).unwrap_or_default()
}

#[tauri::command]
pub fn list_sessions(store: tauri::State<'_, SessionStore>) -> Result<Vec<SessionSummary>, String> {
    store.list_sessions()
}

#[tauri::command]
pub fn load_session_events(
    store: tauri::State<'_, SessionStore>,
    session_id: String,
) -> Result<Vec<BridgeEvent>, String> {
    store.load_session_events(&session_id)
}

#[tauri::command]
pub fn rename_session(
    store: tauri::State<'_, SessionStore>,
    session_id: String,
    name: String,
) -> Result<(), String> {
    store.rename_session(&session_id, &name)
}

#[tauri::command]
pub fn delete_session(
    store: tauri::State<'_, SessionStore>,
    session_id: String,
) -> Result<(), String> {
    store.delete_session(&session_id)
}

#[cfg(test)]
mod tests {
    use super::{SessionStore, parse_body_format, safe_file_component, validate_session_id};
    use crate::event_parser::{BodyFormat, BridgeEvent, CapturedBody};
    use tempfile::tempdir;
    use uuid::Uuid;

    #[test]
    fn sanitizes_untrusted_flow_ids_for_file_names() {
        assert_eq!(safe_file_component("../flow/one"), "___flow_one");
    }

    #[test]
    fn validates_session_ids_and_body_formats() {
        assert!(validate_session_id(&Uuid::new_v4().to_string()).is_ok());
        assert!(validate_session_id("../session").is_err());
        assert_eq!(
            parse_body_format("base64").expect("format should parse"),
            BodyFormat::Base64
        );
        assert!(parse_body_format("other").is_err());
    }

    #[test]
    fn persists_and_reloads_a_session_with_body_files() {
        let directory = tempdir().expect("temporary directory should be created");
        let store = SessionStore::initialize_at(directory.path()).expect("store should initialize");
        let session_id = store.start_session().expect("session should start");
        let flow_id = "flow-storage-test";

        store
            .persist_event(&BridgeEvent::RequestStarted {
                flow_id: flow_id.to_owned(),
                method: "POST".to_owned(),
                url: "https://api.example.com/login".to_owned(),
                host: "api.example.com".to_owned(),
                port: 443,
                scheme: "https".to_owned(),
                http_version: "HTTP/2.0".to_owned(),
                headers: vec![["authorization".to_owned(), "••••••••".to_owned()]],
                started_at: 100.0,
            })
            .expect("request should persist");
        store
            .persist_event(&BridgeEvent::RequestCompleted {
                flow_id: flow_id.to_owned(),
                body: Some(CapturedBody {
                    format: BodyFormat::Text,
                    content_type: Some("application/json".to_owned()),
                    data: r#"{"password":"••••••••"}"#.to_owned(),
                    size: 21,
                    truncated: false,
                }),
                ended_at: Some(100.1),
            })
            .expect("request body should persist");
        store.end_active_session().expect("session should end");

        let sessions = store.list_sessions().expect("sessions should list");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].flow_count, 1);
        assert_eq!(sessions[0].total_size, 21);

        let events = store
            .load_session_events(&session_id)
            .expect("session should load");
        assert_eq!(events.len(), 2);
        assert!(matches!(
            &events[1],
            BridgeEvent::RequestCompleted {
                body: Some(body),
                ..
            } if body.data.contains("••••••••")
        ));

        store
            .rename_session(&session_id, "Login flow")
            .expect("session should rename");
        assert_eq!(
            store.list_sessions().expect("sessions should list")[0].name,
            Some("Login flow".to_owned())
        );

        store
            .delete_session(&session_id)
            .expect("session should delete");
        assert!(
            store
                .list_sessions()
                .expect("sessions should list")
                .is_empty()
        );
    }
}
