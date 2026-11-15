"use strict";

// Bridge between the page and the desktop shell.
//
// Runs with `contextIsolation: true` and `sandbox: true`, so the page never
// sees Node or `ipcRenderer` itself: it gets three named capabilities and
// nothing else. Every method is fire-and-forget or returns plainly serialisable
// data, and the main process validates what it receives.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("webpiDesktop", {
  /** True only inside the desktop window; the page uses it to pick a path. */
  isDesktop: true,

  platform: process.platform,

  /**
   * Report a notification the page would have shown in a browser tab.
   * The main process decides whether the window is out of sight.
   */
  notify: (payload) => {
    if (!payload || typeof payload !== "object") return;
    ipcRenderer.send("webpi:notify", {
      title: typeof payload.title === "string" ? payload.title : "",
      body: typeof payload.body === "string" ? payload.body : "",
      sessionUrl: typeof payload.sessionUrl === "string" ? payload.sessionUrl : "",
      tag: typeof payload.tag === "string" ? payload.tag : "",
    });
  },

  /**
   * Tell the shell which language the UI is in, so the menu bar matches it.
   * The page stores it in localStorage, which the main process cannot read.
   */
  setLocale: (locale) => {
    if (typeof locale === "string") ipcRenderer.send("webpi:locale", locale);
  },

  /** Zoom the shell applies, as a percentage: 50–300. */
  setZoom: (percent) => {
    if (typeof percent === "number" && Number.isFinite(percent)) ipcRenderer.send("webpi:zoom", percent);
  },

  /** The page asks the shell to run one of the menu actions (e.g. new session). */
  onMenuAction: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, action) => callback(action);
    ipcRenderer.on("webpi:menu-action", listener);
    return () => ipcRenderer.removeListener("webpi:menu-action", listener);
  },
});
