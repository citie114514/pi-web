import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  IDENTITY_BYTES,
  MAX_PORT_ATTEMPTS,
  RESERVED_PORTS,
  canBind,
  findFreePort,
  isReservedPort,
  probePort,
  resolveStartPort,
  servesWebPiIdentity,
  webPiIdentityUrl,
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

test("probe recognises WebPi even when its update endpoint fails", async () => {
  // /api/app-update reaches the npm registry and can answer 502 while the app
  // itself is healthy; the page identity is what decides reuse.
  const state = await probePort("127.0.0.1", 30141, {
    bindable: async () => false,
    fetchImpl: async (url) => {
      if (String(url).includes("app-update")) return new Response("", { status: 502 });
      return new Response("<!doctype html><html><head><title>WebPi</title></head></html>", { status: 200 });
    },
  });
  assert.equal(state, "webpi");
});

test("probe never reuses a foreign server that happens to answer", async () => {
  const state = await probePort("127.0.0.1", 30141, {
    bindable: async () => false,
    fetchImpl: async (url) => {
      if (String(url).includes("app-update")) return new Response("", { status: 502 });
      return new Response("<!doctype html><title>Some other dashboard</title>", { status: 200 });
    },
  });
  assert.equal(state, "busy");
});

test("probe ignores a WebPi mention far down a foreign page", async () => {
  const padding = "x".repeat(IDENTITY_BYTES + 100);
  const state = await probePort("127.0.0.1", 30141, {
    bindable: async () => false,
    fetchImpl: async (url) => {
      if (String(url).includes("app-update")) return new Response("", { status: 404 });
      return new Response(padding + "WebPi", { status: 200 });
    },
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
  assert.equal(webPiIdentityUrl("127.0.0.1", "30141"), "http://127.0.0.1:30141/");
});

test("the identity probe only trusts a page that answers", async () => {
  assert.equal(await servesWebPiIdentity("127.0.0.1", 30141, async () => new Response("", { status: 302 })), false);
  assert.equal(
    await servesWebPiIdentity("127.0.0.1", 30141, async () => new Response("WebPi", { status: 200 })),
    true,
  );
});

test("the reserved-port list matches the Next.js list used at runtime", () => {
  const { KNOWN_RESERVED_PORTS, isPortIsReserved } = require("next/dist/lib/helpers/get-reserved-port");
  const expected = Object.keys(KNOWN_RESERVED_PORTS).map(Number).sort((a, b) => a - b);
  const actual = [...RESERVED_PORTS].sort((a, b) => a - b);

  assert.deepEqual(actual, expected, "copy the new list into bin/port-selection.js");
  for (const port of expected) {
    assert.equal(isPortIsReserved(port), true);
    assert.equal(isReservedPort(port), true, `port ${port}`);
  }
  assert.equal(isReservedPort(30141), false);
});

test("probe treats a Next.js reserved port as unusable", async () => {
  let bindCalls = 0;
  const state = await probePort("127.0.0.1", 1723, {
    bindable: async () => {
      bindCalls += 1;
      return true;
    },
  });

  assert.equal(state, "reserved");
  assert.equal(bindCalls, 0, "reserved ports must not be probed with a bind");
});

test("a reserved port is skipped even though nothing owns it", async () => {
  const { probe, visited } = stubProbe({ 1723: "reserved", 1724: "free" });
  assert.deepEqual(await resolveStartPort({ host: "127.0.0.1", port: "1723", probe }), {
    port: "1724",
    alreadyRunning: false,
  });
  assert.deepEqual(visited, [1723, 1724]);
});

test("findFreePort rejects operating-system ports Next.js blocks", async () => {
  const offered = [1723, 2049, 30141];
  let index = 0;
  const createServer = () => ({
    once: () => {},
    listen: (_port, _host, callback) => callback(),
    address: () => ({ port: offered[index++] }),
    close: (callback) => callback(),
  });

  assert.equal(await findFreePort("127.0.0.1", { createServer }), "30141");
  assert.equal(index, 3, "the reserved offers must be discarded");
});

test("findFreePort fails when only reserved ports are available", async () => {
  const createServer = () => ({
    once: () => {},
    listen: (_port, _host, callback) => callback(),
    address: () => ({ port: 1723 }),
    close: (callback) => callback(),
  });

  await assert.rejects(() => findFreePort("127.0.0.1", { createServer }), /reserved ports/);
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
