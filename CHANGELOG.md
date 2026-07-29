# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-07-29

### Added

- Desktop HTTP, HTTPS, and WebSocket capture powered by mitmproxy.
- Local-only and LAN-device proxy modes with automatic LAN IPv4 detection.
- Request overview, headers, query, payload, response, timing, and WebSocket
  views.
- Sensitive header and structured-body redaction before data reaches the UI.
- SQLite-backed capture sessions with rename, reopen, and delete actions.
- Standalone Windows x64 NSIS and MSI packages containing a verified
  mitmproxy 12.2.3 `mitmdump.exe`.
- Reproducible sidecar preparation with a pinned official download URL and
  SHA-256 verification.

### Known limitations

- Windows binaries are not code-signed.
- Certificate pinning is not bypassed.
- Some mobile applications ignore the operating system proxy or user-installed
  certificate authorities.
