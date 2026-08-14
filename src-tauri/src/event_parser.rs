use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::error::Error;
use std::fmt::{Display, Formatter};

pub const EVENT_PREFIX: &str = "APPDBG_EVENT:";

pub type HeaderEntry = [String; 2];
pub type AnalysisObject = Map<String, Value>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowAnalysisEvent {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp_micros: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    pub parameters: AnalysisObject,
    pub items: Vec<AnalysisObject>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowAnalysisBundle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measurement_id: Option<String>,
    pub user_properties: AnalysisObject,
    pub consent: AnalysisObject,
    pub events: Vec<FlowAnalysisEvent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlowAnalysis {
    pub provider_id: String,
    pub provider_label: String,
    pub service_id: String,
    pub service_label: String,
    pub protocol: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub platform: Option<String>,
    pub confidence: f64,
    pub status: String,
    pub parser_version: String,
    pub tags: Vec<String>,
    pub bundles: Vec<FlowAnalysisBundle>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BodyFormat {
    Text,
    Base64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedBody {
    pub format: BodyFormat,
    #[serde(default)]
    pub content_type: Option<String>,
    pub data: String,
    pub size: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebSocketDirection {
    ClientToServer,
    ServerToClient,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum BridgeEvent {
    #[serde(rename_all = "camelCase")]
    RequestStarted {
        flow_id: String,
        method: String,
        url: String,
        host: String,
        port: u16,
        scheme: String,
        http_version: String,
        headers: Vec<HeaderEntry>,
        started_at: f64,
    },
    #[serde(rename_all = "camelCase")]
    RequestCompleted {
        flow_id: String,
        body: Option<CapturedBody>,
        ended_at: Option<f64>,
        #[serde(default)]
        analysis: Option<FlowAnalysis>,
    },
    #[serde(rename_all = "camelCase")]
    ResponseStarted {
        flow_id: String,
        status_code: u16,
        reason: String,
        http_version: String,
        headers: Vec<HeaderEntry>,
        started_at: f64,
    },
    #[serde(rename_all = "camelCase")]
    ResponseCompleted {
        flow_id: String,
        status_code: u16,
        body: Option<CapturedBody>,
        ended_at: Option<f64>,
        duration_ms: Option<f64>,
    },
    #[serde(rename_all = "camelCase")]
    FlowError { flow_id: String, message: String },
    #[serde(rename_all = "camelCase")]
    WebsocketMessage {
        flow_id: String,
        direction: WebSocketDirection,
        format: BodyFormat,
        data: String,
        size: u64,
        timestamp: f64,
    },
}

impl BridgeEvent {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::RequestStarted { .. } => "request_started",
            Self::RequestCompleted { .. } => "request_completed",
            Self::ResponseStarted { .. } => "response_started",
            Self::ResponseCompleted { .. } => "response_completed",
            Self::FlowError { .. } => "flow_error",
            Self::WebsocketMessage { .. } => "websocket_message",
        }
    }

    pub fn flow_id(&self) -> &str {
        match self {
            Self::RequestStarted { flow_id, .. }
            | Self::RequestCompleted { flow_id, .. }
            | Self::ResponseStarted { flow_id, .. }
            | Self::ResponseCompleted { flow_id, .. }
            | Self::FlowError { flow_id, .. }
            | Self::WebsocketMessage { flow_id, .. } => flow_id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventParseError {
    details: String,
}

impl EventParseError {
    fn new(details: impl Into<String>) -> Self {
        Self {
            details: details.into(),
        }
    }
}

impl Display for EventParseError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "invalid mitmproxy bridge event: {}",
            self.details
        )
    }
}

impl Error for EventParseError {}

/// Parses one stdout line from mitmdump.
///
/// Non-bridge output is intentionally ignored so normal mitmdump diagnostics
/// cannot be mistaken for captured traffic.
pub fn parse_event_line(line: &str) -> Result<Option<BridgeEvent>, EventParseError> {
    let Some(payload) = line.strip_prefix(EVENT_PREFIX) else {
        return Ok(None);
    };

    let payload = payload.trim();
    if payload.is_empty() {
        return Err(EventParseError::new("event payload is empty"));
    }

    serde_json::from_str(payload)
        .map(Some)
        .map_err(|error| EventParseError::new(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::{BodyFormat, BridgeEvent, EVENT_PREFIX, parse_event_line};

    #[test]
    fn ignores_lines_without_the_bridge_prefix() {
        let parsed =
            parse_event_line("mitmdump diagnostic output").expect("line should be ignored");
        assert!(parsed.is_none());
    }

    #[test]
    fn preserves_duplicate_headers() {
        let line = concat!(
            "APPDBG_EVENT:",
            r#"{"event":"request_started","flowId":"flow-1","method":"GET","#,
            r#""url":"https://api.example.com/items","host":"api.example.com","#,
            r#""port":443,"scheme":"https","httpVersion":"HTTP/2.0","#,
            r#""headers":[["x-test","one"],["x-test","two"]],"startedAt":1.25}"#
        );

        let event = parse_event_line(line)
            .expect("event should parse")
            .expect("event should not be ignored");

        match event {
            BridgeEvent::RequestStarted { headers, .. } => {
                assert_eq!(headers.len(), 2);
                assert_eq!(headers[0], ["x-test", "one"]);
                assert_eq!(headers[1], ["x-test", "two"]);
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn parses_nullable_body_and_timestamps() {
        let line = concat!(
            "APPDBG_EVENT:",
            r#"{"event":"response_completed","flowId":"flow-2","statusCode":204,"#,
            r#""body":null,"endedAt":null,"durationMs":null}"#
        );

        let event = parse_event_line(line)
            .expect("event should parse")
            .expect("event should not be ignored");

        assert!(matches!(
            event,
            BridgeEvent::ResponseCompleted {
                body: None,
                ended_at: None,
                duration_ms: None,
                ..
            }
        ));
    }

    #[test]
    fn parses_binary_body_metadata() {
        let line = concat!(
            "APPDBG_EVENT:",
            r#"{"event":"request_completed","flowId":"flow-3","body":{"format":"base64","#,
            r#""contentType":"application/octet-stream","data":"AAEC","size":3,"#,
            r#""truncated":false},"endedAt":2.0}"#
        );

        let event = parse_event_line(line)
            .expect("event should parse")
            .expect("event should not be ignored");

        match event {
            BridgeEvent::RequestCompleted {
                body: Some(body), ..
            } => {
                assert_eq!(body.format, BodyFormat::Base64);
                assert_eq!(body.size, 3);
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn parses_old_request_completed_event_without_analysis() {
        let event = parse_event_line(concat!(
            "APPDBG_EVENT:",
            r#"{"event":"request_completed","flowId":"legacy-flow","body":null,"endedAt":2.0}"#
        ))
        .expect("legacy event should parse")
        .expect("legacy event should not be ignored");

        assert!(matches!(
            event,
            BridgeEvent::RequestCompleted { analysis: None, .. }
        ));
    }

    #[test]
    fn parses_typed_analytics_analysis() {
        let event = parse_event_line(concat!(
            "APPDBG_EVENT:",
            r#"{"event":"request_completed","flowId":"analytics-flow","body":null,"endedAt":2.0,"analysis":{"providerId":"firebase","providerLabel":"Firebase","serviceId":"firebase-analytics","serviceLabel":"Firebase Analytics","protocol":"protobuf","platform":"ios","confidence":0.99,"status":"decoded","parserVersion":"1","tags":["analytics","firebase"],"bundles":[{"appId":"com.example.app","appName":"Example","appVersion":"1.2.3","platform":"ios","measurementId":"G-TEST","userProperties":{"plan":"pro"},"consent":{"analyticsStorage":"granted"},"events":[{"name":"view_item","timestampMicros":1234567,"origin":"app","parameters":{"currency":"VND","value":34990000},"items":[{"itemId":"59258","itemName":"iPhone"}]}]}],"warnings":[]}}"#
        ))
        .expect("analytics event should parse")
        .expect("analytics event should not be ignored");

        match event {
            BridgeEvent::RequestCompleted {
                analysis: Some(analysis),
                ..
            } => {
                assert_eq!(analysis.service_id, "firebase-analytics");
                assert_eq!(
                    analysis.bundles[0].app_id.as_deref(),
                    Some("com.example.app")
                );
                assert_eq!(analysis.bundles[0].events[0].name, "view_item");
                assert_eq!(analysis.bundles[0].events[0].parameters["currency"], "VND");
                assert_eq!(analysis.bundles[0].events[0].items[0]["itemId"], "59258");
            }
            other => panic!("unexpected event: {other:?}"),
        }
    }

    #[test]
    fn rejects_malformed_json_without_panicking() {
        let error = parse_event_line(&format!("{EVENT_PREFIX}{{not-json"))
            .expect_err("malformed JSON must return an error");
        assert!(error.to_string().contains("invalid mitmproxy bridge event"));
    }

    #[test]
    fn rejects_unknown_event_types() {
        let error = parse_event_line(concat!(
            "APPDBG_EVENT:",
            r#"{"event":"not_a_real_event","flowId":"flow-4"}"#
        ))
        .expect_err("unknown event must return an error");
        assert!(error.to_string().contains("unknown variant"));
    }

    #[test]
    fn parses_every_sample_fixture_event() {
        let fixture = include_str!("../../tests/fixtures/sample-events.ndjson");
        let events = fixture
            .lines()
            .filter_map(|line| parse_event_line(line).transpose())
            .collect::<Result<Vec<_>, _>>()
            .expect("fixture should contain valid events");

        assert_eq!(events.len(), 7);
        assert_eq!(events[0].kind(), "request_started");
        assert_eq!(events[0].flow_id(), "sample-flow");
        assert_eq!(events[6].kind(), "websocket_message");
    }
}
