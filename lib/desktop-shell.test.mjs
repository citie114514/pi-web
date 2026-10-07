import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import test from "node:test";

const require = createRequire(import.meta.url);
const { CLOSE_DIALOG, decideCloseAction, needsClosePrompt, normalizeCloseAction } = require("../desktop/close-policy.js");
const { buildKillCommand, buildLaunchCommand, parseReadyLine } = require("../desktop/launcher.js");
const { buildTrayMenuTemplate } = require("../desktop/tray-menu.js");
const { ServerSupervisor } = require("../desktop/server-supervisor.js");

const READY = "WebPi ready at http://127.0.0.1:30141\n";
const ALREADY_RUNNING = "WebPi is already running at http://127.0.0.1:30141\n";

function fakeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.exitCode = null;
  child.signalCode = null;
  child.killed = false;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exit = (code = 0, signal = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    child.emit("exit", code, signal);
  };
  child.kill = () => {
    child.killed = true;
    return true;
  };
  return child;
}

/** spawn stub: records calls; a taskkill call aborts the child like the OS would. */
function fakeSpawn(child, calls = []) {
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "taskkill") {
      child.exit(0, "SIGTERM");
      const handle = new EventEmitter();
      handle.unref = () => {};
      return handle;
    }
    return child;
  };
  return { spawnImpl, calls };
}

test("close policy defaults to asking, and unknown values fall back to it", () => {
  assert.equal(normalizeCloseAction(undefined), "ask");
  assert.equal(normalizeCloseAction("nonsense"), "ask");
  assert.equal(normalizeCloseAction("tray"), "tray");
  assert.equal(needsClosePrompt("ask"), true);
  assert.equal(needsClosePrompt("tray"), false);
  assert.equal(needsClosePrompt("quit"), false);
});

test("a remembered close action is applied without a dialog", () => {
  assert.deepEqual(decideCloseAction({ closeAction: "tray" }), { action: "tray", remember: null });
  assert.deepEqual(decideCloseAction({ closeAction: "quit" }), { action: "quit", remember: null });
  assert.deepEqual(decideCloseAction({ closeAction: "ask" }), { action: "ask", remember: null });
});

test("the close dialog maps its buttons to tray, quit, and cancel", () => {
  assert.deepEqual(decideCloseAction({ closeAction: "ask", dialogResponse: 0 }), { action: "tray", remember: null });
  assert.deepEqual(decideCloseAction({ closeAction: "ask", dialogResponse: 1 }), { action: "quit", remember: null });
  assert.deepEqual(decideCloseAction({ closeAction: "ask", dialogResponse: 2 }), { action: "cancel", remember: null });
});

test("the close dialog can remember the answer", () => {
  assert.deepEqual(
    decideCloseAction({ closeAction: "ask", dialogResponse: 0, rememberChecked: true }),
    { action: "tray", remember: "tray" },
  );
  assert.deepEqual(
    decideCloseAction({ closeAction: "ask", dialogResponse: 1, rememberChecked: true }),
    { action: "quit", remember: "quit" },
  );
  assert.deepEqual(
    decideCloseAction({ closeAction: "ask", dialogResponse: 2, rememberChecked: true }),
    { action: "cancel", remember: null },
  );
});

test("the close dialog offers tray first, cancel last, and never clicks quit by default", () => {
  assert.deepEqual(CLOSE_DIALOG.buttons, ["最小化到托盘", "直接关闭", "取消"]);
  assert.equal(CLOSE_DIALOG.defaultId, 0);
  assert.equal(CLOSE_DIALOG.cancelId, 2);
  assert.equal(CLOSE_DIALOG.checkboxLabel, "记住我的选择");
});

test("the tray menu exposes the service and close-behaviour controls", () => {
  const calls = [];
  const template = buildTrayMenuTemplate({
    closeAction: "ask",
    windowVisible: true,
    onToggleWindow: () => calls.push("toggle"),
    onRestartServer: () => calls.push("restart"),
    onQuit: () => calls.push("quit"),
    onSetCloseAction: (action) => calls.push(`close:${action}`),
  });

  assert.deepEqual(template.map((item) => item.label ?? item.type), [
    "隐藏窗口",
    "重启服务",
    "separator",
    "关闭窗口时",
    "separator",
    "退出 WebPi（同时停止服务）",
  ]);

  const submenu = template[3].submenu;
  assert.deepEqual(submenu.map((item) => item.label), ["每次询问", "最小化到托盘", "直接关闭"]);
  assert.deepEqual(submenu.map((item) => item.checked), [true, false, false]);

  template[0].click();
  template[1].click();
  template[5].click();
  submenu[1].click();
  assert.deepEqual(calls, ["toggle", "restart", "quit", "close:tray"]);
});

test("the tray menu marks the remembered close action and the hidden window", () => {
  const template = buildTrayMenuTemplate({ closeAction: "quit", windowVisible: false });
  assert.equal(template[0].label, "显示窗口");
  assert.deepEqual(template[3].submenu.map((item) => item.checked), [false, false, true]);
});

test("the launch command runs the shared launcher with the bundled runtime", () => {
  const command = buildLaunchCommand({
    cliPath: "C:/app/bin/pi-web.js",
    port: "30141",
    hostname: "127.0.0.1",
    execPath: "C:/app/electron.exe",
    electron: true,
    env: { PATH: "/usr/bin" },
    platform: "win32",
  });

  assert.equal(command.command, "C:/app/electron.exe");
  assert.deepEqual(command.args, [
    "C:/app/bin/pi-web.js",
    "--port",
    "30141",
    "--hostname",
    "127.0.0.1",
    "--no-open",
  ]);
  assert.equal(command.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(command.env.PATH, "/usr/bin");
  assert.equal(command.detached, false, "Windows must not detach, taskkill needs the pid");
});

test("plain Node keeps running the launcher without Electron flags", () => {
  const command = buildLaunchCommand({ electron: false, platform: "linux", env: {} });
  assert.equal(command.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(command.detached, true, "POSIX detaches so the tree can be killed");
});

test("WEBPI_NODE selects a specific Node.js for the service", () => {
  const command = buildLaunchCommand({
    electron: true,
    execPath: "C:/app/electron.exe",
    env: { WEBPI_NODE: " C:/node/node.exe " },
  });

  assert.equal(command.command, "C:/node/node.exe", "the override wins over the bundled runtime");
  assert.equal(command.env.ELECTRON_RUN_AS_NODE, undefined, "a real Node must not run in Electron mode");
});

test("the readiness contract line decides ownership", () => {
  assert.deepEqual(parseReadyLine(READY), { url: "http://127.0.0.1:30141", owned: true });
  assert.deepEqual(parseReadyLine(ALREADY_RUNNING), { url: "http://127.0.0.1:30141", owned: false });
  assert.equal(parseReadyLine("next start -p 30141"), null);
});

test("stopping uses a tree kill", () => {
  assert.deepEqual(buildKillCommand(99, { platform: "win32" }), {
    command: "taskkill",
    args: ["/pid", "99", "/T", "/F"],
  });
  assert.deepEqual(buildKillCommand(99, { platform: "win32", force: true }).args, ["/pid", "99", "/T", "/F"]);
  assert.deepEqual(buildKillCommand(99, { platform: "linux" }), { signal: "SIGTERM", pid: -99 });
  assert.deepEqual(buildKillCommand(99, { platform: "linux", force: true }), { signal: "SIGKILL", pid: -99 });
});

test("the supervisor reports the URL once the launcher is ready", async () => {
  const child = fakeChild();
  const { spawnImpl, calls } = fakeSpawn(child);
  const supervisor = new ServerSupervisor({ spawnImpl, platform: "win32", cwd: "/app" });

  const started = supervisor.start();
  child.stdout.write("▲ Next.js 16.3.6\n");
  child.stdout.write(READY);
  const result = await started;

  assert.deepEqual(result, { url: "http://127.0.0.1:30141", owned: true });
  assert.equal(supervisor.url, "http://127.0.0.1:30141");
  assert.equal(supervisor.owned, true);
  assert.equal(supervisor.running, true);
  assert.deepEqual(calls[0].args.slice(1, 3), ["--port", "30141"]);
  assert.equal(calls[0].options.cwd, "/app");
  assert.equal(calls[0].options.windowsHide, true);
});

test("a server this app did not start is reported as not owned", async () => {
  const child = fakeChild();
  const { spawnImpl } = fakeSpawn(child);
  const supervisor = new ServerSupervisor({ spawnImpl, platform: "win32" });
  const exits = [];
  supervisor.on("exit", (info) => exits.push(info));

  const started = supervisor.start();
  child.stdout.write(ALREADY_RUNNING);
  const result = await started;
  // The launcher exits by itself after reporting an existing server.
  child.exit(0, null);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(result, { url: "http://127.0.0.1:30141", owned: false });
  assert.equal(supervisor.owned, false);
  // The launcher exits after stepping aside; the shell ignores expected exits.
  assert.deepEqual(exits, [{ code: 0, signal: null, expected: true }]);
});

test("a launcher that dies before reporting readiness fails with its log", async () => {
  const child = fakeChild();
  const { spawnImpl } = fakeSpawn(child);
  const supervisor = new ServerSupervisor({ spawnImpl, platform: "win32" });

  const started = supervisor.start();
  child.stderr.write("No usable port found after 10 attempts starting at 30141.\n");
  child.exit(1, null);

  await assert.rejects(started, /No usable port found after 10 attempts/);
  assert.match(supervisor.logTail(), /No usable port found/);
  assert.equal(supervisor.listenerCount("error"), 0, "a rejection must not need an error listener");
});

test("startup failure from spawn itself is surfaced", async () => {
  const supervisor = new ServerSupervisor({
    platform: "win32",
    spawnImpl: () => {
      throw new Error("spawn ENOENT");
    },
  });

  await assert.rejects(supervisor.start(), /spawn ENOENT/);
});

test("stop terminates the launcher tree and leaves nothing running", async () => {
  const child = fakeChild();
  const { spawnImpl, calls } = fakeSpawn(child);
  const supervisor = new ServerSupervisor({ spawnImpl, platform: "win32", stopTimeoutMs: 200 });

  const started = supervisor.start();
  child.stdout.write(READY);
  await started;

  assert.equal(await supervisor.stop(), true);
  assert.equal(supervisor.running, false);
  assert.equal(supervisor.url, undefined);
  const kill = calls.find((call) => call.command === "taskkill");
  assert.deepEqual(kill.args, ["/pid", String(child.pid), "/T", "/F"], "the whole tree must die with the app");
});

test("stop is safe to call twice and before start", async () => {
  const supervisor = new ServerSupervisor({ platform: "win32" });
  assert.equal(await supervisor.stop(), true);
  assert.equal(await supervisor.stop(), true);
});

test("an unexpected service exit after readiness asks for a decision", async () => {
  const child = fakeChild();
  const { spawnImpl } = fakeSpawn(child);
  const supervisor = new ServerSupervisor({ spawnImpl, platform: "win32" });
  const exits = [];
  supervisor.on("exit", (info) => exits.push(info));

  const started = supervisor.start();
  child.stdout.write(READY);
  await started;

  child.exit(1, null);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(exits, [{ code: 1, signal: null, expected: false }]);
  assert.equal(supervisor.url, undefined);
});

test("restart stops the old service and starts a fresh one", async () => {
  const children = [fakeChild(1), fakeChild(2)];
  const calls = [];
  let index = 0;
  const spawnImpl = (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "taskkill") {
      children[0].exit(0, "SIGTERM");
      const handle = new EventEmitter();
      handle.unref = () => {};
      return handle;
    }
    return children[index++];
  };

  const supervisor = new ServerSupervisor({ spawnImpl, platform: "win32", stopTimeoutMs: 200 });

  const started = supervisor.start();
  children[0].stdout.write(READY);
  await started;
  assert.equal(supervisor.url, "http://127.0.0.1:30141");

  const restarted = supervisor.restart();
  await new Promise((resolve) => setImmediate(resolve));
  children[1].stdout.write("WebPi ready at http://127.0.0.1:30200\n");
  const result = await restarted;

  assert.deepEqual(result, { url: "http://127.0.0.1:30200", owned: true });
  assert.equal(calls.filter((call) => call.command === "taskkill").length, 1);
  assert.equal(calls.filter((call) => call.command !== "taskkill").length, 2);
});
