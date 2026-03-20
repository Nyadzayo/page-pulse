export function extractOrigin(url) {
  try { return new URL(url).origin; }
  catch { return url; }
}

export async function requestOriginAccess(url) {
  const origin = extractOrigin(url);
  return chrome.permissions.request({ origins: [`${origin}/*`] });
}

export async function hasOriginAccess(url) {
  const origin = extractOrigin(url);
  return chrome.permissions.contains({ origins: [`${origin}/*`] });
}
