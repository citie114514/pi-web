# WebPi Desktop

[中文文档](./README.zh-CN.md) | [日本語](./README.ja.md) | [Русский](./README.ru.md)

**WebPi Desktop is the desktop client for the [pi coding agent](https://github.com/earendil-works/pi), built on WebPi.** It is a normal desktop window with a tray icon: starting the app starts the service, quitting it stops the service, and it needs **no Node.js installation**. It reads the same configuration, credential, and session files as pi — a conversation started in the terminal opens in the app, and one started in the app is still there in the terminal.

![WebPi Desktop start screen: session sidebar, Get Started panel, and the Models, Skills and Settings entries](./docs/screenshot.png)

Two things live in this repository, sharing one pi data directory (sessions and credentials stay in `~/.pi/agent`):

| | What it is | How to run it |
| --- | --- | --- |
| **WebPi Desktop** | The desktop client — its own window and tray icon, with the service started and stopped by the app | Download an installer or a portable build from the [releases page](https://github.com/citie114514/pi-web/releases/latest), or `npm run desktop` |
| **WebPi** | The browser UI it is built on: sessions, chat, models, files, terminal — everything pi does | The global `webpi` command, or `/webpi` from inside pi |

## What this is not

GitHub has plenty of pi front ends and the names collide, so here are the boundaries:

- **Not a terminal bridge.** WebPi is a real web UI (Next.js) that reads and writes pi's session files and RPC — not the TUI moved into a browser with xterm.js.
- **Not another agent runtime.** Session management, model and auth setup, and agent execution all go through upstream `pi`; this is a shell around it.
- **Built on `agegr/pi-web`**, which is where the web UI comes from. WebPi Desktop adds the desktop shell, the packaging, and Windows-friendly startup.

WebPi is a downstream build of [pi-web](https://github.com/agegr/pi-web): the application itself is upstream's work; this repository adds the `webpi` command, the WebPi Desktop desktop client, the Pi package, Windows-friendly startup, and the WebPi name. Read [docs/webpi.md](./docs/webpi.md) for exactly what differs, [docs/webpi-desktop.md](./docs/webpi-desktop.md) for the desktop build, [docs/upstream-sync.md](./docs/upstream-sync.md) for how upstream changes are merged in, and [docs/upstream-inventory.md](./docs/upstream-inventory.md) for the baseline this fork started from.

## Features

- **Session workspace**: browse, resume, rename, export, and delete conversations grouped by project, with running state, context usage, cost, and compaction details.
- **Two ways to branch**: **New session** creates an independent session file from an earlier message; **Edit from here** creates a branch inside the current session.
- **Project file tools**: browse and upload files, inspect Git diffs, and preview source, Markdown, images, audio, PDFs, and DOCX files with automatic refresh.
- **Git worktrees**: switch checkouts from the sidebar while keeping sessions from the same repository grouped together.
- **Web-based configuration**: manage provider login and API keys, models, model tests, plugin packages, and skills without leaving the browser.
- **English, Simplified Chinese, and Traditional Chinese UI**: the interface follows the browser language initially and provides a language switcher in the top bar.

## Quick Start

### Desktop application

Download the build for your platform from the [releases page](https://github.com/citie114514/pi-web/releases/latest) and run it. Starting the app starts the WebPi server, and quitting it stops that server. Nothing else needs to be installed.

| Platform | Installer | Portable |
| --- | --- | --- |
| Windows x64 | `WebPi Desktop-Setup-<version>-x64.exe` (per-user, no administrator rights) | `WebPi Desktop-Portable-<version>-x64.exe`, `WebPi Desktop-<version>-win-x64-portable.zip` |
| Linux x64 | `WebPi Desktop-<version>-linux-x86_64.AppImage`, `WebPi Desktop-<version>-linux-amd64.deb` | `WebPi Desktop-<version>-linux-x64-portable.zip` |
| Linux arm64 | `WebPi Desktop-<version>-linux-arm64.AppImage`, `WebPi Desktop-<version>-linux-arm64.deb` | `WebPi Desktop-<version>-linux-arm64-portable.zip` |
| macOS x64 / arm64 | `WebPi Desktop-Setup-<version>-<arch>.dmg` | `WebPi Desktop-<version>-mac-<arch>-portable.zip` |

See [Desktop application](#desktop-application) for what the app does with the server, portable mode, and the signing warnings.

### The `webpi` command

Requires Node.js 22.19.0 or newer. Check with `node --version`, then install this repository as a global command:

```bash
git clone https://github.com/citie114514/pi-web
cd pi-web
npm install
npm run build
npm install -g .
webpi
```

`webpi` opens a browser once the server is ready. If it does not, open the URL it printed, by default [http://127.0.0.1:30141](http://127.0.0.1:30141). WebPi listens only on `127.0.0.1` by default. To remove the command later, run `npm uninstall -g webpi`.

### As a Pi package

Install this directory as a Pi package to start the server from inside pi:

```bash
pi install /path/to/pi-web
```

Then run `/webpi` in the pi TUI to start the server and get its URL. `/webpi --port 8080` forwards options to the same launcher. A server started this way stops with that pi session; start it from a shell or the desktop app when it must outlive the TUI.

### Configure a model

If no model provider is configured yet, open the **Models** panel and sign in or add an API key. The Models panel uses pi's own model, settings, and credential storage, so whichever interface you use, the change is visible in the other. Running `/login` in the pi CLI writes the same credential store.

Upstream's published package remains available as `npx @agegr/pi-web@latest` if you want upstream without this packaging layer.

## Desktop application

The desktop build is the same application in its own window, with a tray icon and a real lifecycle:

- **Starting the app starts the service, quitting the app stops it.** A server this app did not start is never stopped: if another WebPi already serves the port, the app starts its own instance on a free port so that quitting is always safe.
- **Closing the window asks what to do** — minimize to the tray, or close everything — and can remember the answer. Change it any time from the tray menu.
- **Links open in your browser**: a URL in the model's output goes to the system default browser, not into the embedded window (only http, https and mailto are handed to the OS).
- **The tray menu** also shows or hides the window, restarts the service, and quits. If the service exits unexpectedly, a dialog offers to restart it or exit.
- **Portable mode**: the portable archives keep their settings inside the extracted folder, so the whole folder can be moved to a USB stick. Pi's own data still lives in `~/.pi/agent`.

The builds are not signed, so Windows SmartScreen and macOS Gatekeeper warn on first launch; [docs/webpi-desktop.md](./docs/webpi-desktop.md) explains the warnings, portable mode, code signing, and the CI release workflow.

To build it from source:

```bash
npm run desktop          # run from source
npm run desktop:dist     # installer + portable for this platform
```

Artifacts land in `release/`. `.github/workflows/desktop-release.yml` builds every platform, starts each packaged artifact to verify that it boots, and publishes the release.

## Configuration

For the port and hostname, command-line options override the corresponding environment variables. Either `--no-open` or `PI_WEB_NO_OPEN=1` disables automatic browser opening. Run `webpi --help` (or `-h`) to print the startup options and exit without starting the server; unknown options exit with an error.

Environment variables keep their upstream `PI_WEB_*` names so that existing instructions and wrappers keep working.

| Option or environment variable | Purpose | Default |
| --- | --- | --- |
| `--help`, `-h` | Print startup options and exit | — |
| `--port <port>`, `-p <port>`, or `PORT` | Server port | `30141` |
| `--hostname <host>`, `-H <host>`, or `PI_WEB_HOSTNAME` | Bind hostname | `127.0.0.1` |
| `--no-open` or `PI_WEB_NO_OPEN=1` | Do not open a browser automatically | Browser opens |
| `PI_WEB_SKIP_VERSION_CHECK=1` | Disable WebPi update checks | Unset |
| `PI_WEB_ALLOWED_HOSTS` | Additional exact proxy or custom hostnames, comma-separated | Unset |
| `PI_WEB_PASSWORD` | Enable browser password login; API clients may use Basic Auth with username `pi` | Authentication disabled |
| `PI_WEB_IDLE_TIMEOUT_MS` | Session idle timeout in milliseconds, up to `2147483647`; `0` disables idle shutdown; invalid or out-of-range values use the default | `600000` (10 min) |
| `PI_WEB_SHUTDOWN_DEADLINE_MS` | How long extensions get to handle `session_shutdown` before a closing session is disposed anyway, in milliseconds up to `2147483647`; `0`, invalid or out-of-range values use the default | `5000` (5 s) |

For example:

```bash
webpi --help
webpi -p 8080 -H 0.0.0.0 --no-open
```

### Startup behaviour

- A WebPi server that already serves the requested port is reused: `webpi` prints its URL and exits instead of starting a second server over the same session files.
- A port owned by another program is skipped; the launcher tries up to ten consecutive ports and prints the one it used. Ports that Next.js itself refuses are skipped as well.
- `--port 0` asks the operating system for a free port.
- The standalone `webpi` command keeps running until you stop it with `Ctrl+C`.

### Remote access

Binding to a non-loopback address exposes an agent that can execute high-privilege actions. On a trusted LAN, require a long random password:

```bash
PI_WEB_PASSWORD='a-long-random-password' webpi --hostname 0.0.0.0
```

Password authentication does not encrypt the connection. Do not expose WebPi over plain HTTP to the internet; use HTTPS through a trusted reverse proxy or a trusted VPN. If a reverse proxy sends an external hostname, add that exact name to `PI_WEB_ALLOWED_HOSTS`. This allow-list does not change the address WebPi binds to.

### HTTP proxy

Server-side model and API requests honor the standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` environment variables.

On macOS or Linux:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
NO_PROXY=localhost,127.0.0.1 \
webpi
```

On Windows PowerShell:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
$env:NO_PROXY = "localhost,127.0.0.1"
webpi
```

## Notes

- **Agent data**: WebPi reads pi data from `~/.pi/agent` by default, including session files under `sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`. Set `PI_CODING_AGENT_DIR` to use another pi agent directory.
- **Filesystem access**: WebPi must be able to read the agent data directory and the working directories recorded by its sessions. Run it in the same filesystem environment as pi when sharing existing sessions.
- **Shared configuration**: the Models panel uses pi's model, settings, and credential storage, so changes are visible to both interfaces.
- **File access boundary**: the file browser is limited to working directories selected in WebPi and project or session roots it already knows about; it is not a general filesystem browser.
- **Git worktrees**: see [Worktrees in WebPi](./docs/worktrees.md) for switcher visibility, worktree creation, and removal behavior.
- **Building on WebPi**: wrappers and other downstream builds can hook into the session row context menu and register extension session liveness; see [Downstream integration](./docs/downstream-integration.md).

## Development

```bash
npm install
npm run dev
```

The development server runs at [http://127.0.0.1:30141](http://127.0.0.1:30141). Run the common checks with:

```bash
npm test
node_modules/.bin/tsc --noEmit
npm run lint
```

Do not run `next build` or `npm run build` during normal development: it writes to `.next/` and can interfere with the development server. Leave builds for release work.

Contributor guides: [Upstream sync](./docs/upstream-sync.md) (this fork tracks upstream weekly), [Internationalization](./docs/i18n.md), and [Release process](./docs/release.md).

## Repository Layout

```text
app/             Next.js UI and API routes
components/      React UI components
hooks/           Client state and interaction hooks
lib/             Session, agent, model, file, Git, and security logic
public/          Static assets and PWA files
bin/             npm CLI entrypoint, launch option parsing, startup port selection
desktop/         Electron shell: window, tray, service lifecycle, packaging
extensions/      Pi package extension that provides the /webpi command
skills/          Pi package skills
docs/            Focused user and contributor guides
demo/            Static browser demo published to GitHub Pages (see demo/README.md)
```

See [AGENTS.md](./AGENTS.md) for the architecture notes and detailed file map.

## License

[MIT](./LICENSE). Upstream copyright and attribution are retained; WebPi is a downstream build of [pi-web](https://github.com/agegr/pi-web).
