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
  soundEnabled: true,
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

// All intervals available to everyone for free launch
export const INTERVALS = [
  { label: '5 minutes', ms: 300000, proOnly: false },
  { label: '15 minutes', ms: 900000, proOnly: false },
  { label: '30 minutes', ms: 1800000, proOnly: false },
  { label: '1 hour', ms: 3600000, proOnly: false },
  { label: '6 hours', ms: 21600000, proOnly: false },
  { label: '24 hours', ms: 86400000, proOnly: false },
];
