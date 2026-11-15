import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  MAX_BODY,
  MAX_TITLE,
  buildDesktopNotification,
  notificationTarget,
  shouldNotifyOnDesktop,
} = require("../desktop/notifications.js");

test("a notification fires only while the window is out of sight", () => {
  assert.equal(shouldNotifyOnDesktop({ windowVisible: true, windowFocused: true }), false);
  assert.equal(shouldNotifyOnDesktop({ windowVisible: true, windowFocused: false }), true);
  // Hidden to the tray and minimised both count as "not looking".
  assert.equal(shouldNotifyOnDesktop({ windowVisible: false, windowFocused: false }), true);
});

test("a payload becomes a title, a body and a session URL", () => {
  assert.deepEqual(
    buildDesktopNotification({ title: "任务完成", body: "任务已完成。", sessionUrl: "/?session=abc" }),
    { title: "任务完成", body: "任务已完成。", sessionUrl: "/?session=abc" },
  );
});

test("an empty payload is not shown at all", () => {
  assert.equal(buildDesktopNotification(null), null);
  assert.equal(buildDesktopNotification({}), null);
  assert.equal(buildDesktopNotification({ title: "  ", body: "" }), null);
});

test("long text is clipped, and whitespace is collapsed", () => {
  const { title, body } = buildDesktopNotification({
    title: "x".repeat(MAX_TITLE + 50),
    body: `a\n\n\tb${"y".repeat(MAX_BODY)}`,
  });
  assert.equal(title.length, MAX_TITLE);
  assert.ok(title.endsWith("…"));
  assert.ok(body.length <= MAX_BODY);
  assert.ok(body.startsWith("a b"), "newlines and tabs collapse to one space");
});

test("clipping never leaves half an emoji behind", () => {
  // 11 emoji pairs: the cut lands inside a surrogate pair at the limit.
  const { title } = buildDesktopNotification({ title: "😀".repeat(70) });
  assert.ok(!/[\uD800-\uDBFF]$/.test(title.replace("…", "")), "must not end on a lone high surrogate");
});

test("a missing body still notifies, with the title alone", () => {
  const event = buildDesktopNotification({ title: "需要你的注意" });
  assert.equal(event.title, "需要你的注意");
  assert.equal(event.body, "");
  assert.equal(event.sessionUrl, null);
});

test("only same-origin app paths are navigation targets", () => {
  const origin = "http://127.0.0.1:30141";
  assert.equal(notificationTarget("/?session=abc", origin), "/?session=abc");
  assert.equal(notificationTarget("/", origin), "/");
  // A page-controlled string must not be able to navigate anywhere else.
  assert.equal(notificationTarget("https://evil.example/", origin), null);
  assert.equal(notificationTarget("//evil.example/x", origin), null);
  assert.equal(notificationTarget("javascript:alert(1)", origin), null);
  assert.equal(notificationTarget("file:///C:/Windows/System32/calc.exe", origin), null);
});

test("a session URL carrying a foreign origin is refused", () => {
  const origin = "http://127.0.0.1:30141";
  // `/\evil.example` style tricks resolve to a different origin.
  assert.equal(notificationTarget("/\\evil.example/", origin), null);
});
