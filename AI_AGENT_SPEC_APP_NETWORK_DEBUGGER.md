# App Network Debugger — recovered requirements summary

> Recovery notice: the original 39-section specification was unintentionally
> removed by the initial Tauri scaffolding command. This file preserves the
> requirements used for implementation, but it is not claimed to be a
> byte-for-byte copy of the original. Restore the original source copy here when
> available.

## Product goal

Build a standalone desktop application with a workflow similar to Chrome
DevTools Network. The user starts a local mitmdump proxy, points an authorized
desktop app or mobile device at that proxy, and inspects request and response
data in real time without integrating a debugging SDK into the target app.

## Selected stack and data flow

- Tauri 2, React, strict TypeScript, Rust, Python, mitmdump, and SQLite.
- `bridge.py` receives mitmproxy addon events.
- It emits one `APPDBG_EVENT:`-prefixed JSON object per stdout line.
- Rust parses valid bridge lines safely, logs parse failures without payloads,
  and emits typed IPC events to React.
- SQLite stores sessions and flow metadata; the filesystem stores larger body
  data.

## MVP scope

- Windows and macOS; Linux where support does not add disproportionate
  complexity.
- HTTP/1.1, HTTP/2 where supported, HTTPS when the target trusts the CA, and
  basic WebSocket messages.
- JSON, text, form URL encoded data, multipart metadata, and binary body
  metadata/base64.
- Live request list, request details, query, headers, payload, response,
  timing, errors, search, filters, clear, sessions, JSON export, and HAR if
  feasible.
- Default 1 MB body limit with clear truncation metadata.

## Explicit exclusions and limits

- No certificate-pinning bypass, rooting, jailbreaking, binary modification,
  decompilation, source hooks, advanced replay/mock features, cloud sync, or
  QUIC/HTTP3 requirement.
- Only traffic actually routed through the proxy can be captured.
- Apps may ignore system proxies or reject user-installed CAs.

## Security requirements

- First-run authorization and sensitive-data warning before capture.
- Default redaction for authorization, proxy authorization, cookies, API keys,
  authentication tokens, passwords, passcodes, secrets, and related JSON keys.
- No payloads, credentials, cookies, tokens, or CA private keys in application
  logs.
- No uploading captured traffic or sensitive telemetry.
- Dedicated application-data mitmproxy confdir; never commit runtime CA keys,
  sessions, databases, or logs.
- Resetting the CA requires confirmation and stopped capture.

## Runtime and UI requirements

- Start, stop, restart, status, proxy configuration, runtime-folder, and
  certificate-folder backend commands.
- Prevent duplicate mitmdump processes, track PID, stop on app exit, detect
  crashes, validate the port, and avoid visible production terminals.
- Proxy settings include bind host, port, body limit, history, redaction, and
  automatic clearing.
- Warn when binding `0.0.0.0`.
- Show LAN IP, proxy port, certificate guidance, Wi-Fi proxy steps, and pinning
  limitations.
- Request rows appear at `request_started`, not after the response completes.
- Details include overview, duplicate/raw headers, query, payload, response,
  timing, WebSocket messages, copying, previews where safe, and body saving.

## Storage and export

- Every capture creates a session with start/end time, name, flow count, and
  total size.
- Open, rename, and delete sessions; clear history; enforce a default 1 GB
  storage limit.
- JSON export is required. HAR 1.2 is optional for MVP.
- Export modes: metadata only, redacted bodies, and full session with a
  sensitive-data warning.

## Testing and acceptance

- Frontend unit tests cover flow upsert, search/filter, formatting, JSON view,
  redaction, bytes, and duration.
- Backend tests cover prefix/NDJSON parsing, process lifecycle, port checks,
  settings, database, safe paths, and JSON export.
- Integration tests use local HTTP and WebSocket endpoints for JSON, echo,
  errors, large/binary bodies, delay, headers, and socket messages through real
  mitmdump.
- Each phase must pass build, typecheck, lint, and tests before the next phase.
- Do not claim completion without real build and test results.

## Delivery phases

1. Proxy bridge prototype: real `bridge.py`, stdout parser, sample output.
2. Tauri desktop shell: process manager, Start/Stop, IPC, basic request table.
3. Request details: headers, query, payload, response, timing, copy.
4. Storage: SQLite, body files, session management.
5. Security: redaction, sanitized logs, quotas, deletion, CA management.
6. Export and packaging: JSON, optional HAR, bundled mitmdump, installers.

## Final deliverables

Source code, bridge addon, Tauri desktop application, process manager, React
UI, SQLite schema, JSON export, tests, build scripts, development and packaging
instructions, troubleshooting, security notes, and known limitations.
