import { diffWords } from 'diff';

export function computeDiff(oldText, newText) {
  return diffWords(oldText || '', newText || '');
}

export function hasMeaningfulChange(oldText, newText) {
  const normalizedOld = (oldText || '').replace(/\s+/g, ' ').trim();
  const normalizedNew = (newText || '').replace(/\s+/g, ' ').trim();
  return normalizedOld !== normalizedNew;
}
