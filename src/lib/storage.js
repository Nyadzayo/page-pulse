import { STORAGE_KEYS, DEFAULT_SETTINGS, TIER_LIMITS } from './constants.js';
import { migrateMonitor } from './monitor.js';

/**
 * MonitorStore consolidates monitor and history storage operations into a
 * single, mockable abstraction. It is a thin wrapper around chrome.storage.local
 * keyed by STORAGE_KEYS.MONITORS and STORAGE_KEYS.HISTORY_PREFIX.
 *
 * The module-level functions below (getMonitors, saveMonitor, etc.) are
 * preserved for existing callers and delegate to a shared default instance.
 */
export class MonitorStore {
  async list() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.MONITORS);
    return result[STORAGE_KEYS.MONITORS] || {};
  }

  async get(id) {
    const monitors = await this.list();
    return monitors[id];
  }

  async save(monitor) {
    const monitors = await this.list();
    monitors[monitor.id] = monitor;
    await chrome.storage.local.set({ [STORAGE_KEYS.MONITORS]: monitors });
  }

  async update(id, updates) {
    const monitors = await this.list();
    if (!monitors[id]) return;
    monitors[id] = { ...monitors[id], ...updates };
    await chrome.storage.local.set({ [STORAGE_KEYS.MONITORS]: monitors });
  }

  async remove(id) {
    const monitors = await this.list();
    delete monitors[id];
    await chrome.storage.local.set({ [STORAGE_KEYS.MONITORS]: monitors });
    await chrome.storage.local.remove(STORAGE_KEYS.HISTORY_PREFIX + id);
  }

  async getHistory(monitorId) {
    const key = STORAGE_KEYS.HISTORY_PREFIX + monitorId;
    const result = await chrome.storage.local.get(key);
    return result[key] || [];
  }

  async appendHistory(monitorId, entry, tier) {
    const key = STORAGE_KEYS.HISTORY_PREFIX + monitorId;
    const history = await this.getHistory(monitorId);
    history.push(entry);
    const retentionMs = TIER_LIMITS[tier].historyRetentionMs;
    const latestTs = Math.max(...history.map((e) => e.ts));
    const cutoff = latestTs - retentionMs;
    const pruned = history.filter((e) => e.ts >= cutoff);
    await chrome.storage.local.set({ [key]: pruned });
  }
}

const defaultStore = new MonitorStore();

export async function getMonitors() {
  return defaultStore.list();
}

export async function getMonitor(id) {
  return defaultStore.get(id);
}

export async function saveMonitor(monitor) {
  return defaultStore.save(monitor);
}

export async function updateMonitor(id, updates) {
  return defaultStore.update(id, updates);
}

export async function deleteMonitor(id) {
  return defaultStore.remove(id);
}

export async function getHistory(monitorId) {
  return defaultStore.getHistory(monitorId);
}

export async function appendHistory(monitorId, entry, tier) {
  return defaultStore.appendHistory(monitorId, entry, tier);
}

export async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
}

export async function updateSettings(updates) {
  const current = await getSettings();
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: { ...current, ...updates } });
}

export async function getPendingDigest() {
  const result = await chrome.storage.local.get('pendingDigest');
  return result.pendingDigest || [];
}

export async function addPendingDigest(entry) {
  const pending = await getPendingDigest();
  pending.push(entry);
  await chrome.storage.local.set({ pendingDigest: pending });
}

export async function clearPendingDigest() {
  await chrome.storage.local.set({ pendingDigest: [] });
}

/**
 * Walk all stored monitors and bring them up to the current schema by
 * filling missing fields with defaults. Idempotent. Should be called from
 * chrome.runtime.onInstalled and chrome.runtime.onStartup so that legacy
 * monitors persisted by older versions of the extension acquire any
 * fields introduced since their creation (renderMode, notifyMode,
 * keywords, ignorePatterns, origin, ...).
 */
export async function runMigrations() {
  const monitors = await defaultStore.list();
  const ids = Object.keys(monitors);
  if (ids.length === 0) return;
  const migrated = {};
  let dirty = false;
  for (const id of ids) {
    const before = monitors[id];
    const after = migrateMonitor(before);
    migrated[id] = after;
    // Cheap shallow check: if any default-key was missing, the merged object
    // gains keys and is therefore "dirty". Object.keys length comparison is
    // a reliable proxy because migrateMonitor only adds keys, never removes.
    if (Object.keys(after).length !== Object.keys(before).length) dirty = true;
  }
  if (dirty) {
    await chrome.storage.local.set({ [STORAGE_KEYS.MONITORS]: migrated });
  }
}
