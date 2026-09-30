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

module.exports = {
  PORTABLE_DATA_DIR,
  PORTABLE_MARKER,
  portableMarkerCandidates,
  resolveDataDir,
};
