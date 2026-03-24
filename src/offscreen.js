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
        const RATE = 22050;
        const dur = 0.3;
        const len = Math.floor(RATE * dur);
        const samples = new Float32Array(len);
        for (let i = 0; i < len; i++) {
          const t = i / RATE;
          const half = dur / 2;
          const freq = t < half ? 523.25 : 659.25;
          const vol = t < half ? 1 - (t / half) * 0.3 : 1 - (t - half) / half;
          const env = Math.min(1, t * 50) * Math.min(1, (dur - t) * 20) * vol * 0.4;
          samples[i] = Math.sin(2 * Math.PI * freq * t) * env;
        }
        const ctx = new AudioContext();
        const buf = ctx.createBuffer(1, len, RATE);
        buf.getChannelData(0).set(samples);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.value = 0.5;
        src.connect(gain);
        gain.connect(ctx.destination);
        src.start();
        src.onended = () => { ctx.close(); sendResponse({ success: true }); };
        return true; // async
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    }
  });
}
