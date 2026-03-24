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

Features:
- Smart change summaries for list pages (shows new/removed items instead of raw text)
- Keyword filters — only get notified about changes that match your interests
- Ignore patterns — filter out timestamps, point counts, and other noise
- Digest mode — batch notifications into hourly summaries instead of per-change alerts
- Monitor health dashboard — always know if your monitors are running
- Dark and light themes
- CSV and JSON export
- Keyboard shortcuts for power users
- Share monitor configurations with others

Works well with: Product pages, job listings, news articles, government sites, documentation, and other pages that serve content in their HTML.

Not yet supported: Pages that load content entirely via JavaScript (single-page apps) or pages that require login.

Privacy: All data stays on your device. No tracking, no analytics, no accounts, no servers. Host access is requested per-site only when you create a monitor.

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
