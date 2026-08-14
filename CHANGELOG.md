# Changelog

All notable changes to this project will be documented in this file.

## [0.1.3] - 2026-08-15

### Added

- Pause and resume capture without stopping proxy forwarding, so configured
  mobile devices retain Internet access.
- A certificate setup panel with a local QR code, SHA-256 fingerprint,
  creation time, certificate file action, and explicit trust acknowledgement.
- Detection and a persistent warning when the per-installation CA changes.

### Changed

- Store mitmproxy CA material in a dedicated persistent certificate directory.
- Copy and preserve an existing CA from the previous runtime directory so
  upgrades and rollbacks do not require reinstalling the phone certificate.

## [0.1.2] - 2026-07-30

### Added

- Persistent, timestamped diagnostic logging for application startup,
  shutdown, capture lifecycle, proxy stderr, storage, network, file, and
  frontend failures.
- A **Logs** toolbar action and an **Open logs** action on error banners.
- Automatic detection of an unclean previous shutdown.
- Log rotation at 5 MB with one previous log retained.

## [0.1.1] - 2026-07-29

### Fixed

- Ensure Windows terminates the bundled mitmdump process when the desktop
  application exits, crashes, or is force-closed, preventing an orphan proxy
  from keeping the configured port occupied.
- Package an explicit-proxy-only Windows sidecar without the unused WinDivert
  transparent/local-capture modules.
- Report capture as running only after the proxy is accepting connections.

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
