import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const readRepoFile = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

test("the Pi package manifest points at resources that exist", () => {
  const declared = [...(packageJson.pi?.extensions ?? []), ...(packageJson.pi?.skills ?? [])];
  assert.ok(declared.length >= 2, "the package must declare its extension and skill");

  for (const entry of declared) {
    assert.equal(existsSync(resolve(repoRoot, entry)), true, entry);
  }

  assert.equal(existsSync(resolve(repoRoot, packageJson.bin.webpi)), true);
  assert.ok(packageJson.keywords.includes("pi-package"));
  // The app bundles the SDK it is built against, so it stays a pinned dependency
  // rather than a floating peer range.
  assert.match(packageJson.dependencies["@earendil-works/pi-coding-agent"], /^\d+\.\d+\.\d+$/);
  assert.equal(packageJson.peerDependencies, undefined);
});

test("the packaged skill describes when to use it", () => {
  const skill = readRepoFile("skills/webpi/SKILL.md");
  // Git may check these files out with CRLF on Windows.
  assert.match(skill, /^---\r?\nname: webpi\r?\n/m);
  assert.match(skill, /^description:/m);
  assert.match(skill, /30141/);
});

test("the /webpi command registers an event handler and no other resources", async () => {
  const createJiti = require("jiti").createJiti ?? require("jiti");
  const factory = await createJiti(import.meta.url).import(
    new URL("../extensions/webpi/index.ts", import.meta.url).href,
    { default: true },
  );

  assert.equal(typeof factory, "function");

  const commands = [];
  const events = [];
  const tools = [];
  factory({
    on: (event, handler) => events.push([event, handler]),
    registerCommand: (name, options) => commands.push([name, options]),
    registerTool: (tool) => tools.push(tool),
  });

  assert.deepEqual(commands.map(([name]) => name), ["webpi"]);
  assert.equal(typeof commands[0][1].handler, "function");
  assert.match(commands[0][1].description, /WebPi/);

  // Registration must stay inert: the factory may not start work at load time.
  assert.deepEqual(events.map(([event]) => event), ["session_shutdown"]);
  assert.equal(typeof events[0][1], "function");
  assert.deepEqual(tools, []);
});

test("the launcher, the extension, and the desktop shell agree on the readiness contract", () => {
  const launcher = readRepoFile("bin/pi-web.js");
  const extension = readRepoFile("extensions/webpi/index.ts");
  const { parseReadyLine } = require("../desktop/launcher.js");

  const patternSource = /READY_PATTERN\s*=\s*\/(.+)\/;/.exec(extension)?.[1];
  assert.ok(patternSource, "the extension must keep a greppable READY_PATTERN");
  const ready = new RegExp(patternSource);

  for (const line of [
    "WebPi ready at http://127.0.0.1:30141",
    "WebPi is already running at http://127.0.0.1:30141",
  ]) {
    assert.equal(ready.exec(line)?.[1], "http://127.0.0.1:30141", line);
    assert.ok(launcher.includes(`\`${line.replace("http://127.0.0.1:30141", "${url}")}\``), line);
    assert.deepEqual(
      parseReadyLine(line),
      { url: "http://127.0.0.1:30141", owned: line.includes("ready at") },
      line,
    );
  }
});

test("the packaged app ships every entry point it declares", () => {
  assert.equal(packageJson.main, "desktop/main.js");
  for (const file of [
    "desktop/main.js",
    "desktop/splash.html",
    "desktop/assets/icon.png",
    "desktop/assets/tray.png",
  ]) {
    assert.equal(existsSync(resolve(repoRoot, file)), true, file);
  }
  for (const script of ["desktop", "desktop:icons", "desktop:dist"]) {
    assert.ok(packageJson.scripts[script], `missing npm script ${script}`);
  }
});

test("the launcher keeps the WebPi name in its user-facing output", () => {
  const launcher = readRepoFile("bin/pi-web.js");
  const options = readRepoFile("bin/pi-web-options.js");
  const lifecycle = readRepoFile("bin/process-lifecycle.js");

  assert.match(launcher, /webpi is listening on/);
  assert.match(options, /Usage: webpi \[options\]/);
  assert.match(lifecycle, /\[webpi\]/);
});
