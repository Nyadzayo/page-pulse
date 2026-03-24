import { getMonitors, getSettings, updateMonitor, saveMonitor, appendHistory, getMonitor, getPendingDigest, addPendingDigest, clearPendingDigest } from './lib/storage.js';
import { filterDueMonitors, groupByUrl, processCheckResults, limitUrlBatch } from './lib/scheduler.js';
import { hasOriginAccess, extractOrigin } from './lib/permissions.js';
import { notifyBatch, updateBadge } from './lib/notifications.js';
import { ALARM_NAME, ALARM_PERIOD_MINUTES, STATUS, TIERS, TIER_LIMITS, STORAGE_KEYS, DIGEST_ALARM_NAME, NOTIFY_MODES } from './lib/constants.js';

// --- Alarm Setup ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
  chrome.alarms.create(DIGEST_ALARM_NAME, { periodInMinutes: 60 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
  chrome.alarms.create(DIGEST_ALARM_NAME, { periodInMinutes: 60 });
});

// --- Offscreen Document Management ---
async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER', 'AUDIO_PLAYBACK'],
      justification: 'Parse fetched HTML and play notification sounds',
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
      (response) => {
        void chrome.runtime.lastError; // suppress "Receiving end does not exist"
        resolve(response?.results || []);
      }
    );
  });
}

// --- Tick Handler ---
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) await runTick();
  if (alarm.name === DIGEST_ALARM_NAME) await runDigest();
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

  // Fire notifications (before closing offscreen — sound plays through it)
  if (changes.length > 0) {
    console.log(`[PagePulse] ${changes.length} change(s) detected, notificationsEnabled: ${settings.notificationsEnabled}`);
    if (settings.notificationsEnabled) {
      // Split changes into instant vs digest
      const instantChanges = [];
      for (const change of changes) {
        const mode = change.monitor.notifyMode || NOTIFY_MODES.INSTANT;
        if (mode === NOTIFY_MODES.DIGEST) {
          await addPendingDigest({
            monitorId: change.monitor.id,
            label: change.monitor.label,
            newValue: change.newValue,
            ts: Date.now(),
          });
        } else {
          instantChanges.push(change);
        }
      }

      // Update badge with total (instant fires + pending digest count)
      const pendingCount = (await getPendingDigest()).length;
      const totalBadge = instantChanges.length + pendingCount;
      updateBadge(totalBadge);

      if (instantChanges.length > 0) {
        // Ensure offscreen is open for sound playback
        await ensureOffscreen();
        await notifyBatch(instantChanges, settings.soundEnabled !== false);
        console.log(`[PagePulse] Notifications fired`);
        // Give sound time to play before closing
        setTimeout(closeOffscreen, 2000);
      }
    }
  } else {
    await closeOffscreen();
  }
}

// --- Digest Handler ---
async function runDigest() {
  const pending = await getPendingDigest();
  if (pending.length === 0) return;

  const settings = await getSettings();
  if (!settings.notificationsEnabled) {
    await clearPendingDigest();
    return;
  }

  // Group by monitor
  const byMonitor = {};
  for (const entry of pending) {
    if (!byMonitor[entry.monitorId]) byMonitor[entry.monitorId] = [];
    byMonitor[entry.monitorId].push(entry);
  }

  const monitorCount = Object.keys(byMonitor).length;
  const changeCount = pending.length;

  // Fire one digest notification
  try {
    await chrome.notifications.create(`pagepulse-digest-${Date.now()}`, {
      type: 'basic',
      title: 'PagePulse Digest',
      message: `${changeCount} change${changeCount > 1 ? 's' : ''} detected across ${monitorCount} monitor${monitorCount > 1 ? 's' : ''}`,
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      priority: 2,
    });
  } catch (e) {
    console.error('[PagePulse] Digest notification failed:', e);
  }

  await clearPendingDigest();

  // Play sound if enabled
  if (settings.soundEnabled !== false) {
    await ensureOffscreen();
    chrome.runtime.sendMessage(
      { target: 'offscreen', action: 'playSound' },
      () => void chrome.runtime.lastError
    );
    setTimeout(closeOffscreen, 2000);
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

