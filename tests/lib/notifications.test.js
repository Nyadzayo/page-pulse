import { describe, it, expect, vi } from 'vitest';
import { notifyChange, notifyBatch, truncateMessage, updateBadge } from '../../src/lib/notifications.js';
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
    it('creates a Chrome notification with monitor label and message', async () => {
      await notifyChange({ id: 'm1', label: 'Price Watch' }, '$24.99');
      expect(chrome.notifications.create).toHaveBeenCalledWith(
        expect.stringContaining('pagepulse-m1-'),
        expect.objectContaining({ type: 'basic', title: 'Price Watch', message: '$24.99', priority: 2 })
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
    it('updates badge with change count', async () => {
      const changes = [{ monitor: { id: 'm1', label: 'Test' }, newValue: 'v' }];
      await notifyBatch(changes);
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '1' });
      expect(chrome.action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#10B981' });
    });
  });

  describe('updateBadge', () => {
    it('sets badge text for positive count', () => {
      updateBadge(5);
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '5' });
    });
    it('clears badge for zero', () => {
      updateBadge(0);
      expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    });
  });
});
