import { diffWords } from 'diff';

export function computeDiff(oldText, newText) {
  return diffWords(oldText || '', newText || '');
}

export function hasMeaningfulChange(oldText, newText) {
  const normalizedOld = (oldText || '').replace(/\s+/g, ' ').trim();
  const normalizedNew = (newText || '').replace(/\s+/g, ' ').trim();
  return normalizedOld !== normalizedNew;
}

// ─── List Detection ───────────────────────────────────────────────────────────
// Splits text into items for list-like content.
// Handles: "1.Title (domain)...2.Title..." (HN style, no newlines)
// Also handles: newline-separated numbered lists

function parseListItems(text) {
  if (!text) return [];

  // Pattern 1: "N.Text" without newlines (HN front page style)
  // Match numbered items: digit(s) followed by a dot and text until next number-dot or end
  const numberedInline = text.match(/\d+\.[^]*?(?=\d+\.|$)/g);
  if (numberedInline && numberedInline.length >= 3) {
    return numberedInline.map(item => {
      const clean = item.replace(/^\d+\./, '').trim();
      // Extract title: text before first parenthetical (domain) or before metadata
      const titleMatch = clean.match(/^(.*?)(?:\s*\(|\s*\d+\s*points?\b)/);
      const title = titleMatch ? titleMatch[1].trim() : clean.substring(0, 80);
      return { full: clean, title };
    }).filter(i => i.title.length > 0);
  }

  // Pattern 2: Newline-separated numbered items
  const lines = text.split('\n').filter(l => l.trim());
  const numbered = lines.filter(l => /^\s*\d+[\.\)]\s*.+/.test(l));
  if (numbered.length >= 3) {
    return numbered.map(l => {
      const clean = l.replace(/^\s*\d+[\.\)]\s*/, '').trim();
      return { full: clean, title: clean.substring(0, 80) };
    });
  }

  return [];
}

/**
 * Generate a structured summary of changes.
 * For list content: compares item titles, reports added/removed with actual titles.
 * For text content: counts added/removed words.
 */
export function generateSummary(oldText, newText) {
  const oldItems = parseListItems(oldText);
  const newItems = parseListItems(newText);

  // If both parse as lists, do list comparison
  if (oldItems.length >= 3 && newItems.length >= 3) {
    const oldTitles = new Set(oldItems.map(i => i.title));
    const newTitles = new Set(newItems.map(i => i.title));

    const added = newItems.filter(i => !oldTitles.has(i.title));
    const removed = oldItems.filter(i => !newTitles.has(i.title));
    const unchanged = newItems.filter(i => oldTitles.has(i.title));

    const parts = [];
    if (added.length) parts.push({ type: 'added', count: added.length, items: added.map(i => i.title) });
    if (removed.length) parts.push({ type: 'removed', count: removed.length, items: removed.map(i => i.title) });

    const textParts = [];
    if (added.length) textParts.push(`${added.length} new item${added.length > 1 ? 's' : ''}`);
    if (removed.length) textParts.push(`${removed.length} removed`);
    if (!added.length && !removed.length) textParts.push('items reordered');

    return {
      kind: 'list',
      parts,
      unchanged: unchanged.length,
      text: textParts.join(', '),
    };
  }

  // Fallback: word-level diff
  const diff = diffWords(oldText || '', newText || '');
  let addedWords = 0;
  let removedWords = 0;
  for (const part of diff) {
    const count = part.value.split(/\s+/).filter(Boolean).length;
    if (part.added) addedWords += count;
    if (part.removed) removedWords += count;
  }

  const textParts = [];
  if (addedWords) textParts.push(`${addedWords} word${addedWords > 1 ? 's' : ''} added`);
  if (removedWords) textParts.push(`${removedWords} word${removedWords > 1 ? 's' : ''} removed`);
  if (!addedWords && !removedWords) textParts.push('no changes');

  return {
    kind: 'text',
    parts: [
      ...(addedWords ? [{ type: 'added', count: addedWords }] : []),
      ...(removedWords ? [{ type: 'removed', count: removedWords }] : []),
    ],
    text: textParts.join(', '),
  };
}

// ─── Keyword Matching ─────────────────────────────────────────────────────────
// Improved: works with both list content and plain text.
// For lists: checks if any NEW item title contains a keyword.
// For text: checks if keyword appears in new text but not old, OR in diff additions.
// Empty keywords = always match.

export function matchesKeyword(oldText, newText, keywords) {
  if (!keywords || !keywords.trim()) return true;

  const terms = keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
  if (terms.length === 0) return true;

  // Try list-aware matching first
  const oldItems = parseListItems(oldText);
  const newItems = parseListItems(newText);

  if (oldItems.length >= 3 && newItems.length >= 3) {
    // List content: check if any NEW item contains a keyword
    const oldTitles = new Set(oldItems.map(i => i.title.toLowerCase()));
    const newAddedItems = newItems.filter(i => !oldTitles.has(i.title.toLowerCase()));

    for (const item of newAddedItems) {
      const lower = item.title.toLowerCase();
      for (const term of terms) {
        if (lower.includes(term)) return true;
      }
    }
    return false;
  }

  // Plain text: check if keyword is NEW (in new text but not old)
  const oldLower = (oldText || '').toLowerCase();
  const newLower = (newText || '').toLowerCase();

  for (const term of terms) {
    if (newLower.includes(term) && !oldLower.includes(term)) return true;
  }

  // Also check diff additions
  const diff = diffWords(oldText || '', newText || '');
  const addedText = diff.filter(p => p.added).map(p => p.value).join(' ').toLowerCase();
  for (const term of terms) {
    if (addedText.includes(term)) return true;
  }

  return false;
}
