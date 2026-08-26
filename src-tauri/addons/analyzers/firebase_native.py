from __future__ import annotations

import contextlib
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


_SYSTEM_PARAM_PREFIXES = (
    "_o",
    "_sc",
    "_si",
    "_sn",
    "_sno",
    "_sid",
    "_lte",
    "_se",
    "_previousTimestampMs",
    "firebase_",
)


def _is_system_param(name: str) -> bool:
    return name in {
        "_o",
        "_sc",
        "_si",
        "_sn",
        "_sno",
        "_sid",
        "_lte",
        "_se",
        "_fi",
        "_fot",
        "_id",
        "_previousTimestampMs",
        "firebase_event_origin",
        "firebase_screen",
        "firebase_screen_class",
        "firebase_screen_id",
    } or name.startswith("_") or name.startswith("firebase_")


def _decode_bundle(
    data: bytes, warnings: list[str], redact_sensitive: bool, default_platform: str
) -> dict[str, Any]:
    fields = decode_message(data)
    events: list[dict[str, Any]] = []
    user_properties: dict[str, Any] = {}
    consent: dict[str, Any] = {}
    shared: dict[str, Any] = {}

    protocol_version: int | None = None
    upload_timestamp_millis: int | None = None
    resettable_device_id: str | None = None
    device_model: str | None = None
    os_version: str | None = None
    app_version: str | None = None
    gmp_version: int | None = None
    app_store: str | None = None
    gmp_app_id: str | None = None
    app_id: str | None = None
    app_instance_id: str | None = None
    firebase_instance_id: str | None = None
    bundle_sequential_index: int | None = None
    bundle_platform: str | None = None
    user_default_language: str | None = None
    time_zone_offset_minutes: int | None = None
    start_timestamp_millis: int | None = None
    end_timestamp_millis: int | None = None
    prev_bundle_start_timestamp_millis: int | None = None
    prev_bundle_end_timestamp_millis: int | None = None
    app_version_major: int | None = None
    app_version_minor: int | None = None
    app_version_patch: int | None = None
    ad_services_version: int | None = None
    consent_signals: str | None = None
    dynamite_version: int | None = None
    delivery_index: int | None = None
    batching_timestamp_millis: int | None = None
    config_version: int | None = None

    def _scalar(field: WireField) -> Any:
        if field.wire_type == 0 and isinstance(field.value, int):
            return field.value
        if field.wire_type == 2 and isinstance(field.value, bytes):
            try:
                return field.value.decode("utf-8")
            except UnicodeDecodeError:
                return field.value.hex()
        if field.wire_type == 1 and isinstance(field.value, bytes) and len(field.value) == 8:
            try:
                return struct.unpack("<d", field.value)[0]
            except Exception:
                return field.value.hex()
        if field.wire_type == 5 and isinstance(field.value, bytes) and len(field.value) == 4:
            try:
                return struct.unpack("<f", field.value)[0]
            except Exception:
                return field.value.hex()
        return str(field.value)

    for field in fields:
        num = field.number
        try:
            if num == 1:
                val = _scalar(field)
                if isinstance(val, int):
                    protocol_version = val
            elif num == 2:
                if field.wire_type == 2 and isinstance(field.value, bytes):
                    event = _decode_event(field.value, warnings, redact_sensitive)
                    if event is not None:
                        events.append(event)
                        _collect_consent(event["parameters"], consent)
            elif num == 3:
                if field.wire_type == 2 and isinstance(field.value, bytes):
                    user_property = _decode_user_property(
                        field.value, warnings, redact_sensitive
                    )
                    if user_property is not None:
                        _add_value(user_properties, *user_property)
            elif num == 4:
                val = _scalar(field)
                if isinstance(val, int):
                    upload_timestamp_millis = val
            elif num == 5:
                resettable_device_id = str(_scalar(field))
            elif num == 6:
                device_model = str(_scalar(field))
            elif num == 7:
                os_version = str(_scalar(field))
            elif num == 8:
                app_version = str(_scalar(field))
            elif num == 9:
                val = _scalar(field)
                if isinstance(val, int):
                    gmp_version = val
                else:
                    with contextlib.suppress(ValueError, TypeError):
                        gmp_version = int(str(val))
            elif num == 10:
                app_store = str(_scalar(field))
            elif num == 11:
                gmp_app_id = str(_scalar(field))
            elif num == 12:
                app_id = str(_scalar(field))
            elif num == 13:
                app_instance_id = str(_scalar(field))
            elif num == 14:
                firebase_instance_id = str(_scalar(field))
            elif num == 16:
                val = _scalar(field)
                if isinstance(val, int):
                    bundle_sequential_index = val
            elif num == 17:
                bundle_platform = str(_scalar(field))
            elif num == 18:
                user_default_language = str(_scalar(field))
            elif num == 19:
                val = _scalar(field)
                if isinstance(val, int):
                    time_zone_offset_minutes = val
            elif num == 21:
                val = _scalar(field)
                if isinstance(val, int):
                    start_timestamp_millis = val
            elif num == 22:
                val = _scalar(field)
                if isinstance(val, int):
                    end_timestamp_millis = val
            elif num == 23:
                val = _scalar(field)
                if isinstance(val, int):
                    prev_bundle_start_timestamp_millis = val
            elif num == 24:
                val = _scalar(field)
                if isinstance(val, int):
                    prev_bundle_end_timestamp_millis = val
            elif num == 25:
                val = _scalar(field)
                if isinstance(val, int):
                    app_version_major = val
            elif num == 26:
                val = _scalar(field)
                if isinstance(val, int):
                    app_version_minor = val
            elif num == 27:
                val = _scalar(field)
                if isinstance(val, int):
                    app_version_patch = val
            elif num == 28:
                val = _scalar(field)
                if isinstance(val, int):
                    ad_services_version = val
            elif num == 30:
                consent_signals = str(_scalar(field))
            elif num == 34:
                val = _scalar(field)
                if isinstance(val, int):
                    dynamite_version = val
            elif num == 39:
                val = _scalar(field)
                if isinstance(val, int):
                    delivery_index = val
            elif num == 42:
                val = _scalar(field)
                if isinstance(val, int):
                    batching_timestamp_millis = val
            elif num == 43:
                val = _scalar(field)
                if isinstance(val, int):
                    config_version = val
        except ProtobufDecodeError as error:
            _warn(warnings, f"could not decode bundle field {field.number}: {error}")

    resolved_platform = bundle_platform or default_platform
    if consent_signals:
        consent["consent_signals"] = consent_signals

    # Extract session ID and session number from user properties or events
    session_id = (
        user_properties.get("ga_session_id")
        or user_properties.get("firebase_session_id")
        or user_properties.get("_sid")
    )
    session_num = (
        user_properties.get("ga_session_number")
        or user_properties.get("firebase_session_number")
        or user_properties.get("_sno")
    )

    # Populate shared metadata dictionary
    def _set_shared(key: str, val: Any) -> None:
        if val is not None:
            shared[key] = val

    _set_shared("protocol_version", protocol_version)
    _set_shared("ad_services_version", ad_services_version)
    _set_shared("app_id", app_id)
    _set_shared("app_instance_id", app_instance_id)
    _set_shared("app_store", app_store)
    _set_shared("app_version", app_version)
    _set_shared("app_version_major", app_version_major)
    _set_shared("app_version_minor", app_version_minor)
    _set_shared("app_version_patch", app_version_patch)
    _set_shared("batching_timestamp_millis", batching_timestamp_millis)
    _set_shared("bundle_sequential_index", bundle_sequential_index)
    _set_shared("config_version", config_version)
    _set_shared("delivery_index", delivery_index)
    _set_shared("device_model", device_model)
    _set_shared("dynamite_version", dynamite_version)
    _set_shared("end_timestamp_millis", end_timestamp_millis)
    _set_shared("firebase_instance_id", firebase_instance_id)
    _set_shared("gmp_app_id", gmp_app_id)
    _set_shared("gmp_version", gmp_version)
    _set_shared("os_version", os_version)
    _set_shared("platform", resolved_platform)
    _set_shared("resettable_device_id", resettable_device_id)
    _set_shared("start_timestamp_millis", start_timestamp_millis)
    _set_shared("time_zone_offset_minutes", time_zone_offset_minutes)
    _set_shared("upload_timestamp_millis", upload_timestamp_millis)
    _set_shared("user_default_language", user_default_language)
    _set_shared("previous_bundle_start_timestamp_millis", prev_bundle_start_timestamp_millis)
    _set_shared("previous_bundle_end_timestamp_millis", prev_bundle_end_timestamp_millis)
    _set_shared("consent_signals", consent_signals)

    # Attach bundle context and system parameters to each event
    for event in events:
        event["appId"] = app_id
        ev_params = event.get("parameters", {})
        ev_session_id = ev_params.get("_sid") or ev_params.get("ga_session_id") or session_id
        ev_session_num = ev_params.get("_sno") or ev_params.get("ga_session_number") or session_num
        if ev_session_id is not None:
            event["sessionId"] = ev_session_id
        if ev_session_num is not None:
            event["sessionNum"] = ev_session_num

        # Separate system parameters
        system_params: dict[str, Any] = {}
        for p_key, p_val in ev_params.items():
            if _is_system_param(p_key):
                system_params[p_key] = p_val
        event["systemParameters"] = system_params
        event["userProperties"] = user_properties

    _collect_consent(user_properties, consent)
    return {
        "appId": app_id,
        "appInstanceId": app_instance_id,
        "firebaseInstanceId": firebase_instance_id,
        "gmpAppId": gmp_app_id,
        "gmpVersion": gmp_version,
        "appVersion": app_version,
        "platform": resolved_platform,
        "osVersion": os_version,
        "deviceModel": device_model,
        "sessionId": session_id,
        "sessionNum": session_num,
        "shared": shared,
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

    decoded_content = any(
        bundle["events"] or bundle["userProperties"] for bundle in bundles
    )
    if not decoded_content:
        _warn(warnings, "Bundles contained no supported events or user properties")
    status = "partial" if warnings else "decoded"
    return status, platform, bundles, warnings
