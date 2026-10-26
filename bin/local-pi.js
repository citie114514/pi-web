"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS launcher module, like the rest of bin/ */

// Where the locally installed pi lives, and which one to prefer.
//
// The desktop app ships its own copy of `@earendil-works/pi-*` inside the
// package, but the operator's machine usually has pi installed too — and the
// extensions under `~/.pi/agent/extensions` were written against that install.
// Those extensions `require("@earendil-works/pi-tui")` and friends, which fails
// when the request is resolved from the extension's own folder (it has no
// node_modules of its own).
//
// So: prefer the local install, fall back to the bundled copy. Nothing here
// touches Electron, so the decisions can be unit tested.

const fs = require("node:fs");
const path = require("node:path");

const PI_PACKAGE = "@earendil-works/pi-coding-agent";
const PI_SCOPE = "@earendil-works/";

// Captured before anyone patches it: resolving the local install must not go
// back through the hook (that would recurse into this very function).
const nativeResolveFilename = require("node:module")._resolveFilename;

function isSafeVersion(value) {
  // Same guard pi-launcher.js uses: the version becomes a path segment.
  return typeof value === "string" && /^[0-9A-Za-z._+-]+$/.test(value) && value !== "." && value !== "..";
}

/** The pi agent directory: `PI_CODING_AGENT_DIR`, else `~/.pi/agent`. */
function defaultAgentDir({ env = process.env } = {}) {
  const configured = env.PI_CODING_AGENT_DIR?.trim();
  if (configured) return configured;
  const home = env.USERPROFILE?.trim() || env.HOME?.trim();
  return home ? path.join(home, ".pi", "agent") : null;
}

/** The managed install root (`<agent>/install`), or null when pi is not installed. */
function localPiInstallRoot({ agentDir } = {}) {
  if (!agentDir) return null;
  const installRoot = path.join(agentDir, "install");
  return fs.existsSync(path.join(installRoot, "current-version")) ? installRoot : null;
}

/**
 * node_modules directory of the local pi install, or null.
 *
 * `PI_MANAGED_INSTALL_ROOT` wins when set (that is what the pi launcher passes
 * to its own child), so an app started from inside a pi session follows the
 * same install.
 */
function localPiNodeModules({ env = process.env, agentDir = defaultAgentDir({ env }) } = {}) {
  const managed = env.PI_MANAGED_INSTALL_ROOT?.trim();
  if (managed) {
    const nodeModules = path.join(managed, "releases", env.PI_MANAGED_INSTALL_VERSION?.trim() ?? "", "node_modules");
    // The version is part of the path only when it is known; otherwise the
    // caller passes the resolved release directory directly.
    if (env.PI_MANAGED_INSTALL_VERSION && fs.existsSync(path.join(nodeModules, ...PI_PACKAGE.split("/")))) {
      return nodeModules;
    }
    const releases = path.join(managed, "releases");
    const current = readCurrentVersion(managed);
    if (current) {
      const candidate = path.join(releases, current, "node_modules");
      if (fs.existsSync(path.join(candidate, ...PI_PACKAGE.split("/")))) return candidate;
    }
  }

  const installRoot = localPiInstallRoot({ agentDir });
  if (!installRoot) return null;
  const current = readCurrentVersion(installRoot);
  if (!current) return null;
  const candidate = path.join(installRoot, "releases", current, "node_modules");
  return fs.existsSync(path.join(candidate, ...PI_PACKAGE.split("/"))) ? candidate : null;
}

function readCurrentVersion(installRoot) {
  try {
    const version = fs.readFileSync(path.join(installRoot, "current-version"), "utf8").trim();
    return isSafeVersion(version) ? version : null;
  } catch {
    return null;
  }
}

/** Version of the pi package inside a node_modules directory, or null. */
function piVersionAt(nodeModules) {
  if (!nodeModules) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(nodeModules, ...PI_PACKAGE.split("/"), "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a `@earendil-works/*` request against the local install first.
 *
 * @returns {string | null} the file the local install would load, or null when
 *   this request is not a pi package, the local install has no such entry, or
 *   the local install is missing entirely (the caller then falls back to the
 *   normal resolution, which finds the bundled copy).
 */
function resolveFromLocal(request, { nodeModules, exists = fs.existsSync } = {}) {
  if (!nodeModules || typeof request !== "string" || !request.startsWith(PI_SCOPE)) return null;
  // Use Node's own algorithm (so "main" and "exports" maps are honoured) with a
  // synthetic parent that lives in the local install, and the pristine resolver
  // so a patch installed by the hook cannot recurse back here.
  try {
    const parent = new (require("node:module"))(`${nodeModules}${path.sep}__webpi_resolve__.js`);
    parent.filename = `${nodeModules}${path.sep}__webpi_resolve__.js`;
    parent.paths = [nodeModules];
    return nativeResolveFilename.call(require("node:module"), request, parent, false);
  } catch {
    // No CJS entry point: the package may be ESM-only (an "exports" map with
    // just the "import" condition), in which case CJS resolution cannot match
    // it. Read the package's own entry field instead of handing the loader a
    // directory, which it could not load.
    const entry = packageEntry(nodeModules, request);
    if (entry) return entry;
    const candidate = path.join(nodeModules, ...request.split("/"));
    return exists(candidate) ? candidate : null;
  }
}

/** The entry file a package declares in its own package.json, or null. */
function packageEntry(nodeModules, request) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(nodeModules, ...request.split("/"), "package.json"), "utf8"));
  } catch {
    return null;
  }

  const root = pkg?.exports?.["."];
  const declared =
    (typeof root === "string" ? root : root?.import ?? root?.default ?? root?.require) ?? pkg.main ?? pkg.module ?? "index.js";
  if (typeof declared !== "string") return null;

  const file = path.resolve(path.join(nodeModules, ...request.split("/")), declared);
  try {
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

module.exports = {
  PI_PACKAGE,
  PI_SCOPE,
  defaultAgentDir,
  localPiInstallRoot,
  localPiNodeModules,
  piVersionAt,
  readCurrentVersion,
  resolveFromLocal,
};
