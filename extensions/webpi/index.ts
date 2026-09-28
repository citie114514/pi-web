import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * WebPi is the browser UI for pi. This extension only adds the `/webpi`
 * command: it starts (or finds) the local WebPi server that ships in the same
 * package and reports the URL in the TUI.
 *
 * The launcher stays the single owner of port selection and of the Next.js
 * process, so the command forwards its arguments verbatim instead of
 * reimplementing any of that. The launcher prints exactly one contract line
 * once it knows the real URL:
 *
 *   WebPi ready at http://127.0.0.1:30141
 *   WebPi is already running at http://127.0.0.1:30141
 *
 * and that line is what this extension reports.
 */

const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_PORT = "30141";
const READY_TIMEOUT_MS = 45_000;
const READY_PATTERN = /WebPi (?:is already running|ready) at (\S+)/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "pi-web.js");

// The launcher is a Node.js script, so it needs a Node.js runtime even when pi
// itself is a compiled binary (bun) whose execPath is not node.
function nodeExecutable(): string {
  return process.versions.bun ? "node" : process.execPath;
}

function tokenize(args: string): string[] {
  return args.replace(CONTROL_CHARS, " ").trim().split(/\s+/).filter(Boolean);
}

/** Best-effort URL used when the launcher never prints its contract line. */
function fallbackUrl(tokens: string[]): string {
  let port = process.env.PORT || DEFAULT_PORT;
  let hostname = process.env.PI_WEB_HOSTNAME || DEFAULT_HOSTNAME;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "-p" || token === "--port") {
      const value = tokens[index + 1];
      if (value && /^\d+$/.test(value)) port = value;
    } else if (token.startsWith("--port=") && /^\d+$/.test(token.slice("--port=".length))) {
      port = token.slice("--port=".length);
    } else if (token === "-H" || token === "--hostname") {
      const value = tokens[index + 1];
      if (value) hostname = value;
    } else if (token.startsWith("--hostname=")) {
      hostname = token.slice("--hostname=".length);
    }
  }
  return `http://${hostname}:${port}`;
}

export default function webpiExtension(pi: ExtensionAPI) {
  let launcher: ChildProcess | undefined;

  /**
   * Kill the launcher *and* the Next.js process it owns. Killing the launcher
   * alone would leave the server holding the port, so POSIX runs the launcher
   * in its own process group and Windows uses `taskkill /T`.
   */
  function stopServer(): void {
    const child = launcher;
    launcher = undefined;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;

    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => child.kill());
      return;
    }

    try {
      // Negative pid targets the detached child's process group.
      process.kill(-child.pid!, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }

  pi.on("session_shutdown", stopServer);

  pi.registerCommand("webpi", {
    description: "Start the WebPi browser UI",
    handler: async (args, ctx) => {
      if (launcher && launcher.exitCode === null && launcher.signalCode === null) {
        ctx.ui.notify("WebPi is already running from this session.", "info");
        return;
      }

      const tokens = tokenize(args);
      const estimatedUrl = fallbackUrl(tokens);

      const started = await startLauncher(tokens);
      if (!started.ok) {
        ctx.ui.notify(`WebPi could not start: ${started.error}`, "error");
        return;
      }

      if (started.url) {
        ctx.ui.notify(`WebPi: ${started.url}`, "info");
        return;
      }

      ctx.ui.notify(
        `WebPi is still starting; open ${estimatedUrl} once it is ready.`,
        "warning",
      );
    },
  });

  function startLauncher(tokens: string[]): Promise<{ ok: true; url?: string } | { ok: false; error: string }> {
    return new Promise((resolve) => {
      let child: ChildProcess | undefined;
      let settled = false;
      let output = "";

      function finish(result: { ok: true; url?: string } | { ok: false; error: string }): void {
        if (settled) return;
        settled = true;
        clearTimeout(readiness);
        resolve(result);
      }

      // A launcher that never reports readiness must not hang the TUI command.
      const readiness = setTimeout(() => {
        // Keep the handle so session_shutdown can stop a slow-starting server.
        if (child && child.exitCode === null && child.signalCode === null) launcher = child;
        finish({ ok: true });
      }, READY_TIMEOUT_MS);

      try {
        child = spawn(nodeExecutable(), [CLI_PATH, ...tokens], {
          cwd: process.cwd(),
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
          // Own process group on POSIX so stopServer() can kill the tree.
          detached: process.platform !== "win32",
        });
      } catch (error) {
        clearTimeout(readiness);
        resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
        return;
      }

      const launcherProcess = child;

      const consume = (chunk: Buffer) => {
        output = `${output}${chunk.toString()}`.slice(-4000);
        const match = READY_PATTERN.exec(output);
        if (!match) return;
        // A server owned by this session keeps the launcher alive; one that was
        // already running exits cleanly after reporting its URL.
        launcher = launcherProcess.exitCode === null && launcherProcess.signalCode === null
          ? launcherProcess
          : undefined;
        finish({ ok: true, url: match[1] });
      };

      launcherProcess.stdout?.on("data", consume);
      launcherProcess.stderr?.on("data", consume);

      launcherProcess.on("error", (error) => {
        finish({ ok: false, error: error.message });
      });

      launcherProcess.on("exit", (code, signal) => {
        const tail = output.trim().split("\n").slice(-3).join(" ").trim();
        finish({
          ok: false,
          error: tail || `the WebPi launcher exited (${signal ? `signal ${signal}` : `code ${code}`})`,
        });
      });
    });
  }
}
