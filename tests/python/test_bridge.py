from __future__ import annotations

import contextlib
import io
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest import mock

from mitmproxy import http

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ADDON_DIRECTORY = PROJECT_ROOT / "src-tauri" / "addons"
sys.path.insert(0, str(ADDON_DIRECTORY))

import bridge  # noqa: E402


def emitted_event(callback: Any, flow: Any) -> dict[str, Any]:
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        callback(flow)

    line = output.getvalue().strip()
    if not line.startswith(bridge.PREFIX):
        raise AssertionError(f"missing bridge prefix: {line!r}")
    return json.loads(line.removeprefix(bridge.PREFIX))


class BridgeTests(unittest.TestCase):
    def test_emit_protocol_is_ascii_safe_and_preserves_unicode(self) -> None:
        payload = {
            "event": "test",
            "redacted": bridge.REDACTED_VALUE,
            "label": "Tiếng Việt",
        }
        output = io.StringIO()

        with contextlib.redirect_stdout(output):
            bridge.emit(payload)

        line = output.getvalue().strip()
        line.encode("ascii")
        self.assertEqual(
            json.loads(line.removeprefix(bridge.PREFIX)),
            payload,
        )

    def test_load_registers_configurable_body_limit(self) -> None:
        loader = SimpleNamespace(options=[])
        loader.add_option = lambda **kwargs: loader.options.append(kwargs)

        bridge.load(loader)

        self.assertEqual(loader.options[0]["name"], "appdbg_body_limit")
        self.assertEqual(loader.options[0]["default"], 1_000_000)
        self.assertEqual(loader.options[1]["name"], "appdbg_redact_sensitive")
        self.assertTrue(loader.options[1]["default"])
        self.assertEqual(loader.options[2]["name"], "appdbg_capture_state_file")
        self.assertEqual(loader.options[2]["default"], "")

    def test_paused_capture_suppresses_new_flow_events(self) -> None:
        request = http.Request.make("GET", "https://api.example.com/items")
        flow = SimpleNamespace(id="paused-flow", request=request, metadata={})
        output = io.StringIO()

        with (
            mock.patch.object(bridge, "_capture_enabled", return_value=False),
            contextlib.redirect_stdout(output),
        ):
            bridge.requestheaders(flow)
            bridge.request(flow)

        self.assertEqual(output.getvalue(), "")
        self.assertFalse(flow.metadata[bridge._CAPTURED_METADATA_KEY])

    def test_request_started_preserves_duplicate_headers(self) -> None:
        headers = http.Headers(
            [
                (b"content-type", b"application/json"),
                (b"x-trace", b"first"),
                (b"x-trace", b"second"),
            ]
        )
        request = http.Request.make(
            "POST",
            "https://api.example.com/login",
            content=b'{"email":"test@example.com"}',
            headers=headers,
        )
        flow = SimpleNamespace(id="flow-1", request=request)

        event = emitted_event(bridge.requestheaders, flow)

        self.assertEqual(event["event"], "request_started")
        self.assertEqual(event["flowId"], "flow-1")
        self.assertEqual(
            [entry for entry in event["headers"] if entry[0] == "x-trace"],
            [["x-trace", "first"], ["x-trace", "second"]],
        )

    def test_json_body_is_emitted_as_text(self) -> None:
        request = http.Request.make(
            "POST",
            "https://api.example.com/login",
            content='{"password":"secret"}',
            headers={"content-type": "application/json; charset=utf-8"},
        )

        body = bridge.serialize_body(request, body_limit=1_000)

        self.assertIsNotNone(body)
        self.assertEqual(body["format"], "text")
        self.assertEqual(body["data"], '{"password":"••••••••"}')
        self.assertFalse(body["truncated"])

    def test_sensitive_headers_and_form_fields_are_redacted(self) -> None:
        headers = http.Headers(
            [
                (b"authorization", b"Bearer secret"),
                (b"x-trace", b"safe"),
            ]
        )
        self.assertEqual(
            bridge.serialize_headers(headers),
            [["authorization", "••••••••"], ["x-trace", "safe"]],
        )

        request = http.Request.make(
            "POST",
            "https://api.example.com/login",
            content="email=test%40example.com&token=secret",
            headers={"content-type": "application/x-www-form-urlencoded"},
        )
        body = bridge.serialize_body(request, body_limit=1_000)
        self.assertEqual(
            body["data"],
            "email=test%40example.com&token=%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A2"
            "%E2%80%A2%E2%80%A2%E2%80%A2%E2%80%A2",
        )

    def test_binary_body_is_base64_encoded(self) -> None:
        request = http.Request.make(
            "POST",
            "https://api.example.com/upload",
            content=b"\x00\x01\x02\xff",
            headers={"content-type": "application/octet-stream"},
        )

        body = bridge.serialize_body(request, body_limit=1_000)

        self.assertIsNotNone(body)
        self.assertEqual(body["format"], "base64")
        self.assertEqual(body["data"], "AAEC/w==")
        self.assertEqual(body["size"], 4)

    def test_body_limit_is_applied_before_encoding(self) -> None:
        response = http.Response.make(
            200,
            content=b"abcdefghij",
            headers={"content-type": "text/plain"},
        )

        body = bridge.serialize_body(response, body_limit=4)

        self.assertIsNotNone(body)
        self.assertEqual(body["data"], "abcd")
        self.assertEqual(body["size"], 10)
        self.assertTrue(body["truncated"])

    def test_missing_response_does_not_emit_or_crash(self) -> None:
        flow = SimpleNamespace(id="flow-2", response=None)
        output = io.StringIO()

        with contextlib.redirect_stdout(output):
            bridge.responseheaders(flow)
            bridge.response(flow)

        self.assertEqual(output.getvalue(), "")

    def test_response_completed_has_duration(self) -> None:
        request = http.Request.make("GET", "https://api.example.com/items")
        response = http.Response.make(
            200,
            content='{"items":[]}',
            headers={"content-type": "application/json"},
        )
        request.timestamp_start = 100.0
        response.timestamp_end = 100.25
        flow = SimpleNamespace(id="flow-3", request=request, response=response)

        event = emitted_event(bridge.response, flow)

        self.assertEqual(event["durationMs"], 250.0)
        self.assertEqual(event["body"]["data"], '{"items":[]}')


if __name__ == "__main__":
    unittest.main()
