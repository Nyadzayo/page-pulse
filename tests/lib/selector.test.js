import { describe, it, expect } from 'vitest';
import { generateCssSelector, generateXPath, generateTextFingerprint } from '../../src/lib/selector.js';
import { TEXT_FINGERPRINT_LENGTH } from '../../src/lib/constants.js';

function mockElement({ id, tagName, classList, parentElement, textContent, children, dataset, childIndex }) {
  return {
    id: id || '',
    tagName: tagName || 'DIV',
    classList: { contains: (c) => (classList || []).includes(c), length: (classList || []).length, item: (i) => (classList || [])[i] },
    className: (classList || []).join(' '),
    parentElement: parentElement || null,
    textContent: textContent || '',
    children: children || [],
    dataset: dataset || {},
    getAttribute: (attr) => {
      if (attr === 'id') return id || null;
      if (attr === 'data-testid') return dataset?.testid || null;
      return null;
    },
  };
}

describe('selector', () => {
  describe('generateCssSelector', () => {
    it('uses #id when element has unique id', () => {
      const el = mockElement({ id: 'price', tagName: 'SPAN' });
      expect(generateCssSelector(el)).toBe('#price');
    });

    it('uses data-testid when available', () => {
      const el = mockElement({ tagName: 'DIV', dataset: { testid: 'product-price' } });
      expect(generateCssSelector(el)).toBe('[data-testid="product-price"]');
    });

    it('builds tag + class chain when no id or data-testid', () => {
      const parent = mockElement({ id: 'container', tagName: 'DIV' });
      const el = mockElement({ tagName: 'SPAN', classList: ['price', 'current'], parentElement: parent });
      const selector = generateCssSelector(el);
      expect(selector).toContain('span');
    });

    it('never returns empty string', () => {
      const el = mockElement({ tagName: 'DIV' });
      expect(generateCssSelector(el).length).toBeGreaterThan(0);
    });
  });

  describe('generateXPath', () => {
    it('generates an absolute xpath', () => {
      const root = mockElement({ tagName: 'HTML', children: [] });
      const body = mockElement({ tagName: 'BODY', parentElement: root, children: [] });
      root.children = [body];
      const div = mockElement({ tagName: 'DIV', parentElement: body, children: [] });
      body.children = [div];
      const xpath = generateXPath(div);
      expect(xpath).toMatch(/^\/html/i);
      expect(xpath).toContain('div');
    });
  });

  describe('generateTextFingerprint', () => {
    it('returns trimmed text up to max length', () => {
      expect(generateTextFingerprint('a'.repeat(200)).length).toBe(TEXT_FINGERPRINT_LENGTH);
    });
    it('returns full text if shorter than max', () => {
      expect(generateTextFingerprint('short text')).toBe('short text');
    });
    it('trims whitespace', () => {
      expect(generateTextFingerprint('  hello world  ')).toBe('hello world');
    });
  });
});
