import { STATUS, BROKEN_THRESHOLD, BROKEN_WINDOW_MS, MAX_URLS_PER_TICK } from './constants.js';
import { hasMeaningfulChange } from './differ.js';

export function filterDueMonitors(monitors, now) {
  return Object.values(monitors).filter((m) => {
    if (!m.active) return false;
    if (m.status === STATUS.BROKEN || m.status === STATUS.PERMISSION_REVOKED) return false;
    if (m.lastChecked === null) return true;
    return (now - m.lastChecked) >= m.intervalMs;
  });
}

export function groupByUrl(monitors) {
  const groups = {};
  for (const m of monitors) {
    if (!groups[m.url]) groups[m.url] = [];
    groups[m.url].push(m);
  }
  return groups;
}

export function limitUrlBatch(urlGroups) {
  return Object.keys(urlGroups).slice(0, MAX_URLS_PER_TICK);
}

export function processCheckResults(monitor, result, now) {
  if (result.text === null || result.matchedBy === null) {
    const newErrorCount = monitor.consecutiveErrors + 1;
    const firstError = monitor.firstErrorAt || now;
    const windowExceeded = (now - firstError) > BROKEN_WINDOW_MS;
    const thresholdExceeded = newErrorCount >= BROKEN_THRESHOLD;
    return {
      lastChecked: now,
      consecutiveErrors: newErrorCount,
      firstErrorAt: firstError,
      status: (thresholdExceeded && windowExceeded) ? STATUS.BROKEN : STATUS.OK,
      changed: false,
    };
  }

  const base = { lastChecked: now, consecutiveErrors: 0, firstErrorAt: null, status: STATUS.OK };

  if (hasMeaningfulChange(monitor.baseline, result.text)) {
    return {
      ...base, changed: true, baseline: result.text,
      changeCount: monitor.changeCount + 1, lastChanged: now,
      historyEntry: { ts: now, old: monitor.baseline, new: result.text },
    };
  }
  return { ...base, changed: false };
}
