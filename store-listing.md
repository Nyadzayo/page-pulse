# PagePulse — Chrome Web Store Listing

## Name
PagePulse — Website Change Monitor

## Short Description (132 chars max)
Track text changes on webpage elements. Get notified when prices drop, jobs post, or content updates.

## Detailed Description

PagePulse monitors text content on webpage elements and alerts you when it changes.

How it works:
1. Click the PagePulse icon on a page you want to monitor
2. Select the element you want to track
3. Choose how often to check (every 5 minutes to 24 hours)
4. Get a Chrome notification when something changes
5. View exactly what changed with smart summaries and highlighted diffs

Core features:
- Smart change summaries for list pages (shows new/removed items instead of raw text)
- Keyword filters — only get notified about changes that match your interests
- Ignore patterns — filter out timestamps, point counts, and other noise
- Digest mode — batch notifications into hourly summaries instead of per-change alerts
- Monitor health dashboard — always know if your monitors are running, with auto-recovery for broken selectors via text fingerprint matching
- SPA / JavaScript-rendered page support via offscreen iframe rendering (Chrome 116+)
- Dark and light themes
- CSV, JSON, and RSS feed export
- Keyboard shortcuts for power users
- Share monitor configurations with others

Optional integrations (off by default, fully opt-in):
- Webhook actions — fire a JSON POST to Slack, Discord, Zapier, IFTTT, or any URL on every detected change
- AI summaries — bring your own API key (Anthropic, NVIDIA free tier, OpenAI, Groq, OpenRouter, or local Ollama) for one-line plain-English explanations of what changed; configurable global and per-monitor instructions
- Cross-device sync — opt in to replicate monitor configs across your signed-in Chrome profile via chrome.storage.sync (page baselines and history stay local)

Works well with: Product pages, job listings, news articles, government sites, documentation, SPAs, and most modern websites. Pages that aggressively block iframe embedding (e.g., Twitter/X, LinkedIn) cannot be reliably monitored from the background; PagePulse will surface a "Monitor needs attention" notification when this happens.

Privacy: Local-first by default. All baseline functionality runs entirely in your browser; PagePulse has no server. Three optional features may transmit data to destinations you choose: (1) Sync uses Chrome's built-in chrome.storage.sync (Google's encrypted profile sync); (2) AI summaries call the LLM provider you configure with your own API key; (3) Webhooks POST to a URL you supply. None of these features collect data on PagePulse's behalf.

Free — 10 monitors, 5-minute checks, 30-day history. All features included.

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
