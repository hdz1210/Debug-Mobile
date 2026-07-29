# App Network Debugger

App Network Debugger is a desktop HTTP, HTTPS, and WebSocket inspection tool
powered by mitmproxy. Its target experience is similar to the Network panel in
Chrome DevTools, but traffic comes from an explicitly configured desktop app or
mobile device.

> Only inspect applications, devices, and network traffic that you own or are
> explicitly authorized to test. Captured traffic may contain passwords,
> tokens, cookies, and personal data.

## Architecture

```text
Target app or mobile device
  -> explicit HTTP proxy
  -> mitmdump
  -> src-tauri/addons/bridge.py
  -> APPDBG_EVENT-prefixed NDJSON on stdout
  -> Rust event parser and process manager
  -> Tauri IPC
  -> React network inspector
```

The selected stack is Tauri 2, React, strict TypeScript, Rust, Python,
mitmdump, and SQLite. Metadata will be stored in SQLite; larger bodies will be
stored as files under the application data directory.

## Current status

Phases 1 through 4 are implemented:

- Tauri and React project skeleton
- mitmproxy addon with real HTTP and WebSocket hooks
- bounded text and binary body serialization
- duplicate-header preservation
- prefixed NDJSON parser in Rust
- parser fixture and unit tests
- background mitmdump process lifecycle with Start, Stop, Restart, status, PID,
  port validation, crash detection, and app-exit cleanup
- typed Tauri IPC events and a Zustand flow store
- live request table, basic overview, URL search, Local/LAN bind modes, automatic
  LAN IPv4 detection with copy/refresh controls, and the first-capture
  authorization warning
- Overview, Headers, Query, Payload, Response, Timing, and WebSocket detail
  views with JSON/form formatting, image preview, copy, and body save
- default bridge-level redaction for credential headers and sensitive
  JSON/form fields before stdout or IPC
- SQLite session metadata, filesystem body storage, and History actions to
  reopen, rename, and delete saved sessions

Storage quotas, settings UI, JSON/HAR export, complete CA management, mobile
onboarding, and packaged sidecars remain later-phase work. The application
never inserts simulated traffic.

## Prerequisites

- Node.js 22 or later
- pnpm 10 or later
- Rust 1.91 or later
- Python 3.11 or later
- Windows WebView2 for Windows desktop builds

Development is pinned to mitmproxy `12.2.3`. Production will use verified,
version-locked standalone binaries rather than downloading executables at
runtime.

## Development setup

PowerShell:

```powershell
pnpm install
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

## How to run

Start the Tauri development app:

```powershell
pnpm tauri dev
```

Run mitmdump manually during Phase 1:

```powershell
.\.venv\Scripts\mitmdump.exe `
  --listen-host 127.0.0.1 `
  --listen-port 8080 `
  --set confdir=runtime/mitmproxy `
  --set appdbg_body_limit=1000000 `
  --set termlog_verbosity=error `
  -s src-tauri/addons/bridge.py
```

For a phone on the same trusted LAN, use `--listen-host 0.0.0.0` and allow the
chosen port through the local firewall. Binding all interfaces exposes the
proxy to the LAN and must be treated as a security-sensitive setting.

## How to build

```powershell
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

Installer builds will be introduced with the versioned sidecar packaging work:

```powershell
pnpm tauri build
```

## How the mitmproxy sidecar works

`bridge.py` subscribes to:

- `requestheaders`
- `request`
- `responseheaders`
- `response`
- `error`
- `websocket_message`

Each emitted line starts with `APPDBG_EVENT:`. The Rust backend ignores all
other stdout lines, validates the JSON event shape, and returns parse errors
without crashing the application.

Bodies default to a 1 MB decoded-content limit. Recognized textual media types
are emitted as text. Other bodies are base64 encoded. Duplicate headers remain
ordered header pairs.

You can exercise the sample parser directly:

```powershell
Get-Content tests/fixtures/sample-events.ndjson |
  cargo run --manifest-path src-tauri/Cargo.toml --example parse_bridge_output
```

## Configure an Android or iOS device

1. Connect the phone and computer to the same trusted Wi-Fi.
2. Start the proxy bound to `0.0.0.0`.
3. In `LAN devices` mode, copy the automatically detected **Host / IP** from
   the connection banner and configure the phone's Wi-Fi proxy manually with
   that address and the displayed port.
4. Open `http://mitm.it` on the phone while the proxy is active.
5. Install the certificate for the phone's operating system.
6. Mark the CA as trusted where the operating system requires a separate trust
   step.

Some Android apps ignore the system Wi-Fi proxy, and newer Android apps may not
trust user-installed CAs unless their debug network security configuration
allows it.

## Certificate pinning limitation

The project does not bypass certificate pinning. A pinned app or an app that
does not trust user-installed CAs will fail its TLS handshake. Use an authorized
debug build configured to trust the development CA.

The mitmproxy CA and private key must remain inside the application's private
data directory. Never commit or share the CA private key.

## Project structure

```text
src/                         React frontend
src-tauri/src/               Rust desktop backend
src-tauri/src/event_parser.rs
src-tauri/addons/bridge.py   mitmproxy addon
src-tauri/examples/          Phase 1 stdout parser example
tests/python/                bridge unit tests
tests/fixtures/              NDJSON samples
runtime/                     ignored local runtime data
```

## Testing

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm test:smoke
pnpm test:ui-smoke
```

Integration tests will add a local HTTP/WebSocket test server and send real
requests through mitmdump.

## Packaging

Production packages will bundle one verified mitmdump executable per supported
Tauri target triple:

- `x86_64-pc-windows-msvc`
- `x86_64-apple-darwin`
- `aarch64-apple-darwin`
- `x86_64-unknown-linux-gnu`, if Linux support remains practical

Checksums, mitmproxy version, third-party notices, and platform build
instructions will be committed with the packaging phase. Runtime downloads of
unverified executables are not allowed.

## Troubleshooting

- **Port already in use:** stop the process using `8080` or choose another
  port.
- **No requests appear:** confirm the client proxy IP and port, firewall rules,
  Wi-Fi client isolation, and whether the target app ignores system proxies.
- **HTTPS requests fail:** install and trust the CA from `http://mitm.it`.
- **Certificate pinning:** use an authorized debug build; this project will not
  bypass pinning.
- **Phone cannot connect:** bind `0.0.0.0`, verify both devices share a LAN, and
  allow the port through the firewall.
- **mitmdump binary missing:** install `requirements-dev.txt` in `.venv`; the
  bundled binary is added during packaging.
- **CA reset or expired:** remove the old certificate from the device, restart
  mitmdump with the app confdir, and install the newly generated CA.

## Security and privacy

Captured traffic stays local. Application logs must never contain payloads,
authorization headers, cookies, tokens, passwords, or CA private keys.
Sensitive-value redaction and per-session deletion are implemented. Storage
quotas, full-data export warnings, and user-controlled redaction settings remain
mandatory before the MVP is considered complete.

## License

This project is licensed under the [MIT License](LICENSE). Binary distributions
must also include notices required by Tauri, React, mitmproxy, Python, Rust
crates, JavaScript packages, and all bundled dependencies.

## Known limitations

- Only traffic routed through the configured proxy can be captured.
- Certificate pinning is not bypassed.
- QUIC/HTTP/3 capture is outside the MVP.
- Custom encrypted protocols are not decoded.
- The development build resolves mitmdump from `.venv`; production sidecar
  bundling is not complete yet.
