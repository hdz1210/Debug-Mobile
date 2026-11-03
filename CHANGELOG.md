# Changelog

All notable changes to this project will be documented in this file.

## [0.1.11] - 2026-11-03

### Changed

- Request **Analytics** tab: summary, decoder details and tags merged into one compact header; bundle card shows OS and device and no longer repeats the app ID.
- Removed the "confidence" pill, which was a fixed per-endpoint score rather than a measure of decoding quality.

### Fixed

- Large integer parameters (e.g. Firebase `_si`) were rounded by JavaScript; values beyond 2^53 are now kept exact.
- "1 events" pluralisation in the analytics event counter.

## [0.1.10] - 2026-11-03

### Added

- **Firebase app name**: every analytics event shows the app name (read from the iOS User-Agent), plus `app_name`, `app_id` and `app_version` in Overview.
- **Session export**: new **Session** grouping and **Export session** button that saves every event of a Firebase/GA4 session as JSON with app, device and session summary.
- GA4 hits sent from in-app WebViews are listed in the Firebase tab, labelled `GA4 <measurement ID>`, grouped by their `sid` session.

### Fixed

- Firebase native bundles were decoded with shifted field numbers (`app_id` showed the time-zone offset, e.g. `420`); bundle metadata is now mapped to the correct fields.
- Device info, instance IDs, shared metadata and event session IDs were dropped between the analyzer and the UI.
- Binary request bodies sent with a text content type (e.g. Firebase `/sdk-exp`) were corrupted when stored; they are now kept as base64.
- The Firebase tab list did not match its badge count when GA4 web hits were captured.
- Events without their own timestamp were dated 1970 in session exports.

## [0.1.9] - 2026-08-27

### Fixed

- Fixed unstyled layout and text crowding in **Capture History** modal cards with clean metadata rows and action buttons.
- Fixed header formatting in **Payload & Response BodyViewer** with dedicated format badges, content-type tags, tabular byte counts, and SVG action buttons with copy feedback.
- Modernized **Phone Certificate Setup** dialog with standard dialog header, SVG icons, and tabular figures.

## [0.1.8] - 2026-08-26

### Changed

- Complete UI/UX overhaul adhering to the **Impeccable Design System** (`audit`, `critique`, `distill`, `polish`).
- Replaced all Unicode emojis with handcrafted vector SVG icons (`Icons.tsx`) for professional aesthetic.
- Enhanced Accessibility (A11y) with ARIA roles, full keyboard navigation, and high-contrast focus rings.
- Fixed layout thrashing with GPU-accelerated transforms and applied tabular numerals (`tabular-nums`) to prevent layout jitter.
- Refined Analytics Inspector with formatted cards, status badges, hero chips, and structured Consent Dialog.

## [0.1.7] - 2026-08-26

### Added

- Dedicated full-featured **Analytics Workspace** with real-time event aggregation, event parameter breakdown, and interactive object tree inspection.
- Native decoding for **Branch.io** attribution payloads (`/v1/open`, `/v1/install`, `/v1/event`, `/v2/event`, `/v1/pageview`, `/v1/profile`) with device metadata, event parameters, and content item breakdown.
- Draggable and resizable split-pane layout for comfortable inspection of network traffic and payloads.
- Dark theme styling improvements with customized slim scrollbars and responsive control toolbar.

### Changed

- Enhanced Firebase Protobuf wire decoding and error resilience.
- Improved certificate guidance with direct links to iOS VPN & Device Management and Trust Settings.

## [0.1.6] - 2026-08-15

### Changed

- Redesigned the Firebase Analytics events panel with distinct, high-contrast event cards, category-specific accent borders, event index badges, and human-readable event labels.
- Added hero parameter chips to spotlight critical event metadata (screen, category, location, currency, value, cart) at a glance.
- Added real-time event search filtering by event name or parameter value and global Expand all / Collapse all controls.
- Added one-click copy for individual parameter values and per-event full JSON export.
- Cleaned up non-actionable internal Google Protobuf hardware metadata decoder warnings and promoted cleanly decoded Firebase batches to 100% confidence Decoded status.

## [0.1.5] - 2026-08-15

### Added

- Export selected or all captured network requests to standard HAR 1.2
  archives (`.har`) compatible with Chrome DevTools, Postman, and Charles.
- Multi-selection checkboxes in the network table with per-row selection and a
  master header checkbox supporting indeterminate state.
- Preserve duplicate request and response headers, query parameters, text and
  Base64 payloads/responses, timings, errors, WebSocket frames, and Firebase
  Analytics metadata during HAR export.

## [0.1.4] - 2026-08-15

### Added

- Detect and tag supported Firebase Analytics, Google Analytics, App Check,
  Installations, Crashlytics, and Firebase logging requests while retaining
  the original request in the network inspector.
- Decode supported Firebase native batches, GA collect and batch requests,
  and GA4 Measurement Protocol payloads into a dedicated **Analytics** tab.
- Display analytics events, parameters, user properties, items, consent,
  timestamps, parser confidence, and actionable decoding warnings.
- Search captured and historical traffic by analytics provider, service,
  protocol, tags, application metadata, and event names.

### Changed

- Preserve native analytics payload bytes for reliable decoding and surface
  unsupported, malformed, or truncated schemas without hiding raw traffic.
- Persist decoded analytics metadata with capture history.

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
