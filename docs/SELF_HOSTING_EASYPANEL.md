# Easypanel Self-Hosting

Run OpenSEO on [Easypanel](https://easypanel.io) (Docker Swarm-based PaaS) as a **single
service** — the app and the visual-report render pipeline (Puppeteer/Chrome) run together in
one container, built from [`Dockerfile.selfhost.render`](../Dockerfile.selfhost.render).

This guide uses `AUTH_MODE=hosted` (real email/password login via Better Auth) rather than
Docker self-hosting's usual default of `local_noauth` — since Easypanel attaches a public domain
with automatic SSL, `local_noauth` would leave the app open to anyone who finds the URL, logged
in as `admin@localhost` with no password. `hosted` mode requires a Google OAuth app (see
[Step 2](#step-2--environment-variables)) — Better Auth's config construction hard-fails without
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` in this mode, even if you only intend to offer
email/password login (verified in `src/lib/auth.ts:242-248`).

## Why one container

An earlier revision of this guide deployed the renderer as its own Easypanel service, networked
to the app over the internal per-project DNS. We moved to a single combined container instead:
one service to deploy/update/monitor, and `RENDERER_URL` defaults to `http://localhost:3100`
with nothing to configure — no service-naming discipline, no risk of the two ending up in
different projects and failing to reach each other.

The tradeoff: Puppeteer/Chromium's memory now shares the app container's resource budget instead
of scaling independently. We're deploying this way first specifically to measure real RAM usage
before deciding whether to split it back out (see [Known limitation /
next step](#known-limitation--next-step) below).

`Dockerfile.selfhost.render` never modifies [`Dockerfile.selfhost`](../Dockerfile.selfhost) —
it builds `FROM` the already-published upstream image
(`ghcr.io/every-app/open-seo:latest` by default) and layers the renderer on top. This repo's
`fork/main` can sync new upstream releases without ever hand-merging that file.

## Prerequisites

- An Easypanel server (Ubuntu 22.04+). **4GB RAM minimum** — Chromium now shares the app
  container's memory budget; see the RAM guardrail note below.
- A DataForSEO API key (see [`DATAFORSEO_API_KEY.md`](./DATAFORSEO_API_KEY.md)).
- This repo pushed to a Git host Easypanel can pull from (GitHub, GitLab, or a self-hosted Git
  server it can reach), branch `fork/main`.

## Step 1 — Create the project and service

1. In Easypanel: **Create Project**, name it (e.g. `open-seo`).
2. Add an **App** service inside it.
3. Source: connect the Git repo, branch `fork/main`.
4. Build method: Dockerfile, path `Dockerfile.selfhost.render`, build context = repo root (not
   a subdirectory — this file needs the whole repo to build both the app base image's context
   and `renderer/`).
5. Port: **3001** (this is the only port that needs to be exposed — the renderer's internal
   port 3100 stays inside the container, nothing external talks to it directly).
6. Domain: attach your public domain/subdomain (Easypanel provisions SSL via Traefik
   automatically once DNS points at the server).
7. Volume: mount a persistent volume at `/app/.wrangler` — this is where the app's local D1
   (SQLite) state and R2-equivalent local storage live under workerd. Without this, **all data
   is lost on every redeploy**. Matches `compose.yaml`'s `open_seo_data:/app/.wrangler`.
8. Resource limit: set a memory limit on the service (Easypanel's resource controls, or
   equivalent to `compose.yaml`'s `mem_limit: 1536m`) so a Chrome memory spike gets the
   container restarted cleanly instead of taking down the whole host. Adjust once you've
   measured real usage (see below).

## Step 2 — Environment variables

```
CLOUDFLARE_INCLUDE_PROCESS_ENV=true
PORT=3001
AUTH_MODE=hosted
BETTER_AUTH_URL=https://your-domain.com
BETTER_AUTH_SECRET=<generate a random secret — see below>
GOOGLE_CLIENT_ID=<from Google Cloud Console — see below>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console — see below>
DATAFORSEO_API_KEY=<your base64 email:password — see DATAFORSEO_API_KEY.md>
RENDER_API_TOKEN=<generate a random secret — see below>
```

`RENDERER_URL` does **not** need to be set — the container's own entrypoint defaults it to
`http://localhost:3100` since the renderer now runs in the same container.

### `hosted` mode requirements (verified in code, not just the `.env.example` comment)

`src/lib/selfhost-preflight.ts` refuses to start the container unless **all four** of
`BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` are set —
and `src/lib/auth.ts`'s `getGoogleSocialProviderConfig()` throws at auth construction time
without the Google pair too, so this isn't just a preflight formality. Email/password login
itself doesn't technically need Google (Better Auth configures `emailAndPassword` separately),
but this app's `hosted` mode currently requires the Google credentials regardless.

`POSTHOG_PUBLIC_KEY`/`POSTHOG_HOST` and the three `LOOPS_*` variables share the same
`.env.example` comment block but are **not** required to boot — Loops sends the
verification/password-reset emails and PostHog is analytics; without them the app starts fine,
those specific emails just won't send.

**Generating `BETTER_AUTH_SECRET`** (must be 32+ characters):

```bash
openssl rand -hex 32
```

**Setting up the Google OAuth app** (Google Cloud Console → APIs & Services → Credentials →
Create OAuth client ID, type "Web application"):
- Authorized redirect URI: `https://your-domain.com/api/auth/callback/google` (Better Auth's
  default callback path — no custom `basePath` override exists in this repo's config, verified
  by grep).
- Copy the generated Client ID / Client Secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

### Generating `RENDER_API_TOKEN`

This is the shared secret that gates `GET /api/render/` (used by n8n or anything else pulling
report PNGs — see [`RENDER_REPORTS_API.md`](./RENDER_REPORTS_API.md) for the full contract).
Unrelated to auth — generate it the same way:

```bash
openssl rand -hex 32
```

**If this is unset, the render endpoint refuses every request with `503`** — it never falls
back to open access.

## Step 3 — Deploy and verify

First build compiles the app AND installs Puppeteer's bundled Chromium — expect several minutes
longer than a plain app-only build. Once it's up:

```bash
# App health (config + DB status)
curl https://your-domain.com/api/health

# Render pipeline end-to-end (needs RENDER_API_TOKEN)
curl -H "Authorization: Bearer $RENDER_API_TOKEN" \
  "https://your-domain.com/api/render/?report=backlinks&domain=example.com&country=ES&device=desktop" \
  -o test.png
file test.png   # should report a PNG, several hundred KB, height > 800px
```

If the render call times out or 502s, check the service logs — most likely Chromium failed to
launch (missing a system library `apt-get` didn't cover, or the memory limit is too tight for
even one Chrome instance to start; see the RAM section below).

## Measuring RAM usage

This is the open question this deployment mode exists to answer. Once running:

```bash
docker stats <container-name-or-id> --no-stream
```

Watch it specifically:
- **At idle** (no renders happening) — this is Chrome's baseline once launched (~100–300MB) on
  top of the app's own footprint.
- **During/after a render** — each render opens and closes a page on the shared browser
  instance; watch whether memory returns close to the idle baseline afterward or creeps upward.
- **Under a burst** — trigger 2-3 renders back to back (the app has no concurrency cap on the
  renderer today) and watch the peak.

Report these three numbers back before deciding whether to keep this combined deployment or
split the renderer back out into its own service (or swap the Chrome runtime for a
separately-maintained one, e.g. Steel Browser).

## Updating

Configure auto-deploy on `fork/main`, or trigger manually from the service's **Deploy** button
after pushing.

## Known limitation / next step

Puppeteer/Chromium currently has no hard concurrency cap (a burst of simultaneous render
requests each opens a new page on the shared browser instance with no queue) and the browser
process is never recycled — it lives for the container's entire uptime. Both are candidates for
hardening once we have real memory numbers from this deployment, ahead of deciding whether
Chrome should keep living in this container at all.

The renderer's screenshot capture is full-page height, fixed 1280px width (see
[`RENDER_REPORTS_API.md`](./RENDER_REPORTS_API.md#limitations) for the current parameter
contract).
