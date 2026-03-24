# PagePulse — Feature Documentation

## Overview

PagePulse is a free, privacy-first Chrome extension that monitors webpage elements for text changes and notifies users with smart diffs. All data stays on the user's device.

---

## Core Features

### 1. Element Selector
Pick any element on any public webpage to monitor. Click the extension icon, hit "Add Monitor," hover to highlight, click to capture.

- **CSS selector + XPath + text fingerprint** — triple-anchor capture for resilient element matching
- **Blue highlight overlay** with instruction banner and ESC to cancel
- **Per-origin permission** — Chrome prompts once per domain, not blanket access
- **Confirmation toast** — green toast confirms monitor was added with link to dashboard

### 2. Background Monitoring
Monitors check pages on schedule even when tabs are closed. Works as long as Chrome is running.

- **Single batched alarm** — one `pagepulse-tick` alarm per minute, filters due monitors, batches by URL
- **URL deduplication** — multiple monitors on the same page = one fetch
- **Rate limited** — max 10 URLs per tick cycle to prevent resource exhaustion
- **Service worker** — MV3-native, survives browser restarts

### 3. Smart Change Detection
Goes beyond raw text comparison to deliver useful, actionable change information.

- **Word-level diff** — powered by the `diff` npm package's `diffWords()` function
- **List-aware parsing** — detects numbered lists (HN, Reddit, job boards) and reports "3 new items, 2 removed" with titles
- **Whitespace normalization** — ignores meaningless whitespace differences
- **Meaningful change filter** — only records changes that actually matter

### 4. Diff View Modes
Users choose how changes are displayed. Per-monitor setting.

| Mode | Description |
|------|-------------|
| **Summary** (default) | Smart summary: "2 new items: 'Rust Compiler Released', 'AI Breakthrough'" |
| **Detailed** | Full word-level diff with green insertions and red strikethrough deletions |
| **Both** | Summary at top with expandable detailed diff below |

### 5. Keyword Filters
Only get notified about changes that matter. Per-monitor setting.

- Comma-separated keywords: `rust, AI, hiring`
- **List-aware matching** — on list pages (HN), only checks NEW item titles for keywords
- **Smart matching** — on text pages, checks if keyword is genuinely new (in new text but not old)
- **Case-insensitive**
- **Empty = all changes** — no keywords means every change notifies

### 6. Ignore Patterns
Strip noise before comparison using regex. Per-monitor setting.

- **Regex patterns** — one per line, applied to both old and new text before comparison
- **Preset buttons** — one-click add for common noise:
  - Timestamps: `\d+\s*(minutes?|hours?|days?|seconds?)\s*ago`
  - Points: `\d+\s*points?`
  - Comments: `\d+\s*comments?`
- **Silent baseline update** — if only noise changed, baseline updates but no alert fires
- **Invalid regex safe** — bad patterns are silently skipped

### 7. Notifications

#### Instant Mode (default)
Chrome notification fires immediately when a change is detected.
- Shows monitor label and truncated change preview
- Click opens dashboard to the specific monitor's diff view
- Badge count on extension icon shows unread changes
- Clears when popup opens or notification is clicked

#### Digest Mode
Batches changes into one summary notification per hour.
- "PagePulse Digest: 12 changes across 3 monitors"
- Configurable per monitor
- Badge accumulates until digest fires
- Reduces notification noise from 140/day to 1-4/day on dynamic pages

#### Sound
Two-tone ascending chime (C5 → E5) generated via Web Audio API.
- Toggle on/off in dashboard header
- Preview plays when enabling
- Plays on change detection (instant) or digest fire
- No external audio files — generated in code

### 8. Monitor Health Indicator
Users always know if their monitors are working. Visible in dashboard stats grid and sidebar.

| Status | Meaning | Visual |
|--------|---------|--------|
| **Healthy** | All checks passing | Green |
| **Pending** | Never checked yet | Yellow |
| **Stale** | Overdue by 3x interval | Yellow + "Overdue by..." |
| **Flaky** | Recent errors but not broken | Yellow + error count |
| **Broken** | 3+ errors over 24 hours | Red + "Selector not found" |
| **No Access** | Permission revoked | Red |

### 9. Pause / Resume
Prominent controls so users always know monitor state.

- **Amber "Pause" button** in dashboard actions
- **Green "Resume" button** when paused
- **Amber banner** — "This monitor is paused — no checks are running"
- **Sidebar "PAUSED" tag** on inactive monitors
- **Popup toggle** — quick on/off per monitor

### 10. Error Recovery
Tolerant of temporary failures, aggressive on persistent ones.

- **24-hour error window** — only marks broken after 3+ errors spanning 24 hours
- **Retryable** — "Check Now" on broken monitors resets status and retries
- **Permission revocation** — detected per-tick, shows "Re-grant permission" prompt
- **XPath fallback** — if CSS selector breaks, tries XPath before declaring failure

---

## Dashboard Features

### Monitor Management
- **Sidebar** — all monitors with status dots, hostname, change count, health warnings
- **Stats grid** — Status, Last Checked, Changes, Tracking Since, Health
- **Interval selector** — 5m, 15m, 30m, 1h, 6h, 24h
- **Check Now** — force immediate check with sound on change
- **Delete** — with confirmation prompt

### Change History
- **Timestamped entries** — sorted newest first
- **Diff rendering** — green `<ins>` for additions, red `<del>` for deletions
- **Summary mode** — "3 new items, 2 removed" with item titles listed
- **Expandable detail** — click to see full diff in "Both" mode

### Export
Dropdown with two formats:
- **CSV** — columns: Timestamp, Date, Old Value, New Value, Monitor, URL. Ready for Excel/Sheets.
- **JSON** — structured data with monitor metadata and full history array.

### Copy to Clipboard
Per-history-entry copy button. Copies formatted text:
```
PagePulse Change — Monitor Label
2026-03-24 10:30:00
Old: [first 200 chars]
New: [first 200 chars]
```
Icon swaps to checkmark for 2 seconds on success.

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| `j` | Next monitor |
| `k` | Previous monitor |
| `c` | Check now |
| `e` | Export |
| `Del` | Delete monitor |
| `?` | Show/hide shortcuts help |
| `Esc` | Close overlays |

---

## UI / UX

### Design System — "Precision Instrument"
- **Typography** — Manrope (UI) + JetBrains Mono (data/monospace)
- **Color** — Dark theme default with emerald (#10B981) accent
- **Light theme** — full light mode available via toggle
- **Theme persistence** — saved in localStorage, syncs across popup and dashboard

### Popup (360px)
- Monitor list with pulsing status dots
- Change count badges
- Active/inactive toggle
- Usage bar (N/10 monitors)
- "Add Monitor" and "Dashboard" buttons
- Theme toggle + privacy badge

### Dashboard (full tab)
- Sidebar + main panel layout
- Responsive down to 680px
- All per-monitor settings inline
- Auto-refreshes every 30 seconds

### Privacy Badge
Shield icon + "Local only — your data never leaves your device" in both popup and dashboard footers. Builds trust with privacy-conscious users.

---

## Technical Architecture

### Manifest V3 Compliance
- **No required host permissions** — all host access via `optional_host_permissions`
- **No `unlimitedStorage`** — 10MB default is sufficient
- **No `content_scripts`** — injected programmatically via `scripting` + `activeTab`
- **No remote code** — everything bundled locally
- **Service worker** — proper MV3 background with `"type": "module"`

### Permissions (all justified)
| Permission | Why |
|-----------|-----|
| `alarms` | Schedule periodic checks |
| `storage` | Store monitors, history, settings locally |
| `notifications` | Alert on changes |
| `activeTab` | Access current tab for element selection |
| `scripting` | Inject element picker content script |
| `offscreen` | Parse HTML + play notification sounds |

### Storage Model
- **Monitors** — `chrome.storage.local` key `monitors`, object keyed by UUID
- **History** — separate key per monitor `history-{uuid}`, array of `{ts, old, new}`
- **Settings** — key `settings`, includes tier, notifications, sound preferences
- **Pending digest** — key `pendingDigest`, array of batched change entries

### Data Flow
```
Alarm tick (1 min)
  → Load monitors → Filter due → Group by URL
  → Verify permissions → Fetch pages
  → Offscreen doc: parse HTML, query selectors/xpath
  → Apply ignore patterns → Check meaningful change
  → Match keywords → Record history → Update badge
  → Fire notification (instant) or queue (digest)
```

---

## Competitive Advantages

| vs. Competitor | PagePulse Advantage |
|---------------|---------------------|
| **vs. Distill ($15-35/mo)** | Free, MV3-native, local-only privacy, ignore patterns, smart summaries |
| **vs. Visualping ($10+/mo)** | Free, no account needed, keyword filters, digest mode, keyboard shortcuts |
| **vs. changedetection.io** | No self-hosting required, instant setup, browser-native UX |
| **vs. HARPA AI** | Focused single purpose, no AI costs, lighter weight |

### Pain Points We Solve That Competitors Don't

1. **Alert fatigue** → Digest mode + ignore patterns + keyword filters
2. **"Is it working?"** → Health indicator (Healthy/Stale/Flaky/Broken)
3. **Unreadable diffs** → Smart list-aware summaries
4. **Silent failures** → Amber PAUSED banner, sidebar warnings, error states
5. **Expensive** → Completely free, no tier gating
6. **Privacy concerns** → Local-only, no account, no tracking, no data leaves device
7. **MV2 deprecation** → MV3-native, future-proof

---

## Limits (Free Launch)

| Resource | Limit |
|----------|-------|
| Monitors | 10 |
| Minimum interval | 5 minutes |
| History retention | 30 days |
| Manual checks | Unlimited |
| All features | Available |

---

## Roadmap

### v1.1 — Growth Features (Post-launch, weeks 1-4)

#### Shareable Monitor Links
Let users share their monitor configuration as a link. Recipient clicks → imports the monitor with one click.
- Generates a shareable URL containing encoded monitor config (selector, URL, keywords, ignore patterns)
- Import flow: link opens PagePulse dashboard with pre-filled config, user clicks "Add"
- **Growth impact:** Every shared link = potential new user. This is the core viral loop.
- **Backend:** Cloudflare Worker KV store for short URLs, or encode config in URL hash (no backend needed)

#### Monitor Templates Gallery
Pre-built monitor configurations for popular use cases:
- **Amazon Price Tracker** — selector for price element, ignore patterns for stock count
- **Hacker News Front Page** — keyword filters, digest mode, ignore timestamps/points
- **Job Board Watcher** — keyword: job title, 15-min interval
- **Government Policy Monitor** — selectors for .gov sites, daily digest
- **Reddit Thread Watcher** — comment count tracking
- **Product Restock Alert** — "Add to Cart" button text detection
- **Competitor Website** — full page monitor, weekly digest
- **Documentation Changelog** — detect version number changes
- **Growth impact:** Reduces setup time from 2 minutes to 10 seconds. Templates are shareable content.

#### Slack / Discord / Telegram Webhooks
Send change alerts to team channels via configurable webhook URL per monitor.
- User pastes webhook URL in monitor settings
- On change: POST formatted message with monitor label, summary, diff link
- Supports Slack Block Kit, Discord embeds, Telegram bot API
- **Growth impact:** Team adoption = organic word-of-mouth in channels

#### "Powered by PagePulse" Branding
Already implemented in v1.0: every CSV/JSON export and clipboard copy includes "Tracked by PagePulse" footer.
- **Growth impact:** Every export, paste, and share = brand impression

#### Full-Page Text Monitoring
Monitor entire page text instead of a specific element.
- "Monitor whole page" option in element selector
- Captures `document.body.textContent`
- Best paired with ignore patterns and keyword filters

#### Improved Selector Recovery
When CSS selector breaks, use text fingerprint to find the element again automatically.
- Compare stored fingerprint against all page elements
- Suggest re-selection if close match found
- Reduce "broken monitor" rate from ~30% to ~5%

---

### v2 — Revenue & Scale Features (Month 2-6)

#### Payment Integration (Pro Tier)
- ExtensionPay or Stripe Checkout for $7/month Pro plan
- Pro: 50 monitors, 90-day history, priority checking
- Free tier remains generous (10 monitors, 30 days) to maintain growth
- **Revenue target:** 2% conversion × 10K users = 200 paid = $1,400/month

#### Public Dashboards
Let users make a monitor's change history publicly viewable at a URL.
- `pagepulse.app/d/username/hn-tracker`
- Shows live-updating feed of detected changes
- Each public dashboard = SEO landing page
- **Growth impact:** User-generated content that ranks in Google. "HN changes today" or "Amazon PS5 price history" attract organic search traffic.

#### Weekly Email Digest
Opt-in weekly summary email: "This week: 47 changes across 5 monitors. Top changes: [list]"
- Backend: Cloudflare Workers + Resend for email delivery
- Re-engages users who forgot about the extension
- Configurable: daily, weekly, monthly

#### Visual Screenshot Diff
Capture screenshots of monitored elements and overlay old/new with red/green highlighting.
- `chrome.tabs.captureVisibleTab` for screenshots
- Image diff library (pixelmatch) for comparison
- Side-by-side and overlay view modes
- This is Visualping's main selling point at $10+/mo — offering it free is a major competitive advantage

#### AI Change Summary
Use Claude Haiku or GPT-4o-mini to generate human-readable summaries:
- "Price dropped from $34.99 to $29.99 (15% off)"
- "3 new engineering job postings added in San Francisco"
- "Government policy section 4.2 updated: new compliance deadline March 2027"
- **Cost:** ~$0.01-0.03 per summary (Claude Haiku)
- **Revenue:** Premium feature for Pro tier

#### JS-Rendered Page Support
Server-side rendering via headless browser for single-page apps.
- Backend: Cloudflare Workers + Puppeteer/Playwright
- User marks monitor as "needs JS rendering"
- Fetches page via cloud, returns rendered HTML
- Solves the #1 technical limitation of the extension

#### Cross-Device Monitor Sync
Sync monitor configurations (not history) across devices via `chrome.storage.sync`.
- Monitor configs are small (~500 bytes each)
- History stays local (too large for sync)
- Pro feature to justify subscription

#### Multi-Browser Support
Port to Firefox and Edge with minimal changes.
- MV3 is cross-browser compatible
- Manifest differences are minor
- Firefox users are privacy-conscious — "local only" resonates
- Edge comes pre-installed on Windows — free distribution
- **Growth impact:** 2-3x addressable market

#### Import from Competitors
Import monitor configurations from Distill.io and Visualping JSON exports.
- Reduces switching friction
- "Switch to PagePulse in 30 seconds" marketing angle
- Parse competitor export formats, map to PagePulse config

#### Bulk Monitor Management
Select multiple monitors and apply actions in bulk.
- Select all / select by status
- Bulk pause, resume, delete, change interval
- Bulk apply keyword filters or ignore patterns
- Solves "painful monitor management" complaint from ChangeTower users

#### API / CLI Access
REST API and CLI tool for programmatic monitor management.
- Create, read, update, delete monitors via API
- Trigger checks programmatically
- Pipe change data to other tools
- Developer audience expects this

#### Mobile Companion
Progressive Web App (PWA) that shows monitor status and change history.
- Read-only view of monitors and diffs
- Push notifications via web push
- No app store submission needed
- Pairs with weekly email digest for mobile users

---

### v3 — Platform Features (Month 6+)

#### Team Workspaces
Shared monitor collections for teams.
- Invite team members via email
- Shared monitors with role-based access
- Team-wide digest notifications
- Enterprise pricing tier

#### Monitor Marketplace
Community-contributed monitor templates with ratings and reviews.
- Users publish their best monitor configs
- Others browse and install with one click
- Categories: E-commerce, Jobs, Government, Tech, Real Estate
- Top contributors get badges

#### Zapier / Make Integration
Connect PagePulse to 5,000+ apps via automation platforms.
- Trigger Zaps on change detected
- Actions: send email, update spreadsheet, post to Slack, create task
- Enterprise teams use this for compliance workflows

#### White-Label Solution
Offer PagePulse as a white-label product for agencies and enterprises.
- Custom branding
- Custom domain for public dashboards
- SLA and dedicated support
- Volume pricing
