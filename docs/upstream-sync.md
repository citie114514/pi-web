# Upstream sync

This fork (`citie114514/pi-web`) tracks [`agegr/pi-web`](https://github.com/agegr/pi-web).
The application is upstream's; this repository adds the `webpi` command, the
desktop application, the Pi package, the WebPi branding, and the packaging.

Keeping the gap small matters more than merging fast: a merge that lands 200
upstream commits at once is a debugging session, while a weekly merge is a code
review.

## The automated path

`.github/workflows/upstream-sync.yml` runs every Monday at 03:00 UTC and on
demand (`workflow_dispatch`). It has three outcomes:

| Upstream state | What happens |
| --- | --- |
| No new commits | The job exits without touching anything. |
| Merge without conflicts | Force-pushes the `upstream-sync` branch and opens a pull request (or updates the one already tracking that branch). |
| Merge with conflicts | Opens a single issue labelled `upstream-sync` listing the conflicting files, or updates it if one is already open. |

Nothing reaches `main` on its own. A clean textual merge is not proof that the
result runs — the branch is a place to build, test, and smoke-test first. The pull
request body repeats the checklist below.

To run it immediately:

```bash
gh workflow run upstream-sync.yml --repo citie114514/pi-web --ref main
```

Two things to know about the automated run:

- The pull request is created with the repository's `GITHUB_TOKEN`, and GitHub
  does not start workflow runs for events triggered by that token. So the CI
  checks will **not** appear on the sync pull request by itself; run the
  checklist locally, or push any commit to the branch to wake them up.
- GitHub disables `schedule` triggers in a repository that has had no activity
  for 60 days. If the weekly run silently stops, re-enable it from the Actions
  tab or dispatch it manually.

## Doing it by hand

The same steps, when the automated merge conflicts or you want to control it:

```bash
git fetch upstream
git rev-list --count HEAD..upstream/main    # how far behind

git checkout -b upstream-sync-manual main
git merge upstream/main                     # resolve conflicts here

npm install                                 # the pi SDK moves with upstream
npm run build
npm test                                    # see "expected failures" below
npm run lint
node_modules/.bin/tsc --noEmit

WEBPI_DESKTOP_SMOKE=1 npx electron desktop/main.js
# expect: data dir …, serving … (owned=true), title=WebPi

git push origin upstream-sync-manual
```

`npm test` on Windows has nine known, pre-existing failures (the file-viewer and
PATH tests); `docs/upstream-inventory.md` lists them. Any *other* failure is a
regression from the merge.

## What must survive a merge

Upstream cannot know about the fork's additions, so a merge can quietly revert
them. These are the things to check, and the tests that already guard them:

| What | Where | Guarded by |
| --- | --- | --- |
| WebPi fields in the manifest: `name`, `bin.webpi`, `pi`, `main`, `build`, `desktop:*` scripts, the pinned pi SDK | `package.json` | `lib/webpi-extension.test.mjs`, `lib/desktop-packaging.test.mjs` |
| The readiness contract `WebPi ready at <url>` / `WebPi is already running at <url>` | `bin/pi-web.js`, `extensions/webpi/index.ts`, `desktop/launcher.js` | `lib/webpi-extension.test.mjs` (asserts all three agree) |
| Reserved-port list, kept equal to Next.js's own | `bin/port-selection.js` | `lib/port-selection.test.mjs` |
| Branding: window title, manifest, empty-chat heading, sidebar label, Basic-auth realm, i18n strings | `app/`, `components/`, `lib/i18n/messages/*`, `proxy.ts` | reviewed by hand |
| The four readmes describe WebPi, link to each other, and embed `docs/screenshot.png` | `README*.md` | `lib/readme-branding.test.mjs` |
| Desktop shell and packaging | `desktop/`, `.github/workflows/desktop-release.yml` | `lib/desktop-*.test.mjs` |

Everything else — sessions, models, tools, terminal, worktrees, plugins — is
upstream's, and should be taken as-is.

## Fork-only files upstream will never touch

`desktop/`, `bin/port-selection.js`, `extensions/webpi/`, `skills/webpi/`,
`docs/webpi*.md`, `docs/upstream-sync.md`, and the two `desktop-*` workflows are
additions, so they merge without conflict. The files that *are* edited in both
places — `package.json`, `README.md`, `components/ChatWindow.tsx`,
`components/SessionSidebar.tsx`, `app/layout.tsx`, `lib/i18n/messages/*`,
`proxy.ts`, `eslint.config.mjs` — are where conflicts come from.

The four readmes are the loudest case: they were rewritten as WebPi documents, so
any upstream edit to them now conflicts instead of merging silently. Resolve by
keeping this fork's text and folding in the factual changes from upstream's side
(a new option, a new platform requirement). `lib/readme-branding.test.mjs` fails
if a readme ends up describing upstream's project instead of this one.

## History

| Date | Upstream | Result |
| --- | --- | --- |
| 2026-09-30 | 36 commits, pi 0.87.1 → 0.99.1 (streaming reasoning level, settings group switches, Git-driven file hiding, Safari fixes) | Zero conflicts; `npm test` 1569 tests / 1553 passing / the same 9 pre-existing Windows failures; desktop smoke check `owned=true title=WebPi` |
