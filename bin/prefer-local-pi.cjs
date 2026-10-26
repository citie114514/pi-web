"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS preload hook, like the rest of bin/ */

// Prefer the machine's pi over the copy bundled in the desktop package.
//
// Loaded with `--require` (see bin/pi-web.js) so it runs before any server code.
// Requests for `@earendil-works/*` resolve against the local pi install first —
// which is what the extensions under `~/.pi/agent/extensions` expect — and fall
// back to the bundled copy when the local install is missing, older, or simply
// does not contain the requested entry point.
//
// The hook must never break the app: every path here is guarded, and any
// failure leaves Node's own resolution untouched.

const Module = require("node:module");

const { localPiNodeModules, piVersionAt, resolveFromLocal } = require("./local-pi.js");

function install({ env = process.env, nodeModules, log = () => {} } = {}) {
  const local = nodeModules ?? localPiNodeModules({ env });
  if (!local) {
    log("pi: using the bundled copy (no local pi install found)");
    return { nodeModules: null, version: null };
  }

  const original = Module._resolveFilename;
  const used = new Set();

  Module._resolveFilename = function preferLocalPi(request, ...rest) {
    const resolved = resolveFromLocal(request, { nodeModules: local });
    if (resolved) {
      if (!used.has(request)) {
        used.add(request);
        log(`pi: ${request} -> ${resolved}`);
      }
      return resolved;
    }
    return original.call(this, request, ...rest);
  };

  const version = piVersionAt(local);
  log(`pi: preferring the local install (${version ?? "unknown version"}) at ${local}`);
  return { nodeModules: local, version };
}

module.exports = { install };

// `--require` loads this module for its side effect.
if (require.main === module || !module.parent) {
  // Direct execution: report what would be preferred, without patching.
  const local = localPiNodeModules({ env: process.env });
  process.stdout.write(
    local
      ? `pi: local install ${piVersionAt(local) ?? "unknown"} at ${local}\n`
      : "pi: no local install; the bundled copy would be used\n",
  );
} else {
  const file = process.env.WEBPI_PI_HOOK_LOG?.trim();
  const write = (line) => {
    if (!file) {
      process.stderr.write(`${line}\n`);
      return;
    }
    try {
      require("node:fs").appendFileSync(file, `${line}\n`);
    } catch {
      // 写日志失败不能影响启动
    }
  };
  install({ log: write });
}
