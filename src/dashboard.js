import { getMonitors, getSettings, getHistory, updateMonitor, deleteMonitor, updateSettings, saveMonitor, updateHistoryEntry } from './lib/storage.js';
import { computeDiff, generateSummary, matchesKeyword } from './lib/differ.js';
import { isValidWebhookUrl } from './lib/webhook.js';
import { PROVIDER_PRESETS, summarizeChange, isAiEnabled } from './lib/aiSummary.js';
import { buildRssFeed, monitorToFeedItems } from './lib/rssFeed.js';
import { INTERVALS, TIER_LIMITS, DIFF_MODES, NOTIFY_MODES, STATUS } from './lib/constants.js';
import { initTheme, toggleTheme, getTheme, sunIcon, moonIcon } from './lib/theme.js';
import { playChime } from './lib/sound.js';

const soundOnIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
const soundOffIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
const syncOnIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
const syncOffIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
const aiSparkleSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L9 9l-7 3 7 3 3 7 3-7 7-3-7-3z"/></svg>';
const aiOnLabel = `${aiSparkleSvg}<span>AI On</span>`;
const aiOffLabel = `${aiSparkleSvg}<span>Configure AI</span>`;

let currentMonitorId = null;

// History entries indexed by string position so the rendered HTML never has
// to embed untrusted entry text in attributes (see escapeAttr() comment
// below). The click handler reads data-idx and looks up by index.
const historyEntryMap = new Map();

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

  // Sync toggle — opt-in chrome.storage.sync of monitor configs.
  const syncBtn = document.getElementById('btn-sync');
  let syncOn = settings.syncEnabled === true;
  syncBtn.innerHTML = syncOn ? syncOnIcon : syncOffIcon;
  syncBtn.title = syncOn
    ? 'Sync ON — monitor configs sync via Chrome Sync (history stays local)'
    : 'Sync OFF — click to enable cross-device monitor config sync';
  syncBtn.addEventListener('click', async () => {
    syncOn = !syncOn;
    await updateSettings({ syncEnabled: syncOn });
    syncBtn.innerHTML = syncOn ? syncOnIcon : syncOffIcon;
    syncBtn.title = syncOn
      ? 'Sync ON — monitor configs sync via Chrome Sync (history stays local)'
      : 'Sync OFF — click to enable cross-device monitor config sync';
    // When turning on, immediately push current monitor configs to sync so
    // other signed-in devices can pull them. The background SW will react
    // to the same settings change via its onChanged listener, but doing it
    // here gives instant feedback in the dashboard.
    if (syncOn) {
      try {
        chrome.runtime.sendMessage({ action: 'sync_now' }, () => void chrome.runtime.lastError);
      } catch {}
    }
  });

  // AI summaries toggle — opens config dialog when not yet enabled.
  const aiBtn = document.getElementById('btn-ai');
  const aiDialog = document.getElementById('ai-key-dialog');
  const aiKeyInput = document.getElementById('ai-key-input');
  const aiUrlInput = document.getElementById('ai-url-input');
  const aiModelInput = document.getElementById('ai-model-input');
  const aiPresetSelect = document.getElementById('ai-preset-select');
  const aiPresetNotes = document.getElementById('ai-preset-notes');

  // Populate preset dropdown from PROVIDER_PRESETS.
  if (aiPresetSelect && aiPresetSelect.options.length === 0) {
    for (const p of PROVIDER_PRESETS) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      aiPresetSelect.appendChild(opt);
    }
    const customOpt = document.createElement('option');
    customOpt.value = '__custom__';
    customOpt.textContent = 'Custom…';
    aiPresetSelect.appendChild(customOpt);
  }

  function applyPreset(presetId) {
    if (presetId === '__custom__') {
      aiPresetNotes.textContent = 'Any OpenAI-compatible endpoint works (NVIDIA NIM, vLLM, LM Studio, etc.).';
      return;
    }
    const preset = PROVIDER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    aiUrlInput.value = preset.apiUrl;
    aiModelInput.value = preset.model;
    aiKeyInput.placeholder = preset.keyHint;
    aiPresetNotes.textContent = preset.notes;
    aiPresetSelect.dataset.provider = preset.provider;
  }

  aiPresetSelect?.addEventListener('change', (e) => applyPreset(e.target.value));

  let aiOn = settings.aiSummaryEnabled === true && Boolean(settings.aiApiKey);
  function paintAiBtn() {
    aiBtn.innerHTML = aiOn ? aiOnLabel : aiOffLabel;
    aiBtn.classList.toggle('active', aiOn);
    aiBtn.title = aiOn ? 'AI summaries ON — click to disable' : 'AI summaries OFF — click to configure or re-enable';
  }
  paintAiBtn();

  const aiInstructionInput = document.getElementById('ai-instruction-input');

  function openAiDialog(currentSettings) {
    // Reset any error state from a previous open.
    aiPresetNotes.style.color = '';
    // Pick a preset matching the saved URL, or default to NVIDIA (free tier).
    let matchedId = 'nvidia';
    if (currentSettings.aiApiUrl) {
      const match = PROVIDER_PRESETS.find((p) => p.apiUrl === currentSettings.aiApiUrl);
      matchedId = match ? match.id : '__custom__';
    }
    aiPresetSelect.value = matchedId;
    applyPreset(matchedId);
    if (currentSettings.aiApiUrl) aiUrlInput.value = currentSettings.aiApiUrl;
    if (currentSettings.aiModel) aiModelInput.value = currentSettings.aiModel;
    aiKeyInput.value = currentSettings.aiApiKey || '';
    if (aiInstructionInput) aiInstructionInput.value = currentSettings.aiSummaryInstruction || '';
    aiDialog.showModal();
    aiKeyInput.focus();
  }

  aiBtn.addEventListener('click', async () => {
    const current = await getSettings();
    if (aiOn) {
      await updateSettings({ aiSummaryEnabled: false });
      aiOn = false;
      paintAiBtn();
      return;
    }
    if (current.aiApiKey && current.aiApiUrl && current.aiModel) {
      // Verify host_permissions are in place for the saved endpoint.
      // Without this, the SW's fetch hits CORS preflight failures.
      let parsed;
      try { parsed = new URL(current.aiApiUrl); } catch { openAiDialog(current); return; }
      const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
      if (!isLoopback) {
        const originPattern = `${parsed.protocol}//${parsed.host}/*`;
        let has = false;
        try { has = await chrome.permissions.contains({ origins: [originPattern] }); } catch {}
        if (!has) {
          let granted = false;
          try { granted = await chrome.permissions.request({ origins: [originPattern] }); } catch {}
          if (!granted) {
            aiBtn.title = `AI off — permission for ${parsed.host} was denied`;
            return;
          }
        }
      }
      await updateSettings({ aiSummaryEnabled: true });
      aiOn = true;
      paintAiBtn();
      return;
    }
    openAiDialog(current);
  });

  document.getElementById('ai-key-cancel')?.addEventListener('click', () => aiDialog.close());
  document.getElementById('ai-key-save')?.addEventListener('click', async () => {
    const key = aiKeyInput.value.trim();
    const url = aiUrlInput.value.trim();
    const model = aiModelInput.value.trim();
    if (!key || !url || !model) {
      if (!key) aiKeyInput.focus();
      else if (!url) aiUrlInput.focus();
      else aiModelInput.focus();
      return;
    }
    const presetId = aiPresetSelect.value;
    let provider = aiPresetSelect.dataset.provider;
    if (presetId === '__custom__' || !provider) {
      // Heuristic: anthropic.com → anthropic, otherwise openai_compatible.
      provider = url.includes('anthropic.com') ? 'anthropic' : 'openai_compatible';
    }
    // CORS gate: AI endpoints (NVIDIA, OpenAI, Anthropic, etc.) don't
    // return Access-Control-Allow-Origin for chrome-extension:// origins,
    // so without host_permissions the browser blocks the fetch with a
    // preflight failure. Request the origin via the optional <all_urls>
    // permission ceiling. Localhost/loopback (Ollama) bypasses the gate.
    let parsed;
    try { parsed = new URL(url); } catch {
      aiPresetNotes.textContent = 'Invalid URL — must start with http:// or https://';
      aiPresetNotes.style.color = '#EF4444';
      aiUrlInput.focus();
      return;
    }
    const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
    if (!isLoopback) {
      const originPattern = `${parsed.protocol}//${parsed.host}/*`;
      let granted = false;
      try {
        granted = await chrome.permissions.request({ origins: [originPattern] });
      } catch (e) {
        aiPresetNotes.textContent = `Could not request permission: ${e.message || e}`;
        aiPresetNotes.style.color = '#EF4444';
        return;
      }
      if (!granted) {
        aiPresetNotes.textContent = `Permission denied for ${parsed.host}. Click Enable again to retry.`;
        aiPresetNotes.style.color = '#EF4444';
        return;
      }
    }
    await updateSettings({
      aiSummaryEnabled: true,
      aiProvider: provider,
      aiApiKey: key,
      aiApiUrl: url,
      aiModel: model,
      aiSummaryInstruction: aiInstructionInput ? aiInstructionInput.value : '',
    });
    aiOn = true;
    aiBtn.innerHTML = aiOnIcon;
    aiBtn.title = 'AI summaries ON';
    aiPresetNotes.style.color = '';
    aiDialog.close();
    // Refresh the current monitor view so any "Generate summary" buttons
    // become reachable / state reflects the now-enabled AI feature.
    if (currentMonitorId) await selectMonitor(currentMonitorId);
  });

  await loadSidebar();
  setupEventListeners();
  const params = new URLSearchParams(window.location.search);
  const targetId = params.get('monitor');
  if (targetId) await selectMonitor(targetId);

  // H1 — broken-monitor notification deep-link: ?action=reselect&monitor=<id>
  // shows a banner prompting the user to re-add the monitor on its source page.
  if (params.get('action') === 'reselect' && targetId) {
    showReselectPrompt(targetId);
  }

  // Handle shared monitor import
  const importData = params.get('import');
  if (importData) {
    handleImport(importData);
  }

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
    const healthText = m.status === 'broken' ? 'Broken' :
      m.status === 'permission_revoked' ? 'No access' :
      !m.lastChecked ? 'Pending' :
      (Date.now() - m.lastChecked > (m.intervalMs || 3600000) * 3) ? 'Stale' :
      (m.consecutiveErrors > 0) ? 'Flaky' : '';
    const pausedTag = !m.active ? '<span class="ds-paused">PAUSED</span>' : '';
    const unread = m.unreadChangeCount || 0;
    const unreadDot = unread > 0
      ? `<span class="ds-unread" title="${unread} new change${unread === 1 ? '' : 's'}"></span>`
      : '';
    return `
      <div class="ds-item ${m.id === currentMonitorId ? 'active' : ''} ${unread > 0 ? 'has-unread' : ''}" data-id="${escapeAttr(m.id)}">
        <div class="ds-dot ${dotClass}"></div>
        <div class="ds-info">
          <div class="ds-name">${unreadDot}${escapeHtml(m.label)}</div>
          <div class="ds-host">${escapeHtml(host)}</div>
          ${healthText ? `<div class="ds-health">${escapeHtml(healthText)}</div>` : ''}
        </div>
        <span class="ds-badge ${m.changeCount > 0 ? 'changes' : 'zero'}">${m.changeCount > 0 ? m.changeCount : '—'}</span>
        ${pausedTag}
      </div>
    `;
  }).join('');
}

async function selectMonitor(id) {
  currentMonitorId = id;
  const monitors = await getMonitors();
  const monitor = monitors[id];
  if (!monitor) return;

  // F5A — clear unread counter on view (debounced via storage write).
  if ((monitor.unreadChangeCount || 0) > 0) {
    try {
      await updateMonitor(id, { unreadChangeCount: 0 });
      monitor.unreadChangeCount = 0;
      try { chrome.runtime.sendMessage({ action: 'recompute_badge' }, () => void chrome.runtime.lastError); } catch {}
    } catch {}
  }

  document.getElementById('no-selection').style.display = 'none';
  document.getElementById('monitor-detail').style.display = 'block';

  const labelEl = document.getElementById('detail-label');
  labelEl.textContent = monitor.label;
  labelEl.dataset.monitorId = id;

  const urlEl = document.getElementById('detail-url');
  const u = new URL(monitor.url);
  urlEl.textContent = u.hostname + u.pathname;
  urlEl.href = monitor.url;
  urlEl.title = `Open ${monitor.url} in a new tab`;

  // Stats
  const statusEl = document.getElementById('stat-status');
  statusEl.textContent = monitor.status === 'ok' ? 'Active' : monitor.status.charAt(0).toUpperCase() + monitor.status.slice(1);
  statusEl.className = `dm-stat-value ${monitor.status === 'ok' ? 'ok' : 'err'}`;

  document.getElementById('stat-last-checked').textContent = monitor.lastChecked ? timeAgo(monitor.lastChecked) : 'Never';
  document.getElementById('stat-changes').textContent = monitor.changeCount;
  document.getElementById('stat-since').textContent = new Date(monitor.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Health indicator
  const healthEl = document.getElementById('stat-health');
  const now = Date.now();
  const expectedInterval = monitor.intervalMs || 3600000;
  const timeSinceCheck = monitor.lastChecked ? now - monitor.lastChecked : null;
  const errors = monitor.consecutiveErrors || 0;

  let healthHtml = '';

  if (monitor.status === 'broken') {
    healthHtml = '<span class="health-bad">Broken</span><div class="health-detail">Selector not found</div>';
  } else if (monitor.status === 'permission_revoked') {
    healthHtml = '<span class="health-bad">No Access</span><div class="health-detail">Permission revoked</div>';
  } else if (!monitor.lastChecked) {
    healthHtml = '<span class="health-warn">Pending</span><div class="health-detail">Not checked yet</div>';
  } else if (timeSinceCheck > expectedInterval * 3) {
    healthHtml = '<span class="health-warn">Stale</span><div class="health-detail">Overdue by ' + timeAgo(monitor.lastChecked) + '</div>';
  } else if (errors > 0) {
    healthHtml = '<span class="health-warn">Flaky</span><div class="health-detail">' + errors + ' recent error' + (errors > 1 ? 's' : '') + '</div>';
  } else {
    healthHtml = '<span class="health-good">Healthy</span><div class="health-detail">All checks passing</div>';
  }

  healthEl.innerHTML = healthHtml;

  // Intervals — all available for free launch
  const intervalOpts = document.getElementById('interval-options');
  intervalOpts.innerHTML = INTERVALS.map(i => {
    const isActive = i.ms === monitor.intervalMs;
    const labelShort = i.label
      .replace(' minutes', 'm')
      .replace(' hour', 'h')
      .replace(' hours', 'h');
    return `<button class="dm-interval-opt ${isActive ? 'active' : ''}" data-ms="${escapeAttr(i.ms)}">${escapeHtml(labelShort)}</button>`;
  }).join('');

  // Keywords
  document.getElementById('detail-keywords').value = monitor.keywords || '';

  // Per-monitor AI prompt override
  const aiInstructionEl = document.getElementById('detail-ai-instruction');
  if (aiInstructionEl) aiInstructionEl.value = monitor.aiSummaryInstruction || '';

  // Webhook URL
  const webhookEl = document.getElementById('detail-webhook');
  if (webhookEl) {
    webhookEl.value = monitor.webhookUrl || '';
    const statusEl = document.getElementById('detail-webhook-status');
    if (statusEl) {
      if (!monitor.webhookUrl) {
        statusEl.textContent = 'Slack/Discord/Zapier — fires JSON POST on change. Leave empty to skip.';
        statusEl.style.color = '';
      } else if (isValidWebhookUrl(monitor.webhookUrl)) {
        statusEl.textContent = 'Active — will POST on every detected change.';
        statusEl.style.color = 'var(--success, #10B981)';
      } else {
        statusEl.textContent = 'Invalid URL — must start with http:// or https://';
        statusEl.style.color = '#EF4444';
      }
    }
  }

  // Render mode buttons
  const renderMode = monitor.renderMode || 'fetch';
  document.querySelectorAll('#render-mode-options .dm-interval-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.render === renderMode);
  });

  // Ignore patterns
  document.getElementById('detail-ignore').value = monitor.ignorePatterns || '';

  // Notify mode buttons
  const notifyMode = monitor.notifyMode || NOTIFY_MODES.INSTANT;
  document.querySelectorAll('#notify-mode-options .dm-interval-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.notify === notifyMode);
  });

  // Diff mode buttons
  const diffMode = monitor.diffMode || DIFF_MODES.SUMMARY;
  document.querySelectorAll('#diff-mode-options .dm-interval-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === diffMode);
  });

  // Baseline
  document.getElementById('detail-baseline').textContent = monitor.baseline || '(empty)';

  // History
  const history = await getHistory(id);
  const historyList = document.getElementById('history-list');
  historyEntryMap.clear();
  if (history.length === 0) {
    historyList.innerHTML = '<p style="color:var(--text-tertiary);font-size:12px;">No changes detected yet.</p>';
  } else {
    const sorted = history.sort((a, b) => b.ts - a.ts);
    historyList.innerHTML = sorted.map((entry, idx) => {
      historyEntryMap.set(String(idx), entry);
      return renderHistoryEntry(entry, diffMode, idx);
    }).join('');
  }

  // Pause/Resume button state
  const pauseBtn = document.getElementById('btn-pause');
  if (monitor.active) {
    pauseBtn.textContent = 'Pause';
    pauseBtn.className = 'dm-btn pause';
  } else {
    pauseBtn.textContent = 'Resume';
    pauseBtn.className = 'dm-btn resume';
  }

  // Show paused banner if inactive
  let pausedBanner = document.getElementById('paused-banner');
  if (!monitor.active) {
    if (!pausedBanner) {
      pausedBanner = document.createElement('div');
      pausedBanner.id = 'paused-banner';
      pausedBanner.className = 'dm-paused-banner';
      pausedBanner.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg> This monitor is paused — no checks are running';
      // Insert before stats
      const stats = document.querySelector('.dm-stats');
      stats.parentNode.insertBefore(pausedBanner, stats);
    }
  } else {
    pausedBanner?.remove();
  }

  // Highlight sidebar
  document.querySelectorAll('.ds-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === id);
  });
}

function renderSummaryHtml(entry) {
  const summary = generateSummary(entry.old, entry.new);
  let html = `<div class="dm-summary"><div class="dm-summary-text">${escapeHtml(summary.text)}</div>`;
  if (summary.kind === 'list') {
    for (const part of summary.parts) {
      html += `<ul class="dm-summary-items">`;
      for (const item of part.items) {
        html += `<li class="${escapeAttr(part.type)}">${escapeHtml(item)}</li>`;
      }
      html += `</ul>`;
    }
  }
  html += `</div>`;
  return html;
}

function renderDetailedHtml(entry) {
  const diffParts = computeDiff(entry.old, entry.new);
  return `<div class="dm-diff">${diffParts.map(p => {
    if (p.added) return `<ins>${escapeHtml(p.value)}</ins>`;
    if (p.removed) return `<del>${escapeHtml(p.value)}</del>`;
    return escapeHtml(p.value);
  }).join('')}</div>`;
}

function renderHistoryEntry(entry, diffMode, idx) {
  let bodyHtml = '';
  if (entry.summary) {
    bodyHtml += `<div class="dm-ai-summary" title="AI-generated summary"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L9 9l-7 3 7 3 3 7 3-7 7-3-7-3z"/></svg> ${escapeHtml(entry.summary)}</div>`;
  } else {
    bodyHtml += `<div class="dm-ai-actions"><button class="dm-ai-gen-btn" data-ts="${escapeAttr(entry.ts)}" title="Generate AI summary for this change (uses your configured LLM provider)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L9 9l-7 3 7 3 3 7 3-7 7-3-7-3z"/></svg> Generate AI summary</button></div>`;
  }
  if (diffMode === DIFF_MODES.SUMMARY) {
    bodyHtml += renderSummaryHtml(entry);
  } else if (diffMode === DIFF_MODES.DETAILED) {
    bodyHtml += renderDetailedHtml(entry);
  } else {
    // BOTH: summary at top, expandable detailed diff below
    const uid = 'detail-' + idx;
    bodyHtml += renderSummaryHtml(entry);
    bodyHtml += `<div style="padding:0 14px 10px;">
      <button class="dm-detail-toggle" data-target="${escapeAttr(uid)}">Show detailed diff</button>
      <div id="${escapeAttr(uid)}" class="dm-detail-collapsible">${renderDetailedHtml(entry)}</div>
    </div>`;
  }

  return `
    <div class="dm-entry">
      <div class="dm-entry-head">
        <span class="dm-entry-time">${escapeHtml(new Date(entry.ts).toLocaleString())}</span>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="dm-copy-btn" data-idx="${escapeAttr(idx)}" title="Copy to clipboard">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <span class="dm-entry-tag">Changed</span>
        </div>
      </div>
      ${bodyHtml}
    </div>
  `;
}

function setupEventListeners() {
  document.getElementById('sidebar-list').addEventListener('click', e => {
    const item = e.target.closest('.ds-item');
    if (item) selectMonitor(item.dataset.id);
  });

  // F4 — inline rename: click the title to edit, Enter saves, Esc cancels.
  const labelEl = document.getElementById('detail-label');
  if (labelEl) {
    labelEl.addEventListener('click', () => {
      if (labelEl.isContentEditable) return;
      labelEl.dataset.original = labelEl.textContent;
      labelEl.contentEditable = 'true';
      labelEl.focus();
      const range = document.createRange();
      range.selectNodeContents(labelEl);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    labelEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        labelEl.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        labelEl.textContent = labelEl.dataset.original || '';
        labelEl.contentEditable = 'false';
        labelEl.blur();
      }
    });
    labelEl.addEventListener('blur', async () => {
      if (!labelEl.isContentEditable) return;
      labelEl.contentEditable = 'false';
      const newLabel = labelEl.textContent.trim();
      const id = labelEl.dataset.monitorId;
      const original = labelEl.dataset.original || '';
      if (!id || !newLabel || newLabel === original) {
        if (!newLabel) labelEl.textContent = original;
        return;
      }
      try {
        await updateMonitor(id, { label: newLabel });
        await loadSidebar();
      } catch {
        labelEl.textContent = original;
      }
    });
  }

  document.getElementById('btn-pause')?.addEventListener('click', async () => {
    if (!currentMonitorId) return;
    const monitors = await getMonitors();
    const monitor = monitors[currentMonitorId];
    if (!monitor) return;
    const newActive = !monitor.active;
    await updateMonitor(currentMonitorId, { active: newActive });
    await selectMonitor(currentMonitorId);
    await loadSidebar();
  });

  document.getElementById('btn-check-now').addEventListener('click', async () => {
    if (!currentMonitorId) return;
    const btn = document.getElementById('btn-check-now');
    const monitors = await getMonitors();
    const beforeCount = monitors[currentMonitorId]?.changeCount || 0;

    btn.textContent = 'Checking...';
    btn.disabled = true;
    await chrome.runtime.sendMessage({ action: 'checkNow', monitorId: currentMonitorId }).catch(() => {});

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

  // Share button
  document.getElementById('btn-share').addEventListener('click', async () => {
    if (!currentMonitorId) return;
    const monitors = await getMonitors();
    const monitor = monitors[currentMonitorId];
    if (monitor) showShareModal(monitor);
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
    const data = {
      monitor: { label: monitor.label, url: monitor.url },
      history,
      _meta: { exportedAt: new Date().toISOString(), tool: 'PagePulse — free website change monitor', url: 'https://chromewebstore.google.com/detail/pagepulse' },
    };
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

    const rows = [
      ['# Tracked by PagePulse — free website change monitor'],
      ['# https://chromewebstore.google.com/detail/pagepulse'],
      ['Timestamp', 'Date', 'Old Value', 'New Value', 'Monitor', 'URL'],
    ];
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

  document.getElementById('btn-export-rss')?.addEventListener('click', async () => {
    exportMenu.classList.remove('open');
    if (!currentMonitorId) return;
    const history = await getHistory(currentMonitorId);
    const monitors = await getMonitors();
    const monitor = monitors[currentMonitorId];
    const items = monitorToFeedItems(monitor, history.sort((a, b) => b.ts - a.ts));
    const xml = buildRssFeed({
      title: `PagePulse — ${monitor.label}`,
      description: `Recent changes detected on ${monitor.url}`,
      link: monitor.url,
      items,
    });
    downloadFile(xml, `pagepulse-${safeName(monitor.label)}.xml`, 'application/rss+xml');
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
    // Handle copy button
    const copyBtn = e.target.closest('.dm-copy-btn');
    if (copyBtn) {
      const entry = historyEntryMap.get(copyBtn.dataset.idx);
      if (!entry) return;
      const old = entry.old || '';
      const nw = entry.new || '';
      const monitors = await getMonitors();
      const monitor = monitors[currentMonitorId];
      const text = `PagePulse Change — ${monitor?.label || 'Monitor'}\n${new Date().toLocaleString()}\nOld: ${old.substring(0, 200)}\nNew: ${nw.substring(0, 200)}\n\nTracked by PagePulse — free website change monitor`;
      await navigator.clipboard.writeText(text);
      copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
      setTimeout(() => {
        copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
      }, 2000);
      return;
    }

    // Handle detail toggle
    const toggleBtn = e.target.closest('.dm-detail-toggle');
    if (toggleBtn) {
      const targetId = toggleBtn.dataset.target;
      const collapsible = document.getElementById(targetId);
      if (collapsible) {
        const isOpen = collapsible.classList.toggle('open');
        toggleBtn.textContent = isOpen ? 'Hide detailed diff' : 'Show detailed diff';
      }
      return;
    }

    // Handle on-demand AI summary generation
    const genBtn = e.target.closest('.dm-ai-gen-btn');
    if (genBtn) {
      if (!currentMonitorId) return;
      const ts = Number(genBtn.dataset.ts);
      const settings = await getSettings();
      if (!isAiEnabled(settings)) {
        genBtn.textContent = 'AI not configured — click sparkle icon';
        setTimeout(() => { selectMonitor(currentMonitorId); }, 1800);
        return;
      }
      const monitors = await getMonitors();
      const monitor = monitors[currentMonitorId];
      const history = await getHistory(currentMonitorId);
      const entry = history.find((h) => h.ts === ts);
      if (!monitor || !entry) return;
      const original = genBtn.innerHTML;
      genBtn.disabled = true;
      genBtn.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L9 9l-7 3 7 3 3 7 3-7 7-3-7-3z"/></svg> Generating…';
      const effectiveInstruction =
        (monitor.aiSummaryInstruction || '').trim()
        || (settings.aiSummaryInstruction || '').trim()
        || undefined;
      try {
        const summary = await summarizeChange(monitor, entry, {
          provider: settings.aiProvider,
          apiKey: settings.aiApiKey,
          apiUrl: settings.aiApiUrl,
          model: settings.aiModel,
          instruction: effectiveInstruction,
        });
        if (summary) {
          await updateHistoryEntry(currentMonitorId, ts, { summary });
          await selectMonitor(currentMonitorId);
        } else {
          genBtn.innerHTML = original;
          genBtn.disabled = false;
          genBtn.title = 'Failed — check API key, URL, and host permission';
        }
      } catch (err) {
        genBtn.innerHTML = original;
        genBtn.disabled = false;
        genBtn.title = `Error: ${err.message || err}`;
      }
    }
  });

  // Keywords input — save on blur and enter
  const keywordsInput = document.getElementById('detail-keywords');
  const saveKeywords = async () => {
    if (!currentMonitorId) return;
    await updateMonitor(currentMonitorId, { keywords: keywordsInput.value });
  };
  keywordsInput.addEventListener('blur', saveKeywords);
  keywordsInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await saveKeywords();
    }
  });

  // Ignore patterns textarea — save on blur
  document.getElementById('detail-ignore')?.addEventListener('blur', async () => {
    if (!currentMonitorId) return;
    const value = document.getElementById('detail-ignore').value;
    await updateMonitor(currentMonitorId, { ignorePatterns: value });
  });

  // Per-monitor AI instruction — save on blur. Empty = use global.
  document.getElementById('detail-ai-instruction')?.addEventListener('blur', async () => {
    if (!currentMonitorId) return;
    const value = document.getElementById('detail-ai-instruction').value;
    await updateMonitor(currentMonitorId, { aiSummaryInstruction: value });
  });

  // Webhook URL — save on blur, validate inline.
  document.getElementById('detail-webhook')?.addEventListener('blur', async () => {
    if (!currentMonitorId) return;
    const el = document.getElementById('detail-webhook');
    const value = el.value.trim();
    const statusEl = document.getElementById('detail-webhook-status');
    if (value && !isValidWebhookUrl(value)) {
      if (statusEl) {
        statusEl.textContent = 'Invalid URL — must start with http:// or https://';
        statusEl.style.color = '#EF4444';
      }
      return;
    }
    await updateMonitor(currentMonitorId, { webhookUrl: value });
    if (statusEl) {
      if (!value) {
        statusEl.textContent = 'Slack/Discord/Zapier — fires JSON POST on change. Leave empty to skip.';
        statusEl.style.color = '';
      } else {
        statusEl.textContent = 'Active — will POST on every detected change.';
        statusEl.style.color = 'var(--success, #10B981)';
      }
    }
  });

  // Preset buttons — append pattern to ignore textarea
  document.querySelector('.dm-presets')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.dm-preset-btn');
    if (!btn) return;
    const textarea = document.getElementById('detail-ignore');
    const current = textarea.value.trim();
    const pattern = btn.dataset.pattern;
    textarea.value = current ? current + '\n' + pattern : pattern;
    if (currentMonitorId) {
      await updateMonitor(currentMonitorId, { ignorePatterns: textarea.value });
    }
  });

  // Notify mode buttons
  document.getElementById('notify-mode-options')?.addEventListener('click', async e => {
    const btn = e.target.closest('.dm-interval-opt');
    if (!btn || !currentMonitorId) return;
    const mode = btn.dataset.notify;
    await updateMonitor(currentMonitorId, { notifyMode: mode });
    await selectMonitor(currentMonitorId);
  });

  // Render mode buttons
  document.getElementById('render-mode-options')?.addEventListener('click', async e => {
    const btn = e.target.closest('.dm-interval-opt');
    if (!btn || !currentMonitorId) return;
    const mode = btn.dataset.render;
    await updateMonitor(currentMonitorId, { renderMode: mode });
    await selectMonitor(currentMonitorId);
  });

  // Diff mode buttons
  document.getElementById('diff-mode-options').addEventListener('click', async (e) => {
    const btn = e.target.closest('.dm-interval-opt');
    if (!btn || !currentMonitorId) return;
    const mode = btn.dataset.mode;
    await updateMonitor(currentMonitorId, { diffMode: mode });
    await selectMonitor(currentMonitorId);
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

// escapeHtml() round-trips through textContent → innerHTML which does NOT
// escape `"` or `'` (they are valid in text). When that output is interpolated
// into an HTML attribute, an attacker can close the attribute and inject
// event handlers (e.g. `" onmouseover="...`). Use escapeAttr() at every
// attribute-interpolation site so the five HTML-significant characters are
// all escaped.
function escapeAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function playChimePreview() {
  playChime(0.5);
}

// H1 — surfaces a banner explaining the monitor's selector broke and
// offers a button that opens the source URL in a new tab so the user
// can re-add the monitor with the modern element. We don't auto-trigger
// content.js here because the user gesture must come from the popup or
// the source tab itself (Chrome MV3 permissions).
async function showReselectPrompt(monitorId) {
  const monitors = await getMonitors();
  const monitor = monitors[monitorId];
  if (!monitor) return;

  let banner = document.getElementById('reselect-banner');
  if (banner) banner.remove();
  banner = document.createElement('div');
  banner.id = 'reselect-banner';
  banner.className = 'dm-paused-banner';
  banner.style.background = 'var(--red-dim, rgba(239,68,68,0.12))';
  banner.style.color = 'var(--red-text, #FCA5A5)';
  banner.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>
    <span>This monitor's element could not be found. Open the source page and re-add it to get checks running again.</span>
    <button id="btn-reselect-open" class="dm-btn" style="margin-left:auto;">Open source page</button>
    <button id="btn-reselect-dismiss" class="dm-btn" style="margin-left:8px;">Dismiss</button>
  `;
  // Insert at the top of monitor-detail
  const detail = document.getElementById('monitor-detail');
  if (detail && detail.firstChild) {
    detail.insertBefore(banner, detail.firstChild);
  }

  document.getElementById('btn-reselect-open')?.addEventListener('click', () => {
    try { window.open(monitor.url, '_blank'); } catch {}
  });
  document.getElementById('btn-reselect-dismiss')?.addEventListener('click', () => {
    banner.remove();
    // Clean the action param so a refresh doesn't re-show.
    const url = new URL(window.location.href);
    url.searchParams.delete('action');
    window.history.replaceState({}, '', url.toString());
  });
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

function toggleShortcutsHelp() {
  let overlay = document.getElementById('shortcuts-overlay');
  if (overlay) {
    overlay.remove();
    return;
  }
  overlay = document.createElement('div');
  overlay.id = 'shortcuts-overlay';
  overlay.className = 'shortcuts-overlay';
  overlay.innerHTML = `
    <div class="shortcuts-modal">
      <div class="shortcuts-title">Keyboard Shortcuts</div>
      <div class="shortcuts-grid">
        <kbd>j</kbd><span>Next monitor</span>
        <kbd>k</kbd><span>Previous monitor</span>
        <kbd>c</kbd><span>Check now</span>
        <kbd>e</kbd><span>Export</span>
        <kbd>Del</kbd><span>Delete monitor</span>
        <kbd>?</kbd><span>Toggle this help</span>
        <kbd>Esc</kbd><span>Close</span>
      </div>
    </div>
  `;
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

function hideShortcutsHelp() {
  document.getElementById('shortcuts-overlay')?.remove();
}

// ─── Share & Import ─────────────────────────────────────────────────────────

function encodeMonitorConfig(monitor) {
  const config = {
    url: monitor.url,
    selector: monitor.selector,
    xpath: monitor.xpath,
    label: monitor.label,
    intervalMs: monitor.intervalMs,
    keywords: monitor.keywords || '',
    ignorePatterns: monitor.ignorePatterns || '',
    diffMode: monitor.diffMode || 'summary',
    notifyMode: monitor.notifyMode || 'instant',
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(config))));
}

function decodeMonitorConfig(encoded) {
  try {
    return JSON.parse(decodeURIComponent(escape(atob(encoded))));
  } catch {
    return null;
  }
}

function showShareModal(monitor) {
  const encoded = encodeMonitorConfig(monitor);
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');
  const shareLink = `${dashboardUrl}?import=${encoded}`;

  const shareText = [
    `I'm tracking changes on ${new URL(monitor.url).hostname} with PagePulse`,
    ``,
    `Monitor: ${monitor.label}`,
    `URL: ${monitor.url}`,
    monitor.keywords ? `Keywords: ${monitor.keywords}` : '',
    `Check interval: ${INTERVALS.find(i => i.ms === monitor.intervalMs)?.label || 'custom'}`,
    ``,
    `Get PagePulse (free): https://chromewebstore.google.com/detail/pagepulse`,
  ].filter(Boolean).join('\n');

  const overlay = document.createElement('div');
  overlay.className = 'share-overlay';
  overlay.innerHTML = `
    <div class="share-modal">
      <div class="share-title">Share Monitor</div>
      <div class="share-subtitle">Share this monitor config — others with PagePulse can import it with one click</div>
      <div class="share-link-box">
        <input class="share-link-input" value="${escapeAttr(shareLink)}" readonly>
        <button class="share-copy-btn" id="share-copy-link">Copy Link</button>
      </div>
      <div class="share-subtitle">Or share as text:</div>
      <div class="share-text-box">${escapeHtml(shareText)}</div>
      <div style="display:flex;gap:8px;">
        <button class="share-copy-btn" id="share-copy-text" style="flex:1;">Copy Text</button>
        <button class="dm-btn" id="share-close" style="flex:1;">Close</button>
      </div>
      <div class="share-branding">PagePulse — free website change monitor</div>
    </div>
  `;

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#share-copy-link').addEventListener('click', async () => {
    const input = overlay.querySelector('.share-link-input');
    await navigator.clipboard.writeText(input.value);
    overlay.querySelector('#share-copy-link').textContent = 'Copied!';
    setTimeout(() => overlay.querySelector('#share-copy-link').textContent = 'Copy Link', 2000);
  });

  overlay.querySelector('#share-copy-text').addEventListener('click', async () => {
    await navigator.clipboard.writeText(shareText);
    overlay.querySelector('#share-copy-text').textContent = 'Copied!';
    setTimeout(() => overlay.querySelector('#share-copy-text').textContent = 'Copy Text', 2000);
  });

  overlay.querySelector('#share-close').addEventListener('click', () => overlay.remove());

  document.body.appendChild(overlay);
}

async function handleImport(encodedData) {
  const config = decodeMonitorConfig(encodedData);
  if (!config || !config.url) return;

  const banner = document.getElementById('import-banner');
  document.getElementById('import-label').textContent = `Import: ${config.label || 'Monitor'}`;
  document.getElementById('import-url').textContent = config.url;
  banner.style.display = 'flex';

  // Hide the no-selection text
  document.getElementById('no-selection').style.display = 'none';
  document.getElementById('monitor-detail').style.display = 'block';

  document.getElementById('btn-import-add').addEventListener('click', async () => {
    // Request permission for the origin
    const origin = new URL(config.url).origin;
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) {
      alert('Permission needed to monitor this site.');
      return;
    }

    // Create the monitor
    const monitor = {
      id: crypto.randomUUID(),
      url: config.url,
      origin,
      selector: config.selector || '',
      xpath: config.xpath || '',
      textFingerprint: '',
      label: config.label || `Monitor on ${new URL(config.url).hostname}`,
      baseline: '',
      intervalMs: config.intervalMs || 3600000,
      keywords: config.keywords || '',
      ignorePatterns: config.ignorePatterns || '',
      diffMode: config.diffMode || 'summary',
      notifyMode: config.notifyMode || 'instant',
      lastChecked: null,
      lastChanged: null,
      changeCount: 0,
      status: STATUS.OK,
      consecutiveErrors: 0,
      firstErrorAt: null,
      active: true,
      createdAt: Date.now(),
    };

    await saveMonitor(monitor);
    banner.style.display = 'none';

    // Clean URL
    window.history.replaceState({}, '', 'dashboard.html');

    // Refresh and select
    await loadSidebar();
    await selectMonitor(monitor.id);

    // Trigger first check
    await chrome.runtime.sendMessage({ action: 'checkNow', monitorId: monitor.id }).catch(() => {});
    await selectMonitor(monitor.id);
    await loadSidebar();
  });

  document.getElementById('btn-import-dismiss').addEventListener('click', () => {
    banner.style.display = 'none';
    window.history.replaceState({}, '', 'dashboard.html');
    document.getElementById('no-selection').style.display = 'flex';
    document.getElementById('monitor-detail').style.display = 'none';
  });
}
