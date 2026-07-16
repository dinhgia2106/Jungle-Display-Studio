# Jungle Display Studio

An open-source Electron workspace for compatible Jungle Leopard USB Serial displays.

Each discovered display keeps its own USB port, resolution, brightness, rotation and canvas layout.

## Features

- Scan compatible Jungle displays from the Overview and choose which one to connect.
- Keep separate profiles and layouts for multiple saved displays.
- Reset a display to the profile captured when it was first discovered.
- Freeform canvas editor with drag, resize, exact position and layer controls.
- Shift-click multi-selection with edge/center alignment and equal horizontal or vertical gaps.
- Context-aware properties show only the controls supported by the selected element.
- Clock, date, text, CPU, RAM, GPU, uptime, tasks, shape, image, local video and YouTube elements.
- Video and YouTube are resizable canvas elements instead of forced full-screen modes.
- Independent label and content typography per element, including color, font size and outline color/width, with cross-element Copy/Paste style; plus solid or transparent backgrounds, opacity, corner radius, media fit and up to 400% media zoom.
- Canvas background color and optional background image.
- English by default, with a Vietnamese interface.
- Windows login launch with an optional hidden start, auto-connect, reconnect delay and preview-on-launch.
- Closing the control window keeps streaming in the system tray; the tray menu can reopen Preview or quit fully.
- YouTube embeds retry when the player frame fails to load or reports an error, without periodically restarting a loaded video.
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

    git tag v1.3.2
    git push origin v1.3.2

The workflow in **.github/workflows/release.yml** validates, builds and attaches both installers to a GitHub Release.

Unsigned installers can trigger Microsoft Defender SmartScreen. Code signing is optional for building and sharing the app, but a trusted signing certificate is recommended for broad public distribution.

## Privacy

No telemetry, analytics or remote settings service is included. YouTube elements load YouTube embeds and therefore require Internet access and follow YouTube policies.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). This project is available under the [MIT License](LICENSE).