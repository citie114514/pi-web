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

/** Electron roles that need no click handler; the OS implements them. */
const EDIT_ROLES = [
  { label: "撤销", role: "undo" },
  { label: "重做", role: "redo" },
  { type: "separator" },
  { label: "剪切", role: "cut" },
  { label: "复制", role: "copy" },
  { label: "粘贴", role: "paste" },
  { label: "全选", role: "selectAll" },
];

/**
 * @param {object} options
 * @param {boolean} options.isMac          macOS puts the app menu first and Window last
 * @param {boolean} options.windowVisible  drives 显示/隐藏 tray wording
 * @param {boolean} options.devTools       show the developer-tools item
 */
function buildMenuTemplate({
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
  const appMenu = {
    label: "WebPi Desktop",
    submenu: [
      { label: "关于 WebPi Desktop", click: onAbout },
      { label: "检查更新…", click: onCheckUpdates },
      { type: "separator" },
      { label: "项目主页", click: onOpenHomepage },
      { type: "separator" },
      { label: "退出 WebPi Desktop", accelerator: "Cmd+Q", click: onQuit },
    ],
  };

  const fileMenu = {
    label: "文件",
    submenu: [
      { label: "新建会话", accelerator: "CmdOrCtrl+N", click: onNewSession },
      { type: "separator" },
      { label: "打开数据目录", click: onOpenDataDir },
      { label: "打开日志文件", click: onOpenLog },
      { type: "separator" },
      // macOS keeps Quit in the application menu, where users expect it.
      ...(isMac
        ? []
        : [{ label: "退出", accelerator: "Ctrl+Q", click: onQuit }]),
    ],
  };

  const viewMenu = {
    label: "视图",
    submenu: [
      { label: "重新加载", accelerator: "CmdOrCtrl+R", click: onReload },
      { type: "separator" },
      { label: "放大", accelerator: "CmdOrCtrl+Plus", click: onZoomIn },
      { label: "缩小", accelerator: "CmdOrCtrl+-", click: onZoomOut },
      { label: "实际大小", accelerator: "CmdOrCtrl+0", click: onZoomReset },
      // A label the user can read at a glance; getZoomPercent runs when the
      // menu is built, which happens on open (see main.js).
      { label: `当前缩放：${getZoomPercent()}%`, enabled: false },
      { type: "separator" },
      { label: "全屏", accelerator: isMac ? "Ctrl+Cmd+F" : "F11", click: onToggleFullScreen },
      ...(devTools ? [{ label: "开发者工具", accelerator: "F12", click: onToggleDevTools }] : []),
      { type: "separator" },
      {
        label: windowVisible ? "隐藏到托盘" : "显示窗口",
        click: onToggleTrayItem,
      },
    ],
  };

  const windowMenu = {
    label: "窗口",
    submenu: [
      { label: "最小化", accelerator: "CmdOrCtrl+M", click: onMinimize },
      { label: "关闭窗口", accelerator: "CmdOrCtrl+W", click: onClose },
    ],
  };

  const helpMenu = {
    label: "帮助",
    submenu: [
      { label: "关于 WebPi Desktop", click: onAbout },
      { label: "检查更新…", click: onCheckUpdates },
      { type: "separator" },
      { label: "项目主页", click: onOpenHomepage },
    ],
  };

  return [
    ...(isMac ? [appMenu] : []),
    fileMenu,
    { label: "编辑", submenu: EDIT_ROLES },
    viewMenu,
    // macOS puts its own Window menu at the end; adding ours would duplicate it.
    ...(isMac ? [] : [windowMenu]),
    helpMenu,
  ];
}

module.exports = { EDIT_ROLES, buildMenuTemplate };
