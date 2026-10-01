# WebPi Desktop

WebPi Desktop is the same WebPi application in its own window, with a tray icon
and a real lifecycle: **starting the app starts the service, and quitting the
app stops it.**

```bash
npm run desktop          # run from source (Electron + local build)
npm run desktop:dist     # installer + portable for the current platform
npm run desktop:portable # portable archive with SHA256SUMS
```

Artifacts land in `release/`.

## Closing the window

The close button is a product decision, not a window-manager detail, so WebPi
asks once and can remember the answer:

| Choice | What happens |
| --- | --- |
| 最小化到托盘 (default, checked by default) | The window hides, the service keeps running, the tray icon stays |
| 直接关闭 | The app quits and the WebPi server it started is stopped |
| 取消 | Nothing happens |
| 记住我的选择 | Stores the answer; change it any time from the tray menu (**关闭窗口时**) |

The tray menu also offers 显示/隐藏窗口, 重启服务, and 退出 WebPi（同时停止服务）.

A server that this app did not start is never stopped: if another WebPi already
serves the preferred port, the app starts its own instance on an OS-chosen free
port so that quitting is always safe. An unexpected service exit opens a dialog
offering 重启服务 or 退出.

## Packages

| Platform | Installer | Portable |
| --- | --- | --- |
| Windows x64 | `WebPi-Setup-<version>-x64.exe` (NSIS, per-user install) | `WebPi-Portable-<version>-x64.exe` (single file) and `WebPi-<version>-win-x64-portable.zip` |
| Linux x64 | `WebPi-<version>-linux-x86_64.AppImage`, `WebPi-<version>-linux-amd64.deb` | `WebPi-<version>-linux-x64-portable.zip` |
| Linux arm64 | `WebPi-<version>-linux-arm64.AppImage`, `WebPi-<version>-linux-arm64.deb` | `WebPi-<version>-linux-arm64-portable.zip` |
| macOS x64 / arm64 | `WebPi-Setup-<version>-<arch>.dmg` | `WebPi-<version>-mac-<arch>-portable.zip` |

`SHA256SUMS.txt` accompanies the portable archives; the release workflow writes
a combined one for every published file. Electron-builder spells the Linux x64
architecture `x86_64` for AppImage and `amd64` for deb, while the portable
archives use `x64`; the same build is meant either way.

### Portable mode

A portable build must not write to `%APPDATA%` or `Application Support`, so it
keeps its settings next to the executable and the whole folder can be copied to
a USB stick. `desktop/portable.js` resolves the data directory in this order:
1. `WEBPI_DESKTOP_DATA_DIR` — explicit override;
2. `PORTABLE_EXECUTABLE_DIR` — set by the single-file Windows portable build →
   `<that folder>/data`;
3. a `.webpi-portable` marker file next to the executable, or beside `WebPi.app`
   on macOS (written into the portable zip by `desktop/make-portable.mjs`) →
   `<marker folder>/data`;
4. otherwise Electron's normal per-user data directory.

Pi's own data does **not** move: sessions, credentials, models, and settings stay
in `~/.pi/agent` (or `PI_CODING_AGENT_DIR`), shared with the `pi` CLI and the
browser build. Portable means the app's own window state and preferences.

### Runtime

The packaged app runs the server with **Electron's bundled Node.js**
(`ELECTRON_RUN_AS_NODE=1`), so no Node.js installation is required. Verified on
Windows, including node-pty shells for the terminal panel. Set `WEBPI_NODE` to
use a specific Node.js instead.

## Building

```bash
npm install
npm run build            # the web app must be built first: the desktop app serves .next
npm run desktop:dir      # unpacked app only, fastest way to test packaging
npm run desktop:dist     # configured installers/portables for this platform
npm run desktop:portable # zip + marker + SHA256SUMS from the unpacked output
```

Per-platform shortcuts: `desktop:dist:win`, `desktop:dist:linux`,
`desktop:dist:mac`. Cross-building is not supported by electron-builder for
these targets: build each platform on its own machine or CI runner.

`.github/workflows/desktop-release.yml` builds Windows x64, Linux x64/arm64, and
macOS x64/arm64 on the matching runners, starts each packaged artifact to verify
it boots, uploads the artifacts, and publishes a GitHub Release with every
archive plus `SHA256SUMS.txt`.

The workflow runs on a `v*` tag, on pull requests that touch the desktop shell or
the build config, and on demand. To cut a release:

```bash
git tag -a v0.9.3-webpi.1 -m "WebPi Desktop 0.9.3"
git push origin v0.9.3-webpi.1
```

Upstream already owns `v<version>` tags (`v0.9.3` points at the upstream release
commit, which has no desktop shell), so this fork publishes under
`v<version>-webpi.<n>` instead of overwriting them. The release name is
`WebPi Desktop <tag>`.

The workflow passes one architecture per runner (`--x64` or `--arm64`) and hands
that value to the packaging step as `WEBPI_PORTABLE_ARCH`. That is not
redundant: electron-builder omits the architecture from the output folder name
when it matches the host, so `--x64` on an arm64 runner still writes
`linux-unpacked`. Without the hint, two architectures would produce the same
archive name. `desktop/portable.js` otherwise falls back to reading the
architecture from the packaged executable's ELF, Mach-O, or PE header, and
`desktop/make-portable.mjs` refuses to run if two folders would share a name.

Notes that matter when packaging:

- `asar` is **disabled**. The server runs as a separate process (`next start`)
  and node-pty loads a native module, so the application tree must stay on disk.
- `npmRebuild` is **disabled**; node-pty ships Node-API prebuilds that work with
  Electron's Node, so no C++ toolchain is needed to build a package.
- The window icon comes from the web app: `npm run desktop:icons` regenerates
  `desktop/assets/{icon.png,tray.png,tray@2x.png}` from `public/icons/icon-512.png`.

### Signing

No certificates are configured, so:

- **Windows**: SmartScreen warns on first run ("Windows protected your PC" →
  更多信息 → 仍要运行). Configure `win.certificateFile`/`CSC_LINK` to sign.
- **macOS**: Gatekeeper blocks an unsigned app download
  ("WebPi.app is damaged" or "cannot be opened"). Users can right-click → 打开,
  or run `xattr -dr com.apple.quarantine /Applications/WebPi.app`. Real
  distribution needs a Developer ID certificate plus notarization.
- **Linux**: AppImage needs `chmod +x`; `fuse` (or `--appimage-extract-and-run`)
  is required on some distributions.

## Verification

The desktop lifecycle is covered by tests that run without a GUI:

```bash
node --experimental-strip-types --test lib/desktop-*.test.mjs
```

They pin the close-button policy, the tray menu, the launcher command and
runtime selection, the readiness contract, tree-kill on stop, the settings file,
portable data-directory resolution, and how each packaging folder is named.

For an end-to-end check without clicking anything, the shell supports a smoke
mode that starts the app, waits for the UI, captures a screenshot, and quits:

```bash
WEBPI_DESKTOP_SMOKE=1 WEBPI_DESKTOP_SMOKE_SCREENSHOT=/tmp/webpi.png npx electron desktop/main.js
```

It logs the resolved data directory, whether this instance owns the service, the
page title, and the first line of rendered text, then exits `0`.

The release workflow runs exactly this check against the **packaged artifact** on
every platform (the unpacked Windows build, the Linux AppImage under `xvfb-run`,
and the macOS `.app`). A build that produces installers but cannot boot them
fails CI, so these are verified to start their own service and render the UI:

| Platform | Data directory | Result |
| --- | --- | --- |
| Windows x64 | `%APPDATA%\webpi` | `owned=true`, `title=WebPi` |
| Linux x64 / arm64 (AppImage) | `~/.config/webpi` | `owned=true`, `title=WebPi` |
| macOS arm64 (`.app`) | `~/Library/Application Support/webpi` | `owned=true`, `title=WebPi` |
