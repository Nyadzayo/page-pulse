import { MAX_NOTIFICATIONS_PER_TICK } from './constants.js';

export function truncateMessage(text, maxLen = 80) {
  if (!text || text.length <= maxLen) return text || '';
  return text.substring(0, maxLen - 3) + '...';
}

export async function notifyChange(monitor, newValue) {
  await chrome.notifications.create(monitor.id, {
    type: 'basic',
    title: monitor.label,
    message: truncateMessage(newValue),
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
  });
}

export async function notifyBatch(changes) {
  const individual = changes.slice(0, MAX_NOTIFICATIONS_PER_TICK);
  const remaining = changes.length - individual.length;
  for (const { monitor, newValue } of individual) {
    await notifyChange(monitor, newValue);
  }
  if (remaining > 0) {
    await chrome.notifications.create('batch-summary', {
      type: 'basic',
      title: 'PagePulse',
      message: `${remaining} more monitor(s) detected changes — click to view`,
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    });
  }
}
