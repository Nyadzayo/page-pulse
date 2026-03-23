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

export async function notifyBatch(changes) {
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

  // Update badge with total change count
  updateBadge(changes.length);
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
