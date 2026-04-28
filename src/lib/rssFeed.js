/**
 * RSS 2.0 feed generation. Pure functions; no I/O, no DOM, no chrome APIs.
 *
 * The dashboard offers a "Download RSS" button that builds the feed XML
 * for one or all monitors and downloads a .xml file. The user can then
 * point any RSS reader (Reeder, NetNewsWire, Inoreader, Feedbin, etc.) at
 * a path of their choosing — for cross-device read tracking they can host
 * the file on personal cloud storage with a public URL, or just re-export
 * periodically.
 *
 * Privacy: zero network egress. The XML is generated locally and offered
 * as a Blob download.
 */

const XML_ESCAPES = {
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&apos;',
};

export function escapeXml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[<>&"']/g, (c) => XML_ESCAPES[c]);
}

export function rfc822Date(ts) {
  // RFC 822 — used by RSS 2.0 pubDate. Date.prototype.toUTCString in
  // V8 emits the right format ("Tue, 14 Nov 2023 22:13:20 GMT").
  return new Date(ts).toUTCString();
}

export function monitorToFeedItems(monitor, history) {
  if (!Array.isArray(history) || history.length === 0) return [];
  return history.map((entry) => {
    const description = entry.summary
      ? entry.summary
      : `Old: ${truncate(entry.old, 200)}\n\nNew: ${truncate(entry.new, 200)}`;
    return {
      title: `${monitor.label} — change detected`,
      link: monitor.url,
      description,
      guid: `${monitor.id}-${entry.ts}`,
      pubDate: rfc822Date(entry.ts),
    };
  });
}

function truncate(s, n) {
  if (s == null) return '';
  const str = String(s);
  if (str.length <= n) return str;
  return str.substring(0, n - 3) + '...';
}

function renderItem(item) {
  return [
    '    <item>',
    `      <title>${escapeXml(item.title)}</title>`,
    `      <link>${escapeXml(item.link)}</link>`,
    `      <description>${escapeXml(item.description)}</description>`,
    `      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>`,
    `      <pubDate>${escapeXml(item.pubDate)}</pubDate>`,
    '    </item>',
  ].join('\n');
}

export function buildRssFeed({ title, description, link, items = [] }) {
  const itemsXml = items.length === 0 ? '' : '\n' + items.map(renderItem).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '  <channel>',
    `    <title>${escapeXml(title)}</title>`,
    `    <link>${escapeXml(link)}</link>`,
    `    <description>${escapeXml(description)}</description>`,
    `    <lastBuildDate>${escapeXml(rfc822Date(Date.now()))}</lastBuildDate>`,
    `    <generator>PagePulse</generator>${itemsXml}`,
    '  </channel>',
    '</rss>',
  ].join('\n');
}
