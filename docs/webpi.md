# WebPi

WebPi is the downstream build of [pi-web](https://github.com/agegr/pi-web): the
local browser UI for the [pi coding agent](https://github.com/earendil-works/pi),
packaged so that a single command is enough to use Pi from a browser.

```bash
npm install -g .
webpi
```

## What this downstream adds

The application itself is upstream. This repository only adds a packaging and
branding layer, so upstream changes stay easy to merge:

| Layer | Change |
| --- | --- |
| Package identity | `name: webpi`, `bin: webpi` (the entry file stays `bin/pi-web.js`) |
| Startup | `webpi` picks a usable port before starting Next.js, reuses a WebPi server that already serves that port, skips ports owned by other programs, and prints one contract line with the real URL |
| Branding | Page title, PWA manifest, login page, window title, offline page and the three UI locales |
| Pi package | `pi.extensions` + `pi.skills` add the `/webpi` command and its skill |
| Desktop app | `desktop/` adds an Electron shell (window + tray, service started and stopped with the app, close dialog), packaging for Windows/Linux/macOS, and a portable mode — see `docs/webpi-desktop.md` |
| Docs | This file, `docs/webpi-desktop.md`, `docs/upstream-inventory.md`, and the README quick start |

Everything else — sessions, models, configuration, tools, terminal, worktrees,
plugins — is upstream behaviour.

## Intentionally unchanged

- **`PI_WEB_*` environment variables** keep their upstream names (`PI_WEB_PASSWORD`,
  `PI_WEB_NO_OPEN`, `PI_WEB_HOSTNAME`, `PI_WEB_ALLOWED_HOSTS`,
  `PI_WEB_IDLE_TIMEOUT_MS`, `PI_WEB_SKIP_VERSION_CHECK`). Renaming them would
  break every existing instruction, script and downstream wrapper for no user
  benefit. `webpi --help` lists them.
- **Session and credential compatibility.** WebPi reads `~/.pi/agent` (or
  `PI_CODING_AGENT_DIR`), so sessions, `settings.json`, `models.json` and
  `auth.json` are shared with the `pi` CLI and with upstream pi-web. Do not
  introduce a second config or session location.
- **The update check** (`app/api/app-update/route.ts`) still compares against the
  published upstream package, because upstream is where new versions come from.
  The banner therefore reports upstream versions.
- **`demo/`** is upstream's static GitHub Pages showcase and is not rebranded.

## Working on the fork

Remotes: `origin` is this fork (<https://github.com/citie114514/pi-web>),
`upstream` is `agegr/pi-web`. Push WebPi work to `origin` and merge upstream
in, never the other way around.

```bash
git fetch upstream
git merge upstream/main
```

Keep changes to the layers listed above. When a change must touch upstream
source, keep it minimal and describe the motivation in the commit message so the
next `git merge upstream/main` is a small conflict.

## Development

The upstream development notes in `AGENTS.md` apply unchanged: `npm run dev` on
port 30141, `node_modules/.bin/tsc --noEmit`, `npm run lint`, `npm test`, and no
`next build` while `npm run dev` is running.

Two additions live in this repository:

- `bin/port-selection.js` — pure startup port selection, unit tested by
  `lib/port-selection.test.mjs`.
- `extensions/webpi/index.ts` — the `/webpi` command. It starts the bundled
  launcher, parses the `WebPi ready at <url>` / `WebPi is already running at <url>`
  contract line, and kills the launcher's process tree on session shutdown.
- `desktop/` — the Electron shell and its packaging, unit tested by
  `lib/desktop-*.test.mjs`. Its only shared contract with the launcher is the
  readiness line above.

Changing that contract line means changing all three sides together.

## Licence

MIT, as upstream. Upstream copyright and attribution are kept in `LICENSE` and
in the README.
