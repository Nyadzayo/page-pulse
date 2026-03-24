import { describe, it, expect } from 'vitest';
import { computeDiff, hasMeaningfulChange, generateSummary, matchesKeyword } from '../../src/lib/differ.js';

describe('differ', () => {
  describe('computeDiff', () => {
    it('returns no changes for identical strings', () => {
      const result = computeDiff('hello world', 'hello world');
      expect(result.every((p) => !p.added && !p.removed)).toBe(true);
    });
    it('detects added words', () => {
      const result = computeDiff('hello', 'hello world');
      expect(result.filter((p) => p.added).length).toBeGreaterThan(0);
    });
    it('detects removed words', () => {
      const result = computeDiff('hello world', 'hello');
      expect(result.filter((p) => p.removed).length).toBeGreaterThan(0);
    });
    it('detects replaced words', () => {
      const result = computeDiff('Price: $29.99', 'Price: $24.99');
      expect(result.filter((p) => p.added).length).toBeGreaterThan(0);
      expect(result.filter((p) => p.removed).length).toBeGreaterThan(0);
    });
  });

  describe('hasMeaningfulChange', () => {
    it('returns false for identical strings', () => {
      expect(hasMeaningfulChange('hello', 'hello')).toBe(false);
    });
    it('returns false for whitespace-only differences', () => {
      expect(hasMeaningfulChange('hello  world', 'hello world')).toBe(false);
    });
    it('returns true for actual text changes', () => {
      expect(hasMeaningfulChange('Price: $29', 'Price: $24')).toBe(true);
    });
  });

  describe('matchesKeyword', () => {
    it('returns true when keyword appears in added text', () => {
      expect(matchesKeyword('old text', 'old text with rust', 'rust')).toBe(true);
    });

    it('returns false when keyword does not appear in added text', () => {
      expect(matchesKeyword('old text', 'old text more', 'rust')).toBe(false);
    });

    it('returns true when keywords string is empty (match all)', () => {
      expect(matchesKeyword('a', 'b', '')).toBe(true);
    });

    it('returns true when keywords is undefined', () => {
      expect(matchesKeyword('a', 'b', undefined)).toBe(true);
    });

    it('matches any keyword in comma-separated list', () => {
      expect(matchesKeyword('hello', 'hello world AI stuff', 'rust, AI')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(matchesKeyword('old', 'old Rust news', 'rust')).toBe(true);
    });
  });

  describe('generateSummary', () => {
    it('returns list kind with correct added/removed for numbered list input', () => {
      const oldText = '1. Alpha (a.com)\n2. Beta (b.com)\n3. Gamma (g.com)';
      const newText = '1. Alpha (a.com)\n2. Delta (d.com)\n3. Epsilon (e.com)\n4. Gamma (g.com)';
      const result = generateSummary(oldText, newText);
      expect(result.kind).toBe('list');
      const addedPart = result.parts.find(p => p.type === 'added');
      const removedPart = result.parts.find(p => p.type === 'removed');
      expect(addedPart).toBeDefined();
      expect(addedPart.count).toBe(2); // Delta, Epsilon
      expect(addedPart.items).toContain('Delta (d.com)');
      expect(addedPart.items).toContain('Epsilon (e.com)');
      expect(removedPart).toBeDefined();
      expect(removedPart.count).toBe(1); // Beta
      expect(removedPart.items).toContain('Beta (b.com)');
    });

    it('returns text kind with word counts for short text', () => {
      const result = generateSummary('hello world', 'hello beautiful world today');
      expect(result.kind).toBe('text');
      const addedPart = result.parts.find(p => p.type === 'added');
      expect(addedPart).toBeDefined();
      expect(addedPart.count).toBeGreaterThan(0);
    });

    it('reports no changes for identical text', () => {
      const result = generateSummary('same text', 'same text');
      expect(result.text).toBe('no changes');
    });

    it('handles empty inputs', () => {
      const result = generateSummary('', 'new content');
      expect(result.kind).toBe('text');
      expect(result.parts.length).toBeGreaterThan(0);
    });
  });
});
