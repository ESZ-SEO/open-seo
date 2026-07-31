# Agent guidance

## Engineering principles

- Prefer simple, readable, flat code with minimal indirection.
- Search for existing implementations and installed libraries before creating new helpers or abstractions.
- Abstract when it prevents meaningful drift and makes the result simpler to maintain. Avoid speculative or one-use abstraction layers.
- Keep product data normalized and relationships explicit. Do not encode relational data in JSON or text merely to avoid joins.
- For new application-backed backend functionality, default to: TanStack server function → service → repository.
- Keep schema changes, queries, and mutations compatible with both SQLite and Postgres.
- Use idiomatic TypeScript. Use Zod to validate untrusted data and narrow runtime values at trust boundaries.
- Prefer established project helpers and libraries over hand-rolled implementations.
- Prefer idiomatic TanStack Query, Router, and Form patterns for server state, routing, and submitted forms.

## Log papercuts

When small, non-blocking repository friction occurs—a retried tool call, confusing setup step, flaky command, stale cache, misleading error, or non-obvious gotcha—use the `papercuts` skill and append it to `.agents/PAPERCUTS.md` in the moment. Continue the current task. Real bugs and tracked work are not papercuts, and sensitive data must never be logged.

Do not mine an entire session for papercuts or start a broad cleanup unless the user explicitly asks.

## Preserve review learnings

After a merge-ready or other code review verifies a finding, use `maintain-greptile-rules` only when the finding exposes a recurring or high-risk repository invariant that existing `.greptile/` context and automated checks do not capture. Do not promote one-off bugs or preferences into permanent review rules.

Changes to `.greptile/**`, `AGENTS.md`, `CLAUDE.md`, `.agents/skills/**`, and `.github/**` alter the review control plane and must receive explicit maintainer review. CODEOWNERS requests that review; where repository settings allow, enable GitHub's requirement for code-owner approval. Repository-specific rules live in `.greptile/`; maintainers should configure or retain a minimal org-enforced Greptile baseline for external-contribution, secret, authentication, billing, CI, and rule-tampering risks. Agents should report an unverified or missing baseline and must not mutate dashboard or organization rules without explicit user authorization.

## Fork workflow

This repository is a fork. `origin` = `ESZ-SEO/open-seo` (your fork); `upstream` = `every-app/open-seo` (the original, **push disabled**). Three-branch model; upstream is integrated by **merge** (no rebase, no force-push).

| Branch | Purpose |
|--------|---------|
| `main` | Pure mirror of `upstream/main`. **Sync only — never commit here.** |
| `fork/main` | Fork integration branch. All fork-only development lives here. Deploy targets this branch. |
| `feature/*` | Short-lived per-epic branches, off `fork/main`, merged back into `fork/main`. |

### Hard rules
- **Never commit to `main`.** It must stay identical to `upstream/main` so it can fast-forward.
- **Never push to `upstream`** (its push URL is disabled — keep it that way).
- **All new work goes on `fork/main`** (or a `feature/*` branch off it).
- **`.dev/` is gitignored** — specs, notes and agent logs are local-only; never commit them.

### Sync the upstream into the fork
Run this when a new upstream release lands. The `--ff-only` on `main` is an intentional fuse: if it fails, someone dirtied `main`.
```bash
git fetch upstream
git checkout main
git merge --ff-only upstream/main
git push origin main
git checkout fork/main
git merge main          # merge commit; resolve conflicts once here if any
git push origin fork/main
```

### Everyday work (one epic)
```bash
git checkout fork/main
git checkout -b feature/<name>
# work, commit...
git checkout fork/main
git merge --no-ff feature/<name>
git push origin fork/main
git branch -d feature/<name>
```

### Contributing a bugfix back to upstream
Branch clean off `main` (no fork-only work) and open a PR to `every-app/open-seo`. Never include fork-only changes in upstream PRs.
