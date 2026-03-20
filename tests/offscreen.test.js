import { describe, it, expect } from 'vitest';
import { parseAndQuery } from '../src/offscreen.js';

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
