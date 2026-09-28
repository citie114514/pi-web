"use strict";

// Startup port selection for the `webpi` launcher.
//
// Before delegating to `next start`, the launcher checks the requested port so
// an out-of-the-box `webpi` call never dies with a raw EADDRINUSE:
//   - a healthy WebPi server on that port is reused instead of duplicated;
//   - a port owned by an unrelated process is skipped, up to MAX_PORT_ATTEMPTS;
//   - `--port 0` asks the operating system for a free port.
//
// "Is it free?" is answered by actually binding the port, not by interpreting
// connection errors: undici reports a closed loopback port as UND_ERR_SOCKET on
// Windows rather than ECONNREFUSED, so error-code matching silently classified
// every free port as busy. Only when the bind fails do we ask HTTP whether the
// owner is a WebPi server worth reusing.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const net = require("node:net");

const MAX_PORT_ATTEMPTS = 10;
const PROBE_TIMEOUT_MS = 700;
const MAX_PORT = 65535;

function webPiProbeUrl(host, port) {
  return `http://${host}:${port}/api/app-update`;
}

/**
 * Bind the port to find out whether anything already owns it.
 *
 * @returns {Promise<boolean>} true when the port can be bound right now.
 */
function canBind(host, port, { createServer = net.createServer } = {}) {
  return new Promise((resolve) => {
    const server = createServer();
    const done = (bindable) => {
      server.removeAllListeners("error");
      server.removeAllListeners("listening");
      resolve(bindable);
    };

    server.once("error", () => done(false));
    server.once("listening", () => {
      // Close before reporting so the launcher can bind it again.
      server.close(() => done(true));
    });
    server.listen(port, host);
  });
}

/**
 * Classify `host:port`.
 *
 * @returns {Promise<"free" | "webpi" | "busy">}
 *   "free"  - nothing owns the port, it can be bound;
 *   "webpi" - a WebPi server answers its own update endpoint;
 *   "busy"  - something else owns the port.
 */
async function probePort(host, port, { fetchImpl = globalThis.fetch, bindable = canBind } = {}) {
  if (await bindable(host, port)) return "free";

  try {
    const response = await fetchImpl(webPiProbeUrl(host, port), {
      cache: "no-store",
      headers: { Accept: "application/json" },
      // A busy port that accepts connections but never answers is not ours.
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // 200 is the normal answer; 401 means PI_WEB_PASSWORD is enabled, which is
    // still WebPi. Anything else is not ours to reuse.
    return response.status === 200 || response.status === 401 ? "webpi" : "busy";
  } catch {
    return "busy";
  }
}

/**
 * Walk from `port` upward until a usable port is found.
 *
 * @returns {Promise<{ port: string, alreadyRunning: boolean } | null>}
 *   `alreadyRunning` means a WebPi server already serves that port, so the
 *   caller should reuse it instead of starting a second server.
 */
async function resolveStartPort({
  host,
  port,
  maxAttempts = MAX_PORT_ATTEMPTS,
  probe = probePort,
} = {}) {
  const start = Number(port);
  if (!Number.isSafeInteger(start) || start < 0 || start > MAX_PORT) {
    throw new Error(`Port must be between 0 and ${MAX_PORT}.`);
  }

  const lastPort = Math.min(start + maxAttempts - 1, MAX_PORT);
  for (let candidate = start; candidate <= lastPort; candidate += 1) {
    const state = await probe(host, candidate);
    if (state === "free") return { port: String(candidate), alreadyRunning: false };
    if (state === "webpi") return { port: String(candidate), alreadyRunning: true };
  }

  return null;
}

/** Ask the operating system for a currently free port (used by `--port 0`). */
function findFreePort(host, { createServer = net.createServer } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(String(port)) : reject(new Error("Could not obtain a free port."))));
    });
  });
}

module.exports = {
  MAX_PORT_ATTEMPTS,
  PROBE_TIMEOUT_MS,
  canBind,
  findFreePort,
  probePort,
  resolveStartPort,
  webPiProbeUrl,
};
