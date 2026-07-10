import { describe, it, expect, vi, beforeEach } from 'vitest';

// Simulate a configured build — real telemetryConfig.js ships empty and the
// module must no-op (covered by the "unconfigured" suite below).
vi.mock('../../src/lib/telemetryConfig.js', () => ({
  TELEMETRY_MEASUREMENT_ID: 'G-TEST123',
  TELEMETRY_API_SECRET: 'test-secret',
}));

import {
  trackEvent,
  trackOnce,
  trackError,
  getHoursSinceInstall,
  isTelemetryConfigured,
  INSTALLED_AT_KEY,
  EVENT_SCHEMA,
} from '../../src/lib/telemetry.js';

function lastRequestBody() {
  const call = global.fetch.mock.calls.at(-1);
  return JSON.parse(call[1].body);
}

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, status: 204 }));
});

describe('telemetry (configured build)', () => {
  it('reports configured', () => {
    expect(isTelemetryConfigured()).toBe(true);
  });

  it('sends an allowlisted event with session and engagement params', async () => {
    const sent = await trackEvent('extension_opened', { surface: 'popup', monitor_count: 3 });
    expect(sent).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('measurement_id=G-TEST123');
    expect(url).toContain('api_secret=test-secret');
    const body = lastRequestBody();
    expect(body.client_id).toBeTruthy();
    expect(body.events).toHaveLength(1);
    const event = body.events[0];
    expect(event.name).toBe('extension_opened');
    expect(event.params.surface).toBe('popup');
    expect(event.params.monitor_count).toBe(3);
    expect(event.params.session_id).toBeTruthy();
    expect(event.params.engagement_time_msec).toBe(100);
  });

  it('keeps client_id stable across events (identity survives restarts)', async () => {
    await trackEvent('extension_opened', { surface: 'popup' });
    const first = lastRequestBody().client_id;
    await trackEvent('extension_opened', { surface: 'dashboard' });
    const second = lastRequestBody().client_id;
    expect(first).toBe(second);
  });

  it('strips params not in the event allowlist (no browsing data leaks)', async () => {
    await trackEvent('extension_opened', {
      surface: 'popup',
      monitor_count: 1,
      url: 'https://secret.example.com/page',
      selector: '#price',
      label: 'my bank balance',
    });
    const params = lastRequestBody().events[0].params;
    expect(params.url).toBeUndefined();
    expect(params.selector).toBeUndefined();
    expect(params.label).toBeUndefined();
    expect(params.surface).toBe('popup');
  });

  it('drops events that are not in the schema', async () => {
    const sent = await trackEvent('vanity_pageview', { count: 1 });
    expect(sent).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('no forbidden key appears in any event allowlist', () => {
    const forbidden = ['url', 'href', 'hostname', 'selector', 'label', 'text', 'baseline'];
    for (const keys of Object.values(EVENT_SCHEMA)) {
      for (const bad of forbidden) {
        expect(keys).not.toContain(bad);
      }
    }
  });

  it('respects the user opt-out setting', async () => {
    chrome.storage.local._store.settings = { telemetryEnabled: false };
    const sent = await trackEvent('extension_opened', { surface: 'popup' });
    expect(sent).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('truncates long string params to 90 chars', async () => {
    await trackError('tick', new Error('x'.repeat(500)));
    const params = lastRequestBody().events[0].params;
    expect(params.message.length).toBeLessThanOrEqual(90);
    expect(params.context).toBe('tick');
  });

  it('converts booleans to strings and drops objects', async () => {
    await trackEvent('monitor_paused', { surface: 'popup', paused: true });
    const params = lastRequestBody().events[0].params;
    expect(params.paused).toBe('true');
  });

  it('trackOnce fires exactly once per install', async () => {
    const first = await trackOnce('first_monitor_created', { hours_since_install: 0.5 });
    const second = await trackOnce('first_monitor_created', { hours_since_install: 2 });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('never throws when the network fails', async () => {
    global.fetch = vi.fn(async () => { throw new Error('offline'); });
    await expect(trackEvent('extension_opened', { surface: 'popup' })).resolves.toBe(false);
  });

  it('getHoursSinceInstall returns null before install stamp, hours after', async () => {
    expect(await getHoursSinceInstall()).toBeNull();
    const now = Date.now();
    chrome.storage.local._store[INSTALLED_AT_KEY] = now - 2 * 3600000;
    expect(await getHoursSinceInstall(now)).toBeCloseTo(2, 1);
  });
});

describe('telemetry (unconfigured build)', () => {
  it('is a silent no-op when credentials are empty', async () => {
    vi.resetModules();
    vi.doMock('../../src/lib/telemetryConfig.js', () => ({
      TELEMETRY_MEASUREMENT_ID: '',
      TELEMETRY_API_SECRET: '',
    }));
    const mod = await import('../../src/lib/telemetry.js');
    expect(mod.isTelemetryConfigured()).toBe(false);
    const sent = await mod.trackEvent('extension_opened', { surface: 'popup' });
    expect(sent).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
    vi.doUnmock('../../src/lib/telemetryConfig.js');
    vi.resetModules();
  });
});
