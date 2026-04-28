import { describe, it, expect } from 'vitest';
import {
  buildRssFeed,
  monitorToFeedItems,
  escapeXml,
  rfc822Date,
} from '../../src/lib/rssFeed.js';

describe('rssFeed', () => {
  describe('escapeXml', () => {
    it('escapes the five XML metacharacters', () => {
      expect(escapeXml('a < b & c > d "e" \'f\'')).toBe('a &lt; b &amp; c &gt; d &quot;e&quot; &apos;f&apos;');
    });
    it('returns empty string for null/undefined', () => {
      expect(escapeXml(null)).toBe('');
      expect(escapeXml(undefined)).toBe('');
    });
    it('coerces numbers to strings', () => {
      expect(escapeXml(42)).toBe('42');
    });
  });

  describe('rfc822Date', () => {
    it('produces an RFC-822-compatible date string ending in GMT', () => {
      const out = rfc822Date(new Date('2026-04-28T15:30:00Z').getTime());
      expect(out).toMatch(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
    });
  });

  describe('monitorToFeedItems', () => {
    const monitor = {
      id: 'mon-1',
      label: 'Job postings',
      url: 'https://example.com/jobs',
    };

    it('produces one item per history entry with title/description/guid', () => {
      const history = [
        { ts: 1700000000000, old: 'no listings', new: 'Senior Engineer' },
        { ts: 1700001000000, old: 'Senior Engineer', new: 'Staff Engineer' },
      ];
      const items = monitorToFeedItems(monitor, history);
      expect(items).toHaveLength(2);
      expect(items[0].title).toContain('Job postings');
      expect(items[0].description).toContain('Senior Engineer');
      expect(items[0].guid).toBe('mon-1-1700000000000');
      expect(items[0].link).toBe('https://example.com/jobs');
      expect(items[0].pubDate).toBeTruthy();
    });

    it('uses entry.summary when present, otherwise falls back to "old → new" format', () => {
      const history = [
        { ts: 1700000000000, old: 'foo', new: 'bar', summary: 'Pricing changed' },
        { ts: 1700001000000, old: 'foo', new: 'bar' },
      ];
      const items = monitorToFeedItems(monitor, history);
      expect(items[0].description).toContain('Pricing changed');
      expect(items[1].description).toContain('foo');
      expect(items[1].description).toContain('bar');
    });

    it('returns empty array for empty history', () => {
      expect(monitorToFeedItems(monitor, [])).toEqual([]);
      expect(monitorToFeedItems(monitor, null)).toEqual([]);
    });
  });

  describe('buildRssFeed', () => {
    const baseChannel = {
      title: 'PagePulse',
      description: 'Recent webpage changes',
      link: 'chrome-extension://abc/dashboard.html',
    };

    it('produces well-formed RSS 2.0 XML with channel metadata', () => {
      const xml = buildRssFeed({ ...baseChannel, items: [] });
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<rss version="2.0">');
      expect(xml).toContain('<channel>');
      expect(xml).toContain('<title>PagePulse</title>');
      expect(xml).toContain('<link>chrome-extension://abc/dashboard.html</link>');
      expect(xml).toContain('<description>Recent webpage changes</description>');
      expect(xml).toContain('</channel>');
      expect(xml).toContain('</rss>');
    });

    it('renders items in the channel with title, link, description, guid, pubDate', () => {
      const items = [
        {
          title: 'Item A',
          link: 'https://example.com/a',
          description: 'Desc A',
          guid: 'g-a',
          pubDate: 'Tue, 14 Nov 2023 22:13:20 GMT',
        },
      ];
      const xml = buildRssFeed({ ...baseChannel, items });
      expect(xml).toContain('<item>');
      expect(xml).toContain('<title>Item A</title>');
      expect(xml).toContain('<link>https://example.com/a</link>');
      expect(xml).toContain('<description>Desc A</description>');
      expect(xml).toMatch(/<guid[^>]*>g-a<\/guid>/);
      expect(xml).toContain('<pubDate>Tue, 14 Nov 2023 22:13:20 GMT</pubDate>');
      expect(xml).toContain('</item>');
    });

    it('escapes XML metacharacters in title/description', () => {
      const items = [
        { title: 'A & B', link: 'https://x.com', description: '<script>alert(1)</script>', guid: 'g', pubDate: 'd' },
      ];
      const xml = buildRssFeed({ ...baseChannel, items });
      expect(xml).toContain('A &amp; B');
      expect(xml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(xml).not.toContain('<script>alert(1)</script>');
    });

    it('marks guids as isPermaLink="false" since they are not real URLs', () => {
      const items = [
        { title: 't', link: 'https://x.com', description: 'd', guid: 'mon-1-12345', pubDate: 'd' },
      ];
      const xml = buildRssFeed({ ...baseChannel, items });
      expect(xml).toContain('<guid isPermaLink="false">mon-1-12345</guid>');
    });

    it('produces empty channel without items section when items list is empty', () => {
      const xml = buildRssFeed({ ...baseChannel, items: [] });
      expect(xml).not.toContain('<item>');
    });
  });
});
