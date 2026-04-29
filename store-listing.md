# PagePulse — Chrome Web Store Listing

## Name
PagePulse — Website Change Monitor

## Short Description (132 chars max)
Track text changes on webpage elements. Get notified when prices drop, jobs post, or content updates.

## Detailed Description

PagePulse is a free website change monitor that tracks webpage elements for text changes and alerts you when something changes. Private by default, powerful when you want it, no account needed.

HOW IT WORKS
1. Click the PagePulse icon on any page
2. Select the element you want to track
3. Choose how often to check (5 minutes to 24 hours)
4. Get a notification when something changes
5. View exactly what changed with smart summaries and diffs

SMART CHANGE DETECTION
- Smart summaries for list pages — shows "3 new items, 2 removed" instead of a wall of text
- Keyword filters — only get notified when changes match your interests
- Ignore patterns — filter out timestamps, point counts, and other noise with one click
- Digest mode — batch notifications into hourly summaries instead of constant alerts
- JS Rendered mode — monitor single-page apps, React sites, and dynamic websites
- Selector auto-recovery — when a site updates its DOM, PagePulse uses text fingerprint matching to find your element again instead of silently breaking
- Monitor health dashboard — always know if your monitors are running

GREAT FOR
- Price drop alerts and restock notifications on any online store
- Job posting alerts on career pages and job boards
- Competitor monitoring and content change detection
- Government and regulatory update tracking
- API documentation and changelog monitoring
- News tracking for specific topics on any news site

OPTIONAL POWER FEATURES (off by default, fully opt-in)
- Webhook actions — fire a JSON POST to Slack, Discord, Zapier, IFTTT, n8n, or any URL on every detected change. No PagePulse middleman.
- AI change summaries — bring your own API key from any major LLM provider you already use, including free-tier options. One-line plain-English explanations of what actually changed. Configurable global and per-monitor instructions.
- Cross-device sync — opt in to replicate monitor configs across your signed-in Chrome profile via Chrome's built-in encrypted sync. Page content and history stay local on each device.

MORE FEATURES
- Dark and light themes
- CSV, JSON, and RSS feed export with full change history
- Keyboard shortcuts for power users
- Copy diffs to clipboard for sharing
- Share monitor configurations with teammates via link
- Right-click context menu to start monitoring directly
- Pause and resume with clear status indicators
- Notification sound alerts with on/off toggle
- Inline rename, unread badges, and a compact in-app stats footer
- First-run onboarding to walk you through your first monitor

PRIVACY
Local-first by default. All baseline functionality runs entirely in your browser — PagePulse has no server. No accounts. No tracking. No analytics. Host access is requested per-site only when you create a monitor.

The three optional power features above transmit data only to destinations you choose: Chrome's built-in encrypted Sync, the LLM provider you select with your own API key, and webhook URLs you paste. PagePulse never proxies, intercepts, or stores any of that traffic. Each feature is off until you turn it on.

FREE
10 monitors, 5-minute checks, 30-day history. All features included. No hidden limits.

Works with static and server-rendered pages out of the box. Use JS Rendered mode for single-page apps and dynamic websites. Sites that aggressively block iframe embedding (e.g., Twitter/X, LinkedIn) cannot be reliably background-monitored — PagePulse will tell you so via the "Monitor needs attention" notification rather than silently failing.

## Category
Productivity

## Single Purpose Description
PagePulse monitors webpage elements for text changes and notifies the user when content changes are detected. All features (keyword filtering, smart summaries, ignore patterns, digest mode, export) serve this single purpose of webpage change detection and notification.

## Privacy Policy URL
https://nyadzayo.github.io/page-pulse/privacy-policy.html

## Permission Justifications

### alarms
Schedule periodic webpage checks at user-configured intervals (5 minutes to 24 hours). A single recurring alarm checks which monitors are due each minute.

### storage
Store monitor configurations, change history, and user settings locally on the user's device. No data is transmitted externally.

### notifications
Alert the user via Chrome desktop notifications when monitored webpage content changes.

### activeTab
Access the current tab to allow the user to select a page element to monitor. Only activates when the user explicitly clicks the PagePulse extension icon.

### scripting
Programmatically inject the element selection overlay into the current page when the user initiates monitor creation. No content scripts run persistently.

### offscreen
Create an offscreen document to parse fetched HTML using DOMParser and play notification sounds. Required because Manifest V3 service workers do not have DOM API access or audio playback capability.

### optional_host_permissions (<all_urls>)
Fetch user-specified webpage URLs to detect content changes. This is declared as an optional permission and is requested per-domain at runtime only when the user creates a monitor on a specific website. The extension never requests blanket host access.

## Why This Extension Needs These Permissions
PagePulse is a webpage change detection tool. To detect changes, it must periodically fetch webpages (host access), parse the HTML to find specific elements (offscreen/DOM parser), compare text content over time (storage), and alert the user when changes occur (notifications). The element selection feature requires temporary access to the active tab (activeTab + scripting). All permissions directly support the single purpose of monitoring webpage elements for text changes.
