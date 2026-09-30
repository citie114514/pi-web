import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { PORTABLE_MARKER, portableMarkerCandidates, resolveDataDir } = require("../desktop/portable.js");

test("without any marker the app keeps using the operating system's data dir", () => {
  const resolved = resolveDataDir({
    env: {},
    exeDir: "C:/apps/WebPi",
    userDataDir: "C:/Users/x/AppData/Roaming/WebPi",
    platform: "win32",
    exists: () => false,
  });

  assert.deepEqual(resolved, { mode: "user", dir: "C:/Users/x/AppData/Roaming/WebPi", marker: null });
});

test("WEBPI_DESKTOP_DATA_DIR overrides everything", () => {
  const resolved = resolveDataDir({
    env: { WEBPI_DESKTOP_DATA_DIR: " D:/webpi-data ", PORTABLE_EXECUTABLE_DIR: "E:/portable" },
    exeDir: "C:/apps/WebPi",
    userDataDir: "C:/Users/x/AppData/Roaming/WebPi",
    platform: "win32",
    exists: () => true,
  });

  assert.equal(resolved.mode, "env");
  assert.equal(resolved.dir, resolve("D:/webpi-data"));
});

test("the single-file portable build keeps data next to the executable", () => {
  const resolved = resolveDataDir({
    env: { PORTABLE_EXECUTABLE_DIR: "E:/WebPi" },
    exeDir: "C:/Temp/xyz",
    userDataDir: "C:/Users/x/AppData/Roaming/WebPi",
    platform: "win32",
    exists: () => false,
  });

  assert.equal(resolved.mode, "portable-exe");
  assert.equal(resolved.dir, resolve("E:/WebPi", "data"));
});

test("the portable archive marker makes the folder self-contained", () => {
  const exeDir = resolve("E:/WebPi-0.9.3-win-x64-portable");
  const marker = join(exeDir, PORTABLE_MARKER);
  const resolved = resolveDataDir({
    env: {},
    exeDir,
    userDataDir: "C:/Users/x/AppData/Roaming/WebPi",
    platform: "win32",
    exists: (candidate) => candidate === marker,
  });

  assert.equal(resolved.mode, "marker");
  assert.equal(resolved.dir, join(exeDir, "data"));
  assert.equal(resolved.marker, marker);
});

test("macOS portable archives are found both beside and above the bundle", () => {
  const portableRoot = resolve("/Volumes/WebPi-0.9.3-mac-arm64-portable");
  const exeDir = join(portableRoot, "WebPi.app", "Contents", "MacOS");
  const candidates = portableMarkerCandidates({ exeDir, platform: "darwin" });

  assert.deepEqual(candidates, [
    join(exeDir, PORTABLE_MARKER),
    join(portableRoot, PORTABLE_MARKER),
  ]);

  const besideBundle = join(portableRoot, PORTABLE_MARKER);
  const resolved = resolveDataDir({
    env: {},
    exeDir,
    userDataDir: "/Users/x/Library/Application Support/WebPi",
    platform: "darwin",
    exists: (candidate) => candidate === besideBundle,
  });

  assert.equal(resolved.mode, "marker");
  assert.equal(resolved.dir, join(portableRoot, "data"));
});

test("a marker written by the build script is a real empty file", () => {
  const dir = mkdtempSync(join(tmpdir(), "webpi-portable-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, PORTABLE_MARKER), "");

  const resolved = resolveDataDir({ env: {}, exeDir: dir, userDataDir: "ignored", platform: "linux" });
  assert.equal(resolved.mode, "marker");
  assert.equal(resolved.dir, join(dir, "data"));
});
