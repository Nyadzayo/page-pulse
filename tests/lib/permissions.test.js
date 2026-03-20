import { describe, it, expect, vi } from 'vitest';
import { extractOrigin, requestOriginAccess, hasOriginAccess } from '../../src/lib/permissions.js';

describe('permissions', () => {
  describe('extractOrigin', () => {
    it('extracts origin from a full URL', () => {
      expect(extractOrigin('https://example.com/path/page?q=1')).toBe('https://example.com');
    });
    it('extracts origin with port', () => {
      expect(extractOrigin('http://localhost:3000/page')).toBe('http://localhost:3000');
    });
    it('handles URLs without path', () => {
      expect(extractOrigin('https://example.com')).toBe('https://example.com');
    });
  });

  describe('requestOriginAccess', () => {
    it('calls chrome.permissions.request with correct origin pattern', async () => {
      chrome.permissions.request.mockResolvedValue(true);
      const granted = await requestOriginAccess('https://example.com/page');
      expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['https://example.com/*'] });
      expect(granted).toBe(true);
    });
    it('returns false when user denies', async () => {
      chrome.permissions.request.mockResolvedValue(false);
      expect(await requestOriginAccess('https://example.com/page')).toBe(false);
    });
  });

  describe('hasOriginAccess', () => {
    it('checks chrome.permissions.contains with origin pattern', async () => {
      chrome.permissions.contains.mockResolvedValue(true);
      const has = await hasOriginAccess('https://example.com/page');
      expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['https://example.com/*'] });
      expect(has).toBe(true);
    });
  });
});
