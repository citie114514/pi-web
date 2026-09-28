import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  MAX_PORT_ATTEMPTS,
  canBind,
  findFreePort,
  probePort,
  resolveStartPort,
  webPiProbeUrl,
} = require("../bin/port-selection.js");

/** probe stub that answers from a port -> state map and records the walk. */
function stubProbe(states) {
  const visited = [];
  return {
    visited,
    probe: async (_host, port) => {
      visited.push(port);
      const state = states[port];
      if (!state) throw new Error(`unexpected probe of port ${port}`);
      return state;
    },
  };
}

/** net.createServer stub: `bound` decides whether listening succeeds. */
function stubCreateServer(bound) {
  const closed = [];
  const createServer = () => {
    const handlers = new Map();
    return {
      once: (event, handler) => handlers.set(event, handler),
      removeAllListeners: () => handlers.clear(),
      listen: () => {
        if (bound) handlers.get("listening")?.();
        else handlers.get("error")?.(Object.assign(new Error("EADDRINUSE"), { code: "EADDRINUSE" }));
      },
      close: (callback) => {
        closed.push(true);
        callback();
      },
    };
  };
  return { createServer, closed };
}

test("a free requested port is used as-is", async () => {
  const { probe, visited } = stubProbe({ 30141: "free" });
  assert.deepEqual(await resolveStartPort({ host: "127.0.0.1", port: "30141", probe }), {
    port: "30141",
    alreadyRunning: false,
  });
  assert.deepEqual(visited, [30141]);
});

test("an existing WebPi server is reused instead of duplicated", async () => {
  const { probe } = stubProbe({ 30141: "webpi" });
  assert.deepEqual(await resolveStartPort({ host: "127.0.0.1", port: "30141", probe }), {
    port: "30141",
    alreadyRunning: true,
  });
});

test("a port owned by an unrelated process is skipped", async () => {
  const { probe, visited } = stubProbe({ 30141: "busy", 30142: "busy", 30143: "free" });
  assert.deepEqual(await resolveStartPort({ host: "127.0.0.1", port: "30141", probe }), {
    port: "30143",
    alreadyRunning: false,
  });
  assert.deepEqual(visited, [30141, 30142, 30143]);
});

test("a WebPi server found after skipping busy ports is reused", async () => {
  const { probe } = stubProbe({ 30141: "busy", 30142: "webpi" });
  assert.deepEqual(await resolveStartPort({ host: "127.0.0.1", port: "30141", probe }), {
    port: "30142",
    alreadyRunning: true,
  });
});

test("gives up after the attempt limit instead of scanning every port", async () => {
  const states = {};
  for (let port = 40000; port < 40000 + MAX_PORT_ATTEMPTS + 5; port += 1) states[port] = "busy";
  const { probe, visited } = stubProbe(states);

  assert.equal(await resolveStartPort({ host: "127.0.0.1", port: "40000", probe }), null);
  assert.equal(visited.length, MAX_PORT_ATTEMPTS);
});

test("never walks past the highest possible port", async () => {
  const { probe, visited } = stubProbe({ 65535: "busy" });
  assert.equal(await resolveStartPort({ host: "127.0.0.1", port: "65535", probe }), null);
  assert.deepEqual(visited, [65535]);
});

test("rejects out-of-range request ports", async () => {
  for (const port of ["-1", "65536", "abc", "1.5"]) {
    await assert.rejects(() => resolveStartPort({ host: "127.0.0.1", port }), /Port must be between/);
  }
});

test("canBind reports a bindable port and releases it immediately", async () => {
  const { createServer, closed } = stubCreateServer(true);
  assert.equal(await canBind("127.0.0.1", 30141, { createServer }), true);
  assert.deepEqual(closed, [true], "the probe must not hold the port");
});

test("canBind reports a port that is already owned", async () => {
  const { createServer } = stubCreateServer(false);
  assert.equal(await canBind("127.0.0.1", 30141, { createServer }), false);
});

test("probe reuses a WebPi server that owns the port", async () => {
  for (const status of [200, 401]) {
    const state = await probePort("127.0.0.1", 30141, {
      bindable: async () => false,
      fetchImpl: async () => new Response("{}", { status }),
    });
    assert.equal(state, "webpi", `status ${status}`);
  }
});

test("probe treats a foreign owner as busy instead of reusing it", async () => {
  for (const status of [404, 500, 302]) {
    const state = await probePort("127.0.0.1", 30141, {
      bindable: async () => false,
      fetchImpl: async () => new Response("", { status }),
    });
    assert.equal(state, "busy", `status ${status}`);
  }
});

test("probe treats a silent listener as busy", async () => {
  const timeout = Object.assign(new Error("the operation was aborted due to timeout"), { name: "TimeoutError" });
  const state = await probePort("127.0.0.1", 30141, {
    bindable: async () => false,
    fetchImpl: async () => { throw timeout; },
  });
  assert.equal(state, "busy");
});

test("probe skips HTTP entirely when the port is bindable", async () => {
  let fetched = false;
  const state = await probePort("127.0.0.1", 30141, {
    bindable: async () => true,
    fetchImpl: async () => {
      fetched = true;
      return new Response("", { status: 200 });
    },
  });
  assert.equal(state, "free");
  assert.equal(fetched, false);
});

test("probe targets the app update endpoint", () => {
  assert.equal(webPiProbeUrl("127.0.0.1", "30141"), "http://127.0.0.1:30141/api/app-update");
});

test("findFreePort asks the operating system for a free port", async () => {
  const closed = [];
  const createServer = () => {
    const handlers = new Map();
    return {
      once: (event, handler) => handlers.set(event, handler),
      listen: (_port, _host, callback) => {
        handlers.set("listening", callback);
        callback();
      },
      address: () => ({ port: 49812 }),
      close: (callback) => {
        closed.push(true);
        callback();
      },
    };
  };

  assert.equal(await findFreePort("127.0.0.1", { createServer }), "49812");
  assert.deepEqual(closed, [true]);
});

test("findFreePort rejects when the server cannot listen", async () => {
  const failure = new Error("EADDRNOTAVAIL");
  const createServer = () => ({
    once: (event, handler) => {
      if (event === "error") handler(failure);
    },
    listen: () => {},
  });

  await assert.rejects(() => findFreePort("127.0.0.1", { createServer }), /EADDRNOTAVAIL/);
});
