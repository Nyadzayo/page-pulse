import { describe, it, expect, vi } from 'vitest';
import { parseAndQuery, iframeRender, queryDocument } from '../src/offscreen.js';

describe('offscreen parseAndQuery', () => {
  const html = `
    <html><body>
      <div id="container">
        <span class="price">$29.99</span>
        <p class="desc">Great product</p>
      </div>
    </body></html>
  `;

  it('finds element by CSS selector', () => {
    const queries = [{ monitorId: 'm1', selector: '#container .price', xpath: '' }];
    const results = parseAndQuery(html, queries);
    expect(results[0].text).toBe('$29.99');
    expect(results[0].matchedBy).toBe('selector');
  });

  it('falls back to XPath when selector fails', () => {
    const queries = [{ monitorId: 'm1', selector: '.nonexistent', xpath: '/html/body/div[1]/p[1]' }];
    const results = parseAndQuery(html, queries);
    expect(results[0].text).toBe('Great product');
    expect(results[0].matchedBy).toBe('xpath');
  });

  it('returns null when both fail', () => {
    const queries = [{ monitorId: 'm1', selector: '.nope', xpath: '/html/body/div[99]' }];
    const results = parseAndQuery(html, queries);
    expect(results[0].text).toBeNull();
    expect(results[0].matchedBy).toBeNull();
  });

  it('processes multiple queries against same HTML', () => {
    const queries = [
      { monitorId: 'm1', selector: '.price', xpath: '' },
      { monitorId: 'm2', selector: '.desc', xpath: '' },
    ];
    const results = parseAndQuery(html, queries);
    expect(results).toHaveLength(2);
    expect(results[0].text).toBe('$29.99');
    expect(results[1].text).toBe('Great product');
  });
});

// ─── queryDocument: shared CSS+XPath lookup against a live document ────────
describe('offscreen queryDocument', () => {
  it('finds element by CSS selector from a live Document', () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><span class="p">42</span></body></html>',
      'text/html',
    );
    const queries = [{ monitorId: 'm1', selector: '.p', xpath: '' }];
    const results = queryDocument(doc, queries);
    expect(results[0].text).toBe('42');
    expect(results[0].matchedBy).toBe('selector');
  });

  it('falls back to XPath against a live Document', () => {
    const doc = new DOMParser().parseFromString(
      '<html><body><div><p>x</p></div></body></html>',
      'text/html',
    );
    const queries = [
      { monitorId: 'm1', selector: '.nope', xpath: '/html/body/div[1]/p[1]' },
    ];
    const results = queryDocument(doc, queries);
    expect(results[0].text).toBe('x');
    expect(results[0].matchedBy).toBe('xpath');
  });

  it('returns nulls when both miss', () => {
    const doc = new DOMParser().parseFromString('<html><body></body></html>', 'text/html');
    const queries = [{ monitorId: 'm1', selector: '.nope', xpath: '/x/y/z' }];
    const results = queryDocument(doc, queries);
    expect(results[0].text).toBeNull();
    expect(results[0].matchedBy).toBeNull();
  });
});

// ─── iframeRender: hidden-iframe path for SPA pages ───────────────────────
//
// In jsdom we cannot navigate a real iframe to a URL, but iframeRender is
// designed to be testable: callers inject a factory that returns an
// iframe-like host. The host is responsible for resolving with a Document
// once the iframe has loaded (or rejecting on timeout).
describe('offscreen iframeRender', () => {
  it('extracts text via CSS selector from the iframe document', async () => {
    const iframeHtml = `
      <html><body>
        <div id="root">
          <h1 class="title">Hello SPA</h1>
        </div>
      </body></html>
    `;
    const factory = vi.fn(() =>
      Promise.resolve(new DOMParser().parseFromString(iframeHtml, 'text/html')),
    );

    const queries = [{ monitorId: 'mA', selector: '.title', xpath: '' }];
    const results = await iframeRender('https://example.com/spa', queries, {
      loadDocument: factory,
      settleMs: 0,
    });

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory.mock.calls[0][0]).toBe('https://example.com/spa');
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ monitorId: 'mA', text: 'Hello SPA', matchedBy: 'selector' });
  });

  it('falls back to XPath when CSS selector misses', async () => {
    const iframeHtml = `
      <html><body><section><span>$99</span></section></body></html>
    `;
    const factory = () =>
      Promise.resolve(new DOMParser().parseFromString(iframeHtml, 'text/html'));

    const queries = [
      { monitorId: 'mB', selector: '.missing', xpath: '/html/body/section/span' },
    ];
    const results = await iframeRender('https://example.com', queries, {
      loadDocument: factory,
      settleMs: 0,
    });

    expect(results[0].text).toBe('$99');
    expect(results[0].matchedBy).toBe('xpath');
  });

  it('returns null entries when load times out / factory rejects', async () => {
    const factory = () => Promise.reject(new Error('load-failed'));
    const queries = [
      { monitorId: 'mC', selector: '.x', xpath: '/x' },
      { monitorId: 'mD', selector: '.y', xpath: '/y' },
    ];
    const results = await iframeRender('https://broken', queries, {
      loadDocument: factory,
      settleMs: 0,
    });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.text === null && r.matchedBy === null)).toBe(true);
    expect(results.map((r) => r.monitorId)).toEqual(['mC', 'mD']);
  });

  it('returns null entries when factory resolves with no document', async () => {
    const factory = () => Promise.resolve(null);
    const queries = [{ monitorId: 'mE', selector: '.x', xpath: '/x' }];
    const results = await iframeRender('https://blank', queries, {
      loadDocument: factory,
      settleMs: 0,
    });
    expect(results[0].text).toBeNull();
    expect(results[0].matchedBy).toBeNull();
  });
});
