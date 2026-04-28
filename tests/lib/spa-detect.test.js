/**
 * detectSpa() — heuristic for whether an HTML response from a URL is a
 * single-page-app skeleton that needs JS rendering before its DOM contains
 * the user-selected content.
 *
 * Heuristic (any one is sufficient):
 *   1. The body has a known SPA framework marker:
 *        - script id="__NEXT_DATA__"  (Next.js)
 *        - element id="__next"        (Next.js root)
 *        - element id="root"          (Create React App / generic React)
 *        - element id="app"           (Vue / Angular)
 *        - element[data-reactroot]    (React server-render)
 *        - script id="__NUXT__"       (Nuxt)
 *        - <html ng-version="">       (Angular)
 *        - <[data-server-rendered]>   (Vue SSR but only client mount)
 *   2. The body's plain text (after script/style removal) is below a low
 *      threshold (default 200 chars) — i.e. the document is mostly an
 *      empty shell.
 *   3. There is a <noscript> element warning the user to enable JS.
 *
 * Returns boolean.
 */

import { describe, it, expect } from 'vitest';
import { detectSpa } from '../../src/lib/spaDetect.js';

describe('detectSpa', () => {
  it('returns false for a server-rendered page with substantial text', () => {
    const html = `
      <!doctype html><html><head><title>Article</title></head>
      <body>
        <h1>Tracking changes on the open web</h1>
        <article>
          ${'Long meaningful content that is fully rendered server-side. '.repeat(20)}
        </article>
      </body></html>
    `;
    expect(detectSpa(html)).toBe(false);
  });

  it('returns true for a Next.js skeleton with __NEXT_DATA__', () => {
    const html = `
      <!doctype html><html><head></head>
      <body>
        <div id="__next"></div>
        <script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>
      </body></html>
    `;
    expect(detectSpa(html)).toBe(true);
  });

  it('returns true for a Create React App empty root', () => {
    const html = `
      <!doctype html><html>
      <body>
        <div id="root"></div>
        <script src="/static/main.js"></script>
      </body></html>
    `;
    expect(detectSpa(html)).toBe(true);
  });

  it('returns true for a Vue/Angular #app skeleton', () => {
    const html = `
      <!doctype html><html>
      <body>
        <div id="app"></div>
        <script src="/main.js"></script>
      </body></html>
    `;
    expect(detectSpa(html)).toBe(true);
  });

  it('returns true for an Angular ng-version page', () => {
    const html = `
      <!doctype html><html ng-version="16.0.0">
      <body><app-root></app-root></body></html>
    `;
    expect(detectSpa(html)).toBe(true);
  });

  it('returns true for a Nuxt skeleton', () => {
    const html = `
      <!doctype html><html><body>
        <div id="__nuxt"></div>
        <script id="__NUXT__">window.__NUXT__={};</script>
      </body></html>
    `;
    expect(detectSpa(html)).toBe(true);
  });

  it('returns true for a noscript-warning page', () => {
    const html = `
      <!doctype html><html><body>
        <noscript>You need to enable JavaScript to run this app.</noscript>
        <div></div>
      </body></html>
    `;
    expect(detectSpa(html)).toBe(true);
  });

  it('returns true when body text is essentially empty', () => {
    const html = `
      <!doctype html><html><body>
        <div class="loading">Loading...</div>
      </body></html>
    `;
    expect(detectSpa(html)).toBe(true);
  });

  it('handles malformed/empty HTML defensively', () => {
    expect(detectSpa('')).toBe(true);
    expect(detectSpa(null)).toBe(true);
    expect(detectSpa(undefined)).toBe(true);
  });

  it('does not flag SSR pages that happen to use #root for a sub-widget', () => {
    // A real SSR page with rich text plus a tiny react root for a widget.
    const html = `
      <!doctype html><html><body>
        <h1>News</h1>
        <article>
          ${'Lorem ipsum dolor sit amet consectetur adipiscing elit. '.repeat(20)}
        </article>
        <div id="root"><div class="widget">A pre-rendered widget.</div></div>
      </body></html>
    `;
    expect(detectSpa(html)).toBe(false);
  });

  it('flags an empty React root even if there is some boilerplate text', () => {
    const html = `
      <!doctype html><html><body>
        <div id="root"></div>
      </body></html>
    `;
    expect(detectSpa(html)).toBe(true);
  });
});
