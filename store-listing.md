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
3. Choose how often to check (hourly to every 15 minutes)
4. Get a Chrome notification when something changes
5. View exactly what changed with highlighted diffs

Works well with: Product pages, job listings, news articles, government sites, documentation, and other pages that serve content in their HTML.

Not yet supported: Pages that load content entirely via JavaScript (single-page apps) or pages that require login. We're working on expanding support.

Free plan: 5 monitors, hourly checks, 7-day history.
Pro plan ($7/month): 50 monitors, 15-minute checks, 90-day history, CSV export.

Privacy: All monitor data stays on your device. No tracking, no analytics, no data sent to external servers. Host access is requested per-site only when you create a monitor.

## Category
Productivity

## Permission Justifications

### alarms
Schedule periodic webpage checks at user-configured intervals.

### storage
Store monitor configurations, change history, and user settings locally.

### notifications
Alert the user when monitored content changes.

### activeTab
Access the current tab to allow the user to select an element to monitor. Only activates when user clicks the extension icon.

### scripting
Inject the element selection interface into the current page when user initiates monitor creation.

### offscreen
Parse fetched HTML using DOMParser to extract monitored element content. Service workers do not have DOM API access.

### optional_host_permissions (<all_urls>)
Fetch user-specified webpage URLs to detect content changes. Permission is requested per-domain at runtime only when the user creates a monitor.
