# Upstream inventory

Recorded when this fork was created, as the baseline for future
`git merge upstream/main` work. Re-run the listed commands after each upstream
merge and update this file when the facts change.

| Fact | Value |
| --- | --- |
| Upstream repository | https://github.com/agegr/pi-web |
| Baseline commit | `96966e5f887e9b127c4ae651a8ccdd8493dc18f5` |
| Baseline commit date | 2026-09-23 14:58:44 +0800 |
| Baseline commit subject | `fix(demo): CI typecheck, downloads on Pages, README auto-tab (#950)` |
| Baseline package version | `0.9.3` (published as `@agegr/pi-web`) |
| Licence | MIT (`LICENSE`) |
| Node.js engine | `>=22.19.0`, checked again at startup by `bin/node-version.js` |

## Shape

- Next.js 16 application using the App Router; `app/` holds routes and
  route handlers, `components/` the UI, `lib/` the server-side logic.
- Browser calls `/api/*`; agent sessions run in process through
  `createAgentSession()` from the SDK (`lib/rpc-manager.ts`), not through a
  child process or RPC.
- `bin/pi-web.js` is a CommonJS launcher that resolves Next.js and starts
  `next start` as a child process, opening a browser once Next.js reports
  readiness.
- No bundler for the launcher: `bin/*.js` is plain CommonJS run by Node
  directly. Application code is TypeScript compiled by Next.js.
- `demo/` is a separate private Next.js project (own `package.json` and
  lockfile) that renders a backend-free showcase for GitHub Pages.

## Commands at baseline

| Purpose | Command |
| --- | --- |
| Dev server (`127.0.0.1:30141`) | `npm run dev` |
| Production build | `npm run build` (`next build --webpack`) |
| Production server | `npm start` (`next start`) |
| Typecheck | `node_modules/.bin/tsc --noEmit` |
| Lint | `npm run lint` |
| Unit tests | `npm test` (node test runner over `app/`, `components/`, `hooks/`, `lib/`, `public/`) |
| E2E (Playwright) | `npm run test:e2e`, `npm run test:terminal` |
| Desktop app (Windows/Linux/macOS) | `npm run desktop` (source) / `npm run desktop:dist` (installer + portable) / `npm run desktop:portable` (marker + zip + SHA256SUMS) |

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, then a build
plus Playwright E2E on Node 22.19.0. `.github/workflows/demo-pages.yml` builds
`demo/` for GitHub Pages.

## Test baseline on Windows

`npm test` reported **1307 tests, 1295 passing, 9 failing** before any change
in this fork. After the WebPi packaging layer and the desktop shell added tests
(port selection, package contract, close policy, tray menu, service supervisor,
desktop settings, portable resolution, packaging config), it reports **1384
tests, 1373 passing, 9 failing, 2 skipped** — the same pre-existing failures,
no new ones:

- `only the active file tab mounts a FileViewer`
- `the active viewer restores tab state and saves it with a revision`
- `closing the file panel pauses the active viewer watcher`
- `markdown preview links forward a PDF page fragment to the viewer`
- `renders image warnings for known text-only defaults without an explicit model selection`
- `a project-level value is reported as shadowing the global one`
- `direct bash updates the platform PATH key`
- `native PTY starts after install and repeated creation reuses the same workspace process`
- `unclaimed creations expire without requiring a browser cleanup request`

They are Windows-specific and unrelated to packaging; they are not fixed here
because that would diverge from upstream without addressing the product goal.
`lib/subagent-isolation.test.mjs` (`isolated worktrees are unique, write-safe, …`)
is load-sensitive in a full parallel run while passing on its own; treat it as
flaky, not as a regression signal.

## Desktop packaging note

The Windows artifact set was built and exercised on this machine
(`electron-builder --win`): NSIS installer, single-file portable, and the
portable zip. A packaged build starts its own service, loads the UI, and releases
the port when the app quits; a portable build writes its settings into the
extracted folder.

Linux and macOS are built by `.github/workflows/desktop-release.yml` on real
runners. The first CI run filed two bugs that a Windows-only check could not see:
electron-builder omits the architecture suffix when it matches the host, and
per-target `arch` arrays in the config overrode the CLI flags, so both Linux jobs
built both architectures and their identically named portable zips overwrote each
other. Both are fixed (the arch now comes from the folder or the executable
header, plus a duplicate-name guard, and the workflow passes the arch); the run
that follows this commit is the verification.

## Configuration and data touched at runtime

- Agent directory: `~/.pi/agent`, overridable with `PI_CODING_AGENT_DIR`.
  Sessions: `sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`. Also read:
  `settings.json`, `models.json`, `auth.json`, `models-store.json`,
  `agents/settings.json`.
- Default bind: `127.0.0.1:30141`. All user-visible options and environment
  variables are listed in the README and in `webpi --help`.
