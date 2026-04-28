import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SYNCABLE_FIELDS,
  selectSyncableFields,
  extractSyncableConfigs,
  mergeSyncedConfigs,
  pushConfigsToSync,
  pullConfigsFromSync,
} from '../../src/lib/configSync.js';

describe('configSync', () => {
  describe('selectSyncableFields', () => {
    it('returns ONLY config fields, never baseline/history/state', () => {
      const monitor = {
        id: 'a',
        url: 'https://x.com',
        origin: 'https://x.com',
        selector: '#price',
        xpath: '/x',
        label: 'Hi',
        intervalMs: 300000,
        keywords: 'rust',
        ignorePatterns: '\\d+',
        renderMode: 'browser',
        notifyMode: 'instant',
        webhookUrl: 'https://hooks.slack.com/x',
        active: true,
        // Local-only state — must NOT leak into sync:
        baseline: 'sensitive page text',
        textFingerprint: 'fp',
        lastChecked: 1700000000000,
        lastChanged: 1700000000000,
        changeCount: 7,
        status: 'broken',
        consecutiveErrors: 3,
        firstErrorAt: 1700000000000,
        createdAt: 1700000000000,
        unreadChangeCount: 2,
      };
      const synced = selectSyncableFields(monitor);
      const expectedFields = SYNCABLE_FIELDS.slice().sort();
      expect(Object.keys(synced).sort()).toEqual(expectedFields);
      expect(synced).not.toHaveProperty('baseline');
      expect(synced).not.toHaveProperty('history');
      expect(synced).not.toHaveProperty('lastChecked');
      expect(synced).not.toHaveProperty('changeCount');
      expect(synced).not.toHaveProperty('unreadChangeCount');
      expect(synced).not.toHaveProperty('textFingerprint');
    });
  });

  describe('extractSyncableConfigs', () => {
    it('returns an array of synced configs, one per monitor in the input map', () => {
      const monitors = {
        a: { id: 'a', url: 'https://a.com', label: 'A', baseline: 'x', selector: '#a', xpath: '', keywords: '', ignorePatterns: '', renderMode: 'fetch', notifyMode: 'instant', webhookUrl: '', active: true, intervalMs: 300000 },
        b: { id: 'b', url: 'https://b.com', label: 'B', baseline: 'y', selector: '#b', xpath: '', keywords: '', ignorePatterns: '', renderMode: 'fetch', notifyMode: 'instant', webhookUrl: '', active: false, intervalMs: 300000 },
      };
      const configs = extractSyncableConfigs(monitors);
      expect(configs).toHaveLength(2);
      const ids = configs.map((c) => c.id).sort();
      expect(ids).toEqual(['a', 'b']);
      expect(configs[0]).not.toHaveProperty('baseline');
    });

    it('returns empty array for empty monitors object', () => {
      expect(extractSyncableConfigs({})).toEqual([]);
    });
  });

  describe('mergeSyncedConfigs', () => {
    const stateFields = (m) => ({
      baseline: m.baseline ?? 'b',
      lastChecked: m.lastChecked ?? null,
      lastChanged: m.lastChanged ?? null,
      changeCount: m.changeCount ?? 0,
      status: m.status ?? 'ok',
      consecutiveErrors: m.consecutiveErrors ?? 0,
      firstErrorAt: m.firstErrorAt ?? null,
      createdAt: m.createdAt ?? 1,
      unreadChangeCount: m.unreadChangeCount ?? 0,
      textFingerprint: m.textFingerprint ?? '',
      origin: m.origin ?? '',
    });

    it('adds new synced monitor to local with default state fields', () => {
      const local = {};
      const synced = [
        { id: 'new', url: 'https://x.com', label: 'New', selector: '#x', xpath: '', keywords: '', ignorePatterns: '', renderMode: 'fetch', notifyMode: 'instant', webhookUrl: '', active: true, intervalMs: 300000 },
      ];
      const merged = mergeSyncedConfigs(local, synced, { now: 1234 });
      expect(merged.new).toBeDefined();
      expect(merged.new.label).toBe('New');
      expect(merged.new.baseline).toBe('');
      expect(merged.new.lastChecked).toBeNull();
      expect(merged.new.changeCount).toBe(0);
      expect(merged.new.createdAt).toBe(1234);
    });

    it('updates config fields on existing local monitor without touching state', () => {
      const local = {
        a: { id: 'a', url: 'https://a.com', label: 'OLD', selector: '#a', xpath: '', keywords: '', ignorePatterns: '', renderMode: 'fetch', notifyMode: 'instant', webhookUrl: '', active: true, intervalMs: 300000, ...stateFields({ baseline: 'KEEP', changeCount: 99 }) },
      };
      const synced = [
        { id: 'a', url: 'https://a.com', label: 'NEW', selector: '#a-new', xpath: '', keywords: 'new', ignorePatterns: '', renderMode: 'fetch', notifyMode: 'instant', webhookUrl: '', active: true, intervalMs: 600000 },
      ];
      const merged = mergeSyncedConfigs(local, synced, { now: 1234 });
      expect(merged.a.label).toBe('NEW');
      expect(merged.a.selector).toBe('#a-new');
      expect(merged.a.keywords).toBe('new');
      expect(merged.a.intervalMs).toBe(600000);
      // Local-only state preserved:
      expect(merged.a.baseline).toBe('KEEP');
      expect(merged.a.changeCount).toBe(99);
    });

    it('does not touch local monitors that are not in the synced list (one-way pull)', () => {
      const local = {
        a: { id: 'a', url: 'https://a.com', label: 'A', selector: '#a', xpath: '', keywords: '', ignorePatterns: '', renderMode: 'fetch', notifyMode: 'instant', webhookUrl: '', active: true, intervalMs: 300000, ...stateFields({}) },
      };
      const synced = [];
      const merged = mergeSyncedConfigs(local, synced, { now: 1234 });
      expect(merged.a).toBeDefined();
      expect(merged.a.label).toBe('A');
    });
  });

  describe('pushConfigsToSync / pullConfigsFromSync', () => {
    beforeEach(() => {
      chrome.storage.sync._store = {};
      vi.clearAllMocks();
    });

    it('pushConfigsToSync writes the configs array under SYNCED_CONFIGS key', async () => {
      const configs = [{ id: 'a', url: 'u', label: 'L', selector: '#a', xpath: '', keywords: '', ignorePatterns: '', renderMode: 'fetch', notifyMode: 'instant', webhookUrl: '', active: true, intervalMs: 300000 }];
      await pushConfigsToSync(configs);
      const stored = await chrome.storage.sync.get('syncedMonitorConfigs');
      expect(stored.syncedMonitorConfigs).toEqual(configs);
    });

    it('pullConfigsFromSync returns the stored array, or empty when missing', async () => {
      expect(await pullConfigsFromSync()).toEqual([]);
      const configs = [{ id: 'a', url: 'u', label: 'L', selector: '#a', xpath: '', keywords: '', ignorePatterns: '', renderMode: 'fetch', notifyMode: 'instant', webhookUrl: '', active: true, intervalMs: 300000 }];
      await chrome.storage.sync.set({ syncedMonitorConfigs: configs });
      expect(await pullConfigsFromSync()).toEqual(configs);
    });

    it('pushConfigsToSync silently swallows quota errors (returns false)', async () => {
      chrome.storage.sync.set = vi.fn().mockRejectedValue(new Error('QUOTA_BYTES quota exceeded'));
      const result = await pushConfigsToSync([{ id: 'big' }]);
      expect(result).toBe(false);
    });
  });
});
