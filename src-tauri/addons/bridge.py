from __future__ import annotations

import base64
import json
from typing import Any
from urllib.parse import parse_qsl, urlencode

from mitmproxy import ctx, http

PREFIX = "APPDBG_EVENT:"
DEFAULT_BODY_LIMIT = 1_000_000
MAX_CONFIGURED_BODY_LIMIT = 100_000_000
REDACTED_VALUE = "••••••••"

_SENSITIVE_HEADERS = {
    "authorization",
    "cookie",
    "proxy-authorization",
    "set-cookie",
    "x-api-key",
    "x-auth-token",
}

_SENSITIVE_KEYS = {
    "access_token",
    "api_key",
    "authorization",
    "client_secret",
    "cookie",
    "passcode",
    "passwd",
    "password",
    "refresh_token",
    "secret",
    "token",
}

_TEXT_MEDIA_TYPES = {
    "application/graphql",
    "application/javascript",
    "application/json",
    "application/sql",
    "application/x-javascript",
    "application/x-ndjson",
    "application/x-www-form-urlencoded",
    "application/xhtml+xml",
    "application/xml",
    "image/svg+xml",
}


def load(loader: Any) -> None:
    loader.add_option(
        name="appdbg_body_limit",
        typespec=int,
        default=DEFAULT_BODY_LIMIT,
        help="Maximum decoded request or response body bytes emitted by App Network Debugger.",
    )
    loader.add_option(
        name="appdbg_redact_sensitive",
        typespec=bool,
        default=True,
        help="Redact common credential headers and structured body fields.",
    )


def emit(payload: dict[str, Any]) -> None:
    message = PREFIX + json.dumps(
        payload,
        # Keep the stdout protocol ASCII-only. On Windows, a redirected Python
        # stdout commonly uses cp1252, which would otherwise encode characters
        # such as the redaction bullets into bytes that are not valid UTF-8.
        ensure_ascii=True,
        separators=(",", ":"),
    )
    try:
        print(message, flush=True)
    except BrokenPipeError:
        # The desktop backend may close stdout while mitmdump is shutting down.
        return


def _configured_redaction() -> bool:
    try:
        return bool(ctx.options.appdbg_redact_sensitive)
    except (AttributeError, RuntimeError):
        return True


def serialize_headers(
    headers: http.Headers,
    redact_sensitive: bool | None = None,
) -> list[list[str]]:
    should_redact = (
        _configured_redaction() if redact_sensitive is None else redact_sensitive
    )
    return [
        [
            name,
            REDACTED_VALUE
            if should_redact and name.lower() in _SENSITIVE_HEADERS
            else value,
        ]
        for name, value in headers.items(multi=True)
    ]


def _configured_body_limit() -> int:
    try:
        configured = int(ctx.options.appdbg_body_limit)
    except (AttributeError, RuntimeError, TypeError, ValueError):
        return DEFAULT_BODY_LIMIT

    if configured <= 0:
        return DEFAULT_BODY_LIMIT

    return min(configured, MAX_CONFIGURED_BODY_LIMIT)


def _media_type(content_type: str) -> str:
    return content_type.partition(";")[0].strip().lower()


def _is_textual(content_type: str) -> bool:
    media_type = _media_type(content_type)
    return (
        media_type.startswith("text/")
        or media_type in _TEXT_MEDIA_TYPES
        or media_type.endswith("+json")
        or media_type.endswith("+xml")
    )


def _charset(content_type: str) -> str:
    for parameter in content_type.split(";")[1:]:
        name, separator, value = parameter.partition("=")
        if separator and name.strip().lower() == "charset":
            return value.strip().strip("\"'") or "utf-8"
    return "utf-8"


def _decoded_content(message: http.Message, raw: bytes) -> bytes:
    try:
        decoded = message.get_content(strict=False)
    except (ValueError, TypeError):
        decoded = None
    return decoded if decoded is not None else raw


def _redact_json_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: (
                REDACTED_VALUE
                if str(key).lower() in _SENSITIVE_KEYS
                else _redact_json_value(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_json_value(item) for item in value]
    return value


def _redact_text(text: str, content_type: str) -> str:
    media_type = _media_type(content_type)
    if "json" in media_type or media_type.endswith("+json"):
        try:
            parsed = json.loads(text)
        except (json.JSONDecodeError, TypeError):
            return "[Invalid JSON hidden because sensitive-data redaction is enabled]"
        return json.dumps(
            _redact_json_value(parsed),
            ensure_ascii=False,
            separators=(",", ":"),
        )

    if media_type == "application/x-www-form-urlencoded":
        entries = [
            (
                key,
                REDACTED_VALUE if key.lower() in _SENSITIVE_KEYS else value,
            )
            for key, value in parse_qsl(text, keep_blank_values=True)
        ]
        return urlencode(entries)

    return text


def serialize_body(
    message: http.Message | None,
    body_limit: int | None = None,
    redact_sensitive: bool | None = None,
) -> dict[str, Any] | None:
    if message is None or message.raw_content is None:
        return None

    raw = message.raw_content
    content_type = message.headers.get("content-type", "")
    content = _decoded_content(message, raw)
    original_size = len(content)
    limit = body_limit if body_limit is not None else _configured_body_limit()
    limit = max(1, min(limit, MAX_CONFIGURED_BODY_LIMIT))
    should_redact = (
        _configured_redaction() if redact_sensitive is None else redact_sensitive
    )

    if _is_textual(content_type):
        try:
            text = content.decode(_charset(content_type), errors="replace")
        except LookupError:
            text = content.decode("utf-8", errors="replace")

        if should_redact:
            text = _redact_text(text, content_type)

        encoded_text = text.encode("utf-8")
        limited_text = encoded_text[:limit].decode("utf-8", errors="replace")

        return {
            "format": "text",
            "contentType": content_type,
            "data": limited_text,
            "size": original_size,
            "truncated": original_size > limit or len(encoded_text) > limit,
        }

    limited = content[:limit]
    return {
        "format": "base64",
        "contentType": content_type,
        "data": base64.b64encode(limited).decode("ascii"),
        "size": original_size,
        "truncated": original_size > limit,
    }


def requestheaders(flow: http.HTTPFlow) -> None:
    request = flow.request
    emit(
        {
            "event": "request_started",
            "flowId": flow.id,
            "method": request.method,
            "url": request.pretty_url,
            "host": request.host,
            "port": request.port,
            "scheme": request.scheme,
            "httpVersion": request.http_version,
            "headers": serialize_headers(request.headers),
            "startedAt": request.timestamp_start,
        }
    )


def request(flow: http.HTTPFlow) -> None:
    emit(
        {
            "event": "request_completed",
            "flowId": flow.id,
            "body": serialize_body(flow.request),
            "endedAt": flow.request.timestamp_end,
        }
    )


def responseheaders(flow: http.HTTPFlow) -> None:
    response = flow.response
    if response is None:
        return

    emit(
        {
            "event": "response_started",
            "flowId": flow.id,
            "statusCode": response.status_code,
            "reason": response.reason,
            "httpVersion": response.http_version,
            "headers": serialize_headers(response.headers),
            "startedAt": response.timestamp_start,
        }
    )


def response(flow: http.HTTPFlow) -> None:
    captured_response = flow.response
    if captured_response is None:
        return

    started_at = flow.request.timestamp_start
    ended_at = captured_response.timestamp_end
    duration_ms = None
    if started_at is not None and ended_at is not None:
        duration_ms = round((ended_at - started_at) * 1000, 2)

    emit(
        {
            "event": "response_completed",
            "flowId": flow.id,
            "statusCode": captured_response.status_code,
            "body": serialize_body(captured_response),
            "endedAt": ended_at,
            "durationMs": duration_ms,
        }
    )


def error(flow: http.HTTPFlow) -> None:
    emit(
        {
            "event": "flow_error",
            "flowId": flow.id,
            "message": str(flow.error) if flow.error else "Unknown error",
        }
    )


def websocket_message(flow: http.HTTPFlow) -> None:
    websocket = flow.websocket
    if websocket is None or not websocket.messages:
        return

    message = websocket.messages[-1]
    if message.is_text:
        data = message.content.decode("utf-8", errors="replace")
        if _configured_redaction():
            try:
                parsed_data = json.loads(data)
            except json.JSONDecodeError:
                pass
            else:
                data = json.dumps(
                    _redact_json_value(parsed_data),
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
        data_format = "text"
    else:
        data = base64.b64encode(message.content).decode("ascii")
        data_format = "base64"

    emit(
        {
            "event": "websocket_message",
            "flowId": flow.id,
            "direction": (
                "client_to_server" if message.from_client else "server_to_client"
            ),
            "format": data_format,
            "data": data,
            "size": len(message.content),
            "timestamp": message.timestamp,
        }
    )
