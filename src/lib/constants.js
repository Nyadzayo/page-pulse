export const RENDER_MODES = {
  FETCH: 'fetch',     // Default: raw HTML fetch (fast, works for static/SSR pages)
  BROWSER: 'browser',  // Opens hidden tab, renders JS, extracts content (works for SPAs + login pages)
};

export const ALARM_NAME = 'pagepulse-tick';
export const ALARM_PERIOD_MINUTES = 1;

export const STATUS = {
  OK: 'ok',
  CHECKING: 'checking',
  BROKEN: 'broken',
  PERMISSION_REVOKED: 'permission_revoked',
};

export const TIERS = {
  FREE: 'free',
  PRO: 'pro',
};

// Free launch: generous limits, no gating
export const TIER_LIMITS = {
  [TIERS.FREE]: {
    maxMonitors: 10,
    minIntervalMs: 300000,          // 5 minutes
    historyRetentionMs: 2592000000, // 30 days
    maxManualChecksPerDay: Infinity,
  },
  [TIERS.PRO]: {
    maxMonitors: 50,
    minIntervalMs: 300000,
    historyRetentionMs: 7776000000,
    maxManualChecksPerDay: Infinity,
  },
};

// Hard caps on stored history per monitor, on top of time-based retention.
// storage.local has a 10MB quota (no unlimitedStorage permission) and a
// noisy monitor with large text changing every tick can fill it well
// inside the retention window — after which every write throws
// kQuotaBytes forever. Field data: one user generated 1.9K quota errors
// in a week. The fallback cap is what we shrink to when a write still
// exceeds quota.
export const MAX_HISTORY_ENTRIES = 200;
export const QUOTA_FALLBACK_HISTORY_ENTRIES = 20;

// A monitor whose content differs on this many consecutive checks has
// latched onto churning content (timestamps, counters, rotating modules).
// Field data: ~97% of checks produced a "change" for such monitors —
// 83 notifications per user in two days, zero clicked. Once noisy,
// instant notifications fall back to the hourly digest until the
// content stabilizes or the user fixes the selection.
export const NOISY_CHANGE_THRESHOLD = 3;

export const MAX_URLS_PER_TICK = 10;
export const MAX_NOTIFICATIONS_PER_TICK = 5;
export const BROKEN_WINDOW_MS = 86400000;
export const BROKEN_THRESHOLD = 3;
export const TEXT_FINGERPRINT_LENGTH = 100;

export const STORAGE_KEYS = {
  MONITORS: 'monitors',
  SETTINGS: 'settings',
  HISTORY_PREFIX: 'history-',
  MANUAL_CHECK_COUNT: 'manualCheckCount',
};

export const DEFAULT_SETTINGS = {
  tier: TIERS.FREE,
  notificationsEnabled: true,
  // Off by default — notification sound is opt-in via the dashboard toggle.
  soundEnabled: false,
  syncEnabled: false,
  aiSummaryEnabled: false,
  aiProvider: 'openai_compatible',
  aiApiKey: '',
  aiApiUrl: '',
  aiModel: '',
  aiSummaryInstruction: '',
  firstRunSeen: false,
  // Anonymous usage statistics (see lib/telemetry.js). Only takes effect
  // once telemetryConfig.js credentials are set; user-toggleable in the
  // dashboard footer.
  telemetryEnabled: true,
};

export const DIFF_MODES = {
  SUMMARY: 'summary',
  DETAILED: 'detailed',
  BOTH: 'both',
};

export const NOTIFY_MODES = {
  INSTANT: 'instant',
  DIGEST: 'digest',
};

export const DIGEST_INTERVALS = [
  { label: '1 hour', ms: 3600000 },
  { label: '6 hours', ms: 21600000 },
  { label: '24 hours', ms: 86400000 },
];

export const DIGEST_ALARM_NAME = 'pagepulse-digest';

// Daily telemetry heartbeat — the source for "weekly users with a healthy
// monitor", the product's real retention metric (popup DAU is meaningless
// for a background monitoring tool).
export const HEARTBEAT_ALARM_NAME = 'pagepulse-heartbeat';
export const HEARTBEAT_PERIOD_MINUTES = 1440;

// All intervals available to everyone for free launch
export const INTERVALS = [
  { label: '5 minutes', ms: 300000, proOnly: false },
  { label: '15 minutes', ms: 900000, proOnly: false },
  { label: '30 minutes', ms: 1800000, proOnly: false },
  { label: '1 hour', ms: 3600000, proOnly: false },
  { label: '6 hours', ms: 21600000, proOnly: false },
  { label: '24 hours', ms: 86400000, proOnly: false },
];
