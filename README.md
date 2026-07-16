# Jungle Display Studio

An open-source Electron dashboard for compatible Jungle Leopard USB Serial displays.

The app is not limited to AC-02. Users can select a common resolution preset or enter the native width and height of their own compatible Jungle display.

## Features

- English by default, with a full Vietnamese interface.
- Configurable landscape, square, portrait, ultra-wide and custom resolutions.
- Local video, YouTube, system dashboard and multi-item task list modes.
- Per-display name, brightness, 0°/180° rotation and JPEG frame limit.
- Windows login launch, startup auto-connect, delayed reconnect and preview-on-launch.
- Automatic detection of compatible USB Serial devices listed in **src/device-profiles.json**.
- Settings and tasks are stored only in Electron's local user-data directory.

## Supported hardware

The current device table contains these USB identifiers:

| Vendor ID | Product ID | Protocol |
| --- | --- | --- |
| 33C3 | 7788 | Jungle USB Serial |
| 33C3 | 7792 | Jungle USB Serial |

Screen dimensions are not hardcoded. A compatible display with another USB identifier can be added in **src/device-profiles.json**. The packet framing and commands in the driver are hardware-protocol constants and must remain exact.

Close the vendor display app before connecting if it is holding the same COM port. Jungle Display Studio does not configure or stop unrelated displays or vendor software.

## Run from source

Use Node.js 22 LTS or newer:

    npm ci
    npm start

Open **Display**, select a preset or enter the panel's native width and height, then save and preview the layout.

## Build Windows installers

    npm ci
    npm run check
    npm test
    npm run dist:win

The generated x64 NSIS .exe and Windows Installer .msi files are written to **dist/**.

## Publish a GitHub Release

The workflow at **.github/workflows/release.yml** builds and publishes both installers when a version tag is pushed:

    git tag v1.1.0
    git push origin v1.1.0

GitHub Actions then creates the Release and attaches the installer files. Keep the tag and package.json version aligned.

Unsigned installers can trigger Microsoft Defender SmartScreen. Code signing is optional for building and sharing the app, but a trusted signing certificate is needed to reduce warnings for broad public distribution.

## Privacy

No telemetry, cloud account, analytics or remote settings service is included. YouTube mode loads the selected YouTube embed in the display window, so that mode requires a network connection and is subject to YouTube's own policies.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This project is available under the [MIT License](LICENSE).

---

## Tiếng Việt

Jungle Display Studio là ứng dụng mã nguồn mở cho các màn hình Jungle Leopard tương thích cùng giao thức USB Serial. Kích thước màn hình không bị cố định theo AC-02: người dùng có thể chọn preset hoặc nhập độ phân giải riêng.

Để chạy từ mã nguồn, dùng Node.js 22 LTS trở lên rồi chạy **npm ci** và **npm start**. Để tạo bộ cài Windows, chạy **npm run dist:win**; file EXE và MSI sẽ nằm trong thư mục **dist**.

Ứng dụng không thu thập dữ liệu. Cài đặt và danh sách công việc chỉ được lưu cục bộ. Chế độ YouTube là phần duy nhất cần tải nội dung Internet.