#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getUnsupportedNodeVersionMessage, isNodeVersionSupported } = require("./node-version");

if (!isNodeVersionSupported(process.versions.node)) {
  console.error(getUnsupportedNodeVersionMessage(process.versions.node));
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getHelpText, parseLaunchOptions } = require("./pi-web-options");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getNextNodeArgs } = require("./pi-web-node-args");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { wireChildProcessLifecycle } = require("./process-lifecycle");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findFreePort, resolveStartPort, MAX_PORT_ATTEMPTS } = require("./port-selection");

let launchOptions;
try {
  launchOptions = parseLaunchOptions();
} catch (error) {
  fs.writeSync(
    process.stderr.fd,
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

if (launchOptions.help) {
  fs.writeSync(process.stdout.fd, getHelpText());
  process.exit(0);
}

const { hostname, openBrowser } = launchOptions;

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

const loopbackHostnames = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const passwordEnabled = Boolean(process.env.PI_WEB_PASSWORD);

if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Please report this issue.");
  process.exit(1);
}

function warnAboutRemoteBinding() {
  if (loopbackHostnames.has(hostname)) return;

  if (passwordEnabled) {
    console.warn(
      `Warning: webpi is listening on ${hostname} with password authentication over HTTP. Use HTTPS or a trusted VPN to protect the password in transit.`,
    );
  } else {
    console.warn(
      `Warning: webpi is listening on ${hostname} without authentication. Only use this on a trusted network.`,
    );
  }
}

function openBrowserAt(url) {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  // Avoid `shell: true` to suppress Node.js DEP0190 deprecation
  // ("Passing args to a child process with shell option true can lead to
  // security vulnerabilities, as the arguments are not escaped").
  // Pass a structured argv so Node.js handles escaping instead of
  // concatenating the args into a shell command string.
  let opener;
  if (isWindows) {
    // `start` is a cmd.exe built-in, so invoke cmd directly. The empty
    // title argument is required by `start` before the target URL.
    opener = spawn(process.env.ComSpec || "cmd.exe", ["/c", "start", "", url], {
      stdio: "ignore",
      detached: true,
    });
  } else if (isMac) {
    opener = spawn("open", [url], {
      stdio: "ignore",
      detached: true,
    });
  } else {
    opener = spawn("xdg-open", [url], {
      stdio: "ignore",
      detached: true,
    });
  }

  opener.on("error", (error) => {
    console.warn(`Could not open browser automatically: ${error.message}`);
  });

  opener.unref();
}

// `WebPi is already running at <url>` / `WebPi ready at <url>` are a contract:
// the bundled /webpi Pi extension parses this line to report the real URL.
async function main() {
  const requestedPort = launchOptions.port;
  const targetPort = requestedPort === "0" ? await findFreePort(hostname) : requestedPort;

  let resolved;
  try {
    resolved = await resolveStartPort({ host: hostname, port: targetPort });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  if (!resolved) {
    console.error(
      `No usable port found after ${MAX_PORT_ATTEMPTS} attempts starting at ${targetPort}. Stop the process using it, or pass --port <port> where <port> is a free port Next.js also accepts.`,
    );
    process.exit(1);
  }

  const url = `http://${hostname}:${resolved.port}`;

  if (resolved.alreadyRunning) {
    console.log(`WebPi is already running at ${url}`);
    console.log("Stop it first, or pass --port <port> to run another instance.");
    if (openBrowser) openBrowserAt(url);
    return;
  }

  if (resolved.port !== targetPort) {
    console.warn(`Port ${targetPort} is in use; starting WebPi on ${resolved.port} instead.`);
  }

  warnAboutRemoteBinding();

  const nextArgs = ["start", "-p", resolved.port];
  nextArgs.push("-H", hostname);

  // Always run next's JS entry with node directly — avoids .bin symlink issues
  // and path-with-spaces problems on Windows when shell: true is used.
  const child = spawn(process.execPath, getNextNodeArgs(nextBin, nextArgs), {
    cwd: pkgDir,
    stdio: ["inherit", "pipe", "inherit"],
    env: { ...process.env, PI_WEB_HOSTNAME: hostname },
  });
  wireChildProcessLifecycle(child);

  let browserOpened = false;
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    process.stdout.write(text);
    if (!browserOpened && text.includes("Ready")) {
      browserOpened = true;
      // Contract line for the bundled /webpi extension (see above).
      console.log(`WebPi ready at ${url}`);
      if (openBrowser) openBrowserAt(url);
    }
  });
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
