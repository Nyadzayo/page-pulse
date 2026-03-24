import { getMonitors, getSettings, updateMonitor } from './lib/storage.js';
import { TIER_LIMITS } from './lib/constants.js';
import { initTheme, toggleTheme, getTheme, sunIcon, moonIcon } from './lib/theme.js';

document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Theme
    initTheme();
    const themeBtn = document.getElementById('btn-theme');
    themeBtn.innerHTML = getTheme() === 'dark' ? sunIcon : moonIcon;
    themeBtn.addEventListener('click', () => {
      const next = toggleTheme();
      themeBtn.innerHTML = next === 'dark' ? sunIcon : moonIcon;
    });

    // Clear badge
    try { chrome.action.setBadgeText({ text: '' }); } catch {}

    const monitors = await getMonitors();
    const settings = await getSettings();
    const limits = TIER_LIMITS[settings.tier];
    const monitorArr = Object.values(monitors);

    // ── Smart flow: zero monitors + permission already granted → skip popup ──
    if (monitorArr.length === 0) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.id && isMonitorablePage(tab.url)) {
          const origin = new URL(tab.url).origin;
          const hasPermission = await chrome.permissions.contains({ origins: [`${origin}/*`] });
          if (hasPermission) {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
            window.close();
            return;
          }
        }
      } catch {
        // Can't auto-start — fall through to show popup
      }
    }

    // ── Render monitor list ──
    const listEl = document.getElementById('monitor-list');

    if (monitorArr.length === 0) {
      listEl.innerHTML = `
        <div class="popup-empty">
          <div class="popup-empty-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M2 12h4l3-9 4 18 3-9h4"/>
            </svg>
          </div>
          <h3>Start monitoring</h3>
          <p>Click "Add Monitor" to select an element on this page.</p>
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
          metaText = '<span style="color:var(--red-text)">Broken</span>';
        } else {
          statusClass = 'live';
          try {
            metaText = `${timeAgo(m.lastChecked)} <span class="sep">·</span> ${new URL(m.url).hostname}`;
          } catch {
            metaText = timeAgo(m.lastChecked);
          }
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

    // ── Click handlers ──
    listEl.addEventListener('click', async (e) => {
      try {
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
            try {
              meta.innerHTML = `${timeAgo(monitor.lastChecked)} <span class="sep">·</span> ${new URL(monitor.url).hostname}`;
            } catch {
              meta.innerHTML = timeAgo(monitor.lastChecked);
            }
          }
          return;
        }

        const item = e.target.closest('.popup-monitor');
        if (item?.dataset.id) {
          chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard.html?monitor=${item.dataset.id}`) });
          window.close();
        }
      } catch {}
    });

    // ── Add Monitor ──
    document.getElementById('btn-add').addEventListener('click', async () => {
      try {
        const currentMonitors = await getMonitors();
        const activeCount = Object.values(currentMonitors).filter(m => m.active).length;
        if (activeCount >= limits.maxMonitors) return;

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id || !isMonitorablePage(tab.url)) return;

        const origin = new URL(tab.url).origin;
        const hasPermission = await chrome.permissions.contains({ origins: [`${origin}/*`] });

        if (hasPermission) {
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
          window.close();
          return;
        }

        // Request permission (requires user gesture — this IS a click handler)
        const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
        if (granted) {
          // After permission dialog, popup context may be stale
          // Use background to inject — it's always alive
          chrome.runtime.sendMessage(
            { action: 'startSelection', tabId: tab.id },
            () => void chrome.runtime.lastError
          );
          setTimeout(() => window.close(), 150);
        }
      } catch {}
    });

    // ── Dashboard ──
    document.getElementById('btn-dashboard').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
      window.close();
    });

    // ── Usage bar ──
    const activeCount = monitorArr.filter((m) => m.active).length;
    document.getElementById('usage-text').innerHTML = `<strong>${activeCount}</strong>/${limits.maxMonitors} monitors`;
    document.getElementById('usage-fill').style.width = `${(activeCount / limits.maxMonitors) * 100}%`;

  } catch (err) {
    console.error('[PagePulse] Popup error:', err);
  }
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
  div.textContent = str || '';
  return div.innerHTML;
}

function isMonitorablePage(url) {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
}
