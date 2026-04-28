/**
 * detectSpa(html) — heuristic for whether the raw HTML response from a URL
 * is a single-page-app skeleton that needs JS rendering before its DOM
 * contains user-selectable content.
 *
 * Returns true if any of the following is true:
 *   1. The HTML contains a known SPA framework marker (Next/Nuxt/React/Vue/
 *      Angular shell pattern with an empty root container).
 *   2. The body has a <noscript> element warning that JS is required.
 *   3. The body's plain text (script/style/noscript stripped) is shorter
 *      than SPA_TEXT_FALLBACK_MIN — i.e. an empty shell.
 *
 * Returns true defensively for empty / null / undefined / unparseable HTML
 * so callers err on the side of using browser rendering.
 *
 * Pure function; safe to import in either offscreen or service-worker
 * contexts (uses DOMParser which is available in both).
 */

const SPA_TEXT_FALLBACK_MIN = 200;

// Regex-based markers that indicate an SPA shell. We use string matching
// (not DOMParser walks) for cheap, robust detection that doesn't depend on
// the precise DOM structure produced by the parser.
const SHELL_MARKERS = [
  // Next.js
  /<script\s[^>]*id=["']__NEXT_DATA__["']/i,
  /<div\s[^>]*id=["']__next["'][^>]*>\s*<\/div>/i,
  // Nuxt
  /<script\s[^>]*id=["']__NUXT__["']/i,
  /<div\s[^>]*id=["']__nuxt["'][^>]*>\s*<\/div>/i,
  // Angular
  /<html\s[^>]*\bng-version\b/i,
  /<app-root\s*>\s*<\/app-root>/i,
  // React (Create React App / Vite-React)
  /<div\s[^>]*id=["']root["'][^>]*>\s*<\/div>/i,
  /<div\s[^>]*data-reactroot/i,
  // Vue
  /<div\s[^>]*id=["']app["'][^>]*>\s*<\/div>/i,
  /<[^>]+data-server-rendered=/i,
  // Apollo / generic
  /window\.__APOLLO_STATE__/i,
];

const NOSCRIPT_JS_WARNING = /<noscript[^>]*>[\s\S]{0,500}?(enable\s+JavaScript|JavaScript\s+is\s+required|requires\s+JavaScript)/i;

export function detectSpa(html) {
  if (!html || typeof html !== 'string') return true;

  for (const re of SHELL_MARKERS) {
    if (re.test(html)) return true;
  }

  if (NOSCRIPT_JS_WARNING.test(html)) return true;

  // Final fallback: parse the body and measure visible text length.
  // We strip script/style/noscript content before measuring.
  const visibleText = stripNonTextElements(html);
  if (visibleText.length < SPA_TEXT_FALLBACK_MIN) return true;

  return false;
}

function stripNonTextElements(html) {
  let body = html;
  // Try to extract <body> content; if not found, use the whole document.
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (bodyMatch) body = bodyMatch[1];

  return body
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
