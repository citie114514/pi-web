"use strict";

// Application menu for the desktop shell.
//
// Built as a plain template so the structure can be asserted without an
// Electron runtime (see lib/desktop-menu.test.mjs). The main process turns it
// into a real Menu and adds Electron's own roles where they apply.
//
// Layout follows a conventional desktop application: 文件 / 编辑 / 视图 /
// 窗口 / 帮助. The web UI keeps its own in-app controls; this menu is the shell
// around it — window management, reload, zoom, the data directory, and the
// things a user looks for when the page itself will not answer.

// The menu speaks the same languages as the web UI (lib/i18n). The page tells
// the shell which one is active (desktop/preload.js setLocale); this is the
// shell's own copy of the few strings the menu needs, so a stale page cannot
// leave the menu in a language the UI no longer shows.
const LABELS = {
  en: {
    app: "WebPi Desktop",
    file: "File",
    edit: "Edit",
    view: "View",
    window: "Window",
    help: "Help",
    newSession: "New Session",
    openDataDir: "Open Data Folder",
    openLog: "Open Log File",
    quit: "Quit",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    selectAll: "Select All",
    reload: "Reload",
    zoomIn: "Zoom In",
    zoomOut: "Zoom Out",
    zoomReset: "Actual Size",
    zoomNow: (percent) => `Zoom: ${percent}%`,
    fullScreen: "Toggle Full Screen",
    devTools: "Developer Tools",
    hideToTray: "Hide to Tray",
    showWindow: "Show Window",
    minimize: "Minimize",
    close: "Close Window",
    about: "About WebPi Desktop",
    checkUpdates: "Check for Updates…",
    homepage: "Project Homepage",
  },
  "zh-CN": {
    app: "WebPi Desktop",
    file: "文件",
    edit: "编辑",
    view: "视图",
    window: "窗口",
    help: "帮助",
    newSession: "新建会话",
    openDataDir: "打开数据目录",
    openLog: "打开日志文件",
    quit: "退出",
    undo: "撤销",
    redo: "重做",
    cut: "剪切",
    copy: "复制",
    paste: "粘贴",
    selectAll: "全选",
    reload: "重新加载",
    zoomIn: "放大",
    zoomOut: "缩小",
    zoomReset: "实际大小",
    zoomNow: (percent) => `当前缩放：${percent}%`,
    fullScreen: "全屏",
    devTools: "开发者工具",
    hideToTray: "隐藏到托盘",
    showWindow: "显示窗口",
    minimize: "最小化",
    close: "关闭窗口",
    about: "关于 WebPi Desktop",
    checkUpdates: "检查更新…",
    homepage: "项目主页",
  },
  "zh-TW": {
    app: "WebPi Desktop",
    file: "檔案",
    edit: "編輯",
    view: "檢視",
    window: "視窗",
    help: "說明",
    newSession: "新增工作階段",
    openDataDir: "開啟資料目錄",
    openLog: "開啟記錄檔",
    quit: "結束",
    undo: "復原",
    redo: "重做",
    cut: "剪下",
    copy: "複製",
    paste: "貼上",
    selectAll: "全選",
    reload: "重新載入",
    zoomIn: "放大",
    zoomOut: "縮小",
    zoomReset: "實際大小",
    zoomNow: (percent) => `目前縮放：${percent}%`,
    fullScreen: "全螢幕",
    devTools: "開發人員工具",
    hideToTray: "隱藏到系統匣",
    showWindow: "顯示視窗",
    minimize: "最小化",
    close: "關閉視窗",
    about: "關於 WebPi Desktop",
    checkUpdates: "檢查更新…",
    homepage: "專案首頁",
  },
};

/** Labels for a locale, falling back to English for anything unknown. */
function labelsFor(locale) {
  return LABELS[locale] ?? LABELS.en;
}

/** Electron roles that need no click handler; the OS implements them. */
function editRoles(t) {
  return [
    { label: t.undo, role: "undo" },
    { label: t.redo, role: "redo" },
    { type: "separator" },
    { label: t.cut, role: "cut" },
    { label: t.copy, role: "copy" },
    { label: t.paste, role: "paste" },
    { label: t.selectAll, role: "selectAll" },
  ];
}

/** Every locale the menu can speak, for the page and for the tests. */
function supportedMenuLocales() {
  return Object.keys(LABELS);
}

/**
 * @param {object} options
 * @param {string} options.locale         "en" | "zh-CN" | "zh-TW"; anything else falls back to English
 * @param {boolean} options.isMac          macOS puts the app menu first and Window last
 * @param {boolean} options.windowVisible  drives 显示/隐藏 tray wording
 * @param {boolean} options.devTools       show the developer-tools item
 */
function buildMenuTemplate({
  locale = "en",
  isMac = false,
  windowVisible = true,
  devTools = false,
  onNewSession = () => {},
  onOpenDataDir = () => {},
  onOpenLog = () => {},
  getZoomPercent = () => 100,
  onReload = () => {},
  onZoomIn = () => {},
  onZoomOut = () => {},
  onZoomReset = () => {},
  onToggleFullScreen = () => {},
  onToggleDevTools = () => {},
  onToggleTrayItem = () => {},
  onMinimize = () => {},
  onClose = () => {},
  onAbout = () => {},
  onCheckUpdates = () => {},
  onOpenHomepage = () => {},
  onQuit = () => {},
} = {}) {
  const t = labelsFor(locale);

  const aboutItem = { label: t.about, click: onAbout };
  const updatesItem = { label: t.checkUpdates, click: onCheckUpdates };
  const homepageItem = { label: t.homepage, click: onOpenHomepage };

  const appMenu = {
    label: t.app,
    submenu: [
      aboutItem,
      updatesItem,
      { type: "separator" },
      homepageItem,
      { type: "separator" },
      { label: t.quit, accelerator: "Cmd+Q", click: onQuit },
    ],
  };

  const fileMenu = {
    label: t.file,
    submenu: [
      { label: t.newSession, accelerator: "CmdOrCtrl+N", click: onNewSession },
      { type: "separator" },
      { label: t.openDataDir, click: onOpenDataDir },
      { label: t.openLog, click: onOpenLog },
      { type: "separator" },
      // macOS keeps Quit in the application menu, where users expect it.
      ...(isMac ? [] : [{ label: t.quit, accelerator: "Ctrl+Q", click: onQuit }]),
    ],
  };

  const viewMenu = {
    label: t.view,
    submenu: [
      { label: t.reload, accelerator: "CmdOrCtrl+R", click: onReload },
      { type: "separator" },
      { label: t.zoomIn, accelerator: "CmdOrCtrl+Plus", click: onZoomIn },
      { label: t.zoomOut, accelerator: "CmdOrCtrl+-", click: onZoomOut },
      { label: t.zoomReset, accelerator: "CmdOrCtrl+0", click: onZoomReset },
      // A label the user can read at a glance; getZoomPercent runs when the
      // menu is built, which happens on open (see main.js).
      { label: t.zoomNow(getZoomPercent()), enabled: false },
      { type: "separator" },
      { label: t.fullScreen, accelerator: isMac ? "Ctrl+Cmd+F" : "F11", click: onToggleFullScreen },
      ...(devTools ? [{ label: t.devTools, accelerator: "F12", click: onToggleDevTools }] : []),
      { type: "separator" },
      {
        label: windowVisible ? t.hideToTray : t.showWindow,
        click: onToggleTrayItem,
      },
    ],
  };

  const windowMenu = {
    label: t.window,
    submenu: [
      { label: t.minimize, accelerator: "CmdOrCtrl+M", click: onMinimize },
      { label: t.close, accelerator: "CmdOrCtrl+W", click: onClose },
    ],
  };

  const helpMenu = {
    label: t.help,
    submenu: [aboutItem, updatesItem, { type: "separator" }, homepageItem],
  };

  return [
    ...(isMac ? [appMenu] : []),
    fileMenu,
    { label: t.edit, submenu: editRoles(t) },
    viewMenu,
    // macOS puts its own Window menu at the end; adding ours would duplicate it.
    ...(isMac ? [] : [windowMenu]),
    helpMenu,
  ];
}

module.exports = { LABELS, buildMenuTemplate, editRoles, labelsFor, supportedMenuLocales };
