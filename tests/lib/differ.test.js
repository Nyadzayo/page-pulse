import { describe, it, expect } from 'vitest';
import { computeDiff, hasMeaningfulChange } from '../../src/lib/differ.js';

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
});
