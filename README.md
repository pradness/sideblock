# SideBlock

SideBlock is a Chrome Manifest V3 extension that opens websites inside the side panel and applies a lightweight filter list based on uBlock-style filter sources.

## Features

- Browse sites inside the side panel.
- Switch between desktop and mobile view.
- Toggle the filter list on and off from the toolbar.
- Restore the last opened URL and view mode.
- Uses JetBrains Mono and a minimal AMOLED-black UI.

## Install locally

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this cloned folder: `sideblock`.

## Project structure

- `manifest.json` - extension manifest and permissions.
- `background.js` - filter fetching, rule conversion, and session rule management.
- `sidepanel.html` - side panel markup.
- `sidepanel.css` - side panel styling.
- `sidepanel.js` - UI behavior and state handling.
- `content.js` - page-level content script.
- `mobile_ua_rules.json` - mobile user-agent rule data.
- `icons/` - toolbar and extension icons.

## Notes

- The extension uses `declarativeNetRequest` session rules for blocking.
- The filter list can be turned off from the toolbar without removing saved state.
- If you update the icon set, keep `manifest.json` aligned with the available files in `icons/`.

## Development

There is no build step. Edit the files directly and reload the unpacked extension in Chrome to test changes.
