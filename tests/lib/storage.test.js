import { describe, it, expect, beforeEach } from 'vitest';
import {
  getMonitors, getMonitor, saveMonitor, deleteMonitor, updateMonitor,
  getHistory, appendHistory, getSettings, updateSettings,
} from '../../src/lib/storage.js';
import { STORAGE_KEYS, DEFAULT_SETTINGS, TIERS, TIER_LIMITS } from '../../src/lib/constants.js';

describe('storage', () => {
  describe('monitors', () => {
    it('returns empty object when no monitors exist', async () => {
      const monitors = await getMonitors();
      expect(monitors).toEqual({});
    });

    it('saves and retrieves a monitor', async () => {
      const monitor = {
        id: 'test-1', url: 'https://example.com', origin: 'https://example.com',
        selector: '#price', xpath: '/html/body/div/span', textFingerprint: 'Price: $29.99',
        label: 'Test Monitor', baseline: '$29.99', intervalMs: 3600000,
        lastChecked: null, lastChanged: null, changeCount: 0, status: 'ok',
        consecutiveErrors: 0, firstErrorAt: null, active: true, createdAt: Date.now(),
      };
      await saveMonitor(monitor);
      const result = await getMonitor('test-1');
      expect(result).toEqual(monitor);
    });

    it('updates specific fields on a monitor', async () => {
      await saveMonitor({ id: 'test-1', label: 'Original', status: 'ok', active: true });
      await updateMonitor('test-1', { label: 'Updated', status: 'broken' });
      const result = await getMonitor('test-1');
      expect(result.label).toBe('Updated');
      expect(result.status).toBe('broken');
      expect(result.active).toBe(true);
    });

    it('deletes a monitor and its history', async () => {
      await saveMonitor({ id: 'test-1', label: 'Delete Me' });
      await appendHistory('test-1', { ts: 1, old: 'a', new: 'b' }, TIERS.FREE);
      await deleteMonitor('test-1');
      expect(await getMonitor('test-1')).toBeUndefined();
      expect(await getHistory('test-1')).toEqual([]);
    });

    it('returns all monitors as an object', async () => {
      await saveMonitor({ id: 'a', label: 'A' });
      await saveMonitor({ id: 'b', label: 'B' });
      const all = await getMonitors();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all.a.label).toBe('A');
    });
  });

  describe('history', () => {
    it('returns empty array when no history exists', async () => {
      expect(await getHistory('nonexistent')).toEqual([]);
    });

    it('appends history entries', async () => {
      await appendHistory('m1', { ts: 1000, old: 'a', new: 'b' }, TIERS.FREE);
      await appendHistory('m1', { ts: 2000, old: 'b', new: 'c' }, TIERS.FREE);
      const history = await getHistory('m1');
      expect(history).toHaveLength(2);
    });

    it('prunes entries older than tier retention', async () => {
      const now = Date.now();
      const eightDaysAgo = now - (8 * 24 * 60 * 60 * 1000);
      await appendHistory('m1', { ts: eightDaysAgo, old: 'old', new: 'stale' }, TIERS.FREE);
      await appendHistory('m1', { ts: now, old: 'stale', new: 'fresh' }, TIERS.FREE);
      const history = await getHistory('m1');
      expect(history).toHaveLength(1);
      expect(history[0].new).toBe('fresh');
    });
  });

  describe('settings', () => {
    it('returns default settings when none exist', async () => {
      expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    });

    it('updates settings', async () => {
      await updateSettings({ tier: TIERS.PRO });
      const settings = await getSettings();
      expect(settings.tier).toBe(TIERS.PRO);
      expect(settings.notificationsEnabled).toBe(true);
    });
  });
});
