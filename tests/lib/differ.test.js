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

  // ── Keyword Matching ──────────────────────────────────────────────────────

  describe('matchesKeyword', () => {
    it('returns true when keywords is empty (match all)', () => {
      expect(matchesKeyword('a', 'b', '')).toBe(true);
    });

    it('returns true when keywords is undefined', () => {
      expect(matchesKeyword('a', 'b', undefined)).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(matchesKeyword('old', 'old Rust news', 'rust')).toBe(true);
    });

    it('matches any keyword in comma-separated list', () => {
      expect(matchesKeyword('hello', 'hello world AI stuff', 'rust, AI')).toBe(true);
    });

    // Plain text matching
    it('returns true when keyword appears in new text but not old', () => {
      expect(matchesKeyword('old text', 'old text with rust', 'rust')).toBe(true);
    });

    it('returns false when keyword is not in added text', () => {
      expect(matchesKeyword('old text', 'old text more', 'rust')).toBe(false);
    });

    // HN-style list matching (no newlines, "N.Title (domain)..." format)
    it('matches keyword in NEW list item on HN-style content', () => {
      const old = '1.Alpha (a.com)10 points2.Beta (b.com)20 points3.Gamma (g.com)30 points';
      const nw  = '1.Alpha (a.com)10 points2.Rust Compiler Released (rust.com)5 points3.Gamma (g.com)30 points';
      expect(matchesKeyword(old, nw, 'rust')).toBe(true);
    });

    it('does NOT match keyword in EXISTING list item', () => {
      const old = '1.Alpha (a.com)10 points2.Rust News (rust.com)20 points3.Gamma (g.com)30 points';
      const nw  = '1.Alpha (a.com)10 points2.Rust News (rust.com)25 points3.Delta (d.com)5 points';
      // "Rust" was already there — the new item "Delta" doesn't contain "rust"
      expect(matchesKeyword(old, nw, 'rust')).toBe(false);
    });

    it('matches keyword when new item title contains the term', () => {
      const old = '1.Post A (a.com)10 points2.Post B (b.com)20 points3.Post C (c.com)30 points';
      const nw  = '1.Post A (a.com)10 points2.Hiring Senior AI Engineer (jobs.com)5 points3.Post C (c.com)30 points';
      expect(matchesKeyword(old, nw, 'hiring')).toBe(true);
      expect(matchesKeyword(old, nw, 'AI')).toBe(true);
      expect(matchesKeyword(old, nw, 'golang')).toBe(false);
    });
  });

  // ── Summary Generation ────────────────────────────────────────────────────

  describe('generateSummary', () => {
    it('returns text kind with word counts for short text', () => {
      const result = generateSummary('hello world', 'hello beautiful world today');
      expect(result.kind).toBe('text');
      expect(result.parts.find(p => p.type === 'added')).toBeDefined();
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

    // Newline-separated numbered list
    it('returns list kind for newline-separated numbered items', () => {
      const old = '1. Alpha\n2. Beta\n3. Gamma';
      const nw  = '1. Alpha\n2. Delta\n3. Gamma';
      const result = generateSummary(old, nw);
      expect(result.kind).toBe('list');
      expect(result.parts.find(p => p.type === 'added')?.count).toBe(1);
      expect(result.parts.find(p => p.type === 'removed')?.count).toBe(1);
    });

    // HN-style inline numbered list (THE critical test)
    it('parses HN-style inline numbered list without newlines', () => {
      const old = '1.Alpha (a.com)100 points by user 1 hour ago2.Beta (b.com)200 points by user 2 hours ago3.Gamma (g.com)300 points by user 3 hours ago';
      const nw  = '1.Alpha (a.com)105 points by user 1 hour ago2.Delta (d.com)50 points by user 10 min ago3.Gamma (g.com)310 points by user 3 hours ago';
      const result = generateSummary(old, nw);
      expect(result.kind).toBe('list');
      const added = result.parts.find(p => p.type === 'added');
      const removed = result.parts.find(p => p.type === 'removed');
      expect(added?.count).toBe(1);
      expect(added?.items[0]).toContain('Delta');
      expect(removed?.count).toBe(1);
      expect(removed?.items[0]).toContain('Beta');
      expect(result.unchanged).toBe(2); // Alpha and Gamma stayed
    });

    it('detects reordering when same items but different order', () => {
      const old = '1.Alpha (a.com)10 points2.Beta (b.com)20 points3.Gamma (g.com)30 points';
      const nw  = '1.Gamma (g.com)35 points2.Alpha (a.com)12 points3.Beta (b.com)22 points';
      const result = generateSummary(old, nw);
      expect(result.kind).toBe('list');
      expect(result.text).toBe('items reordered');
    });

    it('includes item titles in summary parts', () => {
      const old = '1.Post A (a.com)10 points2.Post B (b.com)20 points3.Post C (c.com)30 points';
      const nw  = '1.Post A (a.com)10 points2.New Rust Tool (rust.com)5 points3.AI Breakthrough (ai.com)8 points4.Post C (c.com)30 points';
      const result = generateSummary(old, nw);
      expect(result.kind).toBe('list');
      const added = result.parts.find(p => p.type === 'added');
      expect(added.count).toBe(2);
      expect(added.items.some(i => i.includes('Rust'))).toBe(true);
      expect(added.items.some(i => i.includes('AI'))).toBe(true);
    });
  });
});
