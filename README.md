# App Network Debugger

## Benefits

- Capture HTTP, HTTPS, and WebSocket requests from mobile applications.
- Inspect URLs, methods, status codes, headers, queries, payloads, responses,
  and timing.
- Automatically detect the computer's local IP for easy mobile proxy setup.
- Save capture history and reopen previous sessions.
- Redact sensitive headers and data fields before displaying them.
- Keep captured data locally on the computer.
- Open a persistent diagnostic log from the app when capture or networking
  fails.
- Use the packaged Windows application without installing Python or mitmproxy.

## Onboarding

1. Connect the phone and computer to the same Wi-Fi network.
2. Open App Network Debugger, select **LAN devices**, and click
   **Start capture**.
3. Note the **Host / IP** and **Port** displayed in the desktop application.
4. Open the current Wi-Fi network settings on the phone and select
   **Proxy → Manual**.
5. Enter:
   - **Server/Host:** the local IP displayed in the desktop application.
   - **Port:** `8080` by default.
   - **Authentication:** off.
6. On the phone, open `http://mitm.it` and install the mitmproxy certificate.
7. On iPhone or iPad, open
   **Settings → General → About → Certificate Trust Settings**, then enable
   full trust for the mitmproxy certificate.
8. Open the mobile application you want to inspect and use it normally.
   Requests will appear in the desktop application; select one to inspect its
   payload and response.
9. When finished, click **Stop** and set the phone's Wi-Fi proxy back to
   **Off**.

If the app reports an error, click **Logs** in the toolbar or **Open logs** in
the error banner. The app opens `app-network-debugger.log` in Windows File
Explorer. Review the file before sharing it because diagnostic errors can
contain local paths, hosts, or request URLs.

After changing Wi-Fi networks, refresh the local IP in the desktop application
and update the proxy server on the phone. Some applications ignore the system
proxy or use certificate pinning and therefore cannot be captured. This project
does not bypass certificate pinning.

Only inspect devices and network traffic that you own or are explicitly
authorized to test.

## Installer

Windows x64:

- [Download App Network Debugger v0.1.2 (.exe)](https://github.com/hdz1210/Debug-Mobile/releases/download/v0.1.2/App-Network-Debugger_0.1.2_windows-x64-setup.exe)
- [Download the MSI package](https://github.com/hdz1210/Debug-Mobile/releases/download/v0.1.2/App-Network-Debugger_0.1.2_windows-x64.msi)
- [Verify SHA-256 checksums](https://github.com/hdz1210/Debug-Mobile/releases/download/v0.1.2/SHA256SUMS.txt)
- [View the release page](https://github.com/hdz1210/Debug-Mobile/releases/tag/v0.1.2)

The installer is not currently code-signed, so Windows SmartScreen may display
an **Unknown publisher** warning.
