// ─── Shared helpers ────────────────────────────────────────────────────────

import { matchFingerprint } from './lib/selectorRecovery.js';

/**
 * Run the CSS+XPath fallback against a parsed Document and return one
 * result per query. Used by both parseAndQuery (HTML string input) and
 * iframeRender (live iframe Document input).
 *
 * If a query also carries a `textFingerprint` and the CSS+XPath both
 * miss, we attempt selector recovery via matchFingerprint(): when a
 * sufficiently similar element is found, the result includes
 * `matchedBy: 'fingerprint'` and a `recoveredSelector` the caller is
 * expected to persist back to the monitor.
 */
export function queryDocument(doc, queries) {
  return queries.map(({ monitorId, selector, xpath, textFingerprint }) => {
    if (selector) {
      try {
        const el = doc.querySelector(selector);
        if (el) return { monitorId, text: el.textContent.trim(), matchedBy: 'selector' };
      } catch { /* invalid selector, fall through */ }
    }
    if (xpath) {
      try {
        const result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const el = result.singleNodeValue;
        if (el) return { monitorId, text: el.textContent.trim(), matchedBy: 'xpath' };
      } catch { /* invalid xpath, fall through */ }
    }
    if (textFingerprint) {
      try {
        const match = matchFingerprint(doc, textFingerprint);
        if (match) {
          return {
            monitorId,
            text: match.text,
            matchedBy: 'fingerprint',
            recoveredSelector: match.selector,
          };
        }
      } catch { /* fingerprint walk failed, fall through */ }
    }
    return { monitorId, text: null, matchedBy: null };
  });
}

export function parseAndQuery(html, queries) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  return queryDocument(doc, queries);
}

// ─── Iframe render path (Chrome offscreen IFRAME_SCRIPTING) ────────────────
//
// The offscreen document loads a hidden iframe to the target URL, waits
// for the iframe to dispatch `load` plus a short settle delay, then queries
// `iframe.contentDocument` with the same CSS+XPath fallback used by the
// fetch path. This works for SPAs and other JS-rendered pages without
// needing a visible tab.
//
// Production path: callers omit opts.loadDocument; we build a real iframe.
// Tests: callers inject opts.loadDocument(url) → Promise<Document|null>.

const DEFAULT_LOAD_TIMEOUT_MS = 30000;
const DEFAULT_SETTLE_MS = 2000;

export async function iframeRender(url, queries, opts = {}) {
  const {
    loadDocument = defaultLoadDocument,
    settleMs = DEFAULT_SETTLE_MS,
    timeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
  } = opts;

  let doc;
  try {
    doc = await withTimeout(loadDocument(url, { settleMs, timeoutMs }), timeoutMs);
  } catch {
    doc = null;
  }

  if (!doc) {
    return queries.map((q) => ({ monitorId: q.monitorId, text: null, matchedBy: null }));
  }

  return queryDocument(doc, queries);
}

function withTimeout(promise, ms) {
  if (!promise || typeof promise.then !== 'function') return Promise.resolve(promise);
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('iframe-load-timeout')), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// Default loader — builds a hidden iframe, awaits load, returns the
// contentDocument. Lives in the offscreen document; safe in any DOM
// context (offscreen or unit tests provide their own loader).
function defaultLoadDocument(url, { settleMs = DEFAULT_SETTLE_MS, timeoutMs = DEFAULT_LOAD_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('no-document'));
      return;
    }
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-99999px;top:-99999px;width:1px;height:1px;border:0;visibility:hidden;';
    iframe.setAttribute('aria-hidden', 'true');

    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try { iframe.remove(); } catch { /* ignore */ }
    };

    iframe.addEventListener('load', () => {
      if (settled) return;
      // Give the SPA's JS extra time to render dynamic content.
      setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          const doc = iframe.contentDocument;
          // Detach iframe AFTER reading the document — we hold a reference,
          // but cleanup may invalidate access on some platforms.
          resolve(doc || null);
        } catch (e) {
          resolve(null);
        } finally {
          cleanup();
        }
      }, settleMs);
    });

    iframe.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('iframe-error'));
    });

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('iframe-load-timeout'));
    }, timeoutMs);

    iframe.src = url;
    document.body.appendChild(iframe);
  });
}

// ─── Message handler (offscreen document context) ─────────────────────────

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.target !== 'offscreen') return;

    if (msg.action === 'parseAndQuery') {
      const results = parseAndQuery(msg.html, msg.queries);
      sendResponse({ results });
      return; // sync
    }

    if (msg.action === 'iframeRender') {
      iframeRender(msg.url, msg.queries).then(
        (results) => sendResponse({ results }),
        (err) => sendResponse({ results: msg.queries.map((q) => ({ monitorId: q.monitorId, text: null, matchedBy: null })), error: err?.message }),
      );
      return true; // async
    }

    if (msg.action === 'playSound') {
      try {
        const RATE = 22050;
        const dur = 0.3;
        const len = Math.floor(RATE * dur);
        const samples = new Float32Array(len);
        for (let i = 0; i < len; i++) {
          const t = i / RATE;
          const half = dur / 2;
          const freq = t < half ? 523.25 : 659.25;
          const vol = t < half ? 1 - (t / half) * 0.3 : 1 - (t - half) / half;
          const env = Math.min(1, t * 50) * Math.min(1, (dur - t) * 20) * vol * 0.4;
          samples[i] = Math.sin(2 * Math.PI * freq * t) * env;
        }
        const ctx = new AudioContext();
        const buf = ctx.createBuffer(1, len, RATE);
        buf.getChannelData(0).set(samples);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.value = 0.5;
        src.connect(gain);
        gain.connect(ctx.destination);
        src.start();
        src.onended = () => { ctx.close(); sendResponse({ success: true }); };
        return true; // async
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    }
  });
}
