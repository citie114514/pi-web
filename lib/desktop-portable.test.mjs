import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { PORTABLE_MARKER, archFromBinary, platformLabel, portableMarkerCandidates, resolveDataDir } = require("../desktop/portable.js");

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

test("an explicitly named arch wins, so both Linux arches keep distinct names", () => {
  // electron-builder writes `linux-unpacked` for the host arch, so a folder name
  // alone cannot tell x64 from arm64: the arch must never be guessed from the
  // runner. This is the bug that made two CI jobs overwrite one archive.
  assert.equal(platformLabel("/build/release/linux-arm64-unpacked", { env: {} }), "linux-arm64");
  assert.equal(platformLabel("/build/release/linux-x64-unpacked", { env: {} }), "linux-x64");
  assert.equal(platformLabel("/build/release/linux-unpacked", { env: { WEBPI_PORTABLE_ARCH: "arm64" } }), "linux-arm64");
  assert.equal(platformLabel("/build/release/mac-arm64", { env: {} }), "mac-arm64");
  assert.equal(platformLabel("/build/release/mac", { env: { WEBPI_PORTABLE_ARCH: "x64" } }), "mac-x64");
  assert.equal(platformLabel("/build/release/win-unpacked", { env: { WEBPI_PORTABLE_ARCH: "x64" } }), "win-x64");
});

test("a suffix-less folder falls back to the executable's own header", () => {
  const root = mkdtempSync(join(tmpdir(), "webpi-arch-"));
  const dir = join(root, "linux-unpacked");
  mkdirSync(dir, { recursive: true });
  // A minimal ELF header with e_machine = 0xB7 (AArch64).
  const elf = Buffer.alloc(64);
  elf.writeUInt32LE(0x464c457f, 0);
  elf.writeUInt16LE(0xb7, 18);
  writeFileSync(join(dir, "WebPi"), elf);

  assert.equal(platformLabel(dir, { env: {}, platform: "linux" }), "linux-arm64");
  assert.equal(archFromBinary(dir, { env: {}, platform: "linux" }), "arm64");

  // A PE header with machine = 0x8664 (x86-64) at e_lfanew + 4.
  const peRoot = mkdtempSync(join(tmpdir(), "webpi-arch-pe-"));
  const exeDir = join(peRoot, "win-unpacked");
  mkdirSync(exeDir, { recursive: true });
  const pe = Buffer.alloc(128);
  pe[0] = 0x4d;
  pe[1] = 0x5a;
  pe.writeUInt32LE(64, 0x3c);
  pe.writeUInt16LE(0x8664, 68);
  writeFileSync(join(exeDir, "WebPi.exe"), pe);

  assert.equal(platformLabel(exeDir, { env: {}, platform: "win32" }), "win-x64");
});

test("an unreadable executable degrades to x64 instead of failing the build", () => {
  const root = mkdtempSync(join(tmpdir(), "webpi-arch-empty-"));
  const dir = join(root, "linux-unpacked");
  mkdirSync(dir, { recursive: true });
  assert.equal(archFromBinary(dir, { env: {}, platform: "linux" }), "x64");
});
