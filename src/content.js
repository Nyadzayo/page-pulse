(function () {
  if (document.getElementById('pagepulse-overlay')) return;

  let highlighted = null;
  let overlay = null;

  // --- Overlay ---
  overlay = document.createElement('div');
  overlay.id = 'pagepulse-overlay';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    z-index: 2147483646; cursor: crosshair;
    background: rgba(0,0,0,0.04);
  `;
  document.body.appendChild(overlay);

  // --- Banner ---
  const banner = document.createElement('div');
  banner.style.cssText = `
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
    z-index: 2147483647; padding: 9px 18px;
    background: #0F172A; color: #F1F5F9; border-radius: 8px;
    font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    display: flex; align-items: center; gap: 8px;
    letter-spacing: -0.01em;
  `;
  banner.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
    </svg>
    Click an element to monitor
    <span style="font-family:monospace;font-size:10px;background:rgba(255,255,255,0.12);padding:2px 5px;border-radius:3px;color:#94A3B8;">ESC</span>
  `;
  document.body.appendChild(banner);

  // --- Hover highlight ---
  function onMouseMove(e) {
    overlay.style.pointerEvents = 'none';
    const target = document.elementFromPoint(e.clientX, e.clientY);
    overlay.style.pointerEvents = 'auto';

    if (!target || target === overlay || target === banner) return;
    if (highlighted === target) return;

    clearHighlight();
    highlighted = target;
    highlighted.dataset.pagepulseOrigOutline = highlighted.style.outline;
    highlighted.dataset.pagepulseOrigBg = highlighted.style.backgroundColor;
    highlighted.style.outline = '2px solid #10B981';
    highlighted.style.backgroundColor = 'rgba(16,185,129,0.08)';
  }

  function clearHighlight() {
    if (highlighted) {
      highlighted.style.outline = highlighted.dataset.pagepulseOrigOutline || '';
      highlighted.style.backgroundColor = highlighted.dataset.pagepulseOrigBg || '';
      delete highlighted.dataset.pagepulseOrigOutline;
      delete highlighted.dataset.pagepulseOrigBg;
      highlighted = null;
    }
  }

  // --- Selector generation ---
  function generateSelector(el) {
    if (el.id) return `#${el.id}`;
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${testId}"]`;
    const parts = [];
    let current = el;
    let depth = 0;
    while (current && current !== document.body && depth < 5) {
      let seg = current.tagName.toLowerCase();
      if (current.id && depth > 0) { parts.unshift(`#${current.id}`); break; }
      if (current.className && typeof current.className === 'string') {
        const cls = current.className.trim().split(/\s+/).slice(0, 2).map(c => `.${c}`).join('');
        if (cls) seg += cls;
      }
      parts.unshift(seg);
      current = current.parentElement;
      depth++;
    }
    return parts.join(' > ') || el.tagName.toLowerCase();
  }

  function generateXPath(el) {
    const parts = [];
    let current = el;
    while (current && current.nodeType === 1) {
      let tag = current.tagName.toLowerCase();
      if (tag === 'html') { parts.unshift('/html'); break; }
      let idx = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) idx++;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${tag}[${idx}]`);
      current = current.parentElement;
    }
    return parts.join('/');
  }

  // --- Click to select ---
  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!highlighted) return;

    const el = highlighted;
    const url = window.location.href;
    const origin = new URL(url).origin;

    const data = {
      url,
      selector: generateSelector(el),
      xpath: generateXPath(el),
      textFingerprint: el.textContent.trim().substring(0, 100),
      baseline: el.textContent.trim(),
      label: `${el.tagName.toLowerCase()} on ${window.location.hostname}`,
    };

    // Request permission HERE (user gesture context)
    chrome.permissions.request({ origins: [`${origin}/*`] }, (granted) => {
      if (!granted) {
        cleanup();
        showToast('Permission needed to monitor this site. Please try again and allow access.', null, true);
        return;
      }

      chrome.runtime.sendMessage({ action: 'createMonitor', data }, (response) => {
        cleanup();
        if (response?.success) {
          showToast('Monitor added — checking every hour', response.monitor?.id);
        } else if (response?.reason === 'limit_reached') {
          showToast('Monitor limit reached. Upgrade to Pro for more.', null, true);
        } else {
          showToast('Failed to create monitor. Please try again.', null, true);
        }
      });
    });
  }

  // --- ESC cancel ---
  function onKeyDown(e) {
    if (e.key === 'Escape') cleanup();
  }

  // --- Toast ---
  function showToast(message, monitorId, isError = false) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      padding: 12px 18px; border-radius: 10px; max-width: 360px;
      font: 500 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      background: ${isError ? '#DC2626' : '#059669'}; color: white;
      display: flex; align-items: center; gap: 8px;
      transition: opacity 0.3s ease;
      letter-spacing: -0.01em;
    `;

    if (!isError) {
      toast.innerHTML = `<span style="width:18px;height:18px;background:rgba(255,255,255,0.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;">&#10003;</span>`;
    }

    const textSpan = document.createElement('span');
    textSpan.textContent = message;
    toast.appendChild(textSpan);

    if (monitorId) {
      const link = document.createElement('a');
      link.href = chrome.runtime.getURL(`dashboard.html?monitor=${monitorId}`);
      link.target = '_blank';
      link.textContent = 'Edit';
      link.style.cssText = 'color:rgba(255,255,255,0.8);text-decoration:underline;text-underline-offset:2px;margin-left:4px;';
      toast.appendChild(link);
    }

    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // --- Cleanup ---
  function cleanup() {
    clearHighlight();
    overlay?.remove();
    banner?.remove();
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
  }

  // --- Attach ---
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
})();
