import { getMonitors, getSettings, getHistory, updateMonitor, deleteMonitor, updateSettings } from './lib/storage.js';
import { computeDiff } from './lib/differ.js';
import { INTERVALS, TIER_LIMITS } from './lib/constants.js';
import { initTheme, toggleTheme, getTheme, sunIcon, moonIcon } from './lib/theme.js';
import { playChime } from './lib/sound.js';

const soundOnIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
const soundOffIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';

let currentMonitorId = null;

document.addEventListener('DOMContentLoaded', async () => {
  // Theme
  initTheme();
  const themeBtn = document.getElementById('btn-theme');
  themeBtn.innerHTML = getTheme() === 'dark' ? sunIcon : moonIcon;
  themeBtn.addEventListener('click', () => {
    const next = toggleTheme();
    themeBtn.innerHTML = next === 'dark' ? sunIcon : moonIcon;
  });

  // Sound toggle
  const settings = await getSettings();
  const soundBtn = document.getElementById('btn-sound');
  let soundOn = settings.soundEnabled !== false;
  soundBtn.innerHTML = soundOn ? soundOnIcon : soundOffIcon;
  soundBtn.addEventListener('click', async () => {
    soundOn = !soundOn;
    await updateSettings({ soundEnabled: soundOn });
    soundBtn.innerHTML = soundOn ? soundOnIcon : soundOffIcon;
    // Play preview sound when turning on
    if (soundOn) {
      playChimePreview();
    }
  });

  await loadSidebar();
  setupEventListeners();
  const params = new URLSearchParams(window.location.search);
  const targetId = params.get('monitor');
  if (targetId) selectMonitor(targetId);

  // Auto-refresh every 30 seconds
  setInterval(async () => {
    await loadSidebar();
    if (currentMonitorId) await selectMonitor(currentMonitorId);
  }, 30000);
});

async function loadSidebar() {
  const monitors = await getMonitors();
  const settings = await getSettings();
  const limits = TIER_LIMITS[settings.tier];

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

  // Intervals — all available for free launch
  const intervalOpts = document.getElementById('interval-options');
  intervalOpts.innerHTML = INTERVALS.map(i => {
    const isActive = i.ms === monitor.intervalMs;
    const labelShort = i.label
      .replace(' minutes', 'm')
      .replace(' hour', 'h')
      .replace(' hours', 'h');
    return `<button class="dm-interval-opt ${isActive ? 'active' : ''}" data-ms="${i.ms}">${labelShort}</button>`;
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
            <div style="display:flex;gap:6px;align-items:center;">
              <button class="dm-copy-btn" data-old="${escapeHtml(entry.old)}" data-new="${escapeHtml(entry.new)}" title="Copy to clipboard">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              </button>
              <span class="dm-entry-tag">Changed</span>
            </div>
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
    const monitors = await getMonitors();
    const beforeCount = monitors[currentMonitorId]?.changeCount || 0;

    btn.textContent = 'Checking...';
    btn.disabled = true;
    await chrome.runtime.sendMessage({ action: 'checkNow', monitorId: currentMonitorId });

    // Check if change was detected
    const monitorsAfter = await getMonitors();
    const afterCount = monitorsAfter[currentMonitorId]?.changeCount || 0;

    if (afterCount > beforeCount) {
      // Change detected — play sound from dashboard (reliable)
      const settings = await getSettings();
      if (settings.soundEnabled !== false) {
        playChime(0.5);
      }
    }

    await selectMonitor(currentMonitorId);
    await loadSidebar();
    btn.textContent = 'Check Now';
    btn.disabled = false;
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

  // Export dropdown
  const exportBtn = document.getElementById('btn-export');
  const exportMenu = document.getElementById('export-menu');

  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle('open');
  });

  // Close dropdown on outside click
  document.addEventListener('click', () => exportMenu.classList.remove('open'));

  document.getElementById('btn-export-json').addEventListener('click', async () => {
    exportMenu.classList.remove('open');
    if (!currentMonitorId) return;
    const history = await getHistory(currentMonitorId);
    const monitors = await getMonitors();
    const monitor = monitors[currentMonitorId];
    const data = { monitor: { label: monitor.label, url: monitor.url }, history };
    downloadFile(
      JSON.stringify(data, null, 2),
      `pagepulse-${safeName(monitor.label)}.json`,
      'application/json'
    );
  });

  document.getElementById('btn-export-csv').addEventListener('click', async () => {
    exportMenu.classList.remove('open');
    if (!currentMonitorId) return;
    const history = await getHistory(currentMonitorId);
    const monitors = await getMonitors();
    const monitor = monitors[currentMonitorId];

    const rows = [['Timestamp', 'Date', 'Old Value', 'New Value', 'Monitor', 'URL']];
    for (const entry of history.sort((a, b) => b.ts - a.ts)) {
      rows.push([
        entry.ts,
        new Date(entry.ts).toISOString(),
        csvEscape(entry.old),
        csvEscape(entry.new),
        csvEscape(monitor.label),
        csvEscape(monitor.url),
      ]);
    }
    const csv = rows.map(r => r.join(',')).join('\n');
    downloadFile(csv, `pagepulse-${safeName(monitor.label)}.csv`, 'text/csv');
  });

  // Shortcuts button
  document.getElementById('btn-shortcuts')?.addEventListener('click', toggleShortcutsHelp);

  // Keyboard shortcuts
  document.addEventListener('keydown', async (e) => {
    // Don't fire when typing in input fields
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const items = document.querySelectorAll('.ds-item');
    const ids = Array.from(items).map(el => el.dataset.id);
    const currentIdx = ids.indexOf(currentMonitorId);

    switch(e.key) {
      case 'j': // Next monitor
        if (currentIdx < ids.length - 1) selectMonitor(ids[currentIdx + 1]);
        else if (ids.length > 0 && currentIdx === -1) selectMonitor(ids[0]);
        break;
      case 'k': // Previous monitor
        if (currentIdx > 0) selectMonitor(ids[currentIdx - 1]);
        break;
      case 'c': // Check now
        if (currentMonitorId) document.getElementById('btn-check-now')?.click();
        break;
      case 'e': // Export
        if (currentMonitorId) document.getElementById('btn-export')?.click();
        break;
      case 'Backspace': // Delete (with confirm)
      case 'Delete':
        if (currentMonitorId) document.getElementById('btn-delete')?.click();
        break;
      case '?': // Show shortcuts help
        toggleShortcutsHelp();
        break;
      case 'Escape':
        hideShortcutsHelp();
        break;
    }
  });

  document.getElementById('history-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('.dm-copy-btn');
    if (!btn) return;
    const old = btn.dataset.old;
    const nw = btn.dataset.new;
    const monitors = await getMonitors();
    const monitor = monitors[currentMonitorId];
    const text = `PagePulse Change — ${monitor?.label || 'Monitor'}\n${new Date().toLocaleString()}\nOld: ${old.substring(0, 200)}\nNew: ${nw.substring(0, 200)}`;
    await navigator.clipboard.writeText(text);
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    setTimeout(() => {
      btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
    }, 2000);
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

function playChimePreview() {
  playChime(0.5);
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const str = String(value || '').replace(/"/g, '""');
  return str.includes(',') || str.includes('"') || str.includes('\n')
    ? `"${str}"`
    : str;
}

function safeName(label) {
  return (label || 'monitor').replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-');
}
