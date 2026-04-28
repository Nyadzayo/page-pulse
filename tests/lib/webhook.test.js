import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildWebhookPayload, fireWebhook, isValidWebhookUrl } from '../../src/lib/webhook.js';

describe('webhook', () => {
  describe('buildWebhookPayload', () => {
    it('returns structured payload with type, monitor, and change details', () => {
      const monitor = { id: 'abc', label: 'Job postings', url: 'https://example.com/jobs' };
      const change = { old: 'no listings', new: 'Senior Engineer', ts: 1700000000000 };
      const payload = buildWebhookPayload(monitor, change);
      expect(payload.type).toBe('change');
      expect(payload.monitor).toEqual({ id: 'abc', label: 'Job postings', url: 'https://example.com/jobs' });
      expect(payload.change).toEqual({ old: 'no listings', new: 'Senior Engineer', ts: 1700000000000 });
    });

    it('includes a Slack-friendly text field with the monitor label and new value', () => {
      const monitor = { id: 'a', label: 'Price drop', url: 'https://x.com' };
      const change = { old: '$100', new: '$80', ts: 1700000000000 };
      const payload = buildWebhookPayload(monitor, change);
      expect(payload.text).toContain('Price drop');
      expect(payload.text).toContain('$80');
    });

    it('includes a Discord-friendly content field with the same summary', () => {
      const monitor = { id: 'a', label: 'Lab', url: 'https://x.com' };
      const change = { old: 'old', new: 'new', ts: 1700000000000 };
      const payload = buildWebhookPayload(monitor, change);
      expect(payload.content).toBe(payload.text);
    });

    it('truncates very long new values in text/content but keeps full value in change.new', () => {
      const longValue = 'x'.repeat(500);
      const monitor = { id: 'a', label: 'Long', url: 'https://x.com' };
      const change = { old: 'old', new: longValue, ts: 1700000000000 };
      const payload = buildWebhookPayload(monitor, change);
      expect(payload.text.length).toBeLessThanOrEqual(300);
      expect(payload.change.new).toBe(longValue);
    });
  });

  describe('isValidWebhookUrl', () => {
    it('accepts https URLs', () => {
      expect(isValidWebhookUrl('https://hooks.slack.com/services/X/Y/Z')).toBe(true);
      expect(isValidWebhookUrl('https://discord.com/api/webhooks/123/abc')).toBe(true);
    });

    it('accepts http URLs (for self-hosted endpoints)', () => {
      expect(isValidWebhookUrl('http://localhost:3000/hook')).toBe(true);
    });

    it('rejects non-http schemes', () => {
      expect(isValidWebhookUrl('javascript:alert(1)')).toBe(false);
      expect(isValidWebhookUrl('file:///etc/passwd')).toBe(false);
      expect(isValidWebhookUrl('chrome-extension://abc/x')).toBe(false);
    });

    it('rejects malformed URLs', () => {
      expect(isValidWebhookUrl('not a url')).toBe(false);
      expect(isValidWebhookUrl('')).toBe(false);
      expect(isValidWebhookUrl(null)).toBe(false);
      expect(isValidWebhookUrl(undefined)).toBe(false);
    });
  });

  describe('fireWebhook', () => {
    let fetchSpy;
    beforeEach(() => {
      fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      global.fetch = fetchSpy;
    });

    it('POSTs JSON to the webhook URL', async () => {
      const monitor = { id: 'a', label: 'Test', url: 'https://x.com' };
      const change = { old: 'o', new: 'n', ts: 1 };
      await fireWebhook('https://hooks.slack.com/services/X', monitor, change);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://hooks.slack.com/services/X');
      expect(opts.method).toBe('POST');
      expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
      const body = JSON.parse(opts.body);
      expect(body.monitor.label).toBe('Test');
      expect(body.change.new).toBe('n');
    });

    it('returns true on a 2xx response', async () => {
      const result = await fireWebhook('https://x.com/hook', { id: 'a', label: 'L', url: 'u' }, { old: 'o', new: 'n', ts: 1 });
      expect(result).toBe(true);
    });

    it('returns false on a non-2xx response', async () => {
      fetchSpy.mockResolvedValue({ ok: false, status: 500 });
      const result = await fireWebhook('https://x.com/hook', { id: 'a', label: 'L', url: 'u' }, { old: 'o', new: 'n', ts: 1 });
      expect(result).toBe(false);
    });

    it('returns false and does not throw on network failure', async () => {
      fetchSpy.mockRejectedValue(new Error('network failure'));
      const result = await fireWebhook('https://x.com/hook', { id: 'a', label: 'L', url: 'u' }, { old: 'o', new: 'n', ts: 1 });
      expect(result).toBe(false);
    });

    it('refuses non-http(s) URLs without firing fetch', async () => {
      const result = await fireWebhook('javascript:alert(1)', { id: 'a', label: 'L', url: 'u' }, { old: 'o', new: 'n', ts: 1 });
      expect(result).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('aborts fetch with AbortController after timeout', async () => {
      let signalSeen = null;
      fetchSpy.mockImplementation((url, opts) => {
        signalSeen = opts.signal;
        return new Promise((_, reject) => {
          opts.signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      });
      const result = await fireWebhook(
        'https://x.com/hook',
        { id: 'a', label: 'L', url: 'u' },
        { old: 'o', new: 'n', ts: 1 },
        { timeoutMs: 10 },
      );
      expect(result).toBe(false);
      expect(signalSeen).toBeInstanceOf(AbortSignal);
      expect(signalSeen.aborted).toBe(true);
    });
  });
});
