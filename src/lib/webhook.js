/**
 * Per-monitor webhook actions. Fires a generic JSON POST to the user-supplied
 * URL when a monitor detects a real change. Payload includes Slack-friendly
 * `text` and Discord-friendly `content` convenience fields plus structured
 * `monitor` and `change` data for power users (Zapier, IFTTT, custom servers).
 *
 * Privacy: this fires from the user's browser to the user's chosen endpoint.
 * No PagePulse server is involved.
 */

const TEXT_MAX = 300;
const DEFAULT_TIMEOUT_MS = 10000;

function summarize(monitor, change) {
  const newValue = String(change.new ?? '');
  const summary = `PagePulse: ${monitor.label} — ${newValue}`;
  if (summary.length <= TEXT_MAX) return summary;
  return summary.substring(0, TEXT_MAX - 3) + '...';
}

export function buildWebhookPayload(monitor, change) {
  const text = summarize(monitor, change);
  return {
    type: 'change',
    text,
    content: text,
    monitor: {
      id: monitor.id,
      label: monitor.label,
      url: monitor.url,
    },
    change: {
      old: change.old,
      new: change.new,
      ts: change.ts,
    },
  };
}

export function isValidWebhookUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function fireWebhook(url, monitor, change, opts = {}) {
  if (!isValidWebhookUrl(url)) return false;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const payload = buildWebhookPayload(monitor, change);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return Boolean(response && response.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
