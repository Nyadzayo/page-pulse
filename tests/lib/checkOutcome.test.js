import { describe, it, expect } from 'vitest';
import { evaluateCheck } from '../../src/lib/scheduler.js';
import { STATUS, BROKEN_THRESHOLD, BROKEN_WINDOW_MS } from '../../src/lib/constants.js';

describe('evaluateCheck (CheckOutcome)', () => {
  describe('shape', () => {
    it('returns an object with changed, historyEntry, monitorUpdates', () => {
      const monitor = {
        id: 'm1', baseline: 'hello', status: STATUS.OK,
        consecutiveErrors: 0, firstErrorAt: null, changeCount: 0,
      };
      const result = { monitorId: 'm1', text: 'hello', matchedBy: 'selector' };
      const outcome = evaluateCheck(monitor, result, Date.now());
      expect(outcome).toHaveProperty('changed');
      expect(outcome).toHaveProperty('historyEntry');
      expect(outcome).toHaveProperty('monitorUpdates');
      expect(typeof outcome.changed).toBe('boolean');
      expect(typeof outcome.monitorUpdates).toBe('object');
    });

    it('monitorUpdates never contains "changed" or "historyEntry" keys', () => {
      const monitor = {
        id: 'm1', baseline: 'hello', status: STATUS.OK,
        consecutiveErrors: 0, firstErrorAt: null, changeCount: 0,
      };
      const result = { monitorId: 'm1', text: 'world', matchedBy: 'selector' };
      const outcome = evaluateCheck(monitor, result, Date.now());
      expect(outcome.monitorUpdates).not.toHaveProperty('changed');
      expect(outcome.monitorUpdates).not.toHaveProperty('historyEntry');
    });
  });

  describe('unchanged value', () => {
    it('returns changed:false and null historyEntry', () => {
      const monitor = {
        id: 'm1', baseline: 'hello', status: STATUS.OK,
        consecutiveErrors: 0, firstErrorAt: null, changeCount: 0,
      };
      const now = Date.now();
      const outcome = evaluateCheck(
        monitor,
        { monitorId: 'm1', text: 'hello', matchedBy: 'selector' },
        now,
      );
      expect(outcome.changed).toBe(false);
      expect(outcome.historyEntry).toBeNull();
      expect(outcome.monitorUpdates.lastChecked).toBe(now);
      expect(outcome.monitorUpdates.consecutiveErrors).toBe(0);
      expect(outcome.monitorUpdates.status).toBe(STATUS.OK);
    });
  });

  describe('meaningful change', () => {
    it('returns changed:true with populated historyEntry and updated baseline', () => {
      const monitor = {
        id: 'm1', baseline: 'Price: $29', status: STATUS.OK,
        consecutiveErrors: 0, firstErrorAt: null, changeCount: 2,
      };
      const now = Date.now();
      const outcome = evaluateCheck(
        monitor,
        { monitorId: 'm1', text: 'Price: $24', matchedBy: 'selector' },
        now,
      );
      expect(outcome.changed).toBe(true);
      expect(outcome.historyEntry).toEqual({ ts: now, old: 'Price: $29', new: 'Price: $24' });
      expect(outcome.monitorUpdates.baseline).toBe('Price: $24');
      expect(outcome.monitorUpdates.changeCount).toBe(3);
      expect(outcome.monitorUpdates.lastChanged).toBe(now);
    });
  });

  describe('error path', () => {
    it('increments consecutiveErrors and sets firstErrorAt when result is null', () => {
      const now = Date.now();
      const monitor = {
        id: 'm1', baseline: 'x', status: STATUS.OK,
        consecutiveErrors: 0, firstErrorAt: null, changeCount: 0,
      };
      const outcome = evaluateCheck(
        monitor,
        { monitorId: 'm1', text: null, matchedBy: null },
        now,
      );
      expect(outcome.changed).toBe(false);
      expect(outcome.historyEntry).toBeNull();
      expect(outcome.monitorUpdates.consecutiveErrors).toBe(1);
      expect(outcome.monitorUpdates.firstErrorAt).toBe(now);
      expect(outcome.monitorUpdates.status).toBe(STATUS.OK);
    });

    it('marks as broken after threshold over the broken window', () => {
      const now = Date.now();
      const monitor = {
        id: 'm1', baseline: 'x', status: STATUS.OK,
        consecutiveErrors: BROKEN_THRESHOLD - 1,
        firstErrorAt: now - BROKEN_WINDOW_MS - 1000,
        changeCount: 0,
      };
      const outcome = evaluateCheck(
        monitor,
        { monitorId: 'm1', text: null, matchedBy: null },
        now,
      );
      expect(outcome.monitorUpdates.status).toBe(STATUS.BROKEN);
    });
  });

  describe('keyword filter', () => {
    it('updates baseline silently when keywords do not match (changed:false, no historyEntry)', () => {
      const monitor = {
        id: 'm1', baseline: 'Price: $29', status: STATUS.OK,
        consecutiveErrors: 0, firstErrorAt: null, changeCount: 0,
        keywords: 'rust',
      };
      const outcome = evaluateCheck(
        monitor,
        { monitorId: 'm1', text: 'Price: $24', matchedBy: 'selector' },
        Date.now(),
      );
      expect(outcome.changed).toBe(false);
      expect(outcome.historyEntry).toBeNull();
      expect(outcome.monitorUpdates.baseline).toBe('Price: $24');
    });

    it('fires change when keyword matches the added text', () => {
      const monitor = {
        id: 'm1', baseline: 'old text', status: STATUS.OK,
        consecutiveErrors: 0, firstErrorAt: null, changeCount: 0,
        keywords: 'rust',
      };
      const outcome = evaluateCheck(
        monitor,
        { monitorId: 'm1', text: 'old text with rust news', matchedBy: 'selector' },
        Date.now(),
      );
      expect(outcome.changed).toBe(true);
      expect(outcome.historyEntry).not.toBeNull();
    });
  });

  describe('backwards compatibility', () => {
    it('processCheckResults still returns the legacy flat shape', async () => {
      const { processCheckResults } = await import('../../src/lib/scheduler.js');
      const monitor = {
        id: 'm1', baseline: 'a', status: STATUS.OK,
        consecutiveErrors: 0, firstErrorAt: null, changeCount: 0,
      };
      const updates = processCheckResults(
        monitor,
        { monitorId: 'm1', text: 'b', matchedBy: 'selector' },
        Date.now(),
      );
      // Legacy callers expect flat keys
      expect(updates).toHaveProperty('changed');
      expect(updates).toHaveProperty('historyEntry');
      expect(updates).toHaveProperty('lastChecked');
      expect(updates.changed).toBe(true);
    });
  });
});
