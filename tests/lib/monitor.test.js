import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeMonitor } from '../../src/lib/monitor.js';
import { runMigrations, MonitorStore } from '../../src/lib/storage.js';
import {
  STORAGE_KEYS, STATUS, TIERS, TIER_LIMITS, RENDER_MODES, NOTIFY_MODES,
} from '../../src/lib/constants.js';

describe('makeMonitor factory', () => {
  it('produces a complete monitor with all required fields from minimal input', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('uuid-1');
    const now = 1700000000000;
    const m = makeMonitor(
      {
        url: 'https://example.com/page',
        selector: '#price',
        xpath: '/html/body/div',
        textFingerprint: 'Price: $29.99',
        baseline: '$29.99',
      },
      { tier: TIERS.FREE, now },
    );
    expect(m.id).toBe('uuid-1');
    expect(m.url).toBe('https://example.com/page');
    expect(m.origin).toBe('https://example.com');
    expect(m.selector).toBe('#price');
    expect(m.xpath).toBe('/html/body/div');
    expect(m.textFingerprint).toBe('Price: $29.99');
    expect(m.baseline).toBe('$29.99');
    expect(m.label).toBe('Monitor on example.com');
    expect(m.intervalMs).toBe(TIER_LIMITS[TIERS.FREE].minIntervalMs);
    expect(m.lastChecked).toBeNull();
    expect(m.lastChanged).toBeNull();
    expect(m.changeCount).toBe(0);
    expect(m.status).toBe(STATUS.OK);
    expect(m.consecutiveErrors).toBe(0);
    expect(m.firstErrorAt).toBeNull();
    expect(m.active).toBe(true);
    expect(m.createdAt).toBe(now);
    expect(m.renderMode).toBe(RENDER_MODES.FETCH);
    expect(m.notifyMode).toBe(NOTIFY_MODES.INSTANT);
    expect(m.keywords).toBe('');
    expect(m.ignorePatterns).toBe('');
    expect(m.webhookUrl).toBe('');
    expect(m.aiSummaryInstruction).toBe('');
  });

  it('persists a caller-provided aiSummaryInstruction through the factory', () => {
    const m = makeMonitor(
      { url: 'https://example.com', selector: '#x', baseline: 'a', aiSummaryInstruction: 'Output one tweet.' },
      { tier: TIERS.FREE, now: Date.now() },
    );
    expect(m.aiSummaryInstruction).toBe('Output one tweet.');
  });

  it('persists a caller-provided webhookUrl through the factory', () => {
    const m = makeMonitor(
      { url: 'https://example.com', selector: '#x', baseline: 'a', webhookUrl: 'https://hooks.slack.com/services/X' },
      { tier: TIERS.FREE, now: Date.now() },
    );
    expect(m.webhookUrl).toBe('https://hooks.slack.com/services/X');
  });

  it('honors a caller-provided label', () => {
    const m = makeMonitor(
      { url: 'https://example.com', selector: '#x', baseline: 'a' },
      { tier: TIERS.FREE, now: Date.now(), label: 'Custom Label' },
    );
    expect(m.label).toBe('Custom Label');
  });

  it('uses the data.label field when provided over the hostname default', () => {
    const m = makeMonitor(
      { url: 'https://example.com', selector: '#x', baseline: 'a', label: 'From Data' },
      { tier: TIERS.FREE, now: Date.now() },
    );
    expect(m.label).toBe('From Data');
  });

  it('uses tier-specific minimum interval', () => {
    const free = makeMonitor(
      { url: 'https://example.com', selector: '#x', baseline: 'a' },
      { tier: TIERS.FREE, now: Date.now() },
    );
    const pro = makeMonitor(
      { url: 'https://example.com', selector: '#x', baseline: 'a' },
      { tier: TIERS.PRO, now: Date.now() },
    );
    expect(free.intervalMs).toBe(TIER_LIMITS[TIERS.FREE].minIntervalMs);
    expect(pro.intervalMs).toBe(TIER_LIMITS[TIERS.PRO].minIntervalMs);
  });

  it('respects an overridden intervalMs', () => {
    const m = makeMonitor(
      { url: 'https://example.com', selector: '#x', baseline: 'a' },
      { tier: TIERS.FREE, now: Date.now(), intervalMs: 86400000 },
    );
    expect(m.intervalMs).toBe(86400000);
  });

  it('produces a stable origin from the URL', () => {
    const m = makeMonitor(
      { url: 'https://news.ycombinator.com/news?id=42', selector: 'a', baseline: 'x' },
      { tier: TIERS.FREE, now: Date.now() },
    );
    expect(m.origin).toBe('https://news.ycombinator.com');
  });
});

describe('runMigrations', () => {
  let store;

  beforeEach(() => {
    store = new MonitorStore();
  });

  it('is a no-op when there are no monitors', async () => {
    await runMigrations();
    expect(await store.list()).toEqual({});
  });

  it('fills missing schema fields on legacy monitors with sensible defaults', async () => {
    // A "legacy" monitor with the minimum old-schema fields and no
    // renderMode/notifyMode/keywords/ignorePatterns.
    const legacy = {
      id: 'legacy-1',
      url: 'https://old.example.com/page',
      selector: '#x',
      xpath: '/html/body',
      textFingerprint: 'old',
      label: 'Legacy',
      baseline: 'old',
      intervalMs: 3600000,
      lastChecked: null,
      lastChanged: null,
      changeCount: 0,
      status: STATUS.OK,
      consecutiveErrors: 0,
      firstErrorAt: null,
      active: true,
      createdAt: 1,
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.MONITORS]: { [legacy.id]: legacy } });

    await runMigrations();

    const migrated = await store.get('legacy-1');
    expect(migrated.renderMode).toBe(RENDER_MODES.FETCH);
    expect(migrated.notifyMode).toBe(NOTIFY_MODES.INSTANT);
    expect(migrated.keywords).toBe('');
    expect(migrated.ignorePatterns).toBe('');
    // origin should be derived if missing
    expect(migrated.origin).toBe('https://old.example.com');
    // existing fields preserved
    expect(migrated.label).toBe('Legacy');
    expect(migrated.baseline).toBe('old');
    expect(migrated.changeCount).toBe(0);
  });

  it('does not overwrite existing schema fields', async () => {
    const monitor = {
      id: 'm1',
      url: 'https://example.com',
      origin: 'https://example.com',
      selector: '#x',
      label: 'Pre-set',
      baseline: 'b',
      intervalMs: 900000,
      changeCount: 2,
      status: STATUS.OK,
      active: true,
      createdAt: 1,
      renderMode: RENDER_MODES.BROWSER,
      notifyMode: NOTIFY_MODES.DIGEST,
      keywords: 'foo',
      ignorePatterns: '\\d+',
      consecutiveErrors: 0,
      firstErrorAt: null,
      lastChecked: null,
      lastChanged: null,
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.MONITORS]: { m1: monitor } });
    await runMigrations();
    const after = await store.get('m1');
    expect(after.renderMode).toBe(RENDER_MODES.BROWSER);
    expect(after.notifyMode).toBe(NOTIFY_MODES.DIGEST);
    expect(after.keywords).toBe('foo');
    expect(after.ignorePatterns).toBe('\\d+');
  });

  it('writes back to storage so subsequent reads get the migrated shape', async () => {
    const legacy = {
      id: 'legacy-2',
      url: 'https://x.com/p',
      selector: '#a',
      label: 'L',
      baseline: 'b',
      active: true,
      changeCount: 0,
      status: STATUS.OK,
      consecutiveErrors: 0,
      firstErrorAt: null,
      lastChecked: null,
      lastChanged: null,
      intervalMs: 3600000,
      createdAt: 1,
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.MONITORS]: { [legacy.id]: legacy } });
    await runMigrations();
    // Re-read raw storage to confirm persistence
    const raw = await chrome.storage.local.get(STORAGE_KEYS.MONITORS);
    expect(raw[STORAGE_KEYS.MONITORS]['legacy-2'].renderMode).toBe(RENDER_MODES.FETCH);
  });

  it('is idempotent — running twice produces the same shape', async () => {
    const legacy = {
      id: 'legacy-3',
      url: 'https://y.com/q',
      selector: '#a',
      label: 'L',
      baseline: 'b',
      active: true,
      changeCount: 0,
      status: STATUS.OK,
      consecutiveErrors: 0,
      firstErrorAt: null,
      lastChecked: null,
      lastChanged: null,
      intervalMs: 3600000,
      createdAt: 1,
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.MONITORS]: { [legacy.id]: legacy } });
    await runMigrations();
    const first = await store.get('legacy-3');
    await runMigrations();
    const second = await store.get('legacy-3');
    expect(second).toEqual(first);
  });
});
