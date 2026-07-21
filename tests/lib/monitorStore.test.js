import { describe, it, expect, beforeEach } from 'vitest';
import { MonitorStore } from '../../src/lib/storage.js';
import {
  STORAGE_KEYS,
  TIERS,
  MAX_HISTORY_ENTRIES,
  QUOTA_FALLBACK_HISTORY_ENTRIES,
} from '../../src/lib/constants.js';

describe('MonitorStore', () => {
  let store;

  beforeEach(() => {
    store = new MonitorStore();
  });

  describe('list/get', () => {
    it('returns an empty object when no monitors exist', async () => {
      const monitors = await store.list();
      expect(monitors).toEqual({});
    });

    it('returns undefined when getting a nonexistent monitor by id', async () => {
      const monitor = await store.get('missing');
      expect(monitor).toBeUndefined();
    });

    it('exposes the same data as the underlying storage key', async () => {
      await chrome.storage.local.set({
        [STORAGE_KEYS.MONITORS]: { 'a': { id: 'a', label: 'A' } },
      });
      const monitors = await store.list();
      expect(monitors).toEqual({ a: { id: 'a', label: 'A' } });
      expect(await store.get('a')).toEqual({ id: 'a', label: 'A' });
    });
  });

  describe('save', () => {
    it('saves a monitor and reads it back', async () => {
      const monitor = {
        id: 'm1',
        url: 'https://example.com',
        label: 'My Monitor',
        active: true,
      };
      await store.save(monitor);
      expect(await store.get('m1')).toEqual(monitor);
    });

    it('overwrites an existing monitor with the same id', async () => {
      await store.save({ id: 'm1', label: 'Original', active: true });
      await store.save({ id: 'm1', label: 'Replaced', active: false });
      const result = await store.get('m1');
      expect(result.label).toBe('Replaced');
      expect(result.active).toBe(false);
    });

    it('does not affect other monitors', async () => {
      await store.save({ id: 'a', label: 'A' });
      await store.save({ id: 'b', label: 'B' });
      expect(Object.keys(await store.list())).toHaveLength(2);
    });
  });

  describe('update', () => {
    it('merges updates into an existing monitor', async () => {
      await store.save({ id: 'm1', label: 'A', status: 'ok', active: true });
      await store.update('m1', { label: 'B', status: 'broken' });
      const result = await store.get('m1');
      expect(result.label).toBe('B');
      expect(result.status).toBe('broken');
      expect(result.active).toBe(true);
    });

    it('is a no-op when monitor does not exist', async () => {
      await store.update('missing', { label: 'X' });
      expect(await store.get('missing')).toBeUndefined();
    });
  });

  describe('remove', () => {
    it('removes the monitor and its history', async () => {
      await store.save({ id: 'm1', label: 'X' });
      await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY_PREFIX + 'm1']: [{ ts: 1 }] });
      await store.remove('m1');
      expect(await store.get('m1')).toBeUndefined();
      const result = await chrome.storage.local.get(STORAGE_KEYS.HISTORY_PREFIX + 'm1');
      expect(result[STORAGE_KEYS.HISTORY_PREFIX + 'm1']).toBeUndefined();
    });
  });

  describe('history', () => {
    it('returns an empty array for monitors with no history', async () => {
      expect(await store.getHistory('m1')).toEqual([]);
    });

    it('appends entries with tier-based pruning', async () => {
      const now = Date.now();
      const old = now - (40 * 24 * 60 * 60 * 1000);
      await store.appendHistory('m1', { ts: old, old: 'a', new: 'b' }, TIERS.FREE);
      await store.appendHistory('m1', { ts: now, old: 'b', new: 'c' }, TIERS.FREE);
      const history = await store.getHistory('m1');
      expect(history).toHaveLength(1);
      expect(history[0].new).toBe('c');
    });

    it('caps history at MAX_HISTORY_ENTRIES even inside the retention window', async () => {
      const now = Date.now();
      const key = STORAGE_KEYS.HISTORY_PREFIX + 'm1';
      const entries = Array.from({ length: MAX_HISTORY_ENTRIES + 50 }, (_, i) => ({
        ts: now - (MAX_HISTORY_ENTRIES + 50 - i) * 1000, old: 'a', new: `v${i}`,
      }));
      chrome.storage.local._store[key] = entries;
      await store.appendHistory('m1', { ts: now, old: 'x', new: 'newest' }, TIERS.FREE);
      const history = await store.getHistory('m1');
      expect(history).toHaveLength(MAX_HISTORY_ENTRIES);
      expect(history[history.length - 1].new).toBe('newest');
    });

    it('shrinks to the fallback cap and retries when the write exceeds quota', async () => {
      const now = Date.now();
      const key = STORAGE_KEYS.HISTORY_PREFIX + 'm1';
      chrome.storage.local._store[key] = Array.from({ length: 100 }, (_, i) => ({
        ts: now - (100 - i) * 1000, old: 'a', new: `v${i}`,
      }));
      chrome.storage.local.set.mockRejectedValueOnce(
        new Error('Resource::kQuotaBytes quota exceeded'),
      );
      await store.appendHistory('m1', { ts: now, old: 'x', new: 'newest' }, TIERS.FREE);
      const history = await store.getHistory('m1');
      expect(history).toHaveLength(QUOTA_FALLBACK_HISTORY_ENTRIES);
      expect(history[history.length - 1].new).toBe('newest');
    });
  });

  describe('compatibility with module functions', () => {
    it('writes via MonitorStore are visible to module getMonitor()', async () => {
      const { getMonitor } = await import('../../src/lib/storage.js');
      await store.save({ id: 'shared', label: 'Shared' });
      expect((await getMonitor('shared')).label).toBe('Shared');
    });

    it('writes via module saveMonitor() are visible to MonitorStore.get()', async () => {
      const { saveMonitor } = await import('../../src/lib/storage.js');
      await saveMonitor({ id: 'shared', label: 'Shared' });
      expect((await store.get('shared')).label).toBe('Shared');
    });
  });
});
