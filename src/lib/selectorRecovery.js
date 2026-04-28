/**
 * H1 — selector fallback via textFingerprint.
 *
 * When a monitor's CSS selector and XPath both miss on a check, walk the
 * parsed Document looking for an element whose textContent prefix is
 * sufficiently similar to monitor.textFingerprint. If we find one, we
 * recover by persisting a new CSS selector and continuing checks. If we
 * don't find one and the monitor's status transitions to BROKEN, callers
 * surface a one-time "Monitor X needs attention" notification.
 *
 * Pure functions; no Chrome / DOM API access beyond what's passed in.
 */

import { STATUS, TEXT_FINGERPRINT_LENGTH } from './constants.js';

// Minimum textContent length before we even consider an element as a
// candidate — saves a lot of work on a typical page with thousands of
// near-empty inline tags.
const MIN_CANDIDATE_TEXT_LENGTH = 8;

// Similarity threshold — a candidate must be ≥ 0.80 similar
// (≤ 20% Levenshtein edit distance / max length) to count as a match.
export const SIMILARITY_THRESHOLD = 0.8;

/**
 * Classic dynamic-programming Levenshtein edit distance. O(|a|·|b|).
 * Returns the number of single-character edits (insert / delete /
 * substitute) needed to convert `a` into `b`.
 */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b ? b.length : 0;
  if (!b) return a.length;

  const m = a.length;
  const n = b.length;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost,     // substitution
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

/**
 * Similarity ratio in [0,1] derived from Levenshtein distance.
 *   similarity = 1 - distance / max(|a|, |b|)
 * Returns 1 when both are empty/equal; 0 when one is empty and the other
 * is not; gracefully handles undefined / null inputs.
 */
export function similarity(a, b) {
  if (a == null || b == null) return 0;
  if (a === '' && b === '') return 1;
  if (a === '' || b === '') return 0;
  const max = Math.max(a.length, b.length);
  return 1 - levenshtein(a, b) / max;
}

/**
 * Walk every Element in `doc`, compute the fingerprint-prefix of its
 * textContent, and return the best-similarity match if any candidate
 * scores ≥ SIMILARITY_THRESHOLD. Returns:
 *   { element, text, similarity, selector }
 * or null when no candidate qualifies.
 *
 * Note: we walk the *element tree* and check each element's full text
 * content; large containers naturally win over tiny inline children
 * when fingerprint length > 100 chars, which is fine because the
 * recovery selector should target the smallest stable container that
 * still produces the right text.
 */
export function matchFingerprint(doc, fingerprint, opts = {}) {
  if (!fingerprint || typeof fingerprint !== 'string') return null;
  const threshold = opts.threshold ?? SIMILARITY_THRESHOLD;
  const targetPrefix = fingerprint.trim().substring(0, TEXT_FINGERPRINT_LENGTH);
  if (!targetPrefix) return null;

  // Prefer the smallest element whose textContent prefix matches; that
  // gives us the most precise selector. We track the best (highest
  // similarity, smallest text length tiebreak) candidate.
  let best = null;

  const elements = doc.querySelectorAll('*');
  for (const el of elements) {
    const text = (el.textContent || '').trim();
    if (text.length < MIN_CANDIDATE_TEXT_LENGTH) continue;
    const prefix = text.substring(0, TEXT_FINGERPRINT_LENGTH);
    const score = similarity(targetPrefix, prefix);
    if (score < threshold) continue;
    if (!best || score > best.similarity || (score === best.similarity && text.length < best.text.length)) {
      best = { element: el, text, similarity: score, prefix };
    }
  }

  if (!best) return null;
  return {
    element: best.element,
    text: best.text,
    similarity: best.similarity,
    selector: generateSelector(best.element),
  };
}

/**
 * Bridge for the check pipeline: given the monitor and the parsed
 * document of the latest fetch, attempt to recover a working selector
 * via fingerprint match. Returns:
 *   { recovered: true, newSelector, newText }   — caller persists & continues
 *   { recovered: false }                        — caller treats as a miss
 */
export function recoverSelector(monitor, doc, opts) {
  if (!monitor || !monitor.textFingerprint) return { recovered: false };
  const match = matchFingerprint(doc, monitor.textFingerprint, opts);
  if (!match) return { recovered: false };
  return {
    recovered: true,
    newSelector: match.selector,
    newText: match.text,
    similarity: match.similarity,
  };
}

/**
 * Idempotent gate for firing the "monitor broke" notification: only fire
 * once per OK→BROKEN transition. Permission revocation is a different
 * surface and is excluded here.
 */
export function shouldFireBrokenNotification(beforeMonitor, updates) {
  if (!updates || updates.status !== STATUS.BROKEN) return false;
  const wasBroken = beforeMonitor && beforeMonitor.status === STATUS.BROKEN;
  return !wasBroken;
}

// ─── Selector generation ───────────────────────────────────────────────────
// Mirrors content.js's selector strategy: prefer #id, then [data-testid],
// otherwise build a parent>...>tag.class chain up to depth 5.

function generateSelector(el) {
  if (!el || el.nodeType !== 1) return null;
  if (el.id) return `#${cssEscape(el.id)}`;
  const testId = el.getAttribute && el.getAttribute('data-testid');
  if (testId) return `[data-testid="${cssEscape(testId)}"]`;

  const parts = [];
  let current = el;
  let depth = 0;
  while (current && current.tagName && current.tagName.toLowerCase() !== 'body' && depth < 5) {
    let seg = current.tagName.toLowerCase();
    if (current.id && depth > 0) {
      parts.unshift(`#${cssEscape(current.id)}`);
      break;
    }
    if (current.className && typeof current.className === 'string') {
      const cls = current.className
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((c) => `.${cssEscape(c)}`)
        .join('');
      if (cls) seg += cls;
    }
    parts.unshift(seg);
    current = current.parentElement;
    depth++;
  }
  return parts.join(' > ') || el.tagName.toLowerCase();
}

function cssEscape(s) {
  // Minimal CSS.escape polyfill — safe for class/id values produced by
  // typical static markup. We only escape characters that have meaning
  // in CSS selectors.
  return String(s).replace(/([!"#$%&'()*+,./:;<=>?@\[\\\]^`{|}~])/g, '\\$1');
}
