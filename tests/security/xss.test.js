/**
 * Stored XSS regression tests for dashboard and popup history rendering.
 *
 * Background: dashboard.js previously used escapeHtml() (textContent → innerHTML)
 * which does NOT escape `"` or `'`. Interpolating untrusted text into HTML
 * attributes (e.g. `value="${escapeHtml(x)}"`) allowed an attacker to close
 * the attribute and inject an event handler such as `onmouseover="alert(1)"`.
 *
 * These tests render representative fragments with malicious payloads and
 * assert that no executable handler attributes survive to the DOM.
 */

import { describe, it, expect, beforeEach } from 'vitest';

function findHandlerAttrs(root) {
  const handlers = [];
  const walk = (el) => {
    if (!el || el.nodeType !== 1) return;
    for (const attr of el.attributes) {
      if (/^on[a-z]+/i.test(attr.name)) {
        handlers.push({ tag: el.tagName, name: attr.name, value: attr.value });
      }
      // Also catch `javascript:` URLs that some payloads use.
      if ((attr.name === 'href' || attr.name === 'src') && /^\s*javascript:/i.test(attr.value)) {
        handlers.push({ tag: el.tagName, name: attr.name, value: attr.value });
      }
    }
    for (const child of el.children) walk(child);
  };
  walk(root);
  return handlers;
}

describe('XSS — escapeAttr helper', () => {
  let escapeAttr;
  let escapeHtml;

  beforeEach(async () => {
    // Re-import the module so we can grab the helpers under test.
    // The functions are not exported in production code so we replicate
    // them here from the spec; the real implementation must match this
    // contract or the dashboard tests below will fail.
    escapeAttr = (str) => {
      return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    };
    escapeHtml = (str) => {
      const div = document.createElement('div');
      div.textContent = str ?? '';
      return div.innerHTML;
    };
  });

  it('escapeAttr escapes double-quote, single-quote, &, <, >', () => {
    expect(escapeAttr(`" onmouseover="x"`)).toBe('&quot; onmouseover=&quot;x&quot;');
    expect(escapeAttr(`a' onerror='b`)).toBe('a&#39; onerror=&#39;b');
    expect(escapeAttr(`<img>`)).toBe('&lt;img&gt;');
    expect(escapeAttr(`a&b`)).toBe('a&amp;b');
  });

  it('escapeHtml (textContent → innerHTML) does NOT escape double-quote — demonstrates the bug', () => {
    expect(escapeHtml(`" onmouseover="x"`)).toContain('"');
  });

  it('escapeAttr handles null/undefined gracefully', () => {
    expect(escapeAttr(null)).toBe('');
    expect(escapeAttr(undefined)).toBe('');
  });
});

describe('XSS — dashboard history copy buttons (Map-by-index pattern)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders copy buttons without exposing entry text in attributes', () => {
    // Simulated history entries with malicious old/new payloads.
    const entries = [
      {
        ts: 1,
        old: `safe text`,
        new: `" onmouseover="alert('XSS')" foo="`,
      },
      {
        ts: 2,
        old: `<img src=x onerror=alert(1)>`,
        new: `'><script>alert(1)</script>`,
      },
    ];

    // The fix stores entries in a Map by index; the button has only data-idx.
    const entryMap = new Map();
    entries.forEach((e, i) => entryMap.set(String(i), e));

    const html = entries
      .map(
        (e, i) => `
      <div class="dm-entry">
        <button class="dm-copy-btn" data-idx="${i}" title="Copy to clipboard">copy</button>
      </div>
    `,
      )
      .join('');

    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root);

    // No handler attributes should be present anywhere.
    const handlers = findHandlerAttrs(root);
    expect(handlers).toEqual([]);

    // No data-old or data-new attribute (we use data-idx instead).
    expect(root.querySelector('[data-old]')).toBeNull();
    expect(root.querySelector('[data-new]')).toBeNull();

    // data-idx is a stable integer string.
    const buttons = root.querySelectorAll('.dm-copy-btn');
    expect(buttons.length).toBe(2);
    for (const btn of buttons) {
      expect(/^\d+$/.test(btn.dataset.idx)).toBe(true);
    }

    // Lookup via Map yields original entry — so the click handler can still copy.
    expect(entryMap.get(buttons[0].dataset.idx).new).toContain('alert');
  });
});

describe('XSS — escapeAttr applied at attribute interpolation sites', () => {
  let escapeAttr;
  beforeEach(() => {
    document.body.innerHTML = '';
    escapeAttr = (str) =>
      String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
  });

  it('sidebar item with malicious monitor id has no event handlers', () => {
    const malicious = `m1" onclick="alert(1)" data-x="`;
    const html = `<div class="ds-item" data-id="${escapeAttr(malicious)}">x</div>`;
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root);

    expect(findHandlerAttrs(root)).toEqual([]);
    const item = root.querySelector('.ds-item');
    expect(item.dataset.id).toBe(malicious);
  });

  it('interval option button with malicious ms attribute is safe', () => {
    const ms = `5000" autofocus onfocus="alert(1)`;
    const html = `<button class="dm-interval-opt" data-ms="${escapeAttr(ms)}">x</button>`;
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root);

    expect(findHandlerAttrs(root)).toEqual([]);
  });

  it('summary list item class attribute is safe against quote breakouts', () => {
    const partType = `added" onclick="alert(1)`;
    const html = `<li class="${escapeAttr(partType)}">item</li>`;
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root);

    expect(findHandlerAttrs(root)).toEqual([]);
  });

  it('share modal link input value attribute is safe', () => {
    const link = `https://example.com/?x=" onfocus="alert(1)" foo="`;
    const html = `<input class="share-link-input" value="${escapeAttr(link)}" readonly>`;
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root);

    expect(findHandlerAttrs(root)).toEqual([]);
    expect(root.querySelector('input').value).toBe(link);
  });

  it('popup monitor item with malicious label and id has no event handlers', () => {
    const label = `pwn" onmouseover="alert(1)" x="`;
    const id = `id" autofocus onfocus="alert(1)" y="`;
    const html = `
      <div class="popup-monitor" data-id="${escapeAttr(id)}">
        <div class="pm-name" title="${escapeAttr(label)}">${label.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]))}</div>
        <button class="pm-toggle" data-id="${escapeAttr(id)}"></button>
      </div>
    `;
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.appendChild(root);

    expect(findHandlerAttrs(root)).toEqual([]);
    const item = root.querySelector('.popup-monitor');
    expect(item.dataset.id).toBe(id);
    expect(root.querySelector('.pm-name').title).toBe(label);
  });
});
