"use strict";

// Where a click inside the desktop window should go.
//
// The app serves its own UI from a local origin. Anything else — a link in the
// model's output, a docs link, a mailto — belongs to the operating system's
// default handler, not to the embedded window: opening it in Electron would show
// a browser with no address bar, no extensions, and no session, which is exactly
// what the operator did not ask for.
//
// Nothing here touches Electron, so the decisions can be unit tested.

/** Schemes worth handing to the OS. Everything else is refused. */
const EXTERNAL_SCHEMES = new Set(["http:", "https:", "mailto:"]);

function parse(url) {
  try {
    return new URL(String(url));
  } catch {
    return null;
  }
}

/** True when `url` is the app's own UI (same origin as the served page). */
function isAppUrl(url, appUrl) {
  const target = parse(url);
  const app = parse(appUrl);
  if (!target || !app) return false;
  return target.origin === app.origin;
}

/**
 * Decide what to do with a URL the page wants to open.
 *
 * @returns {string | null} the URL to open in the system browser, or null to
 *   keep it out of both the app window and the OS handler (the app's own UI,
 *   or a scheme that is not safe to launch).
 */
function externalTarget(url, appUrl) {
  if (!url || isAppUrl(url, appUrl)) return null;
  const parsed = parse(url);
  if (!parsed || !EXTERNAL_SCHEMES.has(parsed.protocol)) return null;
  return parsed.href;
}

module.exports = { EXTERNAL_SCHEMES, externalTarget, isAppUrl };
