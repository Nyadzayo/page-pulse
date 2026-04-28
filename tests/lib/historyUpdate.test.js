import { describe, it, expect, beforeEach } from 'vitest';
import { appendHistory, getHistory, updateHistoryEntry } from '../../src/lib/storage.js';
import { TIERS, STORAGE_KEYS } from '../../src/lib/constants.js';

describe('updateHistoryEntry', () => {
  beforeEach(() => {
    chrome.storage.local._store = {};
  });

  it('updates the matching entry by ts and preserves others', async () => {
    await appendHistory('m1', { ts: 100, old: 'a', new: 'b' }, TIERS.FREE);
    await appendHistory('m1', { ts: 200, old: 'b', new: 'c' }, TIERS.FREE);
    await appendHistory('m1', { ts: 300, old: 'c', new: 'd' }, TIERS.FREE);

    const ok = await updateHistoryEntry('m1', 200, { summary: 'middle change' });
    expect(ok).toBe(true);

    const history = await getHistory('m1');
    const byTs = Object.fromEntries(history.map((e) => [e.ts, e]));
    expect(byTs[200].summary).toBe('middle change');
    expect(byTs[200].old).toBe('b');
    expect(byTs[200].new).toBe('c');
    expect(byTs[100].summary).toBeUndefined();
    expect(byTs[300].summary).toBeUndefined();
  });

  it('returns false when ts not found, leaves history untouched', async () => {
    await appendHistory('m1', { ts: 100, old: 'a', new: 'b' }, TIERS.FREE);
    const ok = await updateHistoryEntry('m1', 999, { summary: 'nope' });
    expect(ok).toBe(false);
    const history = await getHistory('m1');
    expect(history).toEqual([{ ts: 100, old: 'a', new: 'b' }]);
  });

  it('returns false for missing monitor id', async () => {
    const ok = await updateHistoryEntry('does-not-exist', 100, { summary: 'x' });
    expect(ok).toBe(false);
  });

  it('does not let the patch overwrite ts (immutable identity)', async () => {
    await appendHistory('m1', { ts: 100, old: 'a', new: 'b' }, TIERS.FREE);
    await updateHistoryEntry('m1', 100, { ts: 999, summary: 's' });
    const history = await getHistory('m1');
    expect(history[0].ts).toBe(100);
    expect(history[0].summary).toBe('s');
  });
});
