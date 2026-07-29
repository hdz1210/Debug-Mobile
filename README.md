# App Network Debugger

## Lợi ích

- Bắt request từ ứng dụng mobile qua HTTP, HTTPS và WebSocket.
- Xem URL, method, status, headers, query, payload, response và thời gian xử lý.
- Tự động nhận diện Local IP của máy tính để cấu hình proxy trên điện thoại.
- Lưu lịch sử capture để mở lại khi cần.
- Che các header và trường dữ liệu nhạy cảm trước khi hiển thị.
- Dữ liệu được lưu cục bộ trên máy tính.
- Bản Windows đã đóng gói sẵn mitmproxy, không cần cài Python.

## Hướng dẫn onboard

1. Kết nối điện thoại và máy tính vào cùng một mạng Wi‑Fi.
2. Mở App Network Debugger, chọn **LAN devices** rồi nhấn
   **Start capture**.
3. Ghi lại **Host / IP** và **Port** đang hiển thị trong ứng dụng.
4. Trên điện thoại, mở cấu hình của mạng Wi‑Fi hiện tại:
   **Proxy → Manual/Thủ công**.
5. Nhập:
   - **Server/Host:** Local IP hiển thị trên desktop app.
   - **Port:** mặc định là `8080`.
   - **Authentication/Xác thực:** tắt.
6. Trên điện thoại, mở `http://mitm.it` và cài chứng chỉ mitmproxy.
7. Nếu dùng iPhone/iPad, vào:
   **Settings → General → About → Certificate Trust Settings**, sau đó bật
   tin cậy đầy đủ cho chứng chỉ mitmproxy.
8. Mở ứng dụng cần kiểm tra và thao tác bình thường. Request sẽ xuất hiện trên
   desktop; chọn một request để xem payload và response.
9. Khi hoàn tất, nhấn **Stop** và chuyển Proxy của Wi‑Fi trên điện thoại về
   **Off/Tắt**.

Nếu đổi Wi‑Fi, hãy refresh Local IP trong desktop app và cập nhật lại Server
trên điện thoại. Một số ứng dụng bỏ qua proxy hệ thống hoặc dùng certificate
pinning nên không thể capture; dự án không bypass certificate pinning.

Chỉ capture thiết bị và lưu lượng mà bạn sở hữu hoặc được phép kiểm tra.

## Installer

Windows x64:

- [Tải App Network Debugger v0.1.0 (.exe)](https://github.com/hdz1210/Debug-Mobile/releases/download/v0.1.0/App-Network-Debugger_0.1.0_windows-x64-setup.exe)
- [Tải bản MSI](https://github.com/hdz1210/Debug-Mobile/releases/download/v0.1.0/App-Network-Debugger_0.1.0_windows-x64.msi)
- [Kiểm tra SHA-256](https://github.com/hdz1210/Debug-Mobile/releases/download/v0.1.0/SHA256SUMS.txt)
- [Xem trang release](https://github.com/hdz1210/Debug-Mobile/releases/tag/v0.1.0)

Installer hiện chưa ký số nên Windows SmartScreen có thể hiển thị
**Unknown publisher**. SHA-256 của file `.exe`:

```text
5b737481b23807b7701ee761106b996b5751f29e2bf5cd873641f1246d1c1de4
```
