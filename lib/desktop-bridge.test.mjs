import assert from "node:assert/strict";
import test from "node:test";

import { desktopBridge, desktopNotify, desktopSetLocale, desktopSetZoom, isDesktopShell } from "../lib/desktop-bridge.ts";

/** Install a fake preload bridge on a fake window, and restore it afterwards. */
function withBridge(bridge, run) {
  const globalWindow = globalThis.window;
  globalThis.window = bridge === null ? {} : { webpiDesktop: bridge };
  try {
    run();
  } finally {
    globalThis.window = globalWindow;
  }
}

test("a browser tab has no bridge, so the page keeps its own behaviour", () => {
  withBridge(null, () => {
    assert.equal(desktopBridge(), null);
    assert.equal(isDesktopShell(), false);
    assert.equal(desktopNotify({ title: "t", body: "b", sessionUrl: "/" }), false);
    assert.equal(desktopSetZoom(125), false);
  });
});

test("the desktop window reports its bridge", () => {
  const sent = [];
  withBridge({ isDesktop: true, platform: "win32", notify: (payload) => sent.push(payload) }, () => {
    assert.equal(isDesktopShell(), true);
    const taken = desktopNotify({ title: "任务完成", body: "任务已完成。", sessionUrl: "/?session=abc", tag: "done" });
    assert.equal(taken, true);
    assert.deepEqual(sent, [{ title: "任务完成", body: "任务已完成。", sessionUrl: "/?session=abc", tag: "done" }]);
  });
});

test("a bridge that is missing a capability is treated as absent for it", () => {
  withBridge({ isDesktop: true }, () => {
    assert.equal(desktopNotify({ title: "t", body: "b", sessionUrl: "/" }), false);
    assert.equal(desktopSetZoom(150), false);
  });
});

test("a throwing bridge never breaks the page", () => {
  withBridge(
    {
      isDesktop: true,
      notify: () => {
        throw new Error("no ipc");
      },
      setZoom: () => {
        throw new Error("no ipc");
      },
    },
    () => {
      assert.equal(desktopNotify({ title: "t", body: "b", sessionUrl: "/" }), false);
      assert.equal(desktopSetZoom(150), false);
    },
  );
});

test("a notification without a title is not sent to the shell", () => {
  const sent = [];
  withBridge({ isDesktop: true, notify: (payload) => sent.push(payload) }, () => {
    assert.equal(desktopNotify({ title: "", body: "b", sessionUrl: "/" }), false);
    assert.deepEqual(sent, []);
  });
});

test("zoom reads and refuses nonsense", () => {
  const sent = [];
  withBridge({ isDesktop: true, setZoom: (percent) => sent.push(percent) }, () => {
    assert.equal(desktopSetZoom(125), true);
    assert.equal(desktopSetZoom(Number.NaN), false);
    assert.deepEqual(sent, [125]);
  });
});

test("the locale reaches the shell so its menu matches the UI", () => {
  const sent = [];
  withBridge({ isDesktop: true, setLocale: (locale) => sent.push(locale) }, () => {
    assert.equal(desktopSetLocale("zh-TW"), true);
    assert.deepEqual(sent, ["zh-TW"]);
  });
  // Nothing to report without a bridge, or without a locale.
  withBridge(null, () => assert.equal(desktopSetLocale("en"), false));
  withBridge({ isDesktop: true, setLocale: (l) => sent.push(l) }, () => {
    assert.equal(desktopSetLocale(""), false);
  });
});
