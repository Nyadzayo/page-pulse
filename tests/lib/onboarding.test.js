import { describe, it, expect, beforeEach } from 'vitest';
import { shouldShowOnboarding, markOnboardingSeen } from '../../src/lib/onboarding.js';
import { updateSettings } from '../../src/lib/storage.js';

describe('onboarding', () => {
  beforeEach(() => {
    chrome.storage.local._store = {};
  });

  describe('shouldShowOnboarding', () => {
    it('returns true on a fresh install (no settings yet)', async () => {
      expect(await shouldShowOnboarding()).toBe(true);
    });

    it('returns true when firstRunSeen is explicitly false', async () => {
      await updateSettings({ firstRunSeen: false });
      expect(await shouldShowOnboarding()).toBe(true);
    });

    it('returns false when firstRunSeen is true', async () => {
      await updateSettings({ firstRunSeen: true });
      expect(await shouldShowOnboarding()).toBe(false);
    });
  });

  describe('markOnboardingSeen', () => {
    it('flips firstRunSeen to true', async () => {
      expect(await shouldShowOnboarding()).toBe(true);
      await markOnboardingSeen();
      expect(await shouldShowOnboarding()).toBe(false);
    });

    it('is idempotent', async () => {
      await markOnboardingSeen();
      await markOnboardingSeen();
      expect(await shouldShowOnboarding()).toBe(false);
    });
  });
});
