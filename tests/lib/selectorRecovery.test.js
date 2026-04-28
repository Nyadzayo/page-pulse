/**
 * Tests for the textFingerprint-based selector fallback.
 *
 * When CSS and XPath both miss for a monitor on a check, we walk the
 * parsed document looking for an element whose
 * `textContent.trim().substring(0, TEXT_FINGERPRINT_LENGTH)` is
 * similar (Levenshtein-derived) to monitor.textFingerprint within
 * SIMILARITY_THRESHOLD. If found, we recover by persisting the new
 * CSS selector and continue checking. If not found and the monitor's
 * consecutive error count hits BROKEN_THRESHOLD, we surface a one-time
 * "broken" notification — but only once per BROKEN transition so the
 * recovery doesn't re-fire every tick.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  levenshtein,
  similarity,
  matchFingerprint,
  recoverSelector,
  shouldFireBrokenNotification,
} from '../../src/lib/selectorRecovery.js';
import { createBrokenMonitorNotification } from '../../src/lib/notifications.js';
import { STATUS } from '../../src/lib/constants.js';

describe('levenshtein / similarity helpers', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
    expect(similarity('hello', 'hello')).toBe(1);
  });

  it('counts substitutions, insertions, deletions', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('similarity ratio is in [0,1] and decreases with distance', () => {
    expect(similarity('abcdef', 'abcdef')).toBe(1);
    expect(similarity('abcdef', 'abxxef')).toBeCloseTo(4 / 6, 5);
    expect(similarity('abcdef', '')).toBe(0);
  });

  it('handles empty / undefined strings', () => {
    expect(similarity('', '')).toBe(1);
    expect(similarity(undefined, 'abc')).toBe(0);
    expect(similarity('abc', undefined)).toBe(0);
  });
});

describe('matchFingerprint — walks DOM looking for a matching element', () => {
  function docFrom(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  it('returns the element whose first-100-chars of text best matches the fingerprint', () => {
    const html = `
      <html><body>
        <div id="page">
          <h1>Site header</h1>
          <p class="other">A paragraph that is unrelated.</p>
          <div class="price-box"><span>Price: $19.99 (was $29.99) free shipping</span></div>
          <footer>©2024</footer>
        </div>
      </body></html>
    `;
    const doc = docFrom(html);
    const fingerprint = 'Price: $19.99 (was $29.99) free shipping';
    const match = matchFingerprint(doc, fingerprint);
    expect(match).toBeTruthy();
    expect(match.text).toContain('Price: $19.99');
    expect(match.similarity).toBeGreaterThanOrEqual(0.8);
    expect(match.selector).toBeTruthy();
  });

  it('tolerates small text drift (≤20% edit distance) and still matches', () => {
    const html = `
      <html><body>
        <div class="info"><span>Stock: 42 units in warehouse</span></div>
      </body></html>
    `;
    const doc = docFrom(html);
    // Close to "Stock: 50 units in warehouse" — edit distance 2 (one digit change ~ 2 chars).
    const fingerprint = 'Stock: 50 units in warehouse';
    const match = matchFingerprint(doc, fingerprint);
    expect(match).toBeTruthy();
    expect(match.similarity).toBeGreaterThanOrEqual(0.8);
  });

  it('returns null when no element is sufficiently similar', () => {
    const html = `
      <html><body>
        <p>Completely different paragraph content here</p>
        <p>Another distinct paragraph with new layout</p>
      </body></html>
    `;
    const doc = docFrom(html);
    const fingerprint = 'Price: $19.99 (was $29.99) free shipping today only';
    const match = matchFingerprint(doc, fingerprint);
    expect(match).toBeNull();
  });

  it('returns null for empty or missing fingerprint', () => {
    const doc = docFrom('<html><body><p>x</p></body></html>');
    expect(matchFingerprint(doc, '')).toBeNull();
    expect(matchFingerprint(doc, undefined)).toBeNull();
    expect(matchFingerprint(doc, null)).toBeNull();
  });

  it('produces a CSS selector for the recovered element that re-resolves', () => {
    const html = `
      <html><body>
        <main>
          <section class="prices">
            <span data-testid="price">Price: $42.00 in stock</span>
          </section>
        </main>
      </body></html>
    `;
    const doc = docFrom(html);
    const fingerprint = 'Price: $42.00 in stock';
    const match = matchFingerprint(doc, fingerprint);
    expect(match).toBeTruthy();
    // Re-resolve via the produced selector — must hit the same element.
    const resolved = doc.querySelector(match.selector);
    expect(resolved).not.toBeNull();
    expect(resolved.textContent.trim()).toBe(fingerprint);
  });
});

describe('recoverSelector — bridges matchFingerprint into the check pipeline', () => {
  function docFrom(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  it('returns recovered: true with a new selector and text when match succeeds', () => {
    const html = `
      <html><body>
        <div class="renamed-container"><p>Tracking notice: changes detected</p></div>
      </body></html>
    `;
    const doc = docFrom(html);
    const monitor = {
      id: 'm1',
      selector: '.old-stale-selector',
      xpath: '/html/body/div[2]/p',
      textFingerprint: 'Tracking notice: changes detected',
    };
    const out = recoverSelector(monitor, doc);
    expect(out.recovered).toBe(true);
    expect(out.newSelector).toBeTruthy();
    expect(out.newText).toBe('Tracking notice: changes detected');
  });

  it('returns recovered: false when no element matches', () => {
    const doc = docFrom('<html><body><p>nothing here matches</p></body></html>');
    const monitor = {
      id: 'm2',
      selector: '.gone',
      xpath: '/x/y',
      textFingerprint: 'A long, very specific fingerprint nobody on this page emits',
    };
    const out = recoverSelector(monitor, doc);
    expect(out.recovered).toBe(false);
    expect(out.newSelector).toBeUndefined();
  });

  it('returns recovered: false when monitor has no fingerprint', () => {
    const doc = docFrom('<html><body><p>a</p></body></html>');
    const monitor = { id: 'm3', selector: '.x', xpath: '/x' };
    const out = recoverSelector(monitor, doc);
    expect(out.recovered).toBe(false);
  });
});

describe('shouldFireBrokenNotification — idempotent gating', () => {
  it('fires when monitor transitions from OK → BROKEN', () => {
    const before = { status: STATUS.OK, consecutiveErrors: 2 };
    const updates = { status: STATUS.BROKEN, consecutiveErrors: 3 };
    expect(shouldFireBrokenNotification(before, updates)).toBe(true);
  });

  it('does NOT fire when monitor was already BROKEN', () => {
    const before = { status: STATUS.BROKEN, consecutiveErrors: 5 };
    const updates = { status: STATUS.BROKEN, consecutiveErrors: 6 };
    expect(shouldFireBrokenNotification(before, updates)).toBe(false);
  });

  it('does NOT fire when status stays OK', () => {
    const before = { status: STATUS.OK, consecutiveErrors: 1 };
    const updates = { status: STATUS.OK, consecutiveErrors: 2 };
    expect(shouldFireBrokenNotification(before, updates)).toBe(false);
  });

  it('does NOT fire when permission is revoked (different surface)', () => {
    const before = { status: STATUS.OK };
    const updates = { status: STATUS.PERMISSION_REVOKED };
    expect(shouldFireBrokenNotification(before, updates)).toBe(false);
  });

  it('handles a missing prior status (newly created monitor) safely', () => {
    const before = {};
    const updates = { status: STATUS.BROKEN };
    expect(shouldFireBrokenNotification(before, updates)).toBe(true);
  });
});

describe('createBrokenMonitorNotification — wired through chrome.notifications', () => {
  beforeEach(() => {
    chrome.notifications.create.mockClear();
  });

  it('fires a chrome notification with a stable id keyed by monitor id', async () => {
    await createBrokenMonitorNotification({ id: 'mABC', label: 'Price tracker' });
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    const call = chrome.notifications.create.mock.calls[0];
    expect(call[0]).toBe('pagepulse-broken-mABC');
    expect(call[1]).toMatchObject({
      type: 'basic',
      title: expect.stringContaining('Price tracker'),
      message: expect.stringMatching(/re-?select/i),
      priority: 2,
    });
  });

  it('returns null and does not throw when monitor is missing', async () => {
    const out = await createBrokenMonitorNotification(null);
    expect(out).toBeNull();
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('returns null when monitor lacks an id (cannot key notification)', async () => {
    const out = await createBrokenMonitorNotification({ label: 'no-id' });
    expect(out).toBeNull();
    expect(chrome.notifications.create).not.toHaveBeenCalled();
  });

  it('using a deterministic id allows Chrome to coalesce/replace prior broken notifs (idempotent UI)', async () => {
    await createBrokenMonitorNotification({ id: 'mDup', label: 'Dup' });
    await createBrokenMonitorNotification({ id: 'mDup', label: 'Dup' });
    expect(chrome.notifications.create).toHaveBeenCalledTimes(2);
    // Same id both times → Chrome itself coalesces / replaces.
    expect(chrome.notifications.create.mock.calls[0][0]).toBe('pagepulse-broken-mDup');
    expect(chrome.notifications.create.mock.calls[1][0]).toBe('pagepulse-broken-mDup');
  });
});
