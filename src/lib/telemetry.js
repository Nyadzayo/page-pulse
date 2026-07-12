/**
 * Anonymous product telemetry via the GA4 Measurement Protocol.
 *
 * Privacy contract (enforced in code, not just policy):
 *   - Random UUID client id; no account, email, IP handling, or fingerprinting.
 *   - Event params pass through a strict per-event allowlist. Keys that could
 *     carry browsing data (url, hostname, selector, label, text, ...) are
 *     rejected even if a call site tries to send them.
 *   - String values are truncated to 90 chars.
 *   - Silent no-op when: credentials unset (telemetryConfig.js), the user
 *     turned the toggle off (settings.telemetryEnabled === false), or the
 *     network call fails. Telemetry must never break product behaviour.
 *
 * Why Measurement Protocol and not gtag.js: MV3 service workers have no DOM
 * and remote scripts are banned by extension CSP. MP is a plain fetch, works
 * identically from the service worker, popup, and dashboard contexts.
 */

import { TELEMETRY_MEASUREMENT_ID, TELEMETRY_API_SECRET } from './telemetryConfig.js';
import { getSettings } from './storage.js';

const ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const SESSION_EXPIRATION_MIN = 30;
const MAX_STRING_LENGTH = 90;

const CLIENT_ID_KEY = 'telemetryClientId';
const SESSION_KEY = 'telemetrySession';
const FIRSTS_KEY = 'telemetryFirsts';
export const INSTALLED_AT_KEY = 'installedAt';

// Keys that must never appear in an event payload, regardless of schema.
const FORBIDDEN_PARAM_KEYS = new Set([
  'url', 'href', 'hostname', 'origin', 'domain', 'page', 'title',
  'selector', 'xpath', 'label', 'text', 'content', 'baseline', 'value',
  'old', 'new', 'keywords', 'webhook', 'api_key', 'email', 'query',
]);

// Per-event param allowlists. An event not listed here is rejected —
// add it deliberately, with the minimum params that answer a real
// product question. No vanity events.
export const EVENT_SCHEMA = {
  extension_installed: ['version'],
  extension_updated: ['version'],
  extension_opened: ['surface', 'monitor_count'],
  onboarding_started: ['surface'],
  onboarding_completed: ['surface'],
  monitor_creation_started: ['surface'],
  monitor_created: ['render_mode', 'interval_minutes', 'monitor_count', 'via'],
  monitor_creation_failed: ['reason', 'surface'],
  first_monitor_created: ['hours_since_install', 'render_mode'],
  monitor_check_completed: ['checks', 'failures', 'changes'],
  monitor_check_failed: ['reason'],
  monitor_noisy: ['streak'],
  change_detected: ['count'],
  first_change_detected: ['hours_since_install'],
  notification_sent: ['kind', 'count'],
  notification_clicked: ['kind'],
  change_viewed: ['unread_count'],
  monitor_edited: ['field'],
  monitor_paused: ['surface', 'paused'],
  monitor_deleted: ['age_days', 'change_count'],
  share_clicked: ['action'],
  heartbeat: [
    'monitors_total', 'monitors_active', 'monitors_paused',
    'monitors_healthy', 'monitors_broken', 'days_since_install', 'version',
  ],
  extension_error: ['context', 'message'],
};

export function isTelemetryConfigured() {
  return Boolean(TELEMETRY_MEASUREMENT_ID && TELEMETRY_API_SECRET);
}

async function isTelemetryEnabled() {
  try {
    const settings = await getSettings();
    return settings.telemetryEnabled !== false;
  } catch {
    return false;
  }
}

async function getClientId() {
  const stored = await chrome.storage.local.get(CLIENT_ID_KEY);
  let id = stored[CLIENT_ID_KEY];
  if (!id) {
    id = crypto.randomUUID();
    await chrome.storage.local.set({ [CLIENT_ID_KEY]: id });
  }
  return id;
}

// GA4 only counts a user as "active" when events carry a session_id and a
// non-zero engagement time. Session state lives in chrome.storage.session
// (survives service-worker restarts, dies with the browser) with a
// chrome.storage.local fallback for contexts/tests where session is absent.
function sessionArea() {
  return chrome.storage.session || chrome.storage.local;
}

async function getOrCreateSessionId(now = Date.now()) {
  const area = sessionArea();
  const stored = await area.get(SESSION_KEY);
  let session = stored[SESSION_KEY];
  if (!session || now - session.ts > SESSION_EXPIRATION_MIN * 60 * 1000) {
    session = { id: String(now), ts: now };
  } else {
    session = { ...session, ts: now };
  }
  await area.set({ [SESSION_KEY]: session });
  return session.id;
}

function sanitizeParams(eventName, params) {
  const allowed = EVENT_SCHEMA[eventName];
  if (!allowed) return null;
  const clean = {};
  for (const key of allowed) {
    if (FORBIDDEN_PARAM_KEYS.has(key)) continue;
    const value = params ? params[key] : undefined;
    if (value === undefined || value === null) continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      clean[key] = value;
    } else if (typeof value === 'boolean') {
      clean[key] = String(value);
    } else if (typeof value === 'string') {
      clean[key] = value.slice(0, MAX_STRING_LENGTH);
    }
    // Objects/arrays/functions are silently dropped.
  }
  return clean;
}

/**
 * Fire-and-forget analytics event. Never throws; never blocks callers.
 * Returns true when a request was actually attempted (useful in tests).
 */
export async function trackEvent(eventName, params = {}) {
  try {
    if (!isTelemetryConfigured()) return false;
    if (!(await isTelemetryEnabled())) return false;

    const clean = sanitizeParams(eventName, params);
    if (clean === null) {
      console.warn(`[PagePulse] telemetry: unknown event "${eventName}" dropped`);
      return false;
    }

    const [clientId, sessionId] = await Promise.all([
      getClientId(),
      getOrCreateSessionId(),
    ]);

    await fetch(
      `${ENDPOINT}?measurement_id=${TELEMETRY_MEASUREMENT_ID}&api_secret=${TELEMETRY_API_SECRET}`,
      {
        method: 'POST',
        body: JSON.stringify({
          client_id: clientId,
          events: [{
            name: eventName,
            params: {
              ...clean,
              session_id: sessionId,
              engagement_time_msec: 100,
            },
          }],
        }),
      },
    );
    return true;
  } catch {
    return false; // telemetry is best-effort, never surface errors
  }
}

/**
 * Track a once-per-install milestone (first_monitor_created,
 * first_change_detected, onboarding_*). Deduplicated via a persisted
 * flag so retries, multiple surfaces, and SW restarts can't double-fire.
 */
export async function trackOnce(eventName, params = {}) {
  try {
    const stored = await chrome.storage.local.get(FIRSTS_KEY);
    const firsts = stored[FIRSTS_KEY] || {};
    if (firsts[eventName]) return false;
    firsts[eventName] = Date.now();
    await chrome.storage.local.set({ [FIRSTS_KEY]: firsts });
    return trackEvent(eventName, params);
  } catch {
    return false;
  }
}

/**
 * Record a runtime failure. `message` is truncated and must already be
 * free of page data — pass error.message, never page content or URLs.
 */
export async function trackError(context, error) {
  const message = String((error && error.message) || error || 'unknown').slice(0, MAX_STRING_LENGTH);
  return trackEvent('extension_error', { context, message });
}

/** Hours between install and now, for time-to-activation params. */
export async function getHoursSinceInstall(now = Date.now()) {
  try {
    const stored = await chrome.storage.local.get(INSTALLED_AT_KEY);
    const installedAt = stored[INSTALLED_AT_KEY];
    if (!installedAt) return null;
    return Math.round((now - installedAt) / 3600000 * 10) / 10;
  } catch {
    return null;
  }
}
