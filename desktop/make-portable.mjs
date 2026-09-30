// Builds the portable archive: the unpacked desktop app plus a marker file that
// makes it keep its settings inside the folder (see desktop/portable.js), zipped
// with one top-level directory and published with a SHA256 sum.
//
// Usage:
//   npm run desktop:dist        # produces release/<platform>-unpacked
//   npm run desktop:portable    # this script
//
// Mirrors the installer layout, so both forms share one runtime tree.
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { PORTABLE_MARKER, executableDir, platformLabel } = require("./portable.js");

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseDir = join(root, "release");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const outDir = join(releaseDir, "portable");

/** Where electron-builder puts `--dir` output, per platform and arch. */
function unpackedDirs() {
  if (!existsSync(releaseDir)) return [];
  return readdirSync(releaseDir)
    .filter((name) => name.endsWith("-unpacked") || name === "mac" || name.startsWith("mac-"))
    .map((name) => join(releaseDir, name))
    .filter((dir) => statSync(dir).isDirectory());
}

/**
 * Archive one folder with the platform's own zip writer.
 *
 * GNU tar (what `tar` on PATH is inside Git Bash) cannot write zip archives and
 * misreads a Windows path as a remote host, so Windows and macOS call their
 * bsdtar explicitly while Linux runners ship `zip`.
 */
function zipCommand(archivePath, name) {
  if (process.platform === "linux") return { command: "zip", args: ["-q", "-r", "-y", archivePath, name] };
  if (process.platform === "win32") {
    const bsdtar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    if (existsSync(bsdtar)) return { command: bsdtar, args: ["-a", "-c", "-f", archivePath, name] };
    return { command: null, args: [] };
  }
  return { command: "/usr/bin/tar", args: ["-a", "-c", "-f", archivePath, name] };
}

function powershellCompress(name, archivePath) {
  return {
    command: "powershell",
    args: [
      "-NoProfile",
      "-Command",
      `Compress-Archive -LiteralPath '${name}' -DestinationPath '${archivePath}' -Force`,
    ],
  };
}

function zip(directory, archivePath) {
  const parent = dirname(directory);
  const name = directory.split(/[\\/]/).pop();
  rmSync(archivePath, { force: true });

  const { command, args } = zipCommand(archivePath, name);
  if (command) {
    execFileSync(command, args, { cwd: parent, stdio: "inherit" });
    return;
  }

  const fallback = powershellCompress(name, archivePath);
  execFileSync(fallback.command, fallback.args, { cwd: parent, stdio: "inherit" });
}

/** Best-effort check that the archive lists back and contains the marker. */
function verifyArchive(archivePath, expectedEntry) {
  const bsdtar = process.platform === "win32"
    ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
    : "/usr/bin/tar";
  const listing = process.platform === "linux"
    ? { command: "unzip", args: ["-Z1", archivePath] }
    : { command: bsdtar, args: ["-tf", archivePath] };

  try {
    // The tree holds tens of thousands of files, so the listing needs far more
    // than the 1 MB default buffer.
    const entries = execFileSync(listing.command, listing.args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const normalized = entries.split("\n").map((line) => line.trim().replaceAll("\\", "/"));
    if (!normalized.some((line) => line.endsWith(expectedEntry))) {
      throw new Error(`压缩包里没有 ${expectedEntry}`);
    }
    console.log(`[portable] 压缩包校验通过（${expectedEntry}）`);
  } catch (error) {
    // A missing listing tool must not fail a build that already produced a zip.
    if (process.platform === "linux") throw error;
    console.warn(`[portable] 跳过压缩包校验：${error instanceof Error ? error.message : String(error)}`);
  }
}

const dirs = unpackedDirs();
if (dirs.length === 0) {
  console.error("[portable] 没有找到 electron-builder 的 --dir 产物，请先运行：npm run desktop:dir 或 npm run desktop:dist");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const sums = [];

// Two folders must never share an archive name: the second zip would silently
// replace the first and drop that architecture from the release.
const targets = dirs.map((appDir) => ({ appDir, label: platformLabel(appDir) }));
const labels = targets.map((target) => target.label);
if (new Set(labels).size !== labels.length) {
  console.error(`[portable] 产物目录重名（${labels.join(", ")}），请清理 release/ 后重新打包`);
  process.exit(1);
}

for (const { appDir, label } of targets) {
  const staging = join(outDir, `WebPi-${version}-${label}-portable`);
  const archive = `${staging}.zip`;

  console.log(`[portable] 装配 ${label}: ${appDir} -> ${staging}`);
  rmSync(staging, { recursive: true, force: true });

  const entryRoot = staging.split(/[\\/]/).pop();
  try {
    // The unpacked tree is a plain directory, so a recursive copy is enough; on
    // macOS the marker goes beside the .app so the folder stays self-contained.
    cpSync(appDir, staging, { recursive: true });

    const bundleDir = process.platform === "darwin" ? staging : null;
    const hasBundle = bundleDir !== null && existsSync(join(staging, "WebPi.app"));
    const markerDir = hasBundle ? bundleDir : executableDir(staging);
    writeFileSync(join(markerDir, PORTABLE_MARKER), "");

    console.log(`[portable] 压缩 -> ${archive}`);
    zip(staging, archive);
    verifyArchive(archive, `${entryRoot}/${PORTABLE_MARKER}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  const sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
  sums.push(`${sha256}  ${archive.split(/[\\/]/).pop()}`);
  console.log(`[portable] 完成 ${archive.split(/[\\/]/).pop()} (${(statSync(archive).size / 1048576).toFixed(1)} MB)`);
}

writeFileSync(join(outDir, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);
console.log(`[portable] SHA256 已写入 ${resolve(join(outDir, "SHA256SUMS.txt"))}`);
