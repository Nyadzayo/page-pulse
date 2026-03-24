import { getMonitors, getSettings, updateMonitor } from './lib/storage.js';
import { TIER_LIMITS } from './lib/constants.js';
import { initTheme, toggleTheme, getTheme, sunIcon, moonIcon } from './lib/theme.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Theme
  initTheme();
  const themeBtn = document.getElementById('btn-theme');
  themeBtn.innerHTML = getTheme() === 'dark' ? sunIcon : moonIcon;
  themeBtn.addEventListener('click', () => {
    const next = toggleTheme();
    themeBtn.innerHTML = next === 'dark' ? sunIcon : moonIcon;
  });

  // Clear badge
  chrome.action.setBadgeText({ text: '' });

  const monitors = await getMonitors();
  const settings = await getSettings();
  const limits = TIER_LIMITS[settings.tier];
  const monitorArr = Object.values(monitors);

  // ── SMART FLOW: Zero monitors + already have permission → skip popup ──
  if (monitorArr.length === 0) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && isMonitorablePage(tab.url)) {
      const origin = new URL(tab.url).origin;
      const hasPermission = await chrome.permissions.contains({ origins: [`${origin}/*`] });
      if (hasPermission) {
        // Already permitted → go straight to selection, no user gesture needed
        chrome.runtime.sendMessage({ action: 'startSelection', tabId: tab.id }, () => void chrome.runtime.lastError);
        window.close();
        return;
      }
      // No permission → show popup, user clicks "Add Monitor" (user gesture required)
    }
  }

  // ── Render monitor list ──
  const listEl = document.getElementById('monitor-list');

  if (monitorArr.length === 0) {
    listEl.innerHTML = `
      <div class="popup-empty">
        <div class="popup-empty-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/><path d="M12 8v8m-4-4h8"/>
          </svg>
        </div>
        <h3>No monitors yet</h3>
        <p>Click below to select an element on a page and start tracking changes.</p>
      </div>
    `;
  } else {
    listEl.innerHTML = '';
    for (const m of monitorArr.sort((a, b) => b.createdAt - a.createdAt)) {
      let statusClass, metaText;
      if (!m.active) {
        statusClass = 'paused';
        metaText = '<span style="color:var(--amber)">Paused</span>';
      } else if (m.status === 'broken') {
        statusClass = 'error';
        metaText = '<span style="color:var(--red-text)">Broken · selector not found</span>';
      } else {
        statusClass = 'live';
        metaText = `${timeAgo(m.lastChecked)} <span class="sep">·</span> ${new URL(m.url).hostname}`;
      }

      const item = document.createElement('div');
      item.className = 'popup-monitor';
      item.dataset.id = m.id;
      item.innerHTML = `
        <div class="pm-status ${statusClass}"></div>
        <div class="pm-info">
          <div class="pm-name" title="${escapeHtml(m.label)}">${escapeHtml(m.label)}</div>
          <div class="pm-meta">${metaText}</div>
        </div>
        <div class="pm-changes ${m.changeCount === 0 ? 'zero' : ''}">${m.changeCount || '0'}</div>
        <button class="pm-toggle ${m.active ? 'on' : 'off'}" data-id="${m.id}"></button>
      `;
      listEl.appendChild(item);
    }
  }

  // ── Click handlers on monitor list ──
  listEl.addEventListener('click', async (e) => {
    // Toggle button
    const toggle = e.target.closest('.pm-toggle');
    if (toggle) {
      e.stopPropagation();
      const id = toggle.dataset.id;
      const monitor = monitors[id];
      if (!monitor) return;
      const newActive = !monitor.active;
      await updateMonitor(id, { active: newActive });
      toggle.className = `pm-toggle ${newActive ? 'on' : 'off'}`;
      monitors[id].active = newActive;

      const item = toggle.closest('.popup-monitor');
      const dot = item.querySelector('.pm-status');
      const meta = item.querySelector('.pm-meta');
      if (!newActive) {
        dot.className = 'pm-status paused';
        meta.innerHTML = '<span style="color:var(--amber)">Paused</span>';
      } else {
        dot.className = `pm-status ${monitor.status === 'broken' ? 'error' : 'live'}`;
        meta.innerHTML = `${timeAgo(monitor.lastChecked)} <span class="sep">·</span> ${new URL(monitor.url).hostname}`;
      }
      return;
    }

    // Click monitor → open dashboard
    const item = e.target.closest('.popup-monitor');
    if (item && item.dataset.id) {
      chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html?monitor=${item.dataset.id}`) });
      window.close();
    }
  });

  // ── Add Monitor ──
  document.getElementById('btn-add').addEventListener('click', () => {
    startAddMonitor(limits);
  });

  // ── Dashboard button ──
  document.getElementById('btn-dashboard').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
    window.close();
  });

  // ── Usage bar ──
  const activeCount = monitorArr.filter((m) => m.active).length;
  document.getElementById('usage-text').innerHTML = `<strong>${activeCount}</strong>/${limits.maxMonitors} monitors`;
  document.getElementById('usage-fill').style.width = `${(activeCount / limits.maxMonitors) * 100}%`;
});

function timeAgo(ts) {
  if (!ts) return 'Not checked';
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function isMonitorablePage(url) {
  if (!url) return false;
  try {
    return url.startsWith('http://') || url.startsWith('https://');
  } catch {
    return false;
  }
}

async function startAddMonitor(limits) {
  // Check monitor limit
  const currentMonitors = await getMonitors();
  const activeCount = Object.values(currentMonitors).filter(m => m.active).length;
  if (limits && activeCount >= limits.maxMonitors) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isMonitorablePage(tab.url)) return;

  const origin = new URL(tab.url).origin;

  // Check if already have permission — skip the prompt
  const hasPermission = await chrome.permissions.contains({ origins: [`${origin}/*`] });
  if (hasPermission) {
    chrome.runtime.sendMessage({ action: 'startSelection', tabId: tab.id }, () => void chrome.runtime.lastError);
    window.close();
    return;
  }

  // Need permission — request it
  const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
  if (!granted) return;

  chrome.runtime.sendMessage({ action: 'startSelection', tabId: tab.id }, () => void chrome.runtime.lastError);
  window.close();
}
