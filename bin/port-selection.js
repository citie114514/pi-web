"use strict";

// Startup port selection for the `webpi` launcher.
//
// Before delegating to `next start`, the launcher checks the requested port so
// an out-of-the-box `webpi` call never dies with a raw EADDRINUSE:
//   - a healthy WebPi server on that port is reused instead of duplicated;
//   - a port owned by an unrelated process is skipped, up to MAX_PORT_ATTEMPTS;
//   - a port Next.js blocks (the fetch-spec reserved list) is skipped as well,
//     because the OS hands those out for `--port 0` on some machines;
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
const IDENTITY_BYTES = 4096;
const IDENTITY_MARKER = /WebPi/i;

// Ports the WHATWG fetch spec blocks and Next.js refuses to serve on, copied
// from next/dist/lib/helpers/get-reserved-port so this launcher stays
// dependency-free. lib/port-selection.test.mjs asserts the two lists match.
const RESERVED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6697, 10080,
]);

/** Next.js refuses these ports, so the OS handing one out is not usable. */
function isReservedPort(port) {
  return RESERVED_PORTS.has(Number(port));
}

function webPiProbeUrl(host, port) {
  return `http://${host}:${port}/api/app-update`;
}

function webPiIdentityUrl(host, port) {
  return `http://${host}:${port}/`;
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
 * @returns {Promise<"free" | "webpi" | "busy" | "reserved">}
 *   "free"     - nothing owns the port, it can be bound;
 *   "webpi"    - a WebPi server answers its own update endpoint;
 *   "busy"     - something else owns the port;
 *   "reserved" - Next.js blocks the port, so it must be skipped even when free.
 */
async function probePort(host, port, { fetchImpl = globalThis.fetch, bindable = canBind } = {}) {
  if (isReservedPort(port)) return "reserved";
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
    if (response.status === 200 || response.status === 401) return "webpi";
  } catch {
    // Fall through to the identity probe below.
  }

  // The update endpoint reaches the npm registry, so it can answer 502 (or
  // time out) while the server itself is perfectly healthy. Identify the app by
  // its own page instead, and only then treat the port as reusable.
  try {
    return (await servesWebPiIdentity(host, port, fetchImpl)) ? "webpi" : "busy";
  } catch {
    return "busy";
  }
}

async function servesWebPiIdentity(host, port, fetchImpl, { bytes = IDENTITY_BYTES } = {}) {
  const response = await fetchImpl(webPiIdentityUrl(host, port), {
    cache: "no-store",
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!response.ok) return false;
  const body = await response.text();
  // The title/brand lives in the head, so a prefix is enough and a huge page
  // cannot dominate the probe.
  return IDENTITY_MARKER.test(body.slice(0, bytes));
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

function listenOnFreePort(host, createServer) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("Could not obtain a free port."))));
    });
  });
}

/** Ask the operating system for a free port the server can actually bind. */
async function findFreePort(host, { createServer = net.createServer, attempts = MAX_PORT_ATTEMPTS } = {}) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await listenOnFreePort(host, createServer);
    if (!isReservedPort(last)) return String(last);
  }

  throw new Error(`The operating system only offered reserved ports (last: ${last}).`);
}

module.exports = {
  IDENTITY_BYTES,
  MAX_PORT_ATTEMPTS,
  PROBE_TIMEOUT_MS,
  RESERVED_PORTS,
  canBind,
  findFreePort,
  isReservedPort,
  probePort,
  resolveStartPort,
  servesWebPiIdentity,
  webPiIdentityUrl,
  webPiProbeUrl,
};
