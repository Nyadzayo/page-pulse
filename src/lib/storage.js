import { STORAGE_KEYS, DEFAULT_SETTINGS, TIER_LIMITS } from './constants.js';

export async function getMonitors() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.MONITORS);
  return result[STORAGE_KEYS.MONITORS] || {};
}

export async function getMonitor(id) {
  const monitors = await getMonitors();
  return monitors[id];
}

export async function saveMonitor(monitor) {
  const monitors = await getMonitors();
  monitors[monitor.id] = monitor;
  await chrome.storage.local.set({ [STORAGE_KEYS.MONITORS]: monitors });
}

export async function updateMonitor(id, updates) {
  const monitors = await getMonitors();
  if (!monitors[id]) return;
  monitors[id] = { ...monitors[id], ...updates };
  await chrome.storage.local.set({ [STORAGE_KEYS.MONITORS]: monitors });
}

export async function deleteMonitor(id) {
  const monitors = await getMonitors();
  delete monitors[id];
  await chrome.storage.local.set({ [STORAGE_KEYS.MONITORS]: monitors });
  await chrome.storage.local.remove(STORAGE_KEYS.HISTORY_PREFIX + id);
}

export async function getHistory(monitorId) {
  const key = STORAGE_KEYS.HISTORY_PREFIX + monitorId;
  const result = await chrome.storage.local.get(key);
  return result[key] || [];
}

export async function appendHistory(monitorId, entry, tier) {
  const key = STORAGE_KEYS.HISTORY_PREFIX + monitorId;
  const history = await getHistory(monitorId);
  history.push(entry);
  const retentionMs = TIER_LIMITS[tier].historyRetentionMs;
  const latestTs = Math.max(...history.map((e) => e.ts));
  const cutoff = latestTs - retentionMs;
  const pruned = history.filter((e) => e.ts >= cutoff);
  await chrome.storage.local.set({ [key]: pruned });
}

export async function getSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] || {}) };
}

export async function updateSettings(updates) {
  const current = await getSettings();
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: { ...current, ...updates } });
}
