import { describe, it, expect, vi } from 'vitest';
import { notifyChange, notifyBatch, truncateMessage } from '../../src/lib/notifications.js';
import { MAX_NOTIFICATIONS_PER_TICK } from '../../src/lib/constants.js';

describe('notifications', () => {
  describe('truncateMessage', () => {
    it('returns text as-is if under 80 chars', () => {
      expect(truncateMessage('short')).toBe('short');
    });
    it('truncates at 80 chars with ellipsis', () => {
      const long = 'a'.repeat(100);
      const result = truncateMessage(long);
      expect(result.length).toBe(80);
      expect(result.endsWith('...')).toBe(true);
    });
  });

  describe('notifyChange', () => {
    it('creates a Chrome notification with monitor label and truncated new value', async () => {
      await notifyChange({ id: 'm1', label: 'Price Watch' }, '$24.99');
      expect(chrome.notifications.create).toHaveBeenCalledWith(
        'm1',
        expect.objectContaining({ type: 'basic', title: 'Price Watch', message: '$24.99' })
      );
    });
  });

  describe('notifyBatch', () => {
    it('fires individual notifications up to MAX limit', async () => {
      const changes = Array.from({ length: 3 }, (_, i) => ({
        monitor: { id: `m${i}`, label: `Monitor ${i}` }, newValue: `value ${i}`,
      }));
      await notifyBatch(changes);
      expect(chrome.notifications.create).toHaveBeenCalledTimes(3);
    });
    it('batches into summary when over MAX limit', async () => {
      const changes = Array.from({ length: 8 }, (_, i) => ({
        monitor: { id: `m${i}`, label: `Monitor ${i}` }, newValue: `value ${i}`,
      }));
      await notifyBatch(changes);
      expect(chrome.notifications.create).toHaveBeenCalledTimes(6); // 5 individual + 1 batch
    });
  });
});
