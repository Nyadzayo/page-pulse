import { describe, it, expect, vi, beforeEach } from 'vitest';
import { filterDueMonitors, groupByUrl, processCheckResults, limitUrlBatch } from '../../src/lib/scheduler.js';
import { STATUS, BROKEN_THRESHOLD, BROKEN_WINDOW_MS, MAX_URLS_PER_TICK } from '../../src/lib/constants.js';

describe('scheduler', () => {
  describe('filterDueMonitors', () => {
    it('includes monitors that have never been checked', () => {
      const monitors = { m1: { id: 'm1', active: true, status: STATUS.OK, lastChecked: null, intervalMs: 3600000 } };
      expect(filterDueMonitors(monitors, Date.now())).toHaveLength(1);
    });

    it('includes monitors whose interval has elapsed', () => {
      const now = Date.now();
      const monitors = { m1: { id: 'm1', active: true, status: STATUS.OK, lastChecked: now - 4000000, intervalMs: 3600000 } };
      expect(filterDueMonitors(monitors, now)).toHaveLength(1);
    });

    it('excludes monitors not yet due', () => {
      const now = Date.now();
      const monitors = { m1: { id: 'm1', active: true, status: STATUS.OK, lastChecked: now - 1000, intervalMs: 3600000 } };
      expect(filterDueMonitors(monitors, now)).toHaveLength(0);
    });

    it('excludes inactive monitors', () => {
      const monitors = { m1: { id: 'm1', active: false, status: STATUS.OK, lastChecked: null, intervalMs: 3600000 } };
      expect(filterDueMonitors(monitors, Date.now())).toHaveLength(0);
    });

    it('excludes broken monitors', () => {
      const monitors = { m1: { id: 'm1', active: true, status: STATUS.BROKEN, lastChecked: null, intervalMs: 3600000 } };
      expect(filterDueMonitors(monitors, Date.now())).toHaveLength(0);
    });

    it('excludes permission_revoked monitors', () => {
      const monitors = { m1: { id: 'm1', active: true, status: STATUS.PERMISSION_REVOKED, lastChecked: null, intervalMs: 3600000 } };
      expect(filterDueMonitors(monitors, Date.now())).toHaveLength(0);
    });
  });

  describe('groupByUrl', () => {
    it('groups monitors by URL', () => {
      const monitors = [
        { id: 'm1', url: 'https://a.com/page' },
        { id: 'm2', url: 'https://a.com/page' },
        { id: 'm3', url: 'https://b.com/other' },
      ];
      const groups = groupByUrl(monitors);
      expect(Object.keys(groups)).toHaveLength(2);
      expect(groups['https://a.com/page']).toHaveLength(2);
    });
  });

  describe('limitUrlBatch', () => {
    it('limits URLs to MAX_URLS_PER_TICK', () => {
      const groups = {};
      for (let i = 0; i < 15; i++) groups[`https://site${i}.com`] = [{ id: `m${i}` }];
      const limited = limitUrlBatch(groups);
      expect(limited.length).toBe(MAX_URLS_PER_TICK);
    });

    it('returns all URLs if under limit', () => {
      const groups = { 'https://a.com': [{ id: 'm1' }], 'https://b.com': [{ id: 'm2' }] };
      expect(limitUrlBatch(groups).length).toBe(2);
    });
  });

  describe('processCheckResults', () => {
    it('marks unchanged monitors as checked', () => {
      const monitor = { id: 'm1', baseline: 'hello', status: STATUS.OK, consecutiveErrors: 0, firstErrorAt: null, changeCount: 0 };
      const result = { monitorId: 'm1', text: 'hello', matchedBy: 'selector' };
      const updates = processCheckResults(monitor, result, Date.now());
      expect(updates.changed).toBe(false);
      expect(updates.consecutiveErrors).toBe(0);
    });

    it('detects changes and produces diff metadata', () => {
      const monitor = { id: 'm1', baseline: 'Price: $29', status: STATUS.OK, consecutiveErrors: 0, firstErrorAt: null, changeCount: 0 };
      const result = { monitorId: 'm1', text: 'Price: $24', matchedBy: 'selector' };
      const now = Date.now();
      const updates = processCheckResults(monitor, result, now);
      expect(updates.changed).toBe(true);
      expect(updates.baseline).toBe('Price: $24');
      expect(updates.changeCount).toBe(1);
      expect(updates.historyEntry.old).toBe('Price: $29');
      expect(updates.historyEntry.new).toBe('Price: $24');
    });

    it('increments errors when selector not found', () => {
      const now = Date.now();
      const monitor = { id: 'm1', baseline: 'x', status: STATUS.OK, consecutiveErrors: 0, firstErrorAt: null, changeCount: 0 };
      const result = { monitorId: 'm1', text: null, matchedBy: null };
      const updates = processCheckResults(monitor, result, now);
      expect(updates.consecutiveErrors).toBe(1);
      expect(updates.firstErrorAt).toBe(now);
      expect(updates.status).toBe(STATUS.OK);
    });

    it('marks as broken after threshold errors over 24hr window', () => {
      const now = Date.now();
      const monitor = { id: 'm1', baseline: 'x', status: STATUS.OK, consecutiveErrors: BROKEN_THRESHOLD - 1, firstErrorAt: now - BROKEN_WINDOW_MS - 1000, changeCount: 0 };
      const result = { monitorId: 'm1', text: null, matchedBy: null };
      const updates = processCheckResults(monitor, result, now);
      expect(updates.status).toBe(STATUS.BROKEN);
    });

    it('does NOT mark broken if errors within 24hr window', () => {
      const now = Date.now();
      const monitor = { id: 'm1', baseline: 'x', status: STATUS.OK, consecutiveErrors: BROKEN_THRESHOLD - 1, firstErrorAt: now - 3600000, changeCount: 0 };
      const result = { monitorId: 'm1', text: null, matchedBy: null };
      const updates = processCheckResults(monitor, result, now);
      expect(updates.status).toBe(STATUS.OK);
    });

    it('resets errors on successful check', () => {
      const monitor = { id: 'm1', baseline: 'hello', status: STATUS.OK, consecutiveErrors: 2, firstErrorAt: Date.now() - 10000, changeCount: 0 };
      const result = { monitorId: 'm1', text: 'hello', matchedBy: 'xpath' };
      const updates = processCheckResults(monitor, result, Date.now());
      expect(updates.consecutiveErrors).toBe(0);
      expect(updates.firstErrorAt).toBeNull();
    });
  });
});
