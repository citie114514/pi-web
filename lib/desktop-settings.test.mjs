import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  createSettingsStore,
  isPersistableWindowState,
  normalizeBounds,
} = require("../desktop/settings.js");

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "webpi-desktop-settings-"));
  return createSettingsStore(join(dir, "settings.json"));
}

test("window bounds are accepted when they can hold the UI", () => {
  assert.deepEqual(normalizeBounds({ width: 1280, height: 800 }), { width: 1280, height: 800 });
  assert.deepEqual(normalizeBounds({ x: 10.4, y: -20.6, width: 1280, height: 800 }), {
    x: 10,
    y: -21,
    width: 1280,
    height: 800,
  });
});

test("window bounds are rejected when they would hide the window", () => {
  for (const raw of [
    null,
    undefined,
    "1280x800",
    {},
    { width: 1280 },
    { width: MIN_WINDOW_WIDTH - 1, height: MIN_WINDOW_HEIGHT - 1 },
    { width: Number.NaN, height: 800 },
    { width: 1280, height: Number.POSITIVE_INFINITY },
  ]) {
    assert.equal(normalizeBounds(raw), null, JSON.stringify(raw));
  }
});

test("a partial or invalid position is dropped, keeping the size", () => {
  for (const raw of [
    { x: 10, width: 1280, height: 800 },
    { x: 10, y: "20", width: 1280, height: 800 },
    { y: 10, width: 1280, height: 800 },
  ]) {
    assert.deepEqual(normalizeBounds(raw), { width: 1280, height: 800 }, JSON.stringify(raw));
  }
});

test("window position is only written once the window has a position", () => {
  assert.deepEqual(normalizeBounds({ width: 1280, height: 800, x: 0, y: 0 }), {
    x: 0,
    y: 0,
    width: 1280,
    height: 800,
  });
  assert.equal("x" in normalizeBounds({ width: 1280, height: 800 }), false);
});

test("maximized, fullscreen, and minimized windows keep their remembered size", () => {
  assert.equal(isPersistableWindowState({ isMaximized: false, isFullScreen: false, isMinimized: false }), true);
  assert.equal(isPersistableWindowState({ isMaximized: true, isFullScreen: false, isMinimized: false }), false);
  assert.equal(isPersistableWindowState({ isMaximized: false, isFullScreen: true, isMinimized: false }), false);
  assert.equal(isPersistableWindowState({ isMaximized: false, isFullScreen: false, isMinimized: true }), false);
});

test("settings round-trip through the file and keep unrelated keys", () => {
  const store = tempStore();
  assert.equal(store.get("closeAction", "ask"), "ask");
  store.set("closeAction", "tray");
  store.setWindowBounds({ width: 1200, height: 700 });

  assert.deepEqual(JSON.parse(readFileSync(store.filePath, "utf8")), {
    closeAction: "tray",
    windowBounds: { width: 1200, height: 700 },
  });
  assert.equal(store.get("closeAction", "ask"), "tray");
  assert.deepEqual(store.getWindowBounds(), { width: 1200, height: 700 });

  store.delete("windowBounds");
  assert.equal(store.getWindowBounds(), null);
  assert.equal(store.get("closeAction", "ask"), "tray", "deleting one key must not drop the others");
  assert.equal(existsSync(`${store.filePath}.tmp`), false, "writes go through a renamed temp file");
});

test("a corrupt or hand-edited settings file falls back to defaults", () => {
  const store = tempStore();
  writeFileSync(store.filePath, "{ not json");
  assert.equal(store.get("closeAction", "ask"), "ask");
  assert.equal(store.getWindowBounds(), null);

  writeFileSync(store.filePath, JSON.stringify({ windowBounds: { width: 10, height: 10 }, other: 1 }));
  assert.equal(store.getWindowBounds(), null);
  assert.equal(store.get("other", null), 1);
});

test("invalid bounds are never written back", () => {
  const store = tempStore();
  assert.equal(store.setWindowBounds({ width: 10, height: 10 }), null);
  assert.equal(store.get("windowBounds", null), null);
});
