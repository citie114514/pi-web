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

async function loadUI(url) {
  appUrl = url;
  logLine(`serving ${url} (owned=${supervisor.owned})`);
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  await mainWindow.loadURL(url);

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
    logLine(
      `[smoke] url=${url} owned=${supervisor.owned} title=${title} window=${mainWindow.getTitle()} popupDenied=${popupDenied} body=${body}`
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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);

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
  mainWindow.on("show", updateTrayMenu);
  mainWindow.on("hide", updateTrayMenu);
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F12") {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  void mainWindow.loadFile(path.join(__dirname, "splash.html"));
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
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(result.url);
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
  logLine(`[desktop] quitting app…`);

  try {
    saveWindowBounds();
    await supervisor?.stop();
  } catch (error) {
    logLine(`stop failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  logLine(`[desktop] server stopped; exiting`);
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

function logLine(line) {
  process.stdout.write(`[desktop] ${line}\n`);
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
