import { MAX_NOTIFICATIONS_PER_TICK } from './constants.js';

export function truncateMessage(text, maxLen = 80) {
  if (!text || text.length <= maxLen) return text || '';
  return text.substring(0, maxLen - 3) + '...';
}

export async function notifyChange(monitor, newValue) {
  try {
    const notifId = `pagepulse-${monitor.id}-${Date.now()}`;
    await chrome.notifications.create(notifId, {
      type: 'basic',
      title: monitor.label,
      message: truncateMessage(newValue),
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      priority: 2,
    });
    console.log(`[PagePulse] Notification created: ${notifId}`);
  } catch (e) {
    console.error('[PagePulse] Notification failed:', e);
  }
}

export async function notifyBatch(changes, soundEnabled = true) {
  const individual = changes.slice(0, MAX_NOTIFICATIONS_PER_TICK);
  const remaining = changes.length - individual.length;

  for (const { monitor, newValue } of individual) {
    await notifyChange(monitor, newValue);
  }

  if (remaining > 0) {
    try {
      await chrome.notifications.create(`pagepulse-batch-${Date.now()}`, {
        type: 'basic',
        title: 'PagePulse',
        message: `${remaining} more monitor(s) detected changes — click to view`,
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        priority: 2,
      });
    } catch (e) {
      console.error('[PagePulse] Batch notification failed:', e);
    }
  }

  // Update badge
  updateBadge(changes.length);

  // Play sound
  if (soundEnabled) {
    await playNotificationSound();
  }
}

export function updateBadge(count) {
  try {
    if (count > 0) {
      chrome.action.setBadgeText({ text: String(count) });
      chrome.action.setBadgeBackgroundColor({ color: '#10B981' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {
    console.error('[PagePulse] Badge update failed:', e);
  }
}

async function playNotificationSound() {
  try {
    chrome.runtime.sendMessage(
      { target: 'offscreen', action: 'playSound' },
      () => void chrome.runtime.lastError // suppress "Receiving end does not exist"
    );
  } catch {
    // Silently ignore — sound is best-effort
  }
}
