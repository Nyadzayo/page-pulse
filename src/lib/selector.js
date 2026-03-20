import { TEXT_FINGERPRINT_LENGTH } from './constants.js';

export function generateCssSelector(element) {
  if (element.id) return `#${element.id}`;
  const testId = element.getAttribute('data-testid');
  if (testId) return `[data-testid="${testId}"]`;

  const parts = [];
  let current = element;
  let depth = 0;
  while (current && current.tagName && depth < 5) {
    const tag = current.tagName.toLowerCase();
    if (current.id && depth > 0) { parts.unshift(`#${current.id}`); break; }
    let segment = tag;
    const classes = [];
    for (let i = 0; i < current.classList.length && classes.length < 2; i++) {
      const cls = current.classList.item(i);
      if (cls && !cls.match(/^[a-z]{1,2}-/)) classes.push(`.${cls}`);
    }
    if (classes.length > 0) segment += classes.join('');
    else if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children || []);
      const sameTag = siblings.filter((s) => s.tagName === current.tagName);
      if (sameTag.length > 1) {
        const index = sameTag.indexOf(current) + 1;
        segment += `:nth-of-type(${index})`;
      }
    }
    parts.unshift(segment);
    current = current.parentElement;
    depth++;
  }
  return parts.join(' > ') || element.tagName.toLowerCase();
}

export function generateXPath(element) {
  const parts = [];
  let current = element;
  while (current && current.tagName) {
    const tag = current.tagName.toLowerCase();
    if (tag === 'html') { parts.unshift('/html'); break; }
    let index = 1;
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children || []);
      const sameTag = siblings.filter((s) => s.tagName === current.tagName);
      if (sameTag.length > 1) index = sameTag.indexOf(current) + 1;
    }
    parts.unshift(`${tag}[${index}]`);
    current = current.parentElement;
  }
  return parts.join('/');
}

export function generateTextFingerprint(text) {
  const trimmed = (text || '').trim();
  return trimmed.substring(0, TEXT_FINGERPRINT_LENGTH);
}
