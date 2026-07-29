# Third-party notices

App Network Debugger includes a restricted `mitmdump.exe` sidecar built from
mitmproxy 12.2.3 and its pinned Python dependencies. The sidecar supports the
explicit HTTP proxy mode used by the application.

- Project: mitmproxy
- Source: https://github.com/mitmproxy/mitmproxy/tree/v12.2.3
- Build dependencies: `requirements-release.txt`
- Entrypoint: `src-tauri/sidecar/mitmdump_entry.py`
- License: MIT; the full license text is bundled as
  `licenses/mitmproxy-LICENSE.txt`.

Transparent and local-capture modes are not used by App Network Debugger. The
Windows WinDivert modules required only by those modes (`pydivert` and
`mitmproxy-windows`) are excluded from the produced sidecar.

The sidecar is bundled with PyInstaller 6.19.0.

- Project: PyInstaller
- Source: https://github.com/pyinstaller/pyinstaller/tree/v6.19.0
- License: GPL-2.0-or-later with the PyInstaller Bootloader Exception; the full
  licensing terms are bundled as `licenses/PyInstaller-COPYING.txt`.

The PyInstaller Bootloader Exception permits the compiled bootloader to be
embedded in and distributed with this application. The application itself
remains licensed under the MIT License.
