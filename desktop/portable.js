"use strict";

// Portable-mode resolution for the desktop shell.
//
// A portable build must not write to %APPDATA% / Application Support: its
// settings live next to the executable so the whole folder can be moved to a
// USB stick. Three markers enable that, in priority order:
//
//   1. WEBPI_DESKTOP_DATA_DIR       - explicit override, any layout;
//   2. PORTABLE_EXECUTABLE_DIR      - set by electron-builder's single-file
//                                     portable target;
//   3. a `.webpi-portable` marker   - written by desktop/make-portable.mjs into
//                                     the portable archive, so the unzipped
//                                     folder is self-contained.
//
// Nothing here reads Electron APIs, so the decision can be unit tested.

const fs = require("node:fs");
const path = require("node:path");

const PORTABLE_MARKER = ".webpi-portable";
const PORTABLE_DATA_DIR = "data";
const ARCH_OVERRIDE_ENV = "WEBPI_PORTABLE_ARCH";

function nonEmpty(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Places the marker file can sit, given the running executable.
 *
 * On macOS the executable lives inside `WebPi.app/Contents/MacOS`, so the
 * marker also sits beside the bundle (where a user unzips it).
 */
function portableMarkerCandidates({ exeDir, platform = process.platform }) {
  const candidates = [path.join(exeDir, PORTABLE_MARKER)];
  if (platform === "darwin") {
    candidates.push(path.resolve(exeDir, "..", "..", "..", PORTABLE_MARKER));
  }
  return candidates;
}

/**
 * Decide where the desktop shell keeps its settings and window state.
 *
 * @returns {{ mode: "env" | "portable-exe" | "marker" | "user", dir: string, marker: string | null }}
 */
function resolveDataDir({
  env = process.env,
  exeDir,
  userDataDir,
  platform = process.platform,
  exists = fs.existsSync,
} = {}) {
  const explicit = nonEmpty(env.WEBPI_DESKTOP_DATA_DIR);
  if (explicit) return { mode: "env", dir: path.resolve(explicit), marker: null };

  const portableDir = nonEmpty(env.PORTABLE_EXECUTABLE_DIR);
  if (portableDir) {
    return { mode: "portable-exe", dir: path.join(path.resolve(portableDir), PORTABLE_DATA_DIR), marker: null };
  }

  for (const marker of portableMarkerCandidates({ exeDir, platform })) {
    if (exists(marker)) return { mode: "marker", dir: path.join(path.dirname(marker), PORTABLE_DATA_DIR), marker };
  }

  return { mode: "user", dir: userDataDir, marker: null };
}

/** macOS keeps the executable inside the .app bundle; every other platform is flat. */
function executableDir(appDir) {
  const bundle = fs.readdirSync(appDir).find((name) => name.endsWith(".app"));
  if (!bundle) return appDir;
  return path.join(appDir, bundle, "Contents", "MacOS");
}

/** Read the first bytes of a file, or null when it cannot be read. */
function readHeader(file, length) {
  let handle;
  try {
    handle = fs.openSync(file, "r");
    const header = Buffer.alloc(length);
    fs.readSync(handle, header, 0, length, 0);
    return header;
  } catch {
    return null;
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
}

/**
 * Read the target architecture from a packaged executable's header.
 *
 * electron-builder drops the arch segment from the output folder when it matches
 * the host (`--x64` on an arm64 runner still writes `linux-unpacked`), so the
 * binary is the only local source of truth. `WEBPI_PORTABLE_ARCH` overrides it
 * for cross-built trees, where the header describes the target but the folder
 * name may not.
 */
function archFromBinary(appDir, { env = process.env, platform = process.platform } = {}) {
  const override = nonEmpty(env[ARCH_OVERRIDE_ENV]);
  if (override) return override;

  let dir;
  try {
    dir = executableDir(appDir);
  } catch {
    return "x64";
  }

  const candidates = platform === "win32"
    ? ["WebPi.exe"]
    : ["WebPi", "WebPi Helper", "WebPi Helper (Renderer)"];
  for (const candidate of candidates) {
    const header = readHeader(path.join(dir, candidate), 64);
    if (!header) continue;
    // ELF: e_machine at 18, 0xb7 = AArch64.
    if (header.readUInt32LE(0) === 0x464c457f) return header.readUInt16LE(18) === 0xb7 ? "arm64" : "x64";
    // Mach-O: cputype at 4, 0x0100000c = arm64.
    if (header.readUInt32LE(0) === 0xfeedfacf || header.readUInt32LE(0) === 0xcffaedfe) {
      return header.readUInt32LE(4) === 0x0100000c ? "arm64" : "x64";
    }
    // PE/COFF: machine at e_lfanew + 4, 0xaa64 = ARM64.
    if (header[0] === 0x4d && header[1] === 0x5a) {
      const machine = readHeader(path.join(dir, candidate), header.readUInt32LE(0x3c) + 6);
      if (!machine) continue;
      return machine.readUInt16LE(machine.length - 2) === 0xaa64 ? "arm64" : "x64";
    }
  }
  return "x64";
}

/**
 * Name a portable archive from an electron-builder output folder.
 *
 * A folder carrying `-arm64`/`-ia32`/`-x64` is authoritative; a suffix-less one
 * (`linux-unpacked`, `mac`, `win-unpacked`) falls back to the binary header.
 */
function platformLabel(appDir, options = {}) {
  const base = path.basename(appDir).replace(/-unpacked$/, "");
  const os = base.startsWith("win") ? "win" : base.startsWith("linux") ? "linux" : "mac";
  for (const arch of ["arm64", "ia32", "x64"]) {
    if (base.endsWith(`-${arch}`)) return `${os}-${arch}`;
  }
  return `${os}-${archFromBinary(appDir, options)}`;
}

module.exports = {
  ARCH_OVERRIDE_ENV,
  PORTABLE_DATA_DIR,
  PORTABLE_MARKER,
  archFromBinary,
  executableDir,
  platformLabel,
  portableMarkerCandidates,
  resolveDataDir,
};
