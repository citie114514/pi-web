import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { EXTERNAL_SCHEMES, externalTarget, isAppUrl } = require("../desktop/external-links.js");

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const readRepoFile = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

const APP = "http://127.0.0.1:30141";

test("the app's own UI keeps navigating inside the window", () => {
  assert.equal(isAppUrl(`${APP}/settings`, APP), true);
  assert.equal(externalTarget(`${APP}/settings`, APP), null);
  assert.equal(externalTarget(`${APP}/?session=abc`, APP), null);
  // A different port is a different server, even on loopback.
  assert.equal(isAppUrl("http://127.0.0.1:8080/", APP), false);
});

test("links in the model's output go to the system browser", () => {
  assert.equal(externalTarget("https://github.com/citie114514/pi-web", APP), "https://github.com/citie114514/pi-web");
  assert.equal(externalTarget("http://example.com/docs", APP), "http://example.com/docs");
  assert.equal(externalTarget("mailto:someone@example.com", APP), "mailto:someone@example.com");
  // Loopback on another port is still an external link.
  assert.equal(externalTarget("http://127.0.0.1:8080/", APP), "http://127.0.0.1:8080/");
});

test("only http, https and mailto may reach the OS handler", () => {
  assert.deepEqual([...EXTERNAL_SCHEMES].sort(), ["http:", "https:", "mailto:"]);
  for (const unsafe of [
    "file:///C:/Windows/System32/cmd.exe",
    "javascript:alert(1)",
    "data:text/html,<script>1</script>",
    "vbscript:msgbox(1)",
    "chrome://settings",
    "about:blank",
    "not a url",
    "",
  ]) {
    assert.equal(externalTarget(unsafe, APP), null, unsafe);
  }
});

test("before the UI is loaded there is no origin to compare against", () => {
  // Nothing is sent out until there is an app URL, but a real external link is
  // still recognised — the URL is normalised by the parser (a bare origin gains
  // a trailing slash).
  assert.equal(isAppUrl(`${APP}/`, undefined), false);
  assert.equal(externalTarget("https://example.com", undefined), "https://example.com/");
  assert.equal(externalTarget(undefined, APP), null);
  assert.equal(externalTarget(null, APP), null);
});

test("the desktop shell wires both navigation paths through the external handler", () => {
  const main = readRepoFile("desktop/main.js");

  // New windows / target=_blank.
  assert.match(main, /setWindowOpenHandler\(\(\{ url \}\) => \{/);
  assert.match(main, /return \{ action: "deny" \};/);
  // In-page navigations (a plain <a href> without target).
  assert.match(main, /webContents\.on\("will-navigate", \(event, url\) => \{/);
  assert.match(main, /if \(isAppUrl\(url, appUrl\)\) return;/);
  assert.match(main, /event\.preventDefault\(\);/);

  // Both paths must funnel through the scheme-checked opener.
  assert.match(main, /function openExternal\(url\) \{/);
  assert.match(main, /const target = externalTarget\(url, appUrl\);/);
  assert.match(main, /if \(!target\) return false;/);
  assert.match(main, /shell\.openExternal\(target\)/);
});
