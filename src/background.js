import { getMonitors, getSettings, updateMonitor, updateSettings, saveMonitor, appendHistory, getMonitor } from './lib/storage.js';
import { filterDueMonitors, groupByUrl, processCheckResults, limitUrlBatch } from './lib/scheduler.js';
import { hasOriginAccess, extractOrigin } from './lib/permissions.js';
import { notifyBatch } from './lib/notifications.js';
import { ALARM_NAME, ALARM_PERIOD_MINUTES, STATUS, TIERS, TIER_LIMITS, STORAGE_KEYS } from './lib/constants.js';
// ExtPay integration — DISABLED during development.
// To enable: register at extensionpay.com, replace 'YOUR_EXTPAY_ID', uncomment below.
// import ExtPay from 'extpay';
// function initExtPay() {
//   try {
//     const extpay = ExtPay('YOUR_EXTPAY_ID');
//     extpay.startBackground();
//     extpay.onPaid.addListener(async () => {
//       await updateSettings({ tier: TIERS.PRO });
//     });
//   } catch (e) {
//     console.warn('PagePulse: ExtPay not configured.', e.message);
//   }
// }
function initExtPay() { /* disabled in dev */ }

// Delay ExtPay init to avoid blocking service worker registration
setTimeout(initExtPay, 1000);

// --- Alarm Setup ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
});

// --- Offscreen Document Management ---
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Parse fetched HTML to extract monitored element text',
    });
  }
}

async function closeOffscreen() {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // Already closed or never opened
  }
}

async function queryOffscreen(html, queries) {
  await ensureOffscreen();
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { target: 'offscreen', action: 'parseAndQuery', html, queries },
      (response) => resolve(response?.results || [])
    );
  });
}

// --- Tick Handler ---
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await runTick();
});

async function runTick() {
  const monitors = await getMonitors();
  const settings = await getSettings();
  const now = Date.now();

  const due = filterDueMonitors(monitors, now);
  console.log(`[PagePulse] Tick: ${Object.keys(monitors).length} monitors, ${due.length} due`);
  if (due.length === 0) return;

  const urlGroups = groupByUrl(due);
  const urlsToProcess = limitUrlBatch(urlGroups);
  const changes = [];

  for (const url of urlsToProcess) {
    const monitorsForUrl = urlGroups[url];

    // Check permission
    const hasAccess = await hasOriginAccess(url);
    if (!hasAccess) {
      for (const m of monitorsForUrl) {
        await updateMonitor(m.id, { status: STATUS.PERMISSION_REVOKED, lastChecked: now });
      }
      continue;
    }

    // Fetch page
    let html;
    try {
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      html = await response.text();
    } catch {
      for (const m of monitorsForUrl) {
        const result = { monitorId: m.id, text: null, matchedBy: null };
        const updates = processCheckResults(m, result, now);
        const { changed, historyEntry, ...storageUpdates } = updates;
        await updateMonitor(m.id, storageUpdates);
      }
      continue;
    }

    // Parse and query
    const queries = monitorsForUrl.map((m) => ({
      monitorId: m.id,
      selector: m.selector,
      xpath: m.xpath,
    }));

    const results = await queryOffscreen(html, queries);

    // Process results
    for (const result of results) {
      const monitor = monitorsForUrl.find((m) => m.id === result.monitorId);
      if (!monitor) continue;

      const updates = processCheckResults(monitor, result, now);

      if (updates.changed && updates.historyEntry) {
        console.log(`[PagePulse] Change detected: "${monitor.label}" — old: "${updates.historyEntry.old?.substring(0, 50)}" → new: "${updates.historyEntry.new?.substring(0, 50)}"`);
        await appendHistory(monitor.id, updates.historyEntry, settings.tier);
        changes.push({ monitor, newValue: updates.historyEntry.new });
      } else {
        console.log(`[PagePulse] No change for "${monitor.label}" (matched by: ${result.matchedBy})`);
      }

      const { changed, historyEntry, ...storageUpdates } = updates;
      await updateMonitor(monitor.id, storageUpdates);
    }
  }

  await closeOffscreen();

  // Fire notifications
  if (changes.length > 0) {
    console.log(`[PagePulse] ${changes.length} change(s) detected, notificationsEnabled: ${settings.notificationsEnabled}`);
    if (settings.notificationsEnabled) {
      await notifyBatch(changes);
      console.log(`[PagePulse] Notifications fired`);
    }
  }
}

// --- Notification Click Handler ---
chrome.notifications.onClicked.addListener((notificationId) => {
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');
  if (notificationId.includes('batch')) {
    chrome.tabs.create({ url: dashboardUrl });
  } else {
    // Extract monitor ID from "pagepulse-{monitorId}-{timestamp}"
    const parts = notificationId.split('-');
    // Remove "pagepulse" prefix and timestamp suffix
    const monitorId = parts.slice(1, -1).join('-');
    chrome.tabs.create({ url: `${dashboardUrl}?monitor=${monitorId}` });
  }
  chrome.notifications.clear(notificationId);
  // Clear badge when user clicks
  chrome.action.setBadgeText({ text: '' });
});

// --- Message Handler ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Ignore offscreen messages (handled by offscreen.js)
  if (msg.target === 'offscreen') return;

  if (msg.action === 'createMonitor') {
    handleCreateMonitor(msg.data).then(sendResponse);
    return true;
  }
  if (msg.action === 'startSelection') {
    handleStartSelection(msg.tabId).then(sendResponse);
    return true;
  }
  if (msg.action === 'checkNow') {
    handleCheckNow(msg.monitorId).then(sendResponse);
    return true;
  }
  if (msg.action === 'toggleTier') {
    handleToggleTier().then(sendResponse);
    return true;
  }
  if (msg.action === 'testNotification') {
    handleTestNotification().then(sendResponse);
    return true;
  }
});

async function handleCreateMonitor(data) {
  const settings = await getSettings();
  const monitors = await getMonitors();
  const activeCount = Object.values(monitors).filter((m) => m.active).length;
  const limits = TIER_LIMITS[settings.tier];

  if (activeCount >= limits.maxMonitors) {
    return { success: false, reason: 'limit_reached' };
  }

  const monitor = {
    id: crypto.randomUUID(),
    url: data.url,
    origin: extractOrigin(data.url),
    selector: data.selector,
    xpath: data.xpath,
    textFingerprint: data.textFingerprint,
    label: data.label || `Monitor on ${new URL(data.url).hostname}`,
    baseline: data.baseline,
    intervalMs: limits.minIntervalMs,
    lastChecked: null,
    lastChanged: null,
    changeCount: 0,
    status: STATUS.OK,
    consecutiveErrors: 0,
    firstErrorAt: null,
    active: true,
    createdAt: Date.now(),
  };

  await saveMonitor(monitor);
  return { success: true, monitor };
}

async function handleStartSelection(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js'],
  });
  return { success: true };
}

async function handleCheckNow(monitorId) {
  const monitor = await getMonitor(monitorId);
  if (!monitor) return { success: false, reason: 'not_found' };

  // Rate limit manual checks for free tier
  const settings = await getSettings();
  const limits = TIER_LIMITS[settings.tier];
  if (limits.maxManualChecksPerDay !== Infinity) {
    const countKey = STORAGE_KEYS.MANUAL_CHECK_COUNT;
    const result = await chrome.storage.local.get(countKey);
    const stored = result[countKey] || { date: '', count: 0 };
    const today = new Date().toISOString().split('T')[0];

    if (stored.date === today && stored.count >= limits.maxManualChecksPerDay) {
      return { success: false, reason: 'rate_limited' };
    }

    const newCount = stored.date === today ? stored.count + 1 : 1;
    await chrome.storage.local.set({ [countKey]: { date: today, count: newCount } });
  }

  // Reset broken/error state so the monitor gets picked up
  if (monitor.status === STATUS.BROKEN || monitor.status === STATUS.PERMISSION_REVOKED) {
    await updateMonitor(monitorId, {
      status: STATUS.OK,
      consecutiveErrors: 0,
      firstErrorAt: null,
      lastChecked: null,
    });
  } else {
    await updateMonitor(monitorId, { lastChecked: null });
  }

  await runTick();
  return { success: true };
}

// --- Dev helpers (remove before production release) ---

async function handleToggleTier() {
  const settings = await getSettings();
  const newTier = settings.tier === TIERS.PRO ? TIERS.FREE : TIERS.PRO;
  await updateSettings({ tier: newTier });
  return { success: true, tier: newTier };
}

async function handleTestNotification() {
  await chrome.notifications.create('test-notification', {
    type: 'basic',
    title: 'PagePulse Test',
    message: 'Notifications are working! This is a test alert.',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
  });
  return { success: true };
}
