from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qsl, urlsplit

from .redaction import redact_pair, redact_structured

_NUMBER_PATTERN = re.compile(r"^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$")
_PRODUCT_PATTERN = re.compile(r"^pr\d+$", re.IGNORECASE)
_PRODUCT_FIELDS = {
    "id": "item_id",
    "nm": "item_name",
    "br": "item_brand",
    "ca": "item_category",
    "ca2": "item_category2",
    "ca3": "item_category3",
    "ca4": "item_category4",
    "ca5": "item_category5",
    "va": "item_variant",
    "pr": "price",
    "qt": "quantity",
    "cp": "coupon",
    "ps": "index",
}
_NUMERIC_PRODUCT_FIELDS = {"price", "quantity", "index"}
_CONSENT_KEYS = {
    "ad_personalization",
    "ad_storage",
    "ad_user_data",
    "analytics_storage",
    "dma",
    "gcd",
    "gcs",
    "npa",
    "non_personalized_ads",
}


@dataclass(slots=True)
class _Bundle:
    app_id: str | None = None
    app_name: str | None = None
    app_version: str | None = None
    platform: str | None = None
    measurement_id: str | None = None
    user_properties: dict[str, Any] = field(default_factory=dict)
    consent: dict[str, Any] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "userProperties": self.user_properties,
            "consent": self.consent,
            "events": self.events,
        }
        optional = {
            "appId": self.app_id,
            "appName": self.app_name,
            "appVersion": self.app_version,
            "platform": self.platform,
            "measurementId": self.measurement_id,
        }
        result.update({key: value for key, value in optional.items() if value})
        return result


def _warn(warnings: list[str], message: str) -> None:
    if message not in warnings and len(warnings) < 100:
        warnings.append(message)


def _coerce_number(value: str) -> int | float | str:
    if not _NUMBER_PATTERN.fullmatch(value):
        return value
    try:
        return float(value) if any(character in value for character in ".eE") else int(value)
    except ValueError:
        return value


def _add_value(target: dict[str, Any], name: str, value: Any) -> None:
    if name not in target:
        target[name] = value
        return
    existing = target[name]
    if isinstance(existing, list):
        existing.append(value)
    else:
        target[name] = [existing, value]


def _is_consent_key(key: str) -> bool:
    lowered = key.lower()
    return lowered in _CONSENT_KEYS or "consent" in lowered


def _parse_product(value: str, redact_sensitive: bool) -> dict[str, Any]:
    item: dict[str, Any] = {}
    for token in value.split("~"):
        code = next(
            (
                candidate
                for candidate in sorted(_PRODUCT_FIELDS, key=len, reverse=True)
                if token.lower().startswith(candidate)
            ),
            None,
        )
        if code is None:
            continue
        item_value = token[len(code) :]
        field_name = _PRODUCT_FIELDS.get(code.lower(), code)
        if field_name in _NUMERIC_PRODUCT_FIELDS:
            parsed_value: Any = _coerce_number(item_value)
        else:
            parsed_value = item_value
        _add_value(
            item,
            field_name,
            redact_pair(field_name, parsed_value, redact_sensitive),
        )
    return item


def _pairs_to_event(
    pairs: list[tuple[str, str]], warnings: list[str], redact_sensitive: bool
) -> tuple[_Bundle, dict[str, Any]] | None:
    first: dict[str, str] = {}
    for key, value in pairs:
        first.setdefault(key, value)

    name = first.get("en") or first.get("ea") or first.get("t")
    if not name:
        _warn(warnings, "ignored an Analytics hit without an event or hit name")
        return None

    bundle = _Bundle(
        app_id=first.get("aid") or first.get("firebase_app_id"),
        app_name=first.get("an"),
        app_version=first.get("av"),
        platform=first.get("platform"),
        measurement_id=first.get("tid") or first.get("measurement_id"),
    )
    parameters: dict[str, Any] = {}
    items: list[dict[str, Any]] = []
    metadata_keys = {
        "aid",
        "an",
        "av",
        "en",
        "firebase_app_id",
        "measurement_id",
        "platform",
        "tid",
    }

    for key, value in pairs:
        lowered = key.lower()
        if lowered in metadata_keys:
            continue
        if lowered.startswith("upn."):
            property_name = key[4:]
            property_value = redact_pair(
                property_name, _coerce_number(value), redact_sensitive
            )
            _add_value(bundle.user_properties, property_name, property_value)
            continue
        if lowered.startswith("up."):
            property_name = key[3:]
            _add_value(
                bundle.user_properties,
                property_name,
                redact_pair(property_name, value, redact_sensitive),
            )
            continue
        if _PRODUCT_PATTERN.fullmatch(key):
            product = _parse_product(value, redact_sensitive)
            if product:
                items.append(product)
            continue
        if lowered.startswith("epn."):
            parameter_name = key[4:]
            parameter_value: Any = _coerce_number(value)
        elif lowered.startswith("ep."):
            parameter_name = key[3:]
            parameter_value = value
        else:
            parameter_name = key
            parameter_value = value
        redacted_value = redact_pair(parameter_name, parameter_value, redact_sensitive)
        _add_value(parameters, parameter_name, redacted_value)
        if _is_consent_key(parameter_name):
            _add_value(bundle.consent, parameter_name, redacted_value)

    for key, value in bundle.user_properties.items():
        if _is_consent_key(key):
            bundle.consent[key] = value

    event: dict[str, Any] = {
        "name": name,
        "parameters": parameters,
        "items": items,
    }
    timestamp_micros = first.get("timestamp_micros")
    if timestamp_micros and timestamp_micros.isdigit():
        event["timestampMicros"] = int(timestamp_micros)
    origin = first.get("firebase_event_origin") or first.get("_o")
    if origin:
        event["origin"] = origin
    return bundle, event


def _merge_bundle(
    bundles: dict[tuple[str | None, ...], _Bundle], incoming: _Bundle, event: dict[str, Any]
) -> None:
    key = (
        incoming.app_id,
        incoming.app_name,
        incoming.app_version,
        incoming.platform,
        incoming.measurement_id,
    )
    target = bundles.get(key)
    if target is None:
        bundles[key] = incoming
        target = incoming
    else:
        for name, value in incoming.user_properties.items():
            _add_value(target.user_properties, name, value)
        target.consent.update(incoming.consent)
    target.events.append(event)


def _decode_collect(
    content: bytes, url: str, redact_sensitive: bool
) -> tuple[str, str | None, list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    parsed_url = urlsplit(url)
    common_pairs = parse_qsl(parsed_url.query, keep_blank_values=True)
    lines: list[str] = []
    if content:
        try:
            decoded_body = content.decode("utf-8")
        except UnicodeDecodeError:
            return "error", None, [], ["Analytics form or batch body is not valid UTF-8"]
        lines = [line for line in decoded_body.splitlines() if line.strip()]

    hit_pairs: list[list[tuple[str, str]]]
    if parsed_url.path == "/batch":
        hit_pairs = [
            common_pairs + parse_qsl(line, keep_blank_values=True) for line in lines
        ]
        if not hit_pairs:
            _warn(warnings, "Analytics batch contains no hits")
    else:
        body_pairs = parse_qsl(lines[0], keep_blank_values=True) if lines else []
        hit_pairs = [common_pairs + body_pairs]

    bundles: dict[tuple[str | None, ...], _Bundle] = {}
    for pairs in hit_pairs:
        decoded = _pairs_to_event(pairs, warnings, redact_sensitive)
        if decoded is None:
            continue
        bundle, event = decoded
        _merge_bundle(bundles, bundle, event)

    result = [bundle.as_dict() for bundle in bundles.values()]
    if not result:
        return "unsupported", None, [], warnings
    return ("partial" if warnings else "decoded"), None, result, warnings


def _user_properties(
    value: Any, warnings: list[str], redact_sensitive: bool
) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        _warn(warnings, "Measurement Protocol user_properties must be an object")
        return {}
    result: dict[str, Any] = {}
    for name, definition in value.items():
        if isinstance(definition, dict) and "value" in definition:
            result[str(name)] = redact_pair(
                str(name), definition["value"], redact_sensitive
            )
        else:
            _warn(warnings, f"user property {name} has no documented value field")
    return result


def _decode_measurement_protocol(
    content: bytes, url: str, redact_sensitive: bool
) -> tuple[str, str | None, list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    try:
        document = json.loads(content.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        return "error", None, [], [f"Invalid Measurement Protocol JSON: {error}"]
    if not isinstance(document, dict):
        return "error", None, [], ["Measurement Protocol payload must be a JSON object"]

    query = dict(parse_qsl(urlsplit(url).query, keep_blank_values=True))
    user_properties = _user_properties(
        document.get("user_properties"), warnings, redact_sensitive
    )
    consent_value = document.get("consent", {})
    if consent_value is None:
        consent_value = {}
    if not isinstance(consent_value, dict):
        _warn(warnings, "Measurement Protocol consent must be an object")
        consent_value = {}
    consent = redact_structured(consent_value, enabled=redact_sensitive)
    events_value = document.get("events")
    if not isinstance(events_value, list):
        return "error", None, [], ["Measurement Protocol events must be an array"]

    top_timestamp = document.get("timestamp_micros")
    events: list[dict[str, Any]] = []
    for index, event_value in enumerate(events_value):
        if not isinstance(event_value, dict) or not isinstance(event_value.get("name"), str):
            _warn(warnings, f"ignored Measurement Protocol event {index} without a name")
            continue
        params_value = event_value.get("params", {})
        if not isinstance(params_value, dict):
            _warn(warnings, f"event {event_value['name']} params must be an object")
            params_value = {}
        params = dict(params_value)
        raw_items = params.pop("items", [])
        if raw_items is None:
            raw_items = []
        if not isinstance(raw_items, list):
            _warn(warnings, f"event {event_value['name']} items must be an array")
            raw_items = []
        items = [item for item in raw_items if isinstance(item, dict)]
        if len(items) != len(raw_items):
            _warn(warnings, f"event {event_value['name']} contains a non-object item")

        event: dict[str, Any] = {
            "name": event_value["name"],
            "parameters": redact_structured(params, enabled=redact_sensitive),
            "items": redact_structured(items, enabled=redact_sensitive),
        }
        timestamp = event_value.get("timestamp_micros", top_timestamp)
        if isinstance(timestamp, int) and not isinstance(timestamp, bool):
            event["timestampMicros"] = timestamp
        origin = params.get("firebase_event_origin") or params.get("_o")
        if isinstance(origin, str):
            event["origin"] = origin
        events.append(event)

    bundle = _Bundle(
        app_id=query.get("firebase_app_id"),
        measurement_id=query.get("measurement_id"),
        user_properties=user_properties,
        consent=consent,
        events=events,
    )
    if not events:
        _warn(warnings, "Measurement Protocol payload contains no decodable events")
    status = "partial" if warnings else "decoded"
    return status, None, [bundle.as_dict()], warnings


def decode_google_analytics(
    content: bytes, url: str, protocol: str, redact_sensitive: bool
) -> tuple[str, str | None, list[dict[str, Any]], list[str]]:
    if protocol == "ga4-measurement-protocol":
        return _decode_measurement_protocol(content, url, redact_sensitive)
    return _decode_collect(content, url, redact_sensitive)
