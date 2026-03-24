import { diffWords } from 'diff';

export function computeDiff(oldText, newText) {
  return diffWords(oldText || '', newText || '');
}

export function hasMeaningfulChange(oldText, newText) {
  const normalizedOld = (oldText || '').replace(/\s+/g, ' ').trim();
  const normalizedNew = (newText || '').replace(/\s+/g, ' ').trim();
  return normalizedOld !== normalizedNew;
}

/**
 * Detect whether text looks like a numbered list.
 * Matches patterns like "1. Title (domain)..." or "1.Title..."
 */
function isListContent(text) {
  const lines = (text || '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return false;
  const numberedCount = lines.filter(l => /^\s*\d+[\.\)]\s*/.test(l)).length;
  return numberedCount >= lines.length * 0.5;
}

/**
 * Extract item titles from numbered-list text.
 * Each line starting with "N. title" produces the trimmed title.
 */
function extractListItems(text) {
  return (text || '').split('\n')
    .filter(l => /^\s*\d+[\.\)]\s*/.test(l))
    .map(l => l.replace(/^\s*\d+[\.\)]\s*/, '').trim())
    .filter(Boolean);
}

/**
 * Generate a structured summary of what changed between oldText and newText.
 *
 * For list content: compare item sets by title and report added/removed/unchanged.
 * For plain text: count added/removed words via diffWords.
 */
export function generateSummary(oldText, newText) {
  const oText = oldText || '';
  const nText = newText || '';

  if (isListContent(oText) || isListContent(nText)) {
    const oldItems = extractListItems(oText);
    const newItems = extractListItems(nText);

    const oldSet = new Set(oldItems);
    const newSet = new Set(newItems);

    const added = newItems.filter(i => !oldSet.has(i));
    const removed = oldItems.filter(i => !newSet.has(i));
    const unchanged = oldItems.filter(i => newSet.has(i));

    const parts = [];
    if (added.length) parts.push({ type: 'added', count: added.length, items: added });
    if (removed.length) parts.push({ type: 'removed', count: removed.length, items: removed });

    const textParts = [];
    if (added.length) textParts.push(`${added.length} new item${added.length > 1 ? 's' : ''}`);
    if (removed.length) textParts.push(`${removed.length} removed`);
    if (!added.length && !removed.length) textParts.push('no changes');

    return {
      kind: 'list',
      parts,
      unchanged: unchanged.length,
      text: textParts.join(', '),
    };
  }

  // Plain text — word-level diff
  const diff = diffWords(oText, nText);
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

/**
 * Check whether any keyword appears in the added text (new text that was not in old text).
 * `keywords` is a comma-separated string. Empty / falsy keywords = always matches.
 */
export function matchesKeyword(oldText, newText, keywords) {
  if (!keywords || !keywords.trim()) return true;

  const diff = diffWords(oldText || '', newText || '');
  const addedText = diff
    .filter(p => p.added)
    .map(p => p.value)
    .join(' ')
    .toLowerCase();

  const kws = keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);
  return kws.some(kw => addedText.includes(kw));
}
