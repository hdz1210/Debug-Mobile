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
- standalone Windows packaging with a verified mitmproxy 12.2.3 `mitmdump.exe`,
  the capture addon, and required license notices bundled in the installer

Storage quotas, settings UI, JSON/HAR export, complete CA management, mobile
onboarding, and signed multi-platform packages remain later-phase work. The
application never inserts simulated traffic.

## Download for Windows

Download the installer from the
[v0.1.0 release](https://github.com/hdz1210/Debug-Mobile/releases/tag/v0.1.0):

- `App-Network-Debugger_0.1.0_windows-x64-setup.exe` is the recommended
  installer.
- `App-Network-Debugger_0.1.0_windows-x64.msi` is provided for managed Windows
  environments.
- `SHA256SUMS.txt` contains the checksums for both installers.

This preview is not code-signed. Windows SmartScreen may show an
**Unknown publisher** warning. Verify the SHA-256 checksum before installing.
The package does not download mitmproxy at runtime.

## Prerequisites

- Node.js 22 or later
- pnpm 10 or later
- Rust 1.91 or later
- Python 3.11 or later
- Windows WebView2 for Windows desktop builds

Development and Windows packages are pinned to mitmproxy `12.2.3`. Release
builds download the official archive at build time, verify its fixed SHA-256,
and bundle the standalone executable. The installed application never
downloads or replaces the executable at runtime.

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

Create Windows MSI and NSIS installers:

```powershell
pnpm tauri build
```

The build runs `scripts/prepare-release-sidecar.ps1` automatically. You can
also run `pnpm release:prepare` directly to download and verify the pinned
mitmproxy archive before building.

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

After building, an administratively extracted MSI can be checked with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass `
  -File scripts/package-ui-smoke.ps1 `
  -PackageRoot "C:\path\to\extracted\PFiles\App Network Debugger"
```

## Packaging

The current Windows x64 package bundles the verified mitmproxy 12.2.3
`mitmdump.exe` and `bridge.py` as Tauri resources. Future packages are planned
for these additional Tauri target triples:

- `x86_64-apple-darwin`
- `aarch64-apple-darwin`
- `x86_64-unknown-linux-gnu`, if Linux support remains practical

The pinned URL and archive SHA-256 are recorded in
`scripts/prepare-release-sidecar.ps1`; attribution is in
`THIRD_PARTY_NOTICES.md`. Runtime downloads of executables are not allowed.

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
- **mitmdump binary missing in development:** install `requirements-dev.txt`
  in `.venv`; packaged builds use the bundled executable.
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
- Windows installers are not code-signed yet.
- macOS and Linux installers are not published yet.
