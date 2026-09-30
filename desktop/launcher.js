"use strict";

// How the desktop shell starts the WebPi service.
//
// The shell never reimplements the server: it runs the same `bin/pi-web.js`
// launcher the CLI and the /webpi command use, so port selection, reuse
// detection and the readiness contract line stay in one place. The only extra
// piece here is the runtime: a packaged app ships Electron, so it runs the
// launcher with Electron's bundled Node (ELECTRON_RUN_AS_NODE=1) instead of
// requiring a separate Node.js installation.

const path = require("node:path");

/** The launcher's readiness contract line, shared with the /webpi extension. */
const READY_PATTERN = /WebPi (is already running|ready) at (\S+)/;

function resolveCliPath(dir = __dirname) {
  return path.join(dir, "..", "bin", "pi-web.js");
}

/**
 * Parse a launcher output chunk.
 *
 * @returns {{ url: string, owned: boolean } | null} `owned` is false when an
 *   existing WebPi server answered instead of one this process started.
 */
function parseReadyLine(text) {
  const match = READY_PATTERN.exec(text);
  if (!match) return null;
  return { url: match[2], owned: match[1] === "ready" };
}

function buildLaunchCommand({
  cliPath = resolveCliPath(),
  port = process.env.WEBPI_DESKTOP_PORT || "30141",
  hostname = process.env.WEBPI_DESKTOP_HOST || "127.0.0.1",
  execPath = process.execPath,
  electron = Boolean(process.versions.electron),
  env = process.env,
  platform = process.platform,
} = {}) {
  const childEnv = { ...env };
  const override = typeof env.WEBPI_NODE === "string" && env.WEBPI_NODE.trim() !== "" ? env.WEBPI_NODE.trim() : null;

  // A packaged app has no `node` on PATH; Electron's binary is the runtime. The
  // bundled runtime is verified to work with the server (including node-pty
  // shells), and WEBPI_NODE overrides it when a specific Node.js is wanted.
  if (!override && electron) childEnv.ELECTRON_RUN_AS_NODE = "1";

  return {
    command: override ?? execPath,
    args: [cliPath, "--port", String(port), "--hostname", hostname, "--no-open"],
    env: childEnv,
    // Own process group on POSIX so the supervisor can stop the whole tree.
    detached: platform !== "win32",
  };
}

/** Command that terminates a launcher and everything it started. */
function buildKillCommand(pid, { platform = process.platform, force = false } = {}) {
  if (platform === "win32") {
    return { command: "taskkill", args: ["/pid", String(pid), "/T", ...(force ? ["/F"] : [])] };
  }
  return { signal: force ? "SIGKILL" : "SIGTERM", pid: -pid };
}

module.exports = {
  READY_PATTERN,
  buildKillCommand,
  buildLaunchCommand,
  parseReadyLine,
  resolveCliPath,
};
