# PagePulse — Website Change Monitor

A free Chrome extension that monitors webpage elements for text changes and notifies you when something changes. Smart diffs, keyword filters, zero noise.

## Features

- **Element selector** — click any element on any webpage to start monitoring
- **Smart summaries** — "3 new items, 2 removed" instead of raw text walls
- **Keyword filters** — only get notified about changes that match your interests
- **Ignore patterns** — filter out timestamps, point counts, noise with one click
- **Digest mode** — batch notifications into hourly summaries
- **JS rendered mode** — monitor SPAs, React sites, and login-required pages
- **Monitor health** — always know if your monitors are running (Healthy/Stale/Broken)
- **Pause/Resume** — clear status indicators so you always know what's active
- **Dark & light themes**
- **CSV/JSON export**
- **Keyboard shortcuts** — j/k navigate, c check, e export, ? help
- **Shareable monitor links** — share configs with teammates
- **Right-click context menu** — start monitoring from any page
- **Privacy first** — all data stays on your device, no servers, no tracking

## Install

**Chrome Web Store:** [Add to Chrome](https://chromewebstore.google.com/detail/pagepulse)

**Manual:** Clone this repo, run `npm install && npm run build`, then load `dist/` as an unpacked extension in `chrome://extensions/`.

## Development

```bash
npm install          # install dependencies
npm run build        # build to dist/
npm run dev          # build with watch mode
npm test             # run tests (84 tests)
```

## Tech Stack

- Vanilla JS (ES modules)
- Vite (bundler)
- Vitest (testing)
- Chrome Manifest V3
- `diff` npm package for word-level diffs

## Privacy

All data is stored locally on your device using `chrome.storage.local`. No data is sent to any external server. No accounts, no analytics, no tracking. [Full privacy policy](https://nyadzayo.github.io/page-pulse/privacy-policy.html).

## License

MIT
