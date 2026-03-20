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

export const TIER_LIMITS = {
  [TIERS.FREE]: {
    maxMonitors: 5,
    minIntervalMs: 3600000,
    historyRetentionMs: 604800000,
    maxManualChecksPerDay: 3,
  },
  [TIERS.PRO]: {
    maxMonitors: 50,
    minIntervalMs: 900000,
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
};

export const INTERVALS = [
  { label: '15 minutes', ms: 900000, proOnly: true },
  { label: '30 minutes', ms: 1800000, proOnly: true },
  { label: '1 hour', ms: 3600000, proOnly: false },
  { label: '6 hours', ms: 21600000, proOnly: false },
  { label: '24 hours', ms: 86400000, proOnly: false },
];
