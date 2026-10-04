"use strict";

// Pure close-button policy for the WebPi desktop shell.
//
// The desktop app owns the WebPi server, so closing the window is a product
// decision rather than a window-manager detail: hide to the tray and keep the
// service running, or quit and stop the service with it. Keeping the decision
// here (instead of inside the Electron event handler) keeps it testable.

const CLOSE_ACTIONS = ["ask", "tray", "quit"];
const DEFAULT_CLOSE_ACTION = "ask";

// Order matters: decideCloseAction maps these indexes to actions.
const CLOSE_DIALOG_BUTTONS = ["最小化到托盘", "直接关闭", "取消"];
const CLOSE_DIALOG_DEFAULT_ID = 0;
const CLOSE_DIALOG_CANCEL_ID = 2;
const CLOSE_DIALOG_CHECKBOX_LABEL = "记住我的选择";

function normalizeCloseAction(value) {
  return CLOSE_ACTIONS.includes(value) ? value : DEFAULT_CLOSE_ACTION;
}

function needsClosePrompt(closeAction) {
  return normalizeCloseAction(closeAction) === "ask";
}

/**
 * Decide what a close request means.
 *
 * @param {object} input
 * @param {string} input.closeAction - remembered preference: "ask" | "tray" | "quit".
 * @param {number|null} input.dialogResponse - clicked button index, or null when
 *   no dialog was shown because the preference was already known.
 * @param {boolean} input.rememberChecked - state of the dialog's checkbox.
 * @returns {{ action: "tray" | "quit" | "cancel", remember: "tray" | "quit" | null }}
 */
function decideCloseAction({ closeAction, dialogResponse = null, rememberChecked = false }) {
  const remembered = normalizeCloseAction(closeAction);

  // No dialog: apply the remembered choice, or ask (the caller must then show
  // the dialog and call again with the response).
  if (dialogResponse === null) {
    return { action: remembered, remember: null };
  }

  if (dialogResponse === 0) return { action: "tray", remember: rememberChecked ? "tray" : null };
  if (dialogResponse === 1) return { action: "quit", remember: rememberChecked ? "quit" : null };
  return { action: "cancel", remember: null };
}

const CLOSE_DIALOG = {
  type: "question",
  buttons: CLOSE_DIALOG_BUTTONS,
  defaultId: CLOSE_DIALOG_DEFAULT_ID,
  cancelId: CLOSE_DIALOG_CANCEL_ID,
  checkboxLabel: CLOSE_DIALOG_CHECKBOX_LABEL,
  checkboxChecked: false,
  noLink: true,
  title: "关闭 PiGUI",
  message: "关闭窗口时要怎么做？",
  detail: "最小化到托盘会保留 WebPi 服务继续运行；直接关闭会同时停止 WebPi 服务。",
};

module.exports = {
  CLOSE_ACTIONS,
  CLOSE_DIALOG,
  CLOSE_DIALOG_BUTTONS,
  CLOSE_DIALOG_CANCEL_ID,
  CLOSE_DIALOG_CHECKBOX_LABEL,
  CLOSE_DIALOG_DEFAULT_ID,
  DEFAULT_CLOSE_ACTION,
  decideCloseAction,
  needsClosePrompt,
  normalizeCloseAction,
};
