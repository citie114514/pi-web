import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { PI_PACKAGE, localPiNodeModules, piVersionAt, readCurrentVersion, resolveFromLocal } = require("../bin/local-pi.js");

/** A managed pi install: <root>/current-version + releases/<v>/node_modules/<pkg>. */
function fakeInstall(version = "1.4.0") {
  const agentDir = mkdtempSync(join(tmpdir(), "webpi-agent-"));
  const installRoot = join(agentDir, "install");
  const nodeModules = join(installRoot, "releases", version, "node_modules");
  const codingAgent = join(nodeModules, "@earendil-works", "pi-coding-agent");
  const tui = join(nodeModules, "@earendil-works", "pi-tui");
  mkdirSync(codingAgent, { recursive: true });
  mkdirSync(tui, { recursive: true });

  writeFileSync(join(installRoot, "current-version"), `${version}\n`);
  writeFileSync(join(codingAgent, "package.json"), JSON.stringify({ name: PI_PACKAGE, version, main: "index.js" }));
  writeFileSync(join(codingAgent, "index.js"), "module.exports = 'local-agent';\n");
  writeFileSync(join(tui, "package.json"), JSON.stringify({ name: "@earendil-works/pi-tui", version, main: "index.js" }));
  writeFileSync(join(tui, "index.js"), "module.exports = 'local';\n");
  return { agentDir, installRoot, version, nodeModules };
}

test("the local install is found through current-version", () => {
  const { agentDir, version } = fakeInstall("1.4.0");
  const nodeModules = localPiNodeModules({ env: {}, agentDir });
  assert.equal(nodeModules, join(agentDir, "install", "releases", version, "node_modules"));
  assert.equal(piVersionAt(nodeModules), version);
});

test("no pi install means no preference (the bundled copy is used)", () => {
  const empty = mkdtempSync(join(tmpdir(), "webpi-agent-empty-"));
  assert.equal(localPiNodeModules({ env: {}, agentDir: empty }), null);
  assert.equal(piVersionAt(null), null);
});

test("a version file that is not a safe path segment is ignored", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "webpi-agent-bad-"));
  const installRoot = join(agentDir, "install");
  mkdirSync(installRoot, { recursive: true });
  for (const bad of ["../escape", "..", ".", "", "  ", "1.4.0/../.."]) {
    writeFileSync(join(installRoot, "current-version"), bad);
    assert.equal(readCurrentVersion(installRoot), null, JSON.stringify(bad));
    assert.equal(localPiNodeModules({ env: {}, agentDir }), null, JSON.stringify(bad));
  }
});

test("PI_MANAGED_INSTALL_ROOT wins, as it does inside a pi session", () => {
  const { installRoot, version } = fakeInstall("1.5.0");
  const nodeModules = localPiNodeModules({ env: { PI_MANAGED_INSTALL_ROOT: installRoot }, agentDir: "/nonexistent" });
  assert.equal(nodeModules, join(installRoot, "releases", version, "node_modules"));
});

test("only @earendil-works requests are redirected, and only when the entry exists", () => {
  const { agentDir } = fakeInstall();
  const nodeModules = localPiNodeModules({ env: {}, agentDir });

  // The entry point is resolved through the package's own "main", not the bare
  // directory, and a missing package falls through to the bundled copy.
  assert.equal(resolveFromLocal("@earendil-works/pi-coding-agent", { nodeModules }), join(nodeModules, "@earendil-works", "pi-coding-agent", "index.js"));
  assert.equal(resolveFromLocal("@earendil-works/pi-mcp", { nodeModules }), null);
  // Not a pi package: never redirected.
  assert.equal(resolveFromLocal("react", { nodeModules }), null);
  assert.equal(resolveFromLocal("@earendil-works/pi-coding-agent", { nodeModules: null }), null);
});

test("an ESM-only package resolves through its own exports map", () => {
  // pi-coding-agent ships "exports": {".": {"import": ...}} and no "main",
  // which CJS resolution cannot match. The hook must still hand back a file.
  const { nodeModules } = fakeInstall();
  const esm = join(nodeModules, "@earendil-works", "pi-mcp");
  mkdirSync(join(esm, "dist"), { recursive: true });
  writeFileSync(join(esm, "package.json"), JSON.stringify({ name: "@earendil-works/pi-mcp", exports: { ".": { import: "./dist/index.js" } } }));
  writeFileSync(join(esm, "dist", "index.js"), "export const x = 1;\n");

  assert.equal(resolveFromLocal("@earendil-works/pi-mcp", { nodeModules }), join(esm, "dist", "index.js"));
});

test("the hook patches resolution to the local install and restores nothing else", () => {
  const { agentDir } = fakeInstall();
  const nodeModules = localPiNodeModules({ env: {}, agentDir });
  const { install } = require("../bin/prefer-local-pi.cjs");
  const lines = [];
  const before = require("node:module")._resolveFilename;

  install({ env: {}, nodeModules, log: (line) => lines.push(line) });
  try {
    const resolved = require.resolve("@earendil-works/pi-tui");
    assert.equal(resolved, join(nodeModules, "@earendil-works", "pi-tui", "index.js"));
    assert.equal(require("@earendil-works/pi-tui"), "local");
    assert.ok(lines.some((line) => line.includes("preferring the local install")));
    // Unrelated modules still resolve the normal way.
    assert.match(require.resolve("node:path"), /node:path|node\\path/);
  } finally {
    require("node:module")._resolveFilename = before;
  }
});
