"use strict";

// WebPi desktop shell.
//
// Lifecycle contract, per product requirement: starting the app starts the
// WebPi service, and quitting the app stops the service it started. Closing the
// window asks whether to hide to the tray (service keeps running) or to quit
// (service stops too), and can remember the answer.
//
// The window is a plain BrowserWindow pointing at the local WebPi server, so
// the UI is exactly the same application as the browser build.

const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, Menu, Notification, Tray, dialog, nativeImage, shell } = require("electron");

const { CLOSE_DIALOG, decideCloseAction, needsClosePrompt, normalizeCloseAction } = require("./close-policy");
const { resolveDataDir } = require("./portable");
const { createSettingsStore, isPersistableWindowState, normalizeBounds } = require("./settings");
const { ServerSupervisor } = require("./server-supervisor");
const { externalTarget, isAppUrl } = require("./external-links");
const { buildTrayMenuTemplate } = require("./tray-menu");
const { buildMenuTemplate } = require("./app-menu");
const { buildDesktopNotification, notificationTarget, shouldNotifyOnDesktop } = require("./notifications");

const PRODUCT = "WebPi Desktop";
const ASSETS_DIR = path.join(__dirname, "assets");
const SMOKE = process.env.WEBPI_DESKTOP_SMOKE === "1";
const SMOKE_SCREENSHOT = process.env.WEBPI_DESKTOP_SMOKE_SCREENSHOT || "";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_WINDOW_SIZE = { width: 1360, height: 880 };
const BOUNDS_SAVE_DELAY_MS = 500;

let deferBoundsSave = null;

// Portable builds keep settings beside the executable, so this must be settled
// before the single-instance lock and before anything reads userData.
const dataLocation = resolveDataDir({
  exeDir: path.dirname(app.getPath("exe")),
  userDataDir: app.getPath("userData"),
});
if (dataLocation.mode !== "user") {
  fs.mkdirSync(dataLocation.dir, { recursive: true });
  app.setPath("userData", dataLocation.dir);
}

let mainWindow;
let tray;
let supervisor;
let settings;
// Origin of the served UI; anything else is an external link (see external-links.js).
let appUrl;
let quitting = false;
let stopping = false;
let trayHintShown = false;
// Zoom the View menu and the page both drive, as a percentage.
const ZOOM_LEVELS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300];
const DEFAULT_ZOOM = 100;
let zoomPercent = DEFAULT_ZOOM;

if (!app.requestSingleInstanceLock()) {
  // A second launch focuses the running app instead of starting a second server.
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.whenReady().then(bootstrap).catch((error) => fail(error));
}

async function bootstrap() {
  app.setAppUserModelId("dev.webpi.desktop");
  settings = createSettingsStore(path.join(app.getPath("userData"), "settings.json"));
  logLine(`data dir: ${app.getPath("userData")} (${dataLocation.mode})`);

  supervisor = new ServerSupervisor({ cwd: path.join(__dirname, "..") });
  supervisor.on("exit", (info) => {
    void onServerExit(info);
  });

  createWindow();
  createTray();
  installIpc();

  try {
    const { url, owned } = await supervisor.start();
    if (!owned) {
      // Another WebPi already owns the preferred port. Start our own server on
      // an OS-chosen free port so quitting this app always stops it.
      logLine(`port already served by another WebPi (${url}); starting a private instance`);
      await supervisor.stop();
      await startService({ port: "0" });
    } else {
      await loadUI(url);
    }
  } catch (error) {
    await fail(error);
  }
}

async function startService(overrides) {
  const { url } = await supervisor.start(overrides);
  await loadUI(url);
  return url;
}

/**
 * Load the app UI and drop the splash screen from the history.
 *
 * The window loads splash.html first, so "back" (a mouse side button, a
 * trackpad swipe, Alt+Left) would walk to it and show "starting the service"
 * again. Removing the entry means that can never happen.
 */
async function loadAppUrl(url) {
  await mainWindow.loadURL(url);
  const history = mainWindow.webContents.navigationHistory;
  if (history && typeof history.clear === "function") history.clear();
  else if (typeof mainWindow.webContents.clearHistory === "function") mainWindow.webContents.clearHistory();
}

async function loadUI(url) {
  appUrl = url;
  logLine(`serving ${url} (owned=${supervisor.owned})`);
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  await loadAppUrl(url);

  if (SMOKE) {
    await delay(1500);
    const title = await mainWindow.webContents.executeJavaScript("document.title").catch(() => "");
    const body = await mainWindow.webContents
      .executeJavaScript("document.body.innerText.slice(0, 60).replace(/\\s+/g, ' ')")
      .catch(() => "");
    // Canary for the external-link wiring: a popup must be denied by
    // setWindowOpenHandler. The default probe uses an unsafe scheme so a
    // regression shows up as popupDenied=false instead of launching a browser
    // during CI; WEBPI_SMOKE_POPUP_URL lets a local run exercise the real path.
    const popupUrl = process.env.WEBPI_SMOKE_POPUP_URL || "file:///webpi-smoke-probe";
    const popupDenied = await mainWindow.webContents
      .executeJavaScript(`window.open(${JSON.stringify(popupUrl)}) === null`)
      .catch(() => false);
    // The shell's own surfaces: a menu bar that exists, and a page bridge the
    // desktop window can actually reach (it is what routes notifications).
    const menuLabels = Menu.getApplicationMenu()?.items.map((item) => item.label).join(",") ?? "";
    const bridgeReady = await mainWindow.webContents
      .executeJavaScript("Boolean(window.webpiDesktop && window.webpiDesktop.isDesktop)")
      .catch(() => false);
    logLine(
      `[smoke] url=${url} owned=${supervisor.owned} title=${title} window=${mainWindow.getTitle()} popupDenied=${popupDenied} menu=${menuLabels} bridge=${bridgeReady} body=${body}`
    );
    if (SMOKE_SCREENSHOT) {
      const image = await mainWindow.webContents.capturePage();
      fs.writeFileSync(SMOKE_SCREENSHOT, image.toPNG());
      logLine(`[smoke] screenshot=${SMOKE_SCREENSHOT}`);
    }
    await quitApp();
  }
}

function createWindow() {
  const remembered = settings ? normalizeBounds(settings.get("windowBounds", null)) : null;

  mainWindow = new BrowserWindow({
    ...DEFAULT_WINDOW_SIZE,
    ...(remembered ?? {}),
    minWidth: 960,
    minHeight: 620,
    show: false,
    backgroundColor: "#1a1a1a",
    title: PRODUCT,
    icon: assetPath("icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      // The page needs no Node, but it does need three named capabilities:
      // desktop notifications, zoom, and menu actions. desktop/preload.js is the
      // only thing exposed to it.
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // A real menu bar: 文件 / 编辑 / 视图 / 窗口 / 帮助. Rebuilt on open so the
  // zoom readout and the tray wording are current.
  applyApplicationMenu();

  // Mouse side buttons arrive as browser-backward / browser-forward. This is not
  // a browser: ignore them so they cannot walk the window history at all.
  mainWindow.webContents.on("app-command", (event, command) => {
    if (command === "browser-backward" || command === "browser-forward") {
      event.preventDefault();
    }
  });

  // Links in the model's output belong to the system browser. The embedded
  // window has no address bar, no extensions and no signed-in session, so
  // opening them here is a worse experience than handing them to the OS.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    // The app's own UI keeps navigating in place; everything else goes out.
    if (isAppUrl(url, appUrl)) return;
    event.preventDefault();
    openExternal(url);
  });

  // Restore the zoom the View menu last set. The factor belongs to the
  // webContents, so it is applied once the page exists.
  const savedZoom = Number(settings?.get("zoomPercent", DEFAULT_ZOOM));
  zoomPercent = Number.isFinite(savedZoom) ? Math.min(300, Math.max(50, Math.round(savedZoom))) : DEFAULT_ZOOM;
  if (zoomPercent !== DEFAULT_ZOOM) mainWindow.webContents.setZoomFactor(zoomPercent / 100);

  mainWindow.once("ready-to-show", () => mainWindow.show());
  // The page sets its own title (the WebPi web UI, plus the active session), so
  // the window would otherwise read "WebPi". Keep the session context but name
  // the application the user actually launched.
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    const pageTitle = mainWindow?.webContents.getTitle() ?? "";
    mainWindow?.setTitle(pageTitle ? pageTitle.replace(/WebPi/g, PRODUCT) : PRODUCT);
  });
  mainWindow.on("close", (event) => {
    void handleWindowClose(event);
  });
  mainWindow.on("resize", scheduleBoundsSave);
  mainWindow.on("move", scheduleBoundsSave);
  mainWindow.on("closed", () => {
    mainWindow = undefined;
    updateTrayMenu();
  });
  mainWindow.on("show", () => {
    updateTrayMenu();
    applyApplicationMenu();
  });
  mainWindow.on("hide", () => {
    updateTrayMenu();
    applyApplicationMenu();
  });
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F12") {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
      return;
    }
    // The menu's zoom accelerators only fire while the menu is showing; a
    // hidden menu bar (autoHideMenuBar) still needs the shortcuts to work.
    const modifier = process.platform === "darwin" ? input.meta : input.control;
    if (!modifier || input.alt) return;
    if (input.key === "+" || input.key === "=") {
      stepZoom(+1);
      event.preventDefault();
    } else if (input.key === "-") {
      stepZoom(-1);
      event.preventDefault();
    } else if (input.key === "0") {
      setZoom(DEFAULT_ZOOM);
      event.preventDefault();
    }
  });

  void mainWindow.loadFile(path.join(__dirname, "splash.html"));
}

/**
 * Build and install the menu bar.
 *
 * Called at window creation and again whenever the zoom readout or the
 * window's visibility would change what the menu says.
 */
function applyApplicationMenu() {
  const template = buildMenuTemplate({
    isMac: process.platform === "darwin",
    windowVisible: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()),
    // F12 already opens the tools (see the key handler); the menu keeps the
    // same shortcut so it is discoverable.
    devTools: true,
    getZoomPercent: () => zoomPercent,
    onNewSession: () => sendMenuAction("new-session"),
    onOpenDataDir: () => shell.openPath(app.getPath("userData")),
    onOpenLog: () => openLogFile(),
    onReload: () => reloadWindow(),
    onZoomIn: () => stepZoom(+1),
    onZoomOut: () => stepZoom(-1),
    onZoomReset: () => setZoom(DEFAULT_ZOOM),
    onToggleFullScreen: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    },
    onToggleDevTools: () => mainWindow?.webContents.toggleDevTools(),
    onToggleTrayItem: () => toggleWindow(),
    onMinimize: () => mainWindow?.minimize(),
    onClose: () => mainWindow?.close(),
    onAbout: () => showAbout(),
    onCheckUpdates: () => checkUpdates(),
    onOpenHomepage: () => openExternal("https://github.com/citie114514/pi-web"),
    onQuit: () => quitApp(),
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Ask the page to act, e.g. start a new session from the 文件 menu. */
function sendMenuAction(action) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("webpi:menu-action", action);
  showWindow();
}

function reloadWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.reload();
}

/** Move to the next zoom step in `direction`, and keep the menu's readout in step. */
function stepZoom(direction) {
  const index = ZOOM_LEVELS.findIndex((level) => level >= zoomPercent);
  const current = index === -1 ? ZOOM_LEVELS.length - 1 : index;
  const next = Math.min(ZOOM_LEVELS.length - 1, Math.max(0, current + direction));
  setZoom(ZOOM_LEVELS[next]);
}

/**
 * Apply a zoom percentage to the page and remember it.
 *
 * Chromium's zoom factor is a ratio; the menu and the page both speak percent.
 * The value is clamped so a bad value from the page cannot make the UI unusable.
 */
function setZoom(percent) {
  const next = Math.round(Math.min(300, Math.max(50, Number(percent) || DEFAULT_ZOOM)));
  if (next === zoomPercent && mainWindow?.webContents.getZoomFactor() === next / 100) return;
  zoomPercent = next;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.setZoomFactor(next / 100);
  settings?.set("zoomPercent", next);
  applyApplicationMenu();
}

function openLogFile() {
  const file = path.join(app.getPath("userData"), "desktop.log");
  // openPath opens the file in the user's editor of choice; if there is none,
  // reveal the folder instead of failing silently.
  void shell.openPath(file).then((error) => {
    if (error) shell.showItemInFolder(file);
  });
}

function showAbout() {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  void dialog.showMessageBox(parent, {
    type: "info",
    title: `关于 ${PRODUCT}`,
    message: `${PRODUCT} ${app.getVersion()}`,
    detail: [
      "pi 的浏览器界面 WebPi 的桌面客户端。",
      "",
      `版本：${app.getVersion()}`,
      `Electron：${process.versions.electron}`,
      `Node：${process.versions.node}`,
      `数据目录：${app.getPath("userData")}`,
    ].join("\n"),
    buttons: ["好"],
    defaultId: 0,
  });
}

/**
 * Check the release feed for a newer version.
 *
 * The page has an update endpoint of its own; this is the shell reaching the
 * same releases page so the menu item works even when the UI is not loaded.
 */
async function checkUpdates() {
  const current = app.getVersion();
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  try {
    const response = await fetch("https://api.github.com/repos/citie114514/pi-web/releases?per_page=1", {
      headers: { "User-Agent": `WebPi-Desktop/${current}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const releases = await response.json();
    const latest = Array.isArray(releases) && releases[0]?.tag_name ? String(releases[0].tag_name) : "";
    if (!latest) throw new Error("no release");
    const newer = latest.replace(/^v/, "").startsWith(current) === false;
    void dialog.showMessageBox(parent, {
      type: "info",
      title: "检查更新",
      message: newer ? `发现新版本 ${latest}` : "已是最新版本",
      detail: newer
        ? `当前 ${current}，最新 ${latest}。\n下载：https://github.com/citie114514/pi-web/releases`
        : `当前 ${current}。`,
      buttons: newer ? ["打开下载页", "关闭"] : ["好"],
      defaultId: 0,
      cancelId: newer ? 1 : 0,
    }).then(({ response: index }) => {
      if (newer && index === 0) openExternal("https://github.com/citie114514/pi-web/releases");
    });
  } catch (error) {
    void dialog.showMessageBox(parent, {
      type: "warning",
      title: "检查更新",
      message: "无法检查更新",
      detail: error instanceof Error ? error.message : String(error),
      buttons: ["好"],
    });
  }
}

/**
 * Show a desktop notification for an event the page reported.
 *
 * Clicking it brings the window forward and, when the payload names a session,
 * opens that session. The URL is validated first (see notifications.js): a
 * page-controlled string must not be able to navigate the window anywhere.
 */
function showPageNotification(payload) {
  const event = buildDesktopNotification(payload);
  if (!event) return;

  const visible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  const focused = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused());
  if (!shouldNotifyOnDesktop({ windowVisible: visible, windowFocused: focused })) return;

  const target = notificationTarget(event.sessionUrl, appUrl);

  const click = () => {
    showWindow();
    if (!target || !mainWindow || mainWindow.isDestroyed()) return;
    // Same-origin paths only, resolved against the served UI.
    const url = new URL(target, appUrl).toString();
    void mainWindow.loadURL(url).then(() => {
      const history = mainWindow?.webContents.navigationHistory;
      if (history && typeof history.clear === "function") history.clear();
    });
  };

  if (process.platform === "win32" && tray?.displayBalloon) {
    tray.displayBalloon({ title: event.title, content: event.body });
    // displayBalloon has no click callback; the tray click already restores the
    // window, so the session still opens through the page's own handlers.
    return;
  }
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: event.title, body: event.body, icon: assetPath("icon.png") });
  notification.on("click", click);
  notification.show();
}

/** Wire the page bridge. Every message is treated as untrusted input. */
function installIpc() {
  const { ipcMain } = require("electron");

  ipcMain.on("webpi:notify", (_event, payload) => {
    try {
      showPageNotification(payload);
    } catch (error) {
      logLine(`[desktop] notification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  ipcMain.on("webpi:zoom", (_event, percent) => {
    if (typeof percent === "number" && Number.isFinite(percent)) setZoom(percent);
  });
}

function createTray() {
  try {
    tray = new Tray(trayIcon());
  } catch (error) {
    // Some Linux desktops have no StatusNotifier host; the window still works,
    // so a missing tray must not take the application down.
    logLine(`[desktop] tray unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  tray.setToolTip(PRODUCT);
  tray.on("click", () => toggleWindow());
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const windowVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  tray.setContextMenu(
    Menu.buildFromTemplate(
      buildTrayMenuTemplate({
        closeAction: currentCloseAction(),
        windowVisible,
        onToggleWindow: () => toggleWindow(),
        onRestartServer: () => void restartServer(),
        onSetCloseAction: (action) => {
          settings.set("closeAction", action);
          updateTrayMenu();
        },
        onQuit: () => void quitApp(),
      }),
    ),
  );
}

function currentCloseAction() {
  return normalizeCloseAction(settings ? settings.get("closeAction", "ask") : "ask");
}

async function handleWindowClose(event) {
  if (quitting) return;
  event.preventDefault();

  const remembered = currentCloseAction();
  if (!needsClosePrompt(remembered)) {
    applyCloseAction(remembered);
    return;
  }

  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const { response, checkboxChecked } = await dialog.showMessageBox(parent, CLOSE_DIALOG);
  const decision = decideCloseAction({
    closeAction: remembered,
    dialogResponse: response,
    rememberChecked: checkboxChecked,
  });

  if (decision.remember) {
    settings.set("closeAction", decision.remember);
    updateTrayMenu();
  }

  applyCloseAction(decision.action);
}

function applyCloseAction(action) {
  logLine(`close decision: ${action}`);
  if (action === "tray") {
    hideWindow();
    return;
  }
  if (action === "quit") {
    void quitApp();
  }
}

function hideWindow() {
  mainWindow?.hide();
  updateTrayMenu();

  if (!trayHintShown) {
    trayHintShown = true;
    notify("WebPi 已最小化到托盘，服务仍在运行。要彻底退出请使用托盘菜单。");
  }
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) hideWindow();
  else showWindow();
}

async function restartServer() {
  try {
    const result = await supervisor.restart();
    logLine(`restarted on ${result.url}`);
    if (mainWindow && !mainWindow.isDestroyed()) await loadAppUrl(result.url);
    notify("WebPi 服务已重启");
  } catch (error) {
    await fail(error);
  }
}

async function onServerExit({ expected }) {
  if (quitting || stopping || expected) return;

  updateTrayMenu();
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const { response } = await dialog.showMessageBox(parent, {
    type: "error",
    buttons: ["重启服务", "退出 WebPi"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: PRODUCT,
    message: "WebPi 服务已停止",
    detail: supervisor.logTail(6) || "服务进程意外退出。",
  });

  if (response === 0) await restartServer();
  else await quitApp();
}

async function quitApp() {
  if (stopping) return;
  stopping = true;
  quitting = true;
  logLine("quitting app…");

  // 立即给反馈：窗口先消失，服务在后台停。否则停止服务的几秒里
  // 窗口毫无反应，会被当成「关不掉」。
  mainWindow?.hide();

  try {
    saveWindowBounds();
    await supervisor?.stop();
  } catch (error) {
    logLine(`stop failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  logLine("server stopped; exiting");
  app.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
}

async function fail(error) {
  const detail = error instanceof Error ? error.message : String(error);
  logLine(`fatal: ${detail}`);

  if (SMOKE) {
    process.exitCode = 1;
    await quitApp();
    return;
  }

  dialog.showErrorBox("WebPi 启动失败", detail);
  await quitApp();
}

/**
 * Hand a URL to the operating system's default handler.
 *
 * Only http, https and mailto are passed on — the page must not be able to make
 * the shell launch arbitrary schemes — and the app's own UI is never sent out.
 */
function openExternal(url) {
  const target = externalTarget(url, appUrl);
  if (!target) return false;
  logLine(`opening in the system browser: ${target}`);
  void shell.openExternal(target);
  return true;
}

function assetPath(name) {
  return path.join(ASSETS_DIR, name);
}

/** Remember where the window was, so the next start looks the same. */
function saveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || !settings) return;
  const persistable = isPersistableWindowState({
    isMaximized: mainWindow.isMaximized(),
    isFullScreen: mainWindow.isFullScreen(),
    isMinimized: mainWindow.isMinimized(),
  });
  if (!persistable) return;
  settings.setWindowBounds(mainWindow.getBounds());
}

function scheduleBoundsSave() {
  if (deferBoundsSave) clearTimeout(deferBoundsSave);
  deferBoundsSave = setTimeout(saveWindowBounds, BOUNDS_SAVE_DELAY_MS);
}

function notify(message) {
  if (mainWindow?.isVisible()) return;

  // displayBalloon only exists on Windows; elsewhere use a system notification.
  if (process.platform === "win32") {
    tray?.displayBalloon?.({ title: PRODUCT, content: message });
    return;
  }
  if (Notification.isSupported()) new Notification({ title: PRODUCT, body: message }).show();
}

function trayIcon() {
  const trayPath = assetPath("tray.png");
  const image = nativeImage.createFromPath(fs.existsSync(trayPath) ? trayPath : assetPath("icon.png"));
  return image.isEmpty() ? nativeImage.createEmpty() : image;
}

const DESKTOP_LOG_MAX_BYTES = 256 * 1024;

/**
 * Log to stdout and to a rolling file in the data directory. The installed app
 * has no console, so without the file there would be nothing to diagnose from
 * when something fails on the operator's machine.
 */
function logLine(line) {
  // A GUI launch has no stdout: writing to it throws EPIPE. Logging must never
  // be the reason the application dies.
  try {
    process.stdout.write(`[desktop] ${line}\n`);
  } catch {
    // no console attached
  }
  try {
    const file = path.join(app.getPath("userData"), "desktop.log");
    let previous = "";
    if (fs.existsSync(file)) previous = fs.readFileSync(file, "utf8");
    let combined = `${previous}[${new Date().toISOString()}] ${line}\n`;
    if (combined.length > DESKTOP_LOG_MAX_BYTES) {
      combined = combined.slice(combined.length - DESKTOP_LOG_MAX_BYTES);
      const firstNewline = combined.indexOf("\n");
      if (firstNewline >= 0) combined = combined.slice(firstNewline + 1);
    }
    fs.writeFileSync(file, combined, "utf8");
  } catch {
    // 日志写不进去不能影响运行（例如目录被杀软锁定）。
  }
}

app.on("before-quit", (event) => {
  if (stopping) return;
  event.preventDefault();
  void quitApp();
});

// The tray keeps the app (and the service) alive when the window is closed.
app.on("window-all-closed", () => {});

// macOS: clicking the dock icon brings the window back from the tray.
app.on("activate", () => showWindow());

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void quitApp());
}

process.on("uncaughtException", (error) => {
  logLine(`uncaught: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
});
