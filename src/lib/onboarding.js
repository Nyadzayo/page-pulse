/**
 * First-run onboarding gate. Renders a small dismissible card in the
 * dashboard until the user clicks "Got it" or the X button. Persists
 * the dismissal via the firstRunSeen settings flag.
 *
 * Intentionally narrow — no uninstall URL, no telemetry, just the
 * welcome card. Other PR C features (telemetry counters, uninstall
 * feedback URL) are deferred.
 */

import { getSettings, updateSettings } from './storage.js';

export async function shouldShowOnboarding() {
  const s = await getSettings();
  return s.firstRunSeen !== true;
}

export async function markOnboardingSeen() {
  await updateSettings({ firstRunSeen: true });
}
