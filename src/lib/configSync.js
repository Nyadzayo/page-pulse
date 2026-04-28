/**
 * chrome.storage.sync support for monitor configs.
 *
 * What syncs: the user-edited configuration of a monitor (URL, selector,
 * label, intervals, keywords, ignore patterns, webhook URL, render and
 * notify modes, active state).
 *
 * What stays local: anything that grows or is sensitive — baseline page
 * content, change history, lastChecked/lastChanged timestamps, change
 * counts, status flags, error counters, textFingerprint. This protects
 * the chrome.storage.sync 8KB-per-item quota and keeps page content off
 * Google's sync servers even when the user opts in to sync.
 *
 * Privacy: chrome.storage.sync transits through Google Sync. Encrypted in
 * transit and at rest by Google; end-to-end encrypted only if the user
 * has set a Chrome Sync passphrase. The feature is opt-in via the
 * settings.syncEnabled flag.
 */

import { MONITOR_SCHEMA_DEFAULTS } from './monitor.js';

export const SYNC_KEY = 'syncedMonitorConfigs';

export const SYNCABLE_FIELDS = [
  'id',
  'url',
  'selector',
  'xpath',
  'label',
  'intervalMs',
  'keywords',
  'ignorePatterns',
  'renderMode',
  'notifyMode',
  'webhookUrl',
  'active',
];

export function selectSyncableFields(monitor) {
  const out = {};
  for (const field of SYNCABLE_FIELDS) {
    if (field in monitor) out[field] = monitor[field];
  }
  return out;
}

export function extractSyncableConfigs(monitors) {
  return Object.values(monitors).map(selectSyncableFields);
}

const STATE_DEFAULTS = {
  origin: '',
  baseline: '',
  textFingerprint: '',
  lastChecked: null,
  lastChanged: null,
  changeCount: 0,
  status: MONITOR_SCHEMA_DEFAULTS.status,
  consecutiveErrors: 0,
  firstErrorAt: null,
  unreadChangeCount: 0,
};

export function mergeSyncedConfigs(localMonitors, syncedConfigs, opts = {}) {
  const now = opts.now ?? Date.now();
  const merged = { ...localMonitors };

  for (const cfg of syncedConfigs) {
    if (!cfg || !cfg.id) continue;
    const existing = merged[cfg.id];
    if (existing) {
      // Update config fields, preserve local state.
      merged[cfg.id] = { ...existing, ...selectSyncableFields(cfg) };
    } else {
      // Brand-new synced monitor on this device — seed default state.
      merged[cfg.id] = {
        ...MONITOR_SCHEMA_DEFAULTS,
        ...selectSyncableFields(cfg),
        ...STATE_DEFAULTS,
        createdAt: now,
      };
    }
  }

  return merged;
}

export async function pushConfigsToSync(configs) {
  try {
    await chrome.storage.sync.set({ [SYNC_KEY]: configs });
    return true;
  } catch (e) {
    console.warn('[PagePulse] sync push failed:', e?.message || e);
    return false;
  }
}

export async function pullConfigsFromSync() {
  try {
    const stored = await chrome.storage.sync.get(SYNC_KEY);
    return Array.isArray(stored[SYNC_KEY]) ? stored[SYNC_KEY] : [];
  } catch (e) {
    console.warn('[PagePulse] sync pull failed:', e?.message || e);
    return [];
  }
}
