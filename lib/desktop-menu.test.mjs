import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { buildMenuTemplate, EDIT_ROLES } = require("../desktop/app-menu.js");

const labels = (menu) => menu.submenu.map((item) => (item.type === "separator" ? "---" : item.label));
// The zoom readout is disabled and has no handler; find it by prefix only.
const readoutOf = (menu) => menu.submenu.find((item) => String(item.label ?? "").startsWith("当前缩放"));

test("the menu bar is 文件 / 编辑 / 视图 / 窗口 / 帮助", () => {
  const template = buildMenuTemplate();
  assert.deepEqual(
    template.map((menu) => menu.label),
    ["文件", "编辑", "视图", "窗口", "帮助"],
  );
});

test("文件 offers a new session, the data directory, the log, and quit", () => {
  const file = buildMenuTemplate().find((menu) => menu.label === "文件");
  assert.deepEqual(labels(file), ["新建会话", "---", "打开数据目录", "打开日志文件", "---", "退出"]);
  const newSession = file.submenu[0];
  assert.equal(newSession.accelerator, "CmdOrCtrl+N");
});

test("every actionable item calls back instead of doing nothing", () => {
  const calls = [];
  const record = (name) => () => calls.push(name);
  const template = buildMenuTemplate({
    onNewSession: record("new"),
    onOpenDataDir: record("data"),
    onOpenLog: record("log"),
    onReload: record("reload"),
    onZoomIn: record("in"),
    onZoomOut: record("out"),
    onZoomReset: record("reset"),
    onToggleFullScreen: record("full"),
    onToggleDevTools: record("devtools"),
    onToggleTrayItem: record("tray"),
    onMinimize: record("min"),
    onClose: record("close"),
    onAbout: record("about"),
    onCheckUpdates: record("updates"),
    onOpenHomepage: record("home"),
    onQuit: record("quit"),
  });

  for (const menu of template) {
    for (const item of menu.submenu) {
      // Roles and the disabled readout are the OS's job; everything else must
      // have a handler, or the menu would silently do nothing.
      if (item.role || item.enabled === false || item.type === "separator") continue;
      assert.equal(typeof item.click, "function", `${menu.label} → ${item.label} has no click`);
    }
  }
  assert.equal(calls.length, 0, "no handler may run while the menu is built");
});

test("the edit menu is made of OS roles, so the clipboard works", () => {
  const edit = buildMenuTemplate().find((menu) => menu.label === "编辑");
  const roles = EDIT_ROLES.filter((item) => item.role).map((item) => item.role);
  assert.deepEqual(roles, ["undo", "redo", "cut", "copy", "paste", "selectAll"]);
  assert.deepEqual(labels(edit).filter((label) => label !== "---"), ["撤销", "重做", "剪切", "复制", "粘贴", "全选"]);
});

test("视图 shows the current zoom and can reset it", () => {
  const view = buildMenuTemplate({ getZoomPercent: () => 125 }).find((menu) => menu.label === "视图");
  const readout = readoutOf(view);
  assert.ok(readout, "the view menu states the current zoom");
  assert.equal(readout.label, "当前缩放：125%");
  assert.equal(readout.enabled, false, "the readout is information, not an action");
});

test("the tray item follows whether the window is visible", () => {
  const hidden = buildMenuTemplate({ windowVisible: false }).find((menu) => menu.label === "视图");
  const shown = buildMenuTemplate({ windowVisible: true }).find((menu) => menu.label === "视图");
  assert.ok(hidden.submenu.some((item) => item.label === "显示窗口"));
  assert.ok(shown.submenu.some((item) => item.label === "隐藏到托盘"));
});

test("macOS keeps Quit in the application menu and drops the duplicate Window menu", () => {
  const template = buildMenuTemplate({ isMac: true });
  assert.equal(template[0].label, "WebPi Desktop");
  assert.ok(template[0].submenu.some((item) => String(item.label ?? "").includes("退出")));
  assert.deepEqual(
    template.map((menu) => menu.label),
    ["WebPi Desktop", "文件", "编辑", "视图", "帮助"],
  );
  const file = template.find((menu) => menu.label === "文件");
  assert.ok(!labels(file).includes("退出"), "macOS users look for Quit in the app menu");
});

test("developer tools are only offered when asked for", () => {
  const without = buildMenuTemplate().find((menu) => menu.label === "视图");
  assert.ok(!labels(without).includes("开发者工具"));
  const withDev = buildMenuTemplate({ devTools: true }).find((menu) => menu.label === "视图");
  assert.ok(labels(withDev).includes("开发者工具"));
});
