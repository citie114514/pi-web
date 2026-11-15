// Bridge to the WebPi Desktop shell (desktop/preload.js).
//
// In a browser tab none of this exists, so every function here degrades to
// "not handled" and the page falls back to its normal browser behaviour. In the
// desktop window the shell owns notifications and zoom, because an Electron
// page has no notification permission of its own and cannot raise the window.

export interface DesktopNotificationRequest {
  title: string;
  body: string;
  sessionUrl: string;
  tag?: string;
}

export interface WebPiDesktopBridge {
  isDesktop?: boolean;
  platform?: string;
  notify?: (payload: DesktopNotificationRequest) => void;
  setZoom?: (percent: number) => void;
  setLocale?: (locale: string) => void;
  onMenuAction?: (callback: (action: string) => void) => () => void;
}

/** The bridge the preload script exposes, or null in a browser. */
export function desktopBridge(): WebPiDesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { webpiDesktop?: WebPiDesktopBridge }).webpiDesktop;
  return bridge && bridge.isDesktop ? bridge : null;
}

export function isDesktopShell(): boolean {
  return desktopBridge() !== null;
}

/**
 * Hand a notification to the desktop shell.
 *
 * @returns true when the shell took it, so the caller must not also show a
 *   browser notification (that would announce the event twice).
 */
export function desktopNotify(request: DesktopNotificationRequest): boolean {
  const bridge = desktopBridge();
  if (!bridge?.notify || !request.title) return false;
  try {
    bridge.notify({ ...request, tag: request.tag ?? "" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Tell the shell which language the UI is in, so its menu bar matches.
 *
 * The page keeps the locale in localStorage; the main process cannot read that,
 * so it has to be reported. Called whenever the locale changes.
 */
export function desktopSetLocale(locale: string): boolean {
  const bridge = desktopBridge();
  if (!bridge?.setLocale || !locale) return false;
  try {
    bridge.setLocale(locale);
    return true;
  } catch {
    return false;
  }
}

/** Ask the shell to apply a zoom percentage. False in a browser tab. */
export function desktopSetZoom(percent: number): boolean {
  const bridge = desktopBridge();
  if (!bridge?.setZoom || !Number.isFinite(percent)) return false;
  try {
    bridge.setZoom(percent);
    return true;
  } catch {
    return false;
  }
}
