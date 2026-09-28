---
name: webpi
description: |
  WebPi is the local browser UI for pi, shipped in the same package as the
  /webpi command. Use when the operator wants to work with pi in a browser, asks
  for WebPi, wants a shareable or visual view of a session, or wants to open the
  current project on a phone, tablet, or second screen. Covers starting the
  server from the TUI or a shell, the default URL and port, argument passing,
  and what to do when the server is already running or will not start.
---

# WebPi

WebPi is a Next.js web interface that runs agent sessions in process, in the
same machine and the same user account as the `pi` CLI. It reads `~/.pi/agent`
(override with `PI_CODING_AGENT_DIR`), so sessions, credentials, models and
settings are shared with the TUI: nothing needs to be configured twice.

## Start it

From the TUI: `/webpi` starts the server and reports the URL. The command
forwards its arguments to the launcher, so `/webpi --port 8080` and
`/webpi -H 0.0.0.0` work the same way they do on the command line.

From a shell: `webpi` (after `npm install -g webpi`) or
`npx webpi`. The default URL is <http://127.0.0.1:30141>.

| Option | Meaning |
| --- | --- |
| `-p, --port <port>` | Port; `0` asks the OS for a free one. Default `30141` |
| `-H, --hostname <host>` | Bind host. Default `127.0.0.1` (loopback only) |
| `--no-open` | Do not open the browser |
| `-h, --help` | Print options and exit |

Useful environment variables (PI_WEB_ names are inherited from upstream
pi-web): `PI_WEB_PASSWORD` for password login, `PI_WEB_NO_OPEN`,
`PI_CODING_AGENT_DIR`, `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`,
`PI_WEB_IDLE_TIMEOUT_MS`.

## Behaviour worth knowing

- The server is started by the current process and stops when that session
  shuts down. Start it from a shell when it must outlive the TUI.
- If WebPi already serves the requested port, `/webpi` reports that URL
  instead of starting a second server over the same session files.
- If another program owns the port, the launcher moves to the next port (up to
  ten attempts) and prints the port it used.
- Binding a non-loopback host exposes an agent that can run commands. Require
  `PI_WEB_PASSWORD`, and use HTTPS or a VPN rather than plain HTTP.

## When it does not work

1. Read the message: "already running" means reuse the printed URL; a port
   warning means use the port the launcher printed.
2. `--help` failures and unknown options exit non-zero — the flag name is
   wrong, not the server.
3. If the browser shows nothing, check that the printed URL is reachable from
   the machine with the browser.
4. No model provider configured: use the **Models** panel in WebPi, or
   `/login` in the TUI. Both write the same credential store.
