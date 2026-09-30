"use strict";

// Owns the WebPi service process for the desktop shell: start it with the app,
// report its URL, and stop the whole process tree when the app quits.

const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { buildKillCommand, buildLaunchCommand, parseReadyLine } = require("./launcher");

const READY_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 8_000;
const FORCE_STOP_TIMEOUT_MS = 3_000;
const MAX_BUFFER = 16_384;
const MAX_LOG_LINES = 40;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class ServerSupervisor extends EventEmitter {
  #spawnImpl;
  #options;
  #child;
  #buffer = "";
  #log = [];
  #url;
  #owned = false;
  #expectedExit = false;
  #readyTimer;
  #startPromise;

  constructor(options = {}) {
    super();
    this.#options = options;
    this.#spawnImpl = options.spawnImpl ?? spawn;
  }

  get url() {
    return this.#url;
  }

  /** True when this app started the server, so quitting must stop it. */
  get owned() {
    return this.#owned;
  }

  get running() {
    return Boolean(this.#child && this.#child.exitCode === null && this.#child.signalCode === null);
  }

  logTail(lines = 8) {
    return this.#log.slice(-lines).join("\n");
  }

  /** Start the launcher, resolving once it reports a URL. */
  start(overrides = {}) {
    if (Object.keys(overrides).length > 0) this.#options = { ...this.#options, ...overrides };
    if (this.#startPromise) return this.#startPromise;

    this.#buffer = "";
    this.#log = [];
    this.#expectedExit = false;

    this.#startPromise = new Promise((resolve, reject) => {
      const { command, args, env, detached } = buildLaunchCommand(this.#options);
      this.#logLine(`[desktop] ${command} ${args.join(" ")}`);

      let child;
      try {
        child = this.#spawnImpl(command, args, {
          cwd: this.#options.cwd,
          env,
          detached,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        this.#startPromise = undefined;
        reject(toError(error));
        return;
      }

      this.#child = child;

      const settle = (call) => {
        clearTimeout(this.#readyTimer);
        call();
      };

      const consume = (chunk) => {
        const text = chunk.toString();
        this.#buffer = `${this.#buffer}${text}`.slice(-MAX_BUFFER);
        for (const line of text.split(/\r?\n/)) if (line.trim()) this.#logLine(line);

        if (this.#url) return;
        const ready = parseReadyLine(this.#buffer);
        if (!ready) return;

        this.#url = ready.url;
        this.#owned = ready.owned;
        // An existing server makes the launcher exit on its own; that is not a crash.
        this.#expectedExit = !ready.owned;
        const result = { url: ready.url, owned: ready.owned };
        settle(() => {
          this.emit("ready", result);
          resolve(result);
        });
      };

      child.stdout?.on("data", consume);
      child.stderr?.on("data", consume);

      child.on("error", (error) => {
        settle(() => {
          this.#startPromise = undefined;
          // Startup failures reject the start() promise; no "error" event is
          // emitted, so no listener is required to keep the process alive.
          reject(toError(error));
        });
      });

      child.on("exit", (code, signal) => {
        const expected = this.#expectedExit;
        const wasReady = Boolean(this.#url);
        this.#child = undefined;
        this.#startPromise = undefined;

        if (!wasReady) {
          const error = new Error(`WebPi 服务启动失败（${signal ? `信号 ${signal}` : `退出码 ${code}`}）\n${this.logTail()}`);
          settle(() => reject(error));
          return;
        }

        this.#url = undefined;
        settle(() => this.emit("exit", { code, signal, expected }));
      });

      this.#readyTimer = setTimeout(() => {
        const error = new Error(`WebPi 服务启动超时（${READY_TIMEOUT_MS / 1000} 秒）\n${this.logTail()}`);
        this.#startPromise = undefined;
        reject(error);
      }, this.#options.readyTimeoutMs ?? READY_TIMEOUT_MS);
    });

    return this.#startPromise;
  }

  /** Stop the launcher and the Next.js process it owns. */
  async stop() {
    clearTimeout(this.#readyTimer);
    const child = this.#child;
    this.#child = undefined;
    this.#url = undefined;
    this.#startPromise = undefined;
    this.#expectedExit = true;
    if (!child || child.exitCode !== null || child.signalCode !== null) return true;

    const ended = new Promise((resolve) => child.once("exit", resolve));
    this.#signal(child, false);
    await Promise.race([ended, delay(this.#options.stopTimeoutMs ?? STOP_TIMEOUT_MS)]);

    if (child.exitCode !== null || child.signalCode !== null) return true;

    this.#logLine("[desktop] 服务未在超时内退出，强制结束");
    this.#signal(child, true);
    await Promise.race([ended, delay(this.#options.forceStopTimeoutMs ?? FORCE_STOP_TIMEOUT_MS)]);
    return child.exitCode !== null || child.signalCode !== null;
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  #signal(child, force) {
    const command = buildKillCommand(child.pid, {
      platform: this.#options.platform ?? process.platform,
      force,
    });

    if (command.command) {
      try {
        this.#spawnImpl(command.command, command.args, { stdio: "ignore", windowsHide: true });
      } catch (error) {
        this.#logLine(`[desktop] 结束进程失败：${toError(error).message}`);
      }
      return;
    }

    try {
      if (command.pid < 0) process.kill(command.pid, command.signal);
      else child.kill(command.signal);
    } catch (error) {
      this.#logLine(`[desktop] 结束进程失败：${toError(error).message}`);
    }
  }

  #logLine(line) {
    this.#log.push(line);
    if (this.#log.length > MAX_LOG_LINES) this.#log.shift();
  }
}

function toError(value) {
  return value instanceof Error ? value : new Error(String(value));
}

module.exports = { MAX_LOG_LINES, READY_TIMEOUT_MS, ServerSupervisor };
