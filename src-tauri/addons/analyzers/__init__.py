from __future__ import annotations

from typing import Any

from .classifier import EndpointMatch, classify_endpoint, is_firebase_native_url
from .firebase_native import decode_firebase_native
from .google_analytics import decode_google_analytics

PARSER_VERSION = "1.0.0"

__all__ = ["analyze_request", "is_firebase_native_url"]


def _base_analysis(match: EndpointMatch) -> dict[str, Any]:
    return {
        "providerId": match.provider_id,
        "providerLabel": match.provider_label,
        "serviceId": match.service_id,
        "serviceLabel": match.service_label,
        "protocol": match.protocol,
        "confidence": match.confidence,
        "status": "identified",
        "parserVersion": PARSER_VERSION,
        "tags": list(match.tags),
        "bundles": [],
        "warnings": [],
    }


def analyze_request(
    url: str,
    content: bytes,
    redact_sensitive: bool = True,
    content_truncated: bool = False,
) -> dict[str, Any] | None:
    match = classify_endpoint(url, content)
    if match is None:
        return None

    analysis = _base_analysis(match)
    if not match.analytics:
        return analysis

    try:
        if match.protocol == "firebase-native-protobuf":
            status, platform, bundles, warnings = decode_firebase_native(
                content, url, redact_sensitive
            )
        else:
            status, platform, bundles, warnings = decode_google_analytics(
                content, url, match.protocol, redact_sensitive
            )
    except Exception as error:  # noqa: BLE001 - analyzers must never break proxying
        analysis["status"] = "error"
        analysis["warnings"] = [f"Analyzer failed safely: {type(error).__name__}: {error}"]
        if content_truncated:
            analysis["warnings"].append(
                "Analytics payload was truncated at the configured capture limit"
            )
        return analysis

    analysis["status"] = status
    analysis["bundles"] = bundles
    analysis["warnings"] = warnings
    if content_truncated:
        analysis["warnings"].append(
            "Analytics payload was truncated at the configured capture limit"
        )
        if analysis["status"] == "decoded":
            analysis["status"] = "partial"
    if platform:
        analysis["platform"] = platform
    return analysis
