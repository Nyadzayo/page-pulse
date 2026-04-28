import { STATUS, BROKEN_THRESHOLD, BROKEN_WINDOW_MS, MAX_URLS_PER_TICK } from './constants.js';
import { hasMeaningfulChange, matchesKeyword, applyIgnorePatterns } from './differ.js';

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

/**
 * @typedef {Object} CheckOutcome
 * @property {boolean} changed - Whether the check produced a meaningful, notifiable change.
 * @property {?{ts: number, old: string, new: string}} historyEntry - Diff entry to append, or null.
 * @property {Object} monitorUpdates - Patch to merge into the monitor record (no `changed`/`historyEntry`).
 */

/**
 * Pure evaluator for a single check result. Returns a structured CheckOutcome
 * separating notification semantics (changed, historyEntry) from storage state
 * (monitorUpdates). Replaces the legacy flat-shape returned by processCheckResults.
 *
 * @param {Object} monitor
 * @param {{monitorId: string, text: ?string, matchedBy: ?string}} result
 * @param {number} now
 * @returns {CheckOutcome}
 */
export function evaluateCheck(monitor, result, now) {
  if (result.text === null || result.matchedBy === null) {
    const newErrorCount = monitor.consecutiveErrors + 1;
    const firstError = monitor.firstErrorAt || now;
    const windowExceeded = (now - firstError) > BROKEN_WINDOW_MS;
    const thresholdExceeded = newErrorCount >= BROKEN_THRESHOLD;
    return {
      changed: false,
      historyEntry: null,
      monitorUpdates: {
        lastChecked: now,
        consecutiveErrors: newErrorCount,
        firstErrorAt: firstError,
        status: (thresholdExceeded && windowExceeded) ? STATUS.BROKEN : STATUS.OK,
      },
    };
  }

  const base = { lastChecked: now, consecutiveErrors: 0, firstErrorAt: null, status: STATUS.OK };

  // Apply ignore patterns before comparison
  const ignorePatterns = monitor.ignorePatterns || '';
  const cleanedBaseline = applyIgnorePatterns(monitor.baseline, ignorePatterns);
  const cleanedResult = applyIgnorePatterns(result.text, ignorePatterns);

  if (hasMeaningfulChange(cleanedBaseline, cleanedResult)) {
    // Check keyword filter: if keywords are set and none match the added text,
    // still update baseline (track latest state) but suppress notification/history.
    if (monitor.keywords && monitor.keywords.trim() &&
        !matchesKeyword(monitor.baseline, result.text, monitor.keywords)) {
      return {
        changed: false,
        historyEntry: null,
        monitorUpdates: { ...base, baseline: result.text },
      };
    }
    return {
      changed: true,
      historyEntry: { ts: now, old: monitor.baseline, new: result.text },
      monitorUpdates: {
        ...base,
        baseline: result.text,
        changeCount: monitor.changeCount + 1,
        lastChanged: now,
      },
    };
  }

  // No meaningful change — but update baseline to latest original text so it stays current.
  const baselineChanged = hasMeaningfulChange(monitor.baseline, result.text);
  return {
    changed: false,
    historyEntry: null,
    monitorUpdates: { ...base, ...(baselineChanged ? { baseline: result.text } : {}) },
  };
}

/**
 * Legacy flat-shape adapter around evaluateCheck. Kept for back-compat with
 * existing tests and any caller that hasn't migrated to the structured outcome.
 * New callers should use evaluateCheck directly.
 *
 * @deprecated Prefer evaluateCheck which returns a structured CheckOutcome.
 */
export function processCheckResults(monitor, result, now) {
  const outcome = evaluateCheck(monitor, result, now);
  const flat = { ...outcome.monitorUpdates, changed: outcome.changed };
  if (outcome.historyEntry) flat.historyEntry = outcome.historyEntry;
  return flat;
}
