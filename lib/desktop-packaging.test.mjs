import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const readRepoFile = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

const build = packageJson.build;

function targetNames(platform) {
  return (build[platform].target ?? []).map((entry) => String(entry.target));
}

function targetArches(platform, target) {
  const entry = (build[platform].target ?? []).find((item) => String(item.target) === target);
  return entry?.arch ?? [];
}

test("every platform ships an installer and a portable archive", () => {
  assert.deepEqual(targetNames("win"), ["nsis", "portable"]);
  assert.deepEqual(targetNames("linux"), ["AppImage", "deb"]);
  assert.deepEqual(targetNames("mac"), ["dmg", "zip"]);

  for (const platform of ["win", "linux", "mac"]) {
    assert.ok(targetArches(platform, targetNames(platform)[0]).length > 0, `${platform} has no arch`);
  }
  assert.deepEqual(targetArches("linux", "AppImage"), ["x64", "arm64"]);
  assert.deepEqual(targetArches("mac", "dmg"), ["x64", "arm64"]);
});

test("artifact names separate the installer from the portable build", () => {
  assert.equal(build.nsis.artifactName, "WebPi-Setup-${version}-${arch}.${ext}");
  assert.equal(build.dmg.artifactName, "WebPi-Setup-${version}-${arch}.${ext}");
  assert.equal(build.portable.artifactName, "WebPi-Portable-${version}-${arch}.${ext}");
  assert.match(build.artifactName, /\$\{productName\}-\$\{version\}-\$\{os\}-\$\{arch\}/);
});

test("the installer stays per-user so it needs no administrator rights", () => {
  assert.equal(build.nsis.oneClick, false);
  assert.equal(build.nsis.perMachine, false);
  assert.equal(build.nsis.allowToChangeInstallationDirectory, true);
});

test("Linux packaging carries the metadata a desktop entry needs", () => {
  assert.equal(build.linux.category, "Development");
  assert.match(build.linux.maintainer, /<\S+@\S+>/, "deb needs a maintainer with an email");
  assert.equal(build.linux.desktop.entry.Name, "WebPi");
  assert.ok(Array.isArray(build.deb.depends) && build.deb.depends.includes("libgtk-3-0"));
});

test("packaging keeps the application tree on disk for the server process", () => {
  assert.equal(build.asar, false, "next start and node-pty need a real filesystem");
  assert.equal(build.npmRebuild, false, "node-pty uses Node-API prebuilds");
  assert.equal(build.extraMetadata.main, "desktop/main.js");
  assert.deepEqual(build.directories, { output: "release", buildResources: "desktop/assets" });
});

test("the packaged app ships the shell, the launcher, and the built web app", () => {
  for (const entry of ["desktop/**/*", "bin/**/*", "public/**/*", ".next/**/*", "next.config.ts", "package.json"]) {
    assert.ok(build.files.includes(entry), `missing packaged entry ${entry}`);
  }
  for (const excluded of ["!.next/cache/**", "!.next/dev/**", "!**/*.map"]) {
    assert.ok(build.files.includes(excluded), `missing exclusion ${excluded}`);
  }
});

test("portable archives are produced by the repository, not the platform", () => {
  assert.equal(packageJson.scripts["desktop:portable"], "node desktop/make-portable.mjs");
  assert.equal(packageJson.scripts["desktop:release"], "electron-builder && node desktop/make-portable.mjs");
  assert.equal(existsSync(join(repoRoot, "desktop/make-portable.mjs")), true);

  const script = readRepoFile("desktop/make-portable.mjs");
  assert.match(script, /PORTABLE_MARKER/, "the archive must carry the portable marker");
  assert.match(script, /createHash\("sha256"\)/, "the archive must be published with a checksum");
  assert.match(script, /SHA256SUMS\.txt/);
});

test("the release workflow covers Windows, Linux, and macOS", () => {
  const workflow = readRepoFile(".github/workflows/desktop-release.yml");
  for (const runner of ["windows-latest", "ubuntu-22.04", "ubuntu-22.04-arm", "macos-14"]) {
    assert.ok(workflow.includes(runner), `missing runner ${runner}`);
  }
  assert.match(workflow, /npx electron-builder/);
  assert.match(workflow, /node desktop\/make-portable\.mjs/);
  assert.match(workflow, /softprops\/action-gh-release/);
  assert.match(workflow, /SHA256SUMS\.txt/);
});
