import { getMonitors, getSettings, updateMonitor, saveMonitor, appendHistory, getMonitor, getPendingDigest, addPendingDigest, clearPendingDigest, runMigrations } from './lib/storage.js';
import { filterDueMonitors, groupByUrl, evaluateCheck, limitUrlBatch } from './lib/scheduler.js';
import { hasOriginAccess, extractOrigin } from './lib/permissions.js';
import { notifyBatch, updateBadge, createBrokenMonitorNotification } from './lib/notifications.js';
import { makeMonitor } from './lib/monitor.js';
import { detectSpa } from './lib/spaDetect.js';
import { shouldFireBrokenNotification } from './lib/selectorRecovery.js';
import { ALARM_NAME, ALARM_PERIOD_MINUTES, STATUS, TIERS, TIER_LIMITS, STORAGE_KEYS, DIGEST_ALARM_NAME, NOTIFY_MODES, RENDER_MODES } from './lib/constants.js';

// Chrome 116+ supports the IFRAME_SCRIPTING reason for chrome.offscreen,
// which lets us load a URL inside a hidden iframe in the offscreen
// document — no visible tab needed. Older Chrome falls back to the
// legacy hidden-tab path implemented below.
const MIN_CHROME_FOR_IFRAME_SCRIPTING = 116;
const detectedChromeVersion = (() => {
  try {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const m = ua.match(/Chrom(?:e|ium)\/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
})();
const supportsOffscreenIframe = detectedChromeVersion === 0 || detectedChromeVersion >= MIN_CHROME_FOR_IFRAME_SCRIPTING;
if (detectedChromeVersion > 0 && !supportsOffscreenIframe) {
  console.warn(`[PagePulse] Chrome ${detectedChromeVersion} < ${MIN_CHROME_FOR_IFRAME_SCRIPTING}; offscreen iframe rendering unavailable, falling back to hidden-tab render with reduced reliability.`);
}

// --- Alarm Setup + Context Menu ---
chrome.runtime.onInstalled.addListener(async () => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
  chrome.alarms.create(DIGEST_ALARM_NAME, { periodInMinutes: 60 });

  // Right-click context menu
  chrome.contextMenus.create({
    id: 'pagepulse-monitor',
    title: 'Monitor this element with PagePulse',
    contexts: ['all'],
  });

  // Bring legacy monitors up to the current schema.
  try { await runMigrations(); } catch (e) { console.error('[PagePulse] Migration failed:', e); }
});

chrome.runtime.onStartup.addListener(async () => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
  chrome.alarms.create(DIGEST_ALARM_NAME, { periodInMinutes: 60 });
  try { await runMigrations(); } catch (e) { console.error('[PagePulse] Migration failed:', e); }
});

// --- Offscreen Document Management ---
async function ensureOffscreen({ withIframe = false } = {}) {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });
  if (contexts.length === 0) {
    const reasons = ['DOM_PARSER', 'AUDIO_PLAYBACK'];
    if (withIframe && supportsOffscreenIframe) reasons.push('IFRAME_SCRIPTING');
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons,
      justification: withIframe
        ? 'Parse fetched HTML, play notification sounds, and render JS-driven SPA pages in a hidden iframe.'
        : 'Parse fetched HTML and play notification sounds',
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

// --- Offscreen Iframe Render (Chrome 116+) ---
// Loads `url` inside a hidden iframe in the offscreen document and
// extracts text via CSS+XPath. Returns null entries on any failure so
// callers can fall back to the hidden-tab path.
async function offscreenRenderExtract(url, queries) {
  await ensureOffscreen({ withIframe: true });
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { target: 'offscreen', action: 'iframeRender', url, queries },
      (response) => {
        void chrome.runtime.lastError;
        resolve(
          response?.results ||
            queries.map((q) => ({ monitorId: q.monitorId, text: null, matchedBy: null })),
        );
      },
    );
  });
}

// --- Browser Render: open hidden tab, wait for JS, extract content ---
// Legacy path for Chrome <116 or as fallback when offscreen iframe fails.
async function browserRenderExtract(url, queries) {
  let tabId = null;
  try {
    // Create a hidden tab
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;

    // Wait for the page to fully load
    await new Promise((resolve) => {
      const listener = (updatedTabId, changeInfo) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      // Timeout after 30 seconds
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 30000);
    });

    // Give JS extra time to render dynamic content
    await new Promise(r => setTimeout(r, 2000));

    // Inject extraction script
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: (queryList) => {
        // Inline fingerprint matcher — must be self-contained because the
        // function body is serialized into the target page.
        const FP_LEN = 100;
        const SIM_THRESHOLD = 0.8;
        function levenshtein(a, b) {
          if (a === b) return 0;
          if (!a) return b ? b.length : 0;
          if (!b) return a.length;
          const m = a.length, n = b.length;
          const prev = new Array(n + 1), curr = new Array(n + 1);
          for (let j = 0; j <= n; j++) prev[j] = j;
          for (let i = 1; i <= m; i++) {
            curr[0] = i;
            for (let j = 1; j <= n; j++) {
              const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
              curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
            }
            for (let j = 0; j <= n; j++) prev[j] = curr[j];
          }
          return prev[n];
        }
        function similarity(a, b) {
          if (a == null || b == null) return 0;
          if (a === '' && b === '') return 1;
          if (a === '' || b === '') return 0;
          return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
        }
        function matchFingerprint(fp) {
          if (!fp) return null;
          const target = fp.trim().substring(0, FP_LEN);
          if (!target) return null;
          let best = null;
          const els = document.querySelectorAll('*');
          for (const el of els) {
            const text = (el.textContent || '').trim();
            if (text.length < 8) continue;
            const prefix = text.substring(0, FP_LEN);
            const score = similarity(target, prefix);
            if (score < SIM_THRESHOLD) continue;
            if (!best || score > best.score || (score === best.score && text.length < best.text.length)) {
              best = { el, text, score };
            }
          }
          return best;
        }
        function genSel(el) {
          if (!el) return null;
          if (el.id) return '#' + el.id;
          const testId = el.getAttribute && el.getAttribute('data-testid');
          if (testId) return '[data-testid="' + testId + '"]';
          const parts = [];
          let cur = el; let depth = 0;
          while (cur && cur.tagName && cur.tagName.toLowerCase() !== 'body' && depth < 5) {
            let seg = cur.tagName.toLowerCase();
            if (cur.id && depth > 0) { parts.unshift('#' + cur.id); break; }
            if (cur.className && typeof cur.className === 'string') {
              const cls = cur.className.trim().split(/\s+/).slice(0, 2).map(c => '.' + c).join('');
              if (cls) seg += cls;
            }
            parts.unshift(seg);
            cur = cur.parentElement;
            depth++;
          }
          return parts.join(' > ') || el.tagName.toLowerCase();
        }

        return queryList.map(({ monitorId, selector, xpath, textFingerprint }) => {
          // Try CSS selector
          if (selector) {
            try {
              const el = document.querySelector(selector);
              if (el) return { monitorId, text: el.textContent.trim(), matchedBy: 'selector' };
            } catch {}
          }
          // Try XPath
          if (xpath) {
            try {
              const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
              const el = result.singleNodeValue;
              if (el) return { monitorId, text: el.textContent.trim(), matchedBy: 'xpath' };
            } catch {}
          }
          // Try textFingerprint recovery
          if (textFingerprint) {
            try {
              const m = matchFingerprint(textFingerprint);
              if (m) return { monitorId, text: m.text, matchedBy: 'fingerprint', recoveredSelector: genSel(m.el) };
            } catch {}
          }
          return { monitorId, text: null, matchedBy: null };
        });
      },
      args: [queries],
    });

    return results?.[0]?.result || queries.map(q => ({ monitorId: q.monitorId, text: null, matchedBy: null }));
  } catch (e) {
    console.error('[PagePulse] Browser render failed:', e);
    return queries.map(q => ({ monitorId: q.monitorId, text: null, matchedBy: null }));
  } finally {
    // Always close the tab
    if (tabId) {
      try { await chrome.tabs.remove(tabId); } catch {}
    }
  }
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

    // Build query list
    const queries = monitorsForUrl.map((m) => ({
      monitorId: m.id,
      selector: m.selector,
      xpath: m.xpath,
      textFingerprint: m.textFingerprint,
    }));

    // Check if any monitor on this URL needs browser rendering
    const needsBrowser = monitorsForUrl.some(m => m.renderMode === RENDER_MODES.BROWSER);
    let results;

    if (needsBrowser) {
      // Browser render — prefer offscreen iframe (no visible tab); fall
      // back to hidden-tab path on Chrome <116 or if offscreen returns
      // empty results (e.g. iframe blocked by X-Frame-Options).
      if (supportsOffscreenIframe) {
        results = await offscreenRenderExtract(url, queries);
        const allEmpty = results.every((r) => r.text === null);
        if (allEmpty) {
          console.warn('[PagePulse] Offscreen iframe render returned empty for', url, '— falling back to hidden tab.');
          results = await browserRenderExtract(url, queries);
        }
      } else {
        results = await browserRenderExtract(url, queries);
      }
    } else {
      // Standard fetch: fast, works for static/SSR pages
      let html;
      try {
        const response = await fetch(url, { redirect: 'follow' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        html = await response.text();
      } catch {
        for (const m of monitorsForUrl) {
          const result = { monitorId: m.id, text: null, matchedBy: null };
          const outcome = evaluateCheck(m, result, now);
          await updateMonitor(m.id, outcome.monitorUpdates);
        }
        continue;
      }
      results = await queryOffscreen(html, queries);
    }

    // Process results
    for (const result of results) {
      const monitor = monitorsForUrl.find((m) => m.id === result.monitorId);
      if (!monitor) continue;

      const outcome = evaluateCheck(monitor, result, now);

      if (result.matchedBy === 'fingerprint' && result.recoveredSelector) {
        console.log(`[PagePulse] Selector recovered for "${monitor.label}": ${monitor.selector} → ${result.recoveredSelector}`);
        outcome.monitorUpdates.selector = result.recoveredSelector;
      }

      if (outcome.changed && outcome.historyEntry) {
        console.log(`[PagePulse] Change detected: "${monitor.label}" — old: "${outcome.historyEntry.old?.substring(0, 50)}" → new: "${outcome.historyEntry.new?.substring(0, 50)}"`);
        await appendHistory(monitor.id, outcome.historyEntry, settings.tier);
        changes.push({ monitor, newValue: outcome.historyEntry.new });
      } else {
        console.log(`[PagePulse] No change for "${monitor.label}" (matched by: ${result.matchedBy})`);
      }

      if (shouldFireBrokenNotification(monitor, outcome.monitorUpdates)) {
        try {
          await createBrokenMonitorNotification({ ...monitor, ...outcome.monitorUpdates });
        } catch (e) {
          console.error('[PagePulse] Broken notification failed:', e);
        }
      }

      await updateMonitor(monitor.id, outcome.monitorUpdates);
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
  if (notificationId.startsWith('pagepulse-broken-')) {
    // H1 — broken-monitor notification: open dashboard with a
    // ?action=reselect prompt for that monitor.
    const monitorId = notificationId.substring('pagepulse-broken-'.length);
    chrome.tabs.create({ url: `${dashboardUrl}?monitor=${monitorId}&action=reselect` });
  } else if (notificationId.includes('batch')) {
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

// --- Context Menu Handler ---
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'pagepulse-monitor' || !tab?.id || !tab.url) return;
  try {
    const origin = new URL(tab.url).origin;
    // Check if we have permission — context menu can't show permission prompt,
    // so if no permission, inject content script which will message back to create monitor
    // and the popup flow will handle permission next time
    const has = await chrome.permissions.contains({ origins: [`${origin}/*`] });
    if (!has) {
      // Can't request permission from background — open popup instead
      // The user will need to click "Add Monitor" in popup for first-time domains
      console.log('[PagePulse] No permission for', origin, '— user needs to use popup for first-time domains');
      return;
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js'],
    });
  } catch (e) {
    console.error('[PagePulse] Context menu inject failed:', e);
  }
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

  let userRenderMode = data.renderMode;
  if (!userRenderMode) {
    try {
      const stored = await chrome.storage.local.get('pendingRenderMode');
      userRenderMode = stored.pendingRenderMode;
    } catch {
      userRenderMode = undefined;
    }
  }
  let renderMode;
  if (userRenderMode === RENDER_MODES.BROWSER || userRenderMode === RENDER_MODES.FETCH) {
    renderMode = userRenderMode;
  } else {
    renderMode = await chooseRenderMode(data.url);
  }
  try { await chrome.storage.local.remove('pendingRenderMode'); } catch {}

  const monitor = makeMonitor(data, { tier: settings.tier, now: Date.now() });
  monitor.renderMode = renderMode;

  await saveMonitor(monitor);
  return { success: true, monitor };
}

// Quick fetch + SPA-detect to pick a default renderMode at create time.
// Falls back to 'fetch' on any network/parse error so we don't silently
// over-classify pages as SPAs.
async function chooseRenderMode(url) {
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) return RENDER_MODES.FETCH;
    const html = await response.text();
    return detectSpa(html) ? RENDER_MODES.BROWSER : RENDER_MODES.FETCH;
  } catch {
    return RENDER_MODES.FETCH;
  }
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

