# Papercuts

Small, non-blocking friction in the repository itself — the kind that will
waste the next contributor's time too. Log it in the moment; review and fix
entries in a separate, user-requested cleanup pass.

This is not a completed-work log, a bug tracker, or a place for the agent's own
sandbox/shell/network hiccups. Never include secrets, credentials, personal
data, or sensitive paths.

## Open

- [ ] `2026-08-20T20:36:32Z` — `codex` — The PR preview Access check treats an immediate workers.dev 404 as proof the preview is public, even though the same URL can begin returning the expected Access redirect seconds later; retry 404 responses as propagation-era errors before failing and recommending stage destruction.
- [ ] `2026-08-18T03:06:44Z` — `claude` — Changing an MCP tool's `outputSchema` while the dev server hot-reloads makes in-flight MCP sessions reject the tool's own (already billed) results — clients validate against the schema cached at connect time, surfacing as "must NOT have additional properties". Note in the MCP dev docs/skill: reconnect the MCP session after any output-schema change before re-testing live.
- [ ] `2026-08-05T20:59:09Z` — `codex` — The documented `pnpm seed:rank-tracking` command fails before opening local D1 because `scripts/seed-rank-tracking.ts` imports the provider-aware `src/db/schema` barrel and plain `tsx` cannot load the resulting `cloudflare:workers` URL. Keep the seed script on dialect-local schema imports or run it through a Workers-compatible execution path. (Workaround: seed via raw SQL with `wrangler d1 execute DB --local`.)
- [ ] `2026-08-01T16:28:36Z` — `claude` — web's pinned wrangler 4.71.0 fails `kv namespace create` with a bare "Authentication error [code: 10000]" even though the OAuth token has workers_kv write scope; wrangler@4.118.0 succeeds with identical auth. Fix: bump wrangler in web/package.json.
- [ ] `2026-07-20T20:08:28Z` — `claude` — In a fresh git worktree, `oxlint --type-aware` crashes with `Cannot find module '@oxlint/binding-darwin-arm64'` — the platform-specific optional dep is missing from the worktree's node_modules while tsc/prettier work fine, and plain `pnpm install` reports up-to-date without restoring it; `pnpm install --force` (~22s) fixes it. Worth making the worktree-setup hook (or a documented step) run the forced install so lint doesn't die on fresh worktrees.
- [ ] `2026-07-19T04:06:52Z` — `codex` — `pnpm --dir web build` fails with `vite: command not found` when `web/node_modules` is absent, despite the root toolchain being installed. Document or enforce the package-local install required before validating the `web/` subpackage.
- [ ] `2026-07-19T02:55:56Z` — `claude` — Adding a docs folder under `web/content/docs` whose `meta.json` lists an `[Overview](...)` link renders a duplicated, double-highlighted sidebar entry, because the folder-index strip in `web/src/lib/source.ts` (`transformPageTree.folder`) is a per-folder-name allowlist. Derive it from the meta convention (or strip the index for all folders) so new sections don't need a hidden source.ts edit.
- [ ] `2026-07-14T01:28:30Z` — `claude` — Regenerating the lockfile (adding or moving a dep) makes `pnpm install` re-run the `minimumReleaseAge` gate on transitive peers already pinned at that exact version (`mysql2`, `sql-escaper`, `@aws-sdk/credential-providers`), failing the install even though nothing about them changed. `pnpm install --config.minimumReleaseAge=0` — then confirm the lockfile diff stays version-neutral — unblocks it; worth documenting that regen step so the gate doesn't re-block already-pinned versions.
- [ ] `2026-07-10T21:28:46Z` — `codex` — `pnpm --dir badseo run typecheck` works through the root toolchain but `pnpm --dir badseo run build` can't find Vite because `badseo/node_modules` is absent. Document or enforce the package-local install before validating the `badseo/` subpackage.
- [ ] `2026-07-10T21:32:10Z` — `codex` — Formatting the `badseo/` workspace with `pnpm exec prettier` fails because Prettier is only available from the repository root. Document the root-only formatter command or expose a workspace-local formatting script.

## Resolved

Move fixed entries here, mark them checked, and append the resolving date or commit.

## badseo harness vs `wrangler dev`: sitemap emits badseo.dev locs locally

`badseo/scripts/run-audit.ts` against a local `wrangler dev --port 8787` fails 4
sitemap-dependent checks (orphan page, 500, 403, duplicate-content) with
NOT CRAWLED: wrangler dev adopts the `badseo.dev` custom-domain route as the
host the worker sees, so `/sitemap.xml` emits `http://badseo.dev/...` locs that
the crawler's same-origin filter drops. Run it as
`wrangler dev --port 8787 --local-upstream "localhost:8787"` (after
`vite build`). Also: `pnpm --filter badseo audit` fails with
"Unknown option: 'recursive'" from the repo root — badseo is its own pnpm
workspace, not a root workspace member; use `npx tsx badseo/scripts/run-audit.ts`.

## 2026-09-11 — `node_modules/zod` symlink pointed at an empty package dir

**Friction:** `require("zod")` failed repo-wide with `MODULE_NOT_FOUND`, blocking any vitest
run that touches `src/server/lib/dataforseo/*`. The top-level `node_modules/zod` symlink
resolves to `node_modules/.pnpm/zod@4.3.6/node_modules/zod`, and that directory was present
but completely empty. A sibling `zod@4.4.3` was intact, which makes the failure look
selective and easy to misdiagnose as "node_modules is corrupted repo-wide".

**Gotcha:** `pnpm install --offline --frozen-lockfile` reports `Already up to date` and does
NOT repair it — pnpm treats an empty-but-present package directory as installed.

**What worked:** remove just the broken directory, then relink from the local store:
```
mv node_modules/.pnpm/zod@4.3.6 ~/.alex-trash/$(date +%F)/
pnpm install --offline
```
`pnpm-lock.yaml` stays untouched. Suspected cause: OneDrive sync, consistent with the
existing OneDrive-vs-file-write friction noted in the render-reports playbook.

## 2026-09-15 — the empty-package-dir failure hits several packages at once; scan for all of them

**Friction:** same root cause as the 2026-09-11 `zod` entry (OneDrive leaves pnpm package
directories present but empty), except six packages were hollow at once: `undici`,
`eventsource-parser`, `@vercel/oidc`, `@standard-schema/spec`, `@workflow/serde` and
`json-schema`. Fixing them one at a time cost three dev-server restarts, each surfacing only
the next missing module — `Cannot find module 'undici'`, then `Could not resolve
"eventsource-parser"`, and so on. `pnpm install` keeps reporting `Already up to date`
because it treats an empty-but-present directory as installed.

**What worked:** stop chasing them one by one and enumerate every hollow package first — a
real directory (not a symlink) under `.pnpm/*/node_modules/` with no `package.json` in it:

```
node -e "
const fs=require('fs'),path=require('path');const root='node_modules/.pnpm';let empty=[];
for(const d of fs.readdirSync(root)){const nm=path.join(root,d,'node_modules');if(!fs.existsSync(nm))continue;
for(const p of fs.readdirSync(nm)){const es=p.startsWith('@')?fs.readdirSync(path.join(nm,p)).map(s=>p+'/'+s):[p];
for(const e of es){const f=path.join(nm,e);let st;try{st=fs.lstatSync(f)}catch{continue}
if(st.isSymbolicLink())continue;if(!fs.existsSync(path.join(f,'package.json')))empty.push(d);}}}
console.log(empty.length, empty.join(' '));"
```

Then move that whole list to trash in one go and run `pnpm install` once. Re-run the scan to
confirm it prints `0`. `pnpm-lock.yaml` stays untouched.

**Gotcha:** the scan must skip symlinks. The hollow directory is the store entry itself; the
symlinks pointing at it look fine, which is why the failure reads as "module not found" for
a package that `ls node_modules` clearly shows.

## 2026-09-15 — writing a large file with a bash heredoc fails on Windows

**Friction:** `cat > file <<'EOF' ... EOF` with a large body fails with
`ENAMETOOLONG: uv_spawn` on Windows, because the whole heredoc becomes part of the spawned
command line. Hit while writing a ~39KB report.

**What worked:** use the Write tool instead. Short appends (a few dozen lines, like this
entry) are fine via `cat >>`.
