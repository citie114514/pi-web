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

CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, then a build
plus Playwright E2E on Node 22.19.0. `.github/workflows/demo-pages.yml` builds
`demo/` for GitHub Pages.

## Test baseline on Windows

`npm test` reported **1307 tests, 1295 passing, 10 failing** before any change
in this fork. After the WebPi packaging layer added 21 tests (port selection and
package contract), it reports **1328 tests, 1317 passing, 9 failing** — the same
pre-existing failures, no new ones:

- `only the active file tab mounts a FileViewer` and its three siblings
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

## Configuration and data touched at runtime

- Agent directory: `~/.pi/agent`, overridable with `PI_CODING_AGENT_DIR`.
  Sessions: `sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`. Also read:
  `settings.json`, `models.json`, `auth.json`, `models-store.json`,
  `agents/settings.json`.
- Default bind: `127.0.0.1:30141`. All user-visible options and environment
  variables are listed in the README and in `webpi --help`.
