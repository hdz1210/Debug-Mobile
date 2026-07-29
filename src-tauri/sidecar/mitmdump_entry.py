"""Restricted mitmdump entry point for App Network Debugger.

The desktop application uses an explicit proxy and does not support mitmproxy's
Windows transparent or local-capture modes. Stubbing the Windows platform
module lets the packaged sidecar omit the unused WinDivert driver packages.
"""

from __future__ import annotations

import sys
import types


class UnsupportedTransparentResolver:
    def setup(self) -> None:
        raise RuntimeError(
            "Transparent proxy mode is not included in App Network Debugger."
        )

    def original_addr(self, _socket: object) -> tuple[str, int]:
        raise RuntimeError(
            "Transparent proxy mode is not included in App Network Debugger."
        )


windows_platform_stub = types.ModuleType("mitmproxy.platform.windows")
windows_platform_stub.Resolver = UnsupportedTransparentResolver
sys.modules["mitmproxy.platform.windows"] = windows_platform_stub


def unsupported_redirector_path() -> None:
    raise RuntimeError(
        "Windows local-capture mode is not included in App Network Debugger."
    )


windows_redirector_stub = types.ModuleType("mitmproxy_windows")
windows_redirector_stub.executable_path = unsupported_redirector_path
sys.modules["mitmproxy_windows"] = windows_redirector_stub

from mitmproxy.tools.main import mitmdump  # noqa: E402


if __name__ == "__main__":
    mitmdump()
