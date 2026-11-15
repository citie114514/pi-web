"use strict";

// Turn a notification the web UI would have shown in the browser into a system
// notification for the desktop app.
//
// The page still runs `lib/browser-notifications.ts`; that path is what a
// browser tab uses. In the desktop window it usually fails — a `file://`/app
// origin has no notification permission and no service worker registration —
// and it also cannot bring the window forward. So the page reports the same
// event here through the preload bridge, and the main process shows it.
//
// Pure functions only: no Electron, no globals, so the decisions are testable.

const MAX_TITLE = 120;
const MAX_BODY = 300;

/**
 * When to show a desktop notification.
 *
 * A notification exists to tell the user about something they cannot see. The
 * page decides when it would have notified (it already hides the event when the
 * tab is focused), so the only question here is whether the desktop window is
 * actually in front of the user. Hidden to the tray, minimised or covered by
 * another window all count as "not looking".
 */
function shouldNotifyOnDesktop({ windowVisible, windowFocused }) {
  return !(windowVisible && windowFocused);
}

/** Collapse whitespace and cut a long string, without splitting a surrogate pair. */
function clip(value, limit) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  // Do not leave half of an emoji behind.
  const safe = /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
  return `${safe}…`;
}

/**
 * Build the notification for a payload the page sent.
 *
 * @returns {{title: string, body: string, sessionUrl: string|null} | null}
 *   null when the payload carries nothing worth showing.
 */
function buildDesktopNotification(payload) {
  if (!payload || typeof payload !== "object") return null;
  const title = clip(payload.title, MAX_TITLE);
  const body = clip(payload.body, MAX_BODY);
  if (!title && !body) return null;

  const sessionUrl = typeof payload.sessionUrl === "string" && payload.sessionUrl ? payload.sessionUrl : null;
  return {
    title: title || "WebPi Desktop",
    body,
    sessionUrl,
  };
}

/**
 * Where a notification click should lead.
 *
 * Only same-origin app URLs are accepted: a notification payload is page
 * controlled, and handing it to `loadURL` unchecked would let a compromised
 * page navigate the window anywhere. Anything else brings the window forward
 * without navigating.
 *
 * @returns {string|null} the path to navigate to, or null to stay put.
 */
function notificationTarget(sessionUrl, appOrigin) {
  if (typeof sessionUrl !== "string" || !sessionUrl) return null;
  // The page sends "/?session=…"; a bare path is all that is accepted.
  if (!sessionUrl.startsWith("/") || sessionUrl.startsWith("//")) return null;
  try {
    const resolved = new URL(sessionUrl, appOrigin || "http://localhost");
    if (appOrigin && resolved.origin !== new URL(appOrigin).origin) return null;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}

module.exports = {
  MAX_BODY,
  MAX_TITLE,
  buildDesktopNotification,
  notificationTarget,
  shouldNotifyOnDesktop,
};
