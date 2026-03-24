export function parseAndQuery(html, queries) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  return queries.map(({ monitorId, selector, xpath }) => {
    if (selector) {
      try {
        const el = doc.querySelector(selector);
        if (el) return { monitorId, text: el.textContent.trim(), matchedBy: 'selector' };
      } catch { /* invalid selector, fall through */ }
    }
    if (xpath) {
      try {
        const result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const el = result.singleNodeValue;
        if (el) return { monitorId, text: el.textContent.trim(), matchedBy: 'xpath' };
      } catch { /* invalid xpath, fall through */ }
    }
    return { monitorId, text: null, matchedBy: null };
  });
}

// Message handler for actual offscreen document context
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.target !== 'offscreen') return;

    if (msg.action === 'parseAndQuery') {
      const results = parseAndQuery(msg.html, msg.queries);
      sendResponse({ results });
    }

    if (msg.action === 'playSound') {
      try {
        const audio = new Audio(msg.dataUrl);
        audio.volume = 0.5;
        audio.play().then(() => sendResponse({ success: true }))
          .catch(e => sendResponse({ success: false, error: e.message }));
        return true; // async response
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    }
  });
}
