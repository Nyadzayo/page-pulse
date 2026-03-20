import { getMonitors, getSettings, getHistory, updateMonitor, deleteMonitor } from './lib/storage.js';
import { computeDiff } from './lib/differ.js';
import { INTERVALS, TIERS, TIER_LIMITS } from './lib/constants.js';

let currentMonitorId = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadSidebar();
  setupEventListeners();
  const params = new URLSearchParams(window.location.search);
  const targetId = params.get('monitor');
  if (targetId) selectMonitor(targetId);
});

async function loadSidebar() {
  const monitors = await getMonitors();
  const settings = await getSettings();
  const limits = TIER_LIMITS[settings.tier];
  const badge = document.getElementById('tier-badge');
  badge.textContent = settings.tier === TIERS.PRO ? 'PRO' : 'FREE';
  if (settings.tier === TIERS.PRO) badge.classList.add('pro');
  else badge.classList.remove('pro');

  const arr = Object.values(monitors).sort((a, b) => b.createdAt - a.createdAt);
  const activeCount = arr.filter(m => m.active).length;
  document.getElementById('sidebar-count').textContent = `${activeCount} / ${limits.maxMonitors}`;

  const list = document.getElementById('sidebar-list');
  if (arr.length === 0) {
    list.innerHTML = '<p style="color:var(--text-tertiary);text-align:center;padding:20px;font-size:12px;">No monitors yet.</p>';
    return;
  }

  list.innerHTML = arr.map(m => {
    const dotClass = m.status === 'ok' ? 'ok' : m.status === 'broken' ? 'err' : 'warn';
    const host = new URL(m.url).hostname;
    return `
      <div class="ds-item ${m.id === currentMonitorId ? 'active' : ''}" data-id="${m.id}">
        <div class="ds-dot ${dotClass}"></div>
        <div class="ds-info">
          <div class="ds-name">${escapeHtml(m.label)}</div>
          <div class="ds-host">${host}</div>
        </div>
        <span class="ds-badge ${m.changeCount > 0 ? 'changes' : 'zero'}">${m.changeCount > 0 ? m.changeCount : '—'}</span>
      </div>
    `;
  }).join('');
}

async function selectMonitor(id) {
  currentMonitorId = id;
  const monitors = await getMonitors();
  const monitor = monitors[id];
  if (!monitor) return;

  const settings = await getSettings();
  const tier = settings.tier;

  document.getElementById('no-selection').style.display = 'none';
  document.getElementById('monitor-detail').style.display = 'block';

  document.getElementById('detail-label').textContent = monitor.label;
  const urlEl = document.getElementById('detail-url');
  urlEl.textContent = new URL(monitor.url).hostname + new URL(monitor.url).pathname;
  urlEl.href = monitor.url;

  // Stats
  const statusEl = document.getElementById('stat-status');
  statusEl.textContent = monitor.status === 'ok' ? 'Active' : monitor.status.charAt(0).toUpperCase() + monitor.status.slice(1);
  statusEl.className = `dm-stat-value ${monitor.status === 'ok' ? 'ok' : 'err'}`;

  document.getElementById('stat-last-checked').textContent = monitor.lastChecked ? timeAgo(monitor.lastChecked) : 'Never';
  document.getElementById('stat-changes').textContent = monitor.changeCount;
  document.getElementById('stat-since').textContent = new Date(monitor.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Intervals
  const intervalOpts = document.getElementById('interval-options');
  intervalOpts.innerHTML = INTERVALS.map(i => {
    const isActive = i.ms === monitor.intervalMs;
    const isPro = i.proOnly && tier !== TIERS.PRO;
    const labelShort = i.label
      .replace(' minutes', 'm')
      .replace(' hour', 'h')
      .replace(' hours', 'h');
    return `<button class="dm-interval-opt ${isActive ? 'active' : ''} ${isPro ? 'pro' : ''}" data-ms="${i.ms}" ${isPro ? 'disabled' : ''}>${labelShort}</button>`;
  }).join('');

  // Baseline
  document.getElementById('detail-baseline').textContent = monitor.baseline || '(empty)';

  // History
  const history = await getHistory(id);
  const historyList = document.getElementById('history-list');
  if (history.length === 0) {
    historyList.innerHTML = '<p style="color:var(--text-tertiary);font-size:12px;">No changes detected yet.</p>';
  } else {
    historyList.innerHTML = history.sort((a, b) => b.ts - a.ts).map(entry => {
      const diffParts = computeDiff(entry.old, entry.new);
      const diffHtml = diffParts.map(p => {
        if (p.added) return `<ins>${escapeHtml(p.value)}</ins>`;
        if (p.removed) return `<del>${escapeHtml(p.value)}</del>`;
        return escapeHtml(p.value);
      }).join('');
      return `
        <div class="dm-entry">
          <div class="dm-entry-head">
            <span class="dm-entry-time">${new Date(entry.ts).toLocaleString()}</span>
            <span class="dm-entry-tag">Changed</span>
          </div>
          <div class="dm-diff">${diffHtml}</div>
        </div>
      `;
    }).join('');
  }

  // Highlight sidebar
  document.querySelectorAll('.ds-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });
}

function setupEventListeners() {
  document.getElementById('sidebar-list').addEventListener('click', e => {
    const item = e.target.closest('.ds-item');
    if (item) selectMonitor(item.dataset.id);
  });

  document.getElementById('btn-check-now').addEventListener('click', async () => {
    if (!currentMonitorId) return;
    const btn = document.getElementById('btn-check-now');
    btn.textContent = 'Checking...';
    btn.disabled = true;
    await chrome.runtime.sendMessage({ action: 'checkNow', monitorId: currentMonitorId });
    setTimeout(async () => {
      await selectMonitor(currentMonitorId);
      await loadSidebar();
      btn.textContent = 'Check Now';
      btn.disabled = false;
    }, 2000);
  });

  document.getElementById('btn-delete').addEventListener('click', async () => {
    if (!currentMonitorId) return;
    if (!confirm('Delete this monitor and its history?')) return;
    await deleteMonitor(currentMonitorId);
    currentMonitorId = null;
    document.getElementById('monitor-detail').style.display = 'none';
    document.getElementById('no-selection').style.display = 'flex';
    await loadSidebar();
  });

  document.getElementById('interval-options').addEventListener('click', async e => {
    const btn = e.target.closest('.dm-interval-opt');
    if (!btn || btn.disabled || !currentMonitorId) return;
    const ms = parseInt(btn.dataset.ms);
    await updateMonitor(currentMonitorId, { intervalMs: ms });
    await selectMonitor(currentMonitorId);
  });

  document.getElementById('btn-export').addEventListener('click', async () => {
    if (!currentMonitorId) return;
    const settings = await getSettings();
    if (settings.tier !== TIERS.PRO) {
      alert('Export is a Pro feature. Upgrade to export your change history.');
      return;
    }
    const history = await getHistory(currentMonitorId);
    const monitors = await getMonitors();
    const monitor = monitors[currentMonitorId];
    const data = { monitor: { label: monitor.label, url: monitor.url }, history };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pagepulse-${monitor.label.replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('btn-upgrade').addEventListener('click', () => {
    // ExtensionPay integration placeholder
    alert('Pro upgrade coming soon!');
  });
}

function timeAgo(ts) {
  if (!ts) return 'Never';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
