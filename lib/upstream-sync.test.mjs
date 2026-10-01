import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const readRepoFile = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

const workflow = readRepoFile(".github/workflows/upstream-sync.yml");
const docs = readRepoFile("docs/upstream-sync.md");

test("the sync workflow runs on a schedule and on demand", () => {
  assert.match(workflow, /^name: Upstream sync$/m);
  assert.match(workflow, /^\s*schedule:$/m);
  assert.match(workflow, /- cron: "\d+ \d+ \* \* \d+"/);
  assert.match(workflow, /^\s*workflow_dispatch:$/m);
});

test("the sync workflow has the permissions it needs and no more", () => {
  assert.match(workflow, /permissions:\n\s+contents: write\n\s+issues: write\n\s+pull-requests: write/);
});

test("a clean merge becomes a pull request, never a direct push to main", () => {
  assert.match(workflow, /git merge --no-commit --no-ff upstream\/main/);
  assert.match(workflow, /gh pr create/);
  assert.match(workflow, /git push --force origin "\$SYNC_BRANCH"/);

  // The whole point of the workflow is that a human reviews the merge first.
  assert.doesNotMatch(workflow, /git push[^\n]*\bmain\b/, "must not push to main");
  assert.doesNotMatch(workflow, /git merge[^\n]*\n[^\n]*git push[^\n]*main/, "must not merge into main");
});

test("conflicts are reported instead of half-merged", () => {
  assert.match(workflow, /git diff --name-only --diff-filter=U/);
  assert.match(workflow, /git merge --abort/);
  assert.match(workflow, /gh issue create/);
  assert.match(workflow, /gh issue edit/);
  // The issue must be reused, otherwise a weekly conflict opens 52 issues a year.
  assert.match(workflow, /gh issue list --label upstream-sync --state open/);
});

test("the sync docs explain the routine and the fork invariants", () => {
  assert.match(docs, /upstream-sync\.yml/);
  assert.match(docs, /gh workflow run upstream-sync\.yml/);

  // Every invariant the docs tell a reviewer to check must still exist.
  for (const path of [
    "bin/pi-web.js",
    "extensions/webpi/index.ts",
    "desktop/launcher.js",
    "bin/port-selection.js",
    "lib/i18n/messages",
  ]) {
    assert.ok(docs.includes(path), `docs must mention ${path}`);
  }
  assert.match(docs, /WebPi ready at <url>/);
  assert.match(docs, /lib\/webpi-extension\.test\.mjs/);
});
