import {
  STATUS, TIER_LIMITS, RENDER_MODES, NOTIFY_MODES,
} from './constants.js';
import { extractOrigin } from './permissions.js';

/**
 * Canonical Monitor schema defaults. Used by both makeMonitor() (when
 * creating a new monitor) and runMigrations() (when filling missing fields
 * on legacy stored monitors). Keep this single source of truth in sync
 * with the storage and dashboard expectations.
 */
export const MONITOR_SCHEMA_DEFAULTS = Object.freeze({
  selector: '',
  xpath: '',
  textFingerprint: '',
  baseline: '',
  label: '',
  intervalMs: 3600000,
  lastChecked: null,
  lastChanged: null,
  changeCount: 0,
  unreadChangeCount: 0,
  status: STATUS.OK,
  consecutiveErrors: 0,
  firstErrorAt: null,
  active: true,
  renderMode: RENDER_MODES.FETCH,
  notifyMode: NOTIFY_MODES.INSTANT,
  keywords: '',
  ignorePatterns: '',
  webhookUrl: '',
});

/**
 * Factory for new Monitor records. Centralizes default field population so
 * call sites don't drift on schema. Uses tier-specific minimum interval by
 * default; caller may override via opts.intervalMs / opts.label.
 *
 * @param {Object} input - { url, selector, xpath, textFingerprint, baseline, label? }
 * @param {Object} opts  - { tier, now, intervalMs?, label? }
 * @returns {Object} A fully-populated Monitor.
 */
export function makeMonitor(input, opts) {
  const { tier, now } = opts;
  const limits = TIER_LIMITS[tier];
  const url = input.url;
  const hostname = new URL(url).hostname;
  const label =
    opts.label ?? input.label ?? `Monitor on ${hostname}`;
  const intervalMs = opts.intervalMs ?? limits.minIntervalMs;

  return {
    id: crypto.randomUUID(),
    url,
    origin: extractOrigin(url),
    selector: input.selector ?? MONITOR_SCHEMA_DEFAULTS.selector,
    xpath: input.xpath ?? MONITOR_SCHEMA_DEFAULTS.xpath,
    textFingerprint: input.textFingerprint ?? MONITOR_SCHEMA_DEFAULTS.textFingerprint,
    label,
    baseline: input.baseline ?? MONITOR_SCHEMA_DEFAULTS.baseline,
    intervalMs,
    lastChecked: null,
    lastChanged: null,
    changeCount: 0,
    unreadChangeCount: 0,
    status: STATUS.OK,
    consecutiveErrors: 0,
    firstErrorAt: null,
    active: true,
    createdAt: now,
    renderMode: MONITOR_SCHEMA_DEFAULTS.renderMode,
    notifyMode: MONITOR_SCHEMA_DEFAULTS.notifyMode,
    keywords: MONITOR_SCHEMA_DEFAULTS.keywords,
    ignorePatterns: MONITOR_SCHEMA_DEFAULTS.ignorePatterns,
    webhookUrl: input.webhookUrl ?? MONITOR_SCHEMA_DEFAULTS.webhookUrl,
  };
}

/**
 * Bring a stored monitor up to the current schema by filling missing fields
 * with defaults. Existing fields are preserved. Returns a new object; does
 * not mutate the input.
 */
export function migrateMonitor(monitor) {
  const merged = { ...monitor };
  for (const [key, value] of Object.entries(MONITOR_SCHEMA_DEFAULTS)) {
    if (merged[key] === undefined) merged[key] = value;
  }
  // Derive origin if missing
  if (merged.origin === undefined && merged.url) {
    try {
      merged.origin = extractOrigin(merged.url);
    } catch {
      merged.origin = '';
    }
  }
  return merged;
}
