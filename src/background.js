import { getMonitors, getSettings, updateMonitor, saveMonitor, appendHistory, getMonitor, getPendingDigest, addPendingDigest, clearPendingDigest, runMigrations } from './lib/storage.js';
import { filterDueMonitors, groupByUrl, evaluateCheck, limitUrlBatch, isNoisyMonitor } from './lib/scheduler.js';
import { hasOriginAccess, extractOrigin } from './lib/permissions.js';
import { notifyBatch, updateBadge, createBrokenMonitorNotification } from './lib/notifications.js';
import { makeMonitor } from './lib/monitor.js';
import { detectSpa } from './lib/spaDetect.js';
import { shouldFireBrokenNotification } from './lib/selectorRecovery.js';
import { fireWebhook } from './lib/webhook.js';
import {
  SYNC_KEY,
  extractSyncableConfigs,
  mergeSyncedConfigs,
  pushConfigsToSync,
  pullConfigsFromSync,
} from './lib/configSync.js';
import { ALARM_NAME, ALARM_PERIOD_MINUTES, STATUS, TIERS, TIER_LIMITS, STORAGE_KEYS, DIGEST_ALARM_NAME, HEARTBEAT_ALARM_NAME, HEARTBEAT_PERIOD_MINUTES, NOISY_CHANGE_THRESHOLD, NOTIFY_MODES, RENDER_MODES } from './lib/constants.js';
import { trackEvent, trackOnce, trackError, getHoursSinceInstall, INSTALLED_AT_KEY } from './lib/telemetry.js';

// SPA / JS-rendered pages are loaded into a hidden iframe inside the
// chrome.offscreen document (IFRAME_SCRIPTING reason, Chrome 116+).
// We do not fall back to opening a real window for older Chrome —
// hidden-window fallbacks are flagged as deceptive UI by Chrome Web
// Store review. Chrome <116 is exceedingly rare in 2026 (manifest_version
// 3 itself requires recent Chrome); on those installs the JS-rendered
// monitor flips to BROKEN and the user sees the standard "Monitor needs
// attention" notification.

// --- Alarm Setup + Context Menu ---
// chrome.alarms.create() with an existing name RESETS its countdown. The
// heartbeat fires 24h after creation, so recreating it on every browser
// startup meant users who restart Chrome daily never emitted a heartbeat
// (and digests were delayed by up to an hour per restart). Only (re)create
// when the alarm is missing or its period changed in an update.
async function ensureAlarm(name, opts) {
  try {
    const existing = await chrome.alarms.get(name);
    if (existing && existing.periodInMinutes === opts.periodInMinutes) return;
  } catch {
    // get() failed — fall through and create
  }
  chrome.alarms.create(name, opts);
}

async function ensureAllAlarms() {
  await ensureAlarm(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
  await ensureAlarm(DIGEST_ALARM_NAME, { periodInMinutes: 60 });
  await ensureAlarm(HEARTBEAT_ALARM_NAME, { periodInMinutes: HEARTBEAT_PERIOD_MINUTES });
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await ensureAllAlarms();

  // Right-click context menu
  chrome.contextMenus.create({
    id: 'pagepulse-monitor',
    title: 'Monitor this element with PagePulse',
    contexts: ['all'],
  });

  const version = chrome.runtime.getManifest().version;
  if (details?.reason === 'install') {
    await chrome.storage.local.set({ [INSTALLED_AT_KEY]: Date.now() });
    trackEvent('extension_installed', { version });
    // Fresh install: open the dashboard so the onboarding card is actually
    // seen. Before this, nothing happened after install and the first-run
    // guide lived on a page most users never reached.
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html?welcome=1') });
    } catch (e) {
      console.error('[PagePulse] Welcome tab failed:', e);
    }
  } else if (details?.reason === 'update') {
    trackEvent('extension_updated', { version });
  }

  // Bring legacy monitors up to the current schema.
  try { await runMigrations(); } catch (e) { console.error('[PagePulse] Migration failed:', e); trackError('migration', e); }

  // Pull synced configs into local on first install / extension reload.
  try { await pullAndMergeSync(); } catch (e) { console.error('[PagePulse] sync pull failed:', e); trackError('sync_pull', e); }
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAllAlarms();
  try { await runMigrations(); } catch (e) { console.error('[PagePulse] Migration failed:', e); trackError('migration', e); }
  try { await pullAndMergeSync(); } catch (e) { console.error('[PagePulse] sync pull failed:', e); trackError('sync_pull', e); }
});

// --- Offscreen Document Management ---
async function ensureOffscreen({ withIframe = false } = {}) {
  // chrome.runtime.getContexts requires Chrome 116+ (the offscreen API
  // itself only needs 109). On older Chrome, skip the existence check and
  // let createDocument's "already exists" rejection stand in for it.
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });
    if (contexts.length > 0) return;
  }
  const reasons = ['DOM_PARSER', 'AUDIO_PLAYBACK'];
  if (withIframe) reasons.push('IFRAME_SCRIPTING');
  const justification = withIframe
    ? 'Parse fetched HTML, play notification sounds, and render JS-driven SPA pages in a hidden iframe.'
    : 'Parse fetched HTML and play notification sounds';
  const create = (r) =>
    chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: r, justification });
  try {
    await create(reasons);
  } catch (e) {
    const msg = String(e?.message || e);
    if (/single `?reason`?/i.test(msg)) {
      // Chrome <114 accepts only one reason. DOM_PARSER is the one extraction
      // needs; sounds/iframe-render degrade gracefully there.
      try {
        await create(['DOM_PARSER']);
      } catch (e2) {
        if (!/single offscreen/i.test(String(e2?.message || e2))) throw e2;
      }
    } else if (!/single offscreen/i.test(msg)) {
      throw e;
    }
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


// --- Tick Handler ---
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) await runTick().catch((e) => { console.error('[PagePulse] Tick failed:', e); trackError('tick', e); });
  if (alarm.name === DIGEST_ALARM_NAME) await runDigest().catch((e) => { console.error('[PagePulse] Digest failed:', e); trackError('digest', e); });
  if (alarm.name === HEARTBEAT_ALARM_NAME) await sendHeartbeat().catch(() => {});
});

// Daily snapshot of monitor fleet health. This single event answers the
// retention questions the funnel events can't: is the user still getting
// value (healthy active monitors) even if they never open the popup?
async function sendHeartbeat() {
  const monitors = Object.values(await getMonitors());
  if (monitors.length === 0) return;
  const active = monitors.filter((m) => m.active);
  const broken = active.filter((m) => m.status === STATUS.BROKEN || m.status === STATUS.PERMISSION_REVOKED);
  const now = Date.now();
  const healthy = active.filter((m) =>
    m.status === STATUS.OK &&
    m.lastChecked !== null &&
    now - m.lastChecked <= (m.intervalMs || 3600000) * 3,
  );
  const stored = await chrome.storage.local.get(INSTALLED_AT_KEY);
  const installedAt = stored[INSTALLED_AT_KEY];
  await trackEvent('heartbeat', {
    monitors_total: monitors.length,
    monitors_active: active.length,
    monitors_paused: monitors.length - active.length,
    monitors_healthy: healthy.length,
    monitors_broken: broken.length,
    days_since_install: installedAt ? Math.floor((now - installedAt) / 86400000) : null,
    version: chrome.runtime.getManifest().version,
  });
}

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
  // Per-tick telemetry aggregates. One event per tick, never per monitor —
  // keeps volume low and avoids leaking per-site cadence patterns.
  const tickStats = { checks: 0, failures: 0 };

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
      // Browser render — exclusively offscreen iframe (no visible window
      // ever). If the iframe is blocked (X-Frame-Options / CSP
      // frame-ancestors on sites like Twitter/LinkedIn), the F2 null-text
      // guard below marks the monitor BROKEN after 3 ticks and surfaces
      // the "needs attention" notification.
      results = await offscreenRenderExtract(url, queries);
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
          tickStats.checks += 1;
          tickStats.failures += 1;
          await updateMonitor(m.id, outcome.monitorUpdates);
        }
        continue;
      }
      results = await queryOffscreen(html, queries);
    }

    // Process results. Each monitor is isolated: a throw while processing
    // one must not abort the tick and starve every monitor after it.
    for (const result of results) {
      try {
        const monitor = monitorsForUrl.find((m) => m.id === result.monitorId);
        if (!monitor) continue;

        // F2 — evaluateCheck treats null text / null matchedBy as a check
        // failure (increments consecutiveErrors → BROKEN after 3). This
        // prevents Twitter/SPA-blocked-iframe ticks from clobbering baseline
        // with empty strings.
        const outcome = evaluateCheck(monitor, result, now);
        tickStats.checks += 1;
        if (outcome.monitorUpdates.consecutiveErrors > 0) tickStats.failures += 1;

        if (result.matchedBy === 'fingerprint' && result.recoveredSelector) {
          console.log(`[PagePulse] Selector recovered for "${monitor.label}": ${monitor.selector} → ${result.recoveredSelector}`);
          outcome.monitorUpdates.selector = result.recoveredSelector;
        }

        if (outcome.changed && outcome.historyEntry) {
          console.log(`[PagePulse] Change detected: "${monitor.label}" — old: "${outcome.historyEntry.old?.substring(0, 50)}" → new: "${outcome.historyEntry.new?.substring(0, 50)}"`);

          // AI summaries are user-triggered only (per-entry "Generate
          // summary" button in the dashboard). No auto-call here — saves
          // tokens and keeps the tick fast.
          await appendHistory(monitor.id, outcome.historyEntry, settings.tier);
          // F5A — increment unread counter for sidebar dot + browser-action badge
          outcome.monitorUpdates.unreadChangeCount = (monitor.unreadChangeCount || 0) + 1;
          // Carry the post-check state (consecutiveChanges) so the
          // notification split below can detect noisy monitors.
          changes.push({ monitor: { ...monitor, ...outcome.monitorUpdates }, newValue: outcome.historyEntry.new });
          // Fire once at the exact threshold crossing, not on every noisy tick.
          if (outcome.monitorUpdates.consecutiveChanges === NOISY_CHANGE_THRESHOLD) {
            trackEvent('monitor_noisy', { streak: outcome.monitorUpdates.consecutiveChanges });
          }
          // Path A — fire user-configured webhook (Slack/Discord/Zapier/etc.)
          // off the change event. Best-effort, no retries; failures logged
          // but don't affect the rest of the tick.
          if (monitor.webhookUrl) {
            fireWebhook(monitor.webhookUrl, monitor, outcome.historyEntry)
              .then((ok) => {
                if (!ok) console.warn(`[PagePulse] Webhook failed for "${monitor.label}"`);
              });
          }
        } else {
          console.log(`[PagePulse] No change for "${monitor.label}" (matched by: ${result.matchedBy})`);
        }

        if (shouldFireBrokenNotification(monitor, outcome.monitorUpdates)) {
          try {
            await createBrokenMonitorNotification({ ...monitor, ...outcome.monitorUpdates });
            trackEvent('monitor_check_failed', { reason: 'selector_broken' });
            trackEvent('notification_sent', { kind: 'broken', count: 1 });
          } catch (e) {
            console.error('[PagePulse] Broken notification failed:', e);
          }
        }

        await updateMonitor(monitor.id, outcome.monitorUpdates);
      } catch (e) {
        console.error('[PagePulse] Check processing failed for monitor', result.monitorId, e);
        trackError('tick_monitor', e);
      }
    }
  }

  if (tickStats.checks > 0) {
    trackEvent('monitor_check_completed', {
      checks: tickStats.checks,
      failures: tickStats.failures,
      changes: changes.length,
    });
  }
  if (changes.length > 0) {
    trackEvent('change_detected', { count: changes.length });
    trackOnce('first_change_detected', { hours_since_install: await getHoursSinceInstall() });
  }

  // Fire notifications (before closing offscreen — sound plays through it)
  if (changes.length > 0) {
    console.log(`[PagePulse] ${changes.length} change(s) detected, notificationsEnabled: ${settings.notificationsEnabled}`);
    if (settings.notificationsEnabled) {
      // Split changes into instant vs digest. Noisy monitors (changing on
      // every consecutive check) are demoted to the digest regardless of
      // their notifyMode — an hourly summary instead of a notification
      // storm. An unchanged check resets the streak and restores instant.
      const instantChanges = [];
      for (const change of changes) {
        const mode = change.monitor.notifyMode || NOTIFY_MODES.INSTANT;
        if (mode === NOTIFY_MODES.DIGEST || isNoisyMonitor(change.monitor)) {
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

      if (instantChanges.length > 0) {
        // Ensure offscreen is open for sound playback
        await ensureOffscreen();
        await notifyBatch(instantChanges, settings.soundEnabled !== false);
        trackEvent('notification_sent', { kind: 'change', count: instantChanges.length });
        console.log(`[PagePulse] Notifications fired`);
        // Give sound time to play before closing
        setTimeout(closeOffscreen, 2000);
      }
    }
    // Always refresh badge after a tick that produced changes — independent
    // of notifications-enabled and digest/instant split. F5C semantics:
    // badge tracks total unread, never just per-tick fires.
    await refreshUnreadBadge();
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
    trackEvent('notification_sent', { kind: 'digest', count: changeCount });
  } catch (e) {
    console.error('[PagePulse] Digest notification failed:', e);
  }

  await clearPendingDigest();
  // Digest fired — keep badge in sync with current unread state.
  await refreshUnreadBadge();

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
chrome.notifications.onClicked.addListener(async (notificationId) => {
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');
  const kind = notificationId.startsWith('pagepulse-broken-') ? 'broken'
    : notificationId.startsWith('pagepulse-digest-') ? 'digest'
    : notificationId.includes('batch') ? 'batch'
    : 'change';
  // Awaited: the SW can shut down right after tabs.create, and an
  // un-awaited fetch here is how clicks get silently dropped.
  await trackEvent('notification_clicked', { kind });
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
  // Don't blanket-clear the badge — F5C semantics are "total unread across
  // all monitors". Selecting the monitor in the dashboard clears that
  // monitor's unreadChangeCount and triggers refreshUnreadBadge via the
  // recompute_badge message.
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
  if (msg.action === 'recompute_badge') {
    refreshUnreadBadge().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'sync_now') {
    maybePushSync().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// Suppression flag to prevent the chrome.storage.onChanged loop:
// when we apply a sync-induced merge to local, the resulting onChanged
// on local would otherwise re-push the same data to sync, which would
// fire onChanged on the OTHER device's sync area, which would merge,
// which would re-push... ad infinitum.
let applyingSyncedConfig = false;

async function maybePushSync() {
  if (applyingSyncedConfig) return;
  const settings = await getSettings();
  if (!settings.syncEnabled) return;
  const monitors = await getMonitors();
  await pushConfigsToSync(extractSyncableConfigs(monitors));
}

async function pullAndMergeSync() {
  const settings = await getSettings();
  if (!settings.syncEnabled) return;
  const synced = await pullConfigsFromSync();
  if (synced.length === 0) return;
  const local = await getMonitors();
  const merged = mergeSyncedConfigs(local, synced);
  applyingSyncedConfig = true;
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.MONITORS]: merged });
  } finally {
    applyingSyncedConfig = false;
  }
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && changes[STORAGE_KEYS.MONITORS]) {
    await maybePushSync();
  } else if (area === 'sync' && changes[SYNC_KEY]) {
    await pullAndMergeSync();
    await refreshUnreadBadge();
  }
});

async function refreshUnreadBadge() {
  try {
    const monitors = await getMonitors();
    const total = Object.values(monitors).reduce(
      (sum, m) => sum + (m.unreadChangeCount || 0),
      0,
    );
    updateBadge(total);
  } catch (e) {
    console.error('[PagePulse] refreshUnreadBadge failed:', e);
  }
}

async function handleCreateMonitor(data) {
  const settings = await getSettings();
  const monitors = await getMonitors();
  const activeCount = Object.values(monitors).filter((m) => m.active).length;
  const limits = TIER_LIMITS[settings.tier];

  if (activeCount >= limits.maxMonitors) {
    trackEvent('monitor_creation_failed', { reason: 'limit_reached', surface: 'content' });
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

  let monitor;
  try {
    monitor = makeMonitor(data, { tier: settings.tier, now: Date.now() });
  } catch (e) {
    trackEvent('monitor_creation_failed', { reason: 'invalid_input', surface: 'content' });
    trackError('create_monitor', e);
    return { success: false, reason: 'invalid_input' };
  }
  monitor.renderMode = renderMode;

  await saveMonitor(monitor);
  trackEvent('monitor_created', {
    render_mode: renderMode,
    interval_minutes: Math.round(monitor.intervalMs / 60000),
    monitor_count: activeCount + 1,
    via: data.via || 'selector',
  });
  trackOnce('first_monitor_created', {
    hours_since_install: await getHoursSinceInstall(),
    render_mode: renderMode,
  });
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

// When the user accepts a host-permission prompt for a domain we have a
// pending selection on, inject the selector overlay automatically — the
// popup that started the flow has already been closed by Chrome (the
// permission dialog steals focus), so we can't rely on it to do this.
const PENDING_SELECTION_TTL_MS = 30000;
chrome.permissions.onAdded.addListener(async (perms) => {
  try {
    const stored = await chrome.storage.local.get('pendingSelection');
    const pending = stored.pendingSelection;
    if (!pending) return;
    if (Date.now() - pending.ts > PENDING_SELECTION_TTL_MS) {
      await chrome.storage.local.remove('pendingSelection');
      return;
    }
    const grantedOrigins = (perms && perms.origins) || [];
    const matches = grantedOrigins.some((o) => o.startsWith(`${pending.origin}/`));
    if (!matches) return;
    await chrome.storage.local.remove('pendingSelection');
    try {
      await chrome.scripting.executeScript({
        target: { tabId: pending.tabId },
        files: ['content.js'],
      });
    } catch (e) {
      console.error('[PagePulse] Auto-start selection after permission grant failed:', e);
    }
  } catch (e) {
    console.error('[PagePulse] permissions.onAdded handler failed:', e);
  }
});

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

