from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

from .protobuf_wire import ProtobufDecodeError, WireField, decode_message, signed_int64
from .redaction import redact_pair

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
class _DecodedParam:
    name: str | None
    value: Any = None
    children: list[_DecodedParam] | None = None


def _warn(warnings: list[str], message: str) -> None:
    if message not in warnings and len(warnings) < 100:
        warnings.append(message)


def _unknown_fields(
    fields: list[WireField], known: set[int], context: str, warnings: list[str]
) -> None:
    unknown = sorted({field.number for field in fields if field.number not in known})
    if unknown:
        joined = ", ".join(str(number) for number in unknown)
        _warn(warnings, f"{context} contains unsupported field(s): {joined}")


def _utf8(field: WireField, context: str, warnings: list[str]) -> str | None:
    if field.wire_type != 2 or not isinstance(field.value, bytes):
        _warn(warnings, f"{context} has an unexpected wire type")
        return None
    try:
        return field.value.decode("utf-8")
    except UnicodeDecodeError:
        _warn(warnings, f"{context} is not valid UTF-8")
        return None


def _varint(field: WireField, context: str, warnings: list[str]) -> int | None:
    if field.wire_type != 0 or not isinstance(field.value, int):
        _warn(warnings, f"{context} has an unexpected wire type")
        return None
    return field.value


def _fixed_number(
    field: WireField, format_code: str, size: int, context: str, warnings: list[str]
) -> float | None:
    expected_wire_type = 5 if size == 4 else 1
    if (
        field.wire_type != expected_wire_type
        or not isinstance(field.value, bytes)
        or len(field.value) != size
    ):
        _warn(warnings, f"{context} has an unexpected wire type")
        return None
    return struct.unpack(format_code, field.value)[0]


def _add_value(target: dict[str, Any], name: str, value: Any) -> None:
    if name not in target:
        target[name] = value
        return
    existing = target[name]
    if isinstance(existing, list):
        existing.append(value)
    else:
        target[name] = [existing, value]


def _children_to_object(children: list[_DecodedParam]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for child in children:
        if child.name is None:
            continue
        _add_value(value, child.name, _materialize(child))
    return value


def _materialize(param: _DecodedParam) -> Any:
    if param.children:
        if all(child.name is not None for child in param.children):
            return _children_to_object(param.children)
        values: list[Any] = []
        for child in param.children:
            if child.children:
                values.append(_children_to_object(child.children))
            elif child.name is not None:
                values.append({child.name: child.value})
            elif child.value is not None:
                values.append(child.value)
        return values
    return param.value


def _decode_param(data: bytes, warnings: list[str], depth: int = 0) -> _DecodedParam:
    if depth > 16:
        raise ProtobufDecodeError("nested parameter depth exceeds 16")

    fields = decode_message(data)
    _unknown_fields(fields, {1, 2, 3, 4, 5, 6}, "parameter", warnings)
    name: str | None = None
    values: list[Any] = []
    children: list[_DecodedParam] = []

    for field in fields:
        if field.number == 1:
            decoded_name = _utf8(field, "parameter name", warnings)
            if decoded_name is not None:
                name = decoded_name
        elif field.number == 2:
            value = _utf8(field, f"parameter {name or '<unnamed>'} string value", warnings)
            if value is not None:
                values.append(value)
        elif field.number == 3:
            value = _varint(field, f"parameter {name or '<unnamed>'} integer value", warnings)
            if value is not None:
                values.append(signed_int64(value))
        elif field.number == 4:
            value = _fixed_number(
                field,
                "<f",
                4,
                f"parameter {name or '<unnamed>'} float value",
                warnings,
            )
            if value is not None:
                values.append(value)
        elif field.number == 5:
            value = _fixed_number(
                field,
                "<d",
                8,
                f"parameter {name or '<unnamed>'} double value",
                warnings,
            )
            if value is not None:
                values.append(value)
        elif field.number == 6:
            if field.wire_type != 2 or not isinstance(field.value, bytes):
                _warn(warnings, "nested parameter has an unexpected wire type")
                continue
            children.append(_decode_param(field.value, warnings, depth + 1))

    if len(values) > 1:
        _warn(warnings, f"parameter {name or '<unnamed>'} has multiple scalar values")
    if values and children:
        _warn(warnings, f"parameter {name or '<unnamed>'} mixes scalar and nested values")
    return _DecodedParam(
        name=name,
        value=values[-1] if values else None,
        children=children or None,
    )


def _items_from_param(param: _DecodedParam) -> list[dict[str, Any]]:
    if not param.children:
        materialized = _materialize(param)
        if isinstance(materialized, list):
            return [item for item in materialized if isinstance(item, dict)]
        if isinstance(materialized, dict):
            return [materialized]
        return []

    if all(child.name is not None for child in param.children):
        return [_children_to_object(param.children)]

    items: list[dict[str, Any]] = []
    for child in param.children:
        if child.children:
            item = _children_to_object(child.children)
            if item:
                items.append(item)
        elif child.name is not None:
            items.append({child.name: _materialize(child)})
    return items


def _is_consent_key(key: str) -> bool:
    lowered = key.lower()
    return lowered in _CONSENT_KEYS or "consent" in lowered


def _collect_consent(value: Any, target: dict[str, Any]) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if _is_consent_key(str(key)):
                target[str(key)] = item
            _collect_consent(item, target)
    elif isinstance(value, list):
        for item in value:
            _collect_consent(item, target)


def _decode_event(
    data: bytes, warnings: list[str], redact_sensitive: bool
) -> dict[str, Any] | None:
    fields = decode_message(data)
    _unknown_fields(fields, {1, 2, 3, 4}, "event", warnings)
    name: str | None = None
    timestamp_ms: int | None = None
    previous_timestamp_ms: int | None = None
    parameters: dict[str, Any] = {}
    items: list[dict[str, Any]] = []

    for field in fields:
        if field.number == 1:
            if field.wire_type != 2 or not isinstance(field.value, bytes):
                _warn(warnings, "event parameter has an unexpected wire type")
                continue
            parameter = _decode_param(field.value, warnings)
            if parameter.name is None:
                _warn(warnings, "ignored an event parameter without a name")
                continue
            if parameter.name == "items":
                decoded_items = _items_from_param(parameter)
                if decoded_items:
                    items.extend(decoded_items)
                else:
                    _warn(warnings, "items parameter did not contain structured items")
                continue
            _add_value(
                parameters,
                parameter.name,
                redact_pair(parameter.name, _materialize(parameter), redact_sensitive),
            )
        elif field.number == 2:
            decoded_name = _utf8(field, "event name", warnings)
            if decoded_name is not None:
                name = decoded_name
        elif field.number == 3:
            timestamp_ms = _varint(field, "event timestamp", warnings)
        elif field.number == 4:
            previous_timestamp_ms = _varint(field, "previous event timestamp", warnings)

    if not name:
        _warn(warnings, "ignored an event without a name")
        return None
    if previous_timestamp_ms is not None:
        parameters["_previousTimestampMs"] = previous_timestamp_ms

    event: dict[str, Any] = {
        "name": name,
        "parameters": parameters,
        "items": [
            {
                key: redact_pair(key, value, redact_sensitive)
                for key, value in item.items()
            }
            for item in items
        ],
    }
    if timestamp_ms is not None:
        event["timestampMs"] = timestamp_ms
    origin = parameters.get("firebase_event_origin") or parameters.get("_o")
    if isinstance(origin, str):
        event["origin"] = origin
    return event


def _decode_user_property(
    data: bytes, warnings: list[str], redact_sensitive: bool
) -> tuple[str, Any] | None:
    fields = decode_message(data)
    _unknown_fields(fields, {1, 2, 3, 4, 5, 6}, "user property", warnings)
    name: str | None = None
    values: list[Any] = []

    for field in fields:
        if field.number == 1:
            _varint(field, "user property timestamp", warnings)
        elif field.number == 2:
            decoded_name = _utf8(field, "user property name", warnings)
            if decoded_name is not None:
                name = decoded_name
        elif field.number == 3:
            value = _utf8(field, f"user property {name or '<unnamed>'} value", warnings)
            if value is not None:
                values.append(value)
        elif field.number == 4:
            value = _varint(field, f"user property {name or '<unnamed>'} value", warnings)
            if value is not None:
                values.append(signed_int64(value))
        elif field.number == 5:
            value = _fixed_number(
                field,
                "<f",
                4,
                f"user property {name or '<unnamed>'} value",
                warnings,
            )
            if value is not None:
                values.append(value)
        elif field.number == 6:
            value = _fixed_number(
                field,
                "<d",
                8,
                f"user property {name or '<unnamed>'} value",
                warnings,
            )
            if value is not None:
                values.append(value)

    if not name:
        _warn(warnings, "ignored a user property without a name")
        return None
    if not values:
        _warn(warnings, f"ignored user property {name} without a value")
        return None
    if len(values) > 1:
        _warn(warnings, f"user property {name} has multiple values")
    return name, redact_pair(name, values[-1], redact_sensitive)


def _decode_bundle(
    data: bytes, warnings: list[str], redact_sensitive: bool, platform: str
) -> dict[str, Any]:
    fields = decode_message(data)
    _unknown_fields(fields, {2, 3}, "bundle", warnings)
    events: list[dict[str, Any]] = []
    user_properties: dict[str, Any] = {}
    consent: dict[str, Any] = {}

    for field in fields:
        if field.number not in {2, 3}:
            continue
        if field.wire_type != 2 or not isinstance(field.value, bytes):
            _warn(warnings, f"bundle field {field.number} has an unexpected wire type")
            continue
        try:
            if field.number == 2:
                event = _decode_event(field.value, warnings, redact_sensitive)
                if event is not None:
                    events.append(event)
                    _collect_consent(event["parameters"], consent)
            else:
                user_property = _decode_user_property(
                    field.value, warnings, redact_sensitive
                )
                if user_property is not None:
                    _add_value(user_properties, *user_property)
        except ProtobufDecodeError as error:
            _warn(warnings, f"could not decode bundle field {field.number}: {error}")

    _collect_consent(user_properties, consent)
    return {
        "platform": platform,
        "userProperties": user_properties,
        "consent": consent,
        "events": events,
    }


def decode_firebase_native(
    content: bytes, url: str, redact_sensitive: bool
) -> tuple[str, str, list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    host = (urlsplit(url).hostname or "").lower()
    platform = "ios" if "analytics-services" in host else "android"

    try:
        fields = decode_message(content)
    except ProtobufDecodeError as error:
        return "error", platform, [], [f"Malformed Firebase protobuf batch: {error}"]

    _unknown_fields(fields, {1}, "batch", warnings)
    bundles: list[dict[str, Any]] = []
    for field in fields:
        if field.number != 1:
            continue
        if field.wire_type != 2 or not isinstance(field.value, bytes):
            _warn(warnings, "batch bundle has an unexpected wire type")
            continue
        try:
            bundles.append(
                _decode_bundle(field.value, warnings, redact_sensitive, platform)
            )
        except ProtobufDecodeError as error:
            _warn(warnings, f"could not decode Firebase bundle: {error}")

    if not bundles:
        _warn(warnings, "No supported bundle field was found in the protobuf batch")
        return "unsupported", platform, [], warnings

    _warn(
        warnings,
        "App identifiers and versions are omitted because parser schema 1.0.0 "
        "does not map those native bundle fields",
    )
    decoded_content = any(
        bundle["events"] or bundle["userProperties"] for bundle in bundles
    )
    if not decoded_content:
        _warn(warnings, "Bundles contained no supported events or user properties")
    status = "partial" if warnings else "decoded"
    return status, platform, bundles, warnings
