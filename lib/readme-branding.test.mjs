import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const readRepoFile = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

const READMES = ["README.md", "README.zh-CN.md", "README.ja.md", "README.ru.md"];
const OTHER_READMES = {
  "README.md": ["README.zh-CN.md", "README.ja.md", "README.ru.md"],
  "README.zh-CN.md": ["README.md", "README.ja.md", "README.ru.md"],
  "README.ja.md": ["README.md", "README.zh-CN.md", "README.ru.md"],
  "README.ru.md": ["README.md", "README.zh-CN.md", "README.ja.md"],
};

// Upstream edits README.md and all three translations, so a merge can replace a
// WebPi readme with upstream's Pi Web text. These assertions fail loudly when it
// does, instead of leaving a readme that describes a different project.
test("every README is a WebPi readme, not upstream's", () => {
  for (const file of READMES) {
    const text = readRepoFile(file);

    assert.ok(text.startsWith("# WebPi\n"), `${file} must start with the WebPi title`);
    assert.ok(text.includes("./docs/screenshot.png"), `${file} must show the WebPi screenshot`);
    assert.ok(text.includes("docs/webpi.md"), `${file} must link to what differs from upstream`);
    assert.ok(text.includes("docs/webpi-desktop.md"), `${file} must link to the desktop guide`);
    assert.ok(text.includes("agegr/pi-web"), `${file} must keep the upstream attribution`);
  }
});

test("every README documents all three ways to run it", () => {
  for (const file of READMES) {
    const text = readRepoFile(file);
    assert.ok(text.includes("webpi`"), `${file} must document the webpi command`);
    assert.ok(text.includes("pi install"), `${file} must document the Pi package install`);
    assert.ok(
      text.includes("citie114514/pi-web/releases/latest"),
      `${file} must link to the release page for the desktop build`,
    );
  }
});

test("the language switchers point at each other", () => {
  for (const file of READMES) {
    const header = readRepoFile(file).split("\n").slice(0, 8).join("\n");
    for (const other of OTHER_READMES[file]) {
      assert.ok(header.includes(`./${other}`), `${file} must link to ${other} in its switcher`);
    }
  }
});

test("no README points at the upstream demo or a broken fork URL", () => {
  for (const file of READMES) {
    const text = readRepoFile(file);
    // The demo and screenshots upstream hosts show upstream's branding.
    assert.doesNotMatch(text, /raw\.githubusercontent\.com\/agegr\/pi-web/, `${file} must not hotlink upstream images`);
    assert.doesNotMatch(text, /citie514\//, `${file} must not contain a mistyped repository`);
    // Every clone URL in a readme has to be this fork.
    for (const match of text.matchAll(/git clone (\S+)/g)) {
      assert.equal(match[1], "https://github.com/citie114514/pi-web", `${file} clones the wrong repository`);
    }
  }
});

test("the screenshot the READMEs embed is committed", () => {
  const png = readFileSync(join(repoRoot, "docs/screenshot.png"));
  // PNG signature, so a placeholder or a truncated copy fails here.
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(png.length > 10_000, "the screenshot looks empty");
});
