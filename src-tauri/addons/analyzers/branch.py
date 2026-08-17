from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlsplit

from .redaction import redact_pair


def is_branch_url(url: str) -> bool:
    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    if not (host.endswith("branch.io") or host.endswith("app.link") or host.endswith("bnc.lt")):
        return False
    path = parsed.path.lower()
    return any(
        path.startswith(prefix)
        for prefix in ("/v1/open", "/v1/install", "/v1/event", "/v2/event", "/v1/pageview", "/v1/profile")
    )


def decode_branch_payload(
    content: bytes, url: str, redact_sensitive: bool
) -> tuple[str, str, list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    parsed_url = urlsplit(url)
    path = parsed_url.path.lower()

    try:
        data = json.loads(content.decode("utf-8"))
    except Exception as error:
        return "error", "mobile", [], [f"Malformed Branch JSON payload: {error}"]

    if not isinstance(data, dict):
        return "unsupported", "mobile", [], ["Branch payload is not a JSON object"]

    # Determine event name
    event_name = data.get("name")
    if not event_name:
        if "open" in path:
            event_name = "open"
        elif "install" in path:
            event_name = "install"
        elif "pageview" in path:
            event_name = "pageview"
        elif "profile" in path:
            event_name = "profile"
        else:
            event_name = "branch_event"

    user_data = data.get("user_data", {}) if isinstance(data.get("user_data"), dict) else {}
    custom_data = data.get("custom_data", {}) if isinstance(data.get("custom_data"), dict) else {}
    event_data = data.get("event_data", {}) if isinstance(data.get("event_data"), dict) else {}
    content_items = data.get("content_items", []) if isinstance(data.get("content_items"), list) else []

    platform = str(user_data.get("os", data.get("os", "mobile"))).lower()
    device_model = str(user_data.get("model", data.get("hardware_id", "")))
    os_version = str(user_data.get("os_version", data.get("os_version", "")))
    app_version = str(user_data.get("app_version", data.get("app_version", "")))
    app_id = str(user_data.get("app_id", data.get("app_id", "")))
    developer_identity = str(user_data.get("developer_identity", data.get("developer_identity", "")))

    # Build event parameters
    parameters: dict[str, Any] = {}
    for k, v in event_data.items():
        parameters[str(k)] = redact_pair(str(k), v, redact_sensitive)
    for k, v in custom_data.items():
        parameters[str(k)] = redact_pair(str(k), v, redact_sensitive)

    # If no event_data/custom_data, copy top-level keys
    if not parameters:
        for k, v in data.items():
            if k not in {"user_data", "custom_data", "event_data", "content_items", "branch_key", "name"}:
                if isinstance(v, (str, int, float, bool)):
                    parameters[str(k)] = redact_pair(str(k), v, redact_sensitive)

    # Build items
    items: list[dict[str, Any]] = []
    for raw_item in content_items:
        if isinstance(raw_item, dict):
            item_dict: dict[str, Any] = {}
            for ik, iv in raw_item.items():
                clean_key = str(ik).lstrip("$")
                item_dict[clean_key] = redact_pair(clean_key, iv, redact_sensitive)
            items.append(item_dict)

    # Shared device / bundle metadata
    shared: dict[str, Any] = {
        "platform": platform,
        "os_version": os_version,
        "device_model": device_model,
        "app_version": app_version,
        "app_id": app_id,
        "developer_identity": developer_identity,
        "branch_key": str(data.get("branch_key", "")),
        "tracking_endpoint": url,
    }

    event: dict[str, Any] = {
        "name": str(event_name),
        "origin": "branch",
        "appId": app_id or None,
        "parameters": parameters,
        "systemParameters": {},
        "items": items,
        "userProperties": {
            "developer_identity": developer_identity,
        } if developer_identity else {},
    }

    bundle: dict[str, Any] = {
        "appId": app_id or None,
        "platform": platform,
        "osVersion": os_version,
        "deviceModel": device_model,
        "appVersion": app_version,
        "shared": shared,
        "userProperties": event["userProperties"],
        "consent": {},
        "events": [event],
    }

    return "decoded", platform, [bundle], warnings
