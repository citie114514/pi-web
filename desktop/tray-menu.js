"use strict";

// Tray menu for the desktop shell. Pure template building so the menu can be
// asserted without an Electron runtime.

const { normalizeCloseAction } = require("./close-policy");

function buildTrayMenuTemplate({
  closeAction = "ask",
  windowVisible = true,
  onToggleWindow = () => {},
  onRestartServer = () => {},
  onSetCloseAction = () => {},
  onQuit = () => {},
} = {}) {
  const action = normalizeCloseAction(closeAction);

  return [
    {
      label: windowVisible ? "隐藏窗口" : "显示窗口",
      click: onToggleWindow,
    },
    {
      label: "重启服务",
      click: onRestartServer,
    },
    { type: "separator" },
    {
      label: "关闭窗口时",
      submenu: [
        {
          label: "每次询问",
          type: "radio",
          checked: action === "ask",
          click: () => onSetCloseAction("ask"),
        },
        {
          label: "最小化到托盘",
          type: "radio",
          checked: action === "tray",
          click: () => onSetCloseAction("tray"),
        },
        {
          label: "直接关闭",
          type: "radio",
          checked: action === "quit",
          click: () => onSetCloseAction("quit"),
        },
      ],
    },
    { type: "separator" },
    {
      label: "退出 WebPi（同时停止服务）",
      click: onQuit,
    },
  ];
}

module.exports = { buildTrayMenuTemplate };
