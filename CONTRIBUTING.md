# Contributing

Contributions are welcome. Please open an issue before making a large change so the proposed behavior can be discussed.

## Development

1. Install Node.js 22 LTS or newer.
2. Run `npm ci`.
3. Run `npm start` for local development.
4. Before opening a pull request, run `npm run check` and `npm test`.

## Supporting another Jungle display

The screen size is a user setting and does not need a code change. If a compatible display uses another USB VID/PID, add it to `src/device-profiles.json` and include the detected port information in the pull request.

Do not include vendor binaries, copyrighted assets, personal paths, user settings, or hardware serial numbers in commits.