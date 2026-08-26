from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import parse_qsl, urlsplit

_FIREBASE_NATIVE_HOSTS = (
    "app-measurement.com",
    "app-analytics-services.com",
    "app-analytics-services-att.com",
)
_GOOGLE_ANALYTICS_HOSTS = (
    "google-analytics.com",
    "analytics.google.com",
)
_FIREBASE_APP_CHECK_HOSTS = ("firebaseappcheck.googleapis.com",)
_FIREBASE_INSTALLATIONS_HOSTS = ("firebaseinstallations.googleapis.com",)
_FIREBASE_CRASHLYTICS_HOSTS = (
    "crashlytics.com",
    "crashlyticsreports-pa.googleapis.com",
    "firebasecrashlytics.googleapis.com",
)
_FIREBASE_LOGGING_HOSTS = (
    "firebaselogging.googleapis.com",
    "firebaselogging-pa.googleapis.com",
    "crashlyticsreports-pa.googleapis.com",
)
_BRANCH_HOSTS = (
    "branch.io",
    "app.link",
    "bnc.lt",
)


@dataclass(frozen=True, slots=True)
class EndpointMatch:
    provider_id: str
    provider_label: str
    service_id: str
    service_label: str
    protocol: str
    confidence: float
    tags: tuple[str, ...]
    analytics: bool


def _matches_domain(host: str, suffixes: tuple[str, ...]) -> bool:
    normalized = host.lower().rstrip(".")
    return any(normalized == suffix or normalized.endswith(f".{suffix}") for suffix in suffixes)


def _pairs_have_ga_markers(pairs: list[tuple[str, str]]) -> bool:
    keys = {key.lower() for key, _value in pairs}
    if {"measurement_id", "api_secret"}.issubset(keys):
        return True
    if {"firebase_app_id", "api_secret"}.issubset(keys):
        return True
    return "tid" in keys and bool(keys.intersection({"v", "en", "t"}))


def _request_pairs(query: str, content: bytes) -> list[tuple[str, str]]:
    pairs = parse_qsl(query, keep_blank_values=True)
    try:
        body = content.decode("utf-8")
    except UnicodeDecodeError:
        return pairs

    for line in body.splitlines() or [body]:
        pairs.extend(parse_qsl(line, keep_blank_values=True))
    return pairs


def is_firebase_native_url(url: str) -> bool:
    parsed = urlsplit(url)
    return parsed.path == "/a" and _matches_domain(parsed.hostname or "", _FIREBASE_NATIVE_HOSTS)


def classify_endpoint(url: str, content: bytes = b"") -> EndpointMatch | None:
    parsed = urlsplit(url)
    host = parsed.hostname or ""
    path = parsed.path

    if is_firebase_native_url(url):
        return EndpointMatch(
            provider_id="firebase",
            provider_label="Firebase",
            service_id="analytics",
            service_label="Analytics",
            protocol="firebase-native-protobuf",
            confidence=0.99,
            tags=("firebase", "analytics", "mobile", "protobuf"),
            analytics=True,
        )

    if _matches_domain(host, _FIREBASE_APP_CHECK_HOSTS):
        return EndpointMatch(
            provider_id="firebase",
            provider_label="Firebase",
            service_id="app-check",
            service_label="App Check",
            protocol="https",
            confidence=0.99,
            tags=("firebase", "app-check", "security"),
            analytics=False,
        )

    if _matches_domain(host, _FIREBASE_INSTALLATIONS_HOSTS):
        return EndpointMatch(
            provider_id="firebase",
            provider_label="Firebase",
            service_id="installations",
            service_label="Installations",
            protocol="https",
            confidence=0.99,
            tags=("firebase", "installations"),
            analytics=False,
        )

    if path.startswith("/v1/firelog/") and _matches_domain(
        host, _FIREBASE_LOGGING_HOSTS
    ):
        return EndpointMatch(
            provider_id="firebase",
            provider_label="Firebase",
            service_id="logging",
            service_label="Logging",
            protocol="firelog",
            confidence=0.99,
            tags=("firebase", "logging"),
            analytics=False,
        )

    if _matches_domain(host, _FIREBASE_LOGGING_HOSTS[:-1]):
        return EndpointMatch(
            provider_id="firebase",
            provider_label="Firebase",
            service_id="logging",
            service_label="Logging",
            protocol="https",
            confidence=0.99,
            tags=("firebase", "logging"),
            analytics=False,
        )

    if _matches_domain(host, _FIREBASE_CRASHLYTICS_HOSTS):
        return EndpointMatch(
            provider_id="firebase",
            provider_label="Firebase",
            service_id="crashlytics",
            service_label="Crashlytics",
            protocol="https",
            confidence=0.99,
            tags=("firebase", "crashlytics", "crash-reporting"),
            analytics=False,
        )

    if _matches_domain(host, _BRANCH_HOSTS):
        branch_paths = (
            "/v1/open",
            "/v1/install",
            "/v1/event",
            "/v2/event",
            "/v1/pageview",
            "/v1/profile",
        )
        if any(path.startswith(prefix) for prefix in branch_paths):
            return EndpointMatch(
                provider_id="branch",
                provider_label="Branch",
                service_id="analytics",
                service_label="Attribution & Analytics",
                protocol="branch-json",
                confidence=0.99,
                tags=("branch", "attribution", "analytics", "deep-linking"),
                analytics=True,
            )

    if not _matches_domain(host, _GOOGLE_ANALYTICS_HOSTS):
        return None

    pairs = _request_pairs(parsed.query, content)
    if path == "/mp/collect" and _pairs_have_ga_markers(pairs):
        query_keys = {key.lower() for key, _value in pairs}
        is_firebase = "firebase_app_id" in query_keys
        return EndpointMatch(
            provider_id="firebase" if is_firebase else "google-analytics",
            provider_label="Firebase" if is_firebase else "Google Analytics",
            service_id="analytics",
            service_label="Analytics",
            protocol="ga4-measurement-protocol",
            confidence=0.98,
            tags=(
                ("firebase", "analytics", "measurement-protocol")
                if is_firebase
                else ("google-analytics", "ga4", "measurement-protocol")
            ),
            analytics=True,
        )

    protocols = {
        "/g/collect": "ga4-collect",
        "/j/collect": "google-analytics-collect",
        "/collect": "google-analytics-collect",
        "/batch": "google-analytics-batch",
    }
    if path in protocols and _pairs_have_ga_markers(pairs):
        return EndpointMatch(
            provider_id="google-analytics",
            provider_label="Google Analytics",
            service_id="analytics",
            service_label="Analytics",
            protocol=protocols[path],
            confidence=0.98,
            tags=("google-analytics", "analytics", "batch")
            if path == "/batch"
            else ("google-analytics", "analytics"),
            analytics=True,
        )

    return None
