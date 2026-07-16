# Jungle Display Studio

An open-source Electron workspace for compatible Jungle Leopard USB Serial displays.

The app is not limited to AC-02. Each discovered display keeps its own USB port, resolution, brightness, rotation and canvas layout.

## Features

- Scan compatible Jungle displays from the Overview and choose which one to connect.
- Keep separate profiles and layouts for multiple saved displays.
- Reset a display to the profile captured when it was first discovered.
- Freeform canvas editor with drag, resize, exact position and layer controls.
- Clock, date, text, CPU, RAM, GPU, uptime, tasks, shape, image, local video and YouTube elements.
- Video and YouTube are resizable canvas elements instead of forced full-screen modes.
- Per-element text color, background color, opacity, font size, corner radius and media fit.
- Canvas background color and optional background image.
- English by default, with a Vietnamese interface.
- Windows login launch, auto-connect, reconnect delay and preview-on-launch.
- Local settings only; no telemetry or cloud account.

The USB driver streams to one selected Jungle display at a time. Switching the active display disconnects the previous stream so frames cannot be sent to the wrong device.

## Supported hardware

| Vendor ID | Product ID | Protocol |
| --- | --- | --- |
| 33C3 | 7788 | Jungle USB Serial |
| 33C3 | 7792 | Jungle USB Serial |

Compatible USB identifiers and fallback device profiles live in **src/device-profiles.json**. Screen size is user-configurable. Packet framing, baud rate and command bytes are hardware-protocol constants.

Some USB serial variants do not expose their physical resolution. In that case, “Reset detected profile” uses the open fallback profile table. Contributors can add verified device defaults without changing the editor.

Close the vendor display app before connecting if it is holding the same COM port. Jungle Display Studio does not configure or stop unrelated displays or vendor software.

## Run from source

Use Node.js 22 LTS or newer:

    npm ci
    npm start

## Validate

    npm run check
    npm test

The test suite covers packet framing, display profiles, workspace migration, canvas defaults and element bounds.

## Build Windows installers

    npm run dist:win

The generated x64 NSIS EXE and MSI files are written to **dist/**.

## Publish a GitHub Release

Push a version tag matching package.json:

    git tag v1.2.0
    git push origin v1.2.0

The workflow in **.github/workflows/release.yml** validates, builds and attaches both installers to a GitHub Release.

Unsigned installers can trigger Microsoft Defender SmartScreen. Code signing is optional for building and sharing the app, but a trusted signing certificate is recommended for broad public distribution.

## Privacy

No telemetry, analytics or remote settings service is included. YouTube elements load YouTube embeds and therefore require Internet access and follow YouTube policies.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This project is available under the [MIT License](LICENSE).

---

## Tiếng Việt

Jungle Display Studio là workspace mã nguồn mở cho các màn hình Jungle Leopard tương thích giao thức USB Serial. Mỗi màn hình lưu riêng cổng USB, độ phân giải, độ sáng và canvas.

Trong **Tổng quan**, người dùng quét và chọn màn hình cần kết nối. Trong **Canvas**, có thể thêm, kéo, đổi kích thước và xếp lớp đồng hồ, CPU, RAM, GPU, công việc, chữ, hình ảnh, video cục bộ hoặc YouTube. Video chỉ là một element nên không còn bắt buộc chiếm toàn màn hình.

Nút reset profile khôi phục cấu hình đã ghi nhận khi quét. Nếu thiết bị USB không báo kích thước, ứng dụng dùng profile fallback trong file cấu hình mở. Ứng dụng không thu thập dữ liệu; settings và công việc chỉ lưu cục bộ.