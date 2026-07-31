# openseo-renderer

A small, deliberately "dumb" Node microservice that receives HTML and returns a
PNG screenshot. It does **not** call DataForSEO and knows nothing about SEO — it
only screenshots HTML. Used by the OpenSEO visual-report pipeline: the main
Cloudflare Worker app renders report HTML and POSTs it here because `workerd`
cannot run Chromium inline.

## Contract

### `POST /screenshot`

Request body (JSON):

| Field            | Type     | Required | Default | Notes                                            |
|------------------|----------|----------|---------|--------------------------------------------------|
| `html`           | string   | yes      | —       | Non-empty HTML to render.                        |
| `width`          | number   | no       | `1280`  | Positive integer. Viewport + clip width (px).    |
| `height`         | number   | no       | `800`   | Positive integer. Viewport + clip height (px).   |
| `waitForSelector`| string   | no       | —       | CSS selector to wait for (visible) before shot.  |

Responses:

- `200` — `Content-Type: image/png`, body is the PNG bytes.
- `4xx` / `5xx` — `Content-Type: application/json`, body `{ "error": string }`.
  - `400` invalid body / failed Zod validation.
  - `502` Chromium render/screenshot failure.

### `GET /health`

`200 { "ok": true }`

## Environment variables

| Name                         | Default | Description                                              |
|------------------------------|---------|----------------------------------------------------------|
| `PORT`                       | `3100`  | Port to listen on.                                       |
| `PUPPETEER_NAV_TIMEOUT_MS`   | `30000` | Launch/navigation/screenshot timeout (≈ per-request cap). |

Listens on `0.0.0.0`.

## Run locally

The renderer uses **npm** (Node 22+) and is intentionally not part of the
repo's pnpm workspace.

```bash
cd renderer
npm install           # downloads Chromium on first run (puppeteer postinstall)
npm run build
npm start             # or: npm run dev  (build + run)
```

Quick check:

```bash
curl -s http://localhost:3100/health
# {"ok":true}

curl -s -X POST http://localhost:3100/screenshot \
  -H 'content-type: application/json' \
  -d '{"html":"<h1 style=\"font-family:sans-serif\">OpenSEO render test</h1>","width":400,"height":200}' \
  -o out.png
file out.png   # PNG image data, ...
```

## Docker / Compose

Build the image (npm is used inside the container too, no pnpm/corepack needed):

```bash
docker build -t openseo-renderer ./renderer
docker run --rm -p 3100:3100 openseo-renderer
```

The root `compose.yaml` defines a `renderer` service alongside `open-seo`:

```bash
docker compose up -d renderer
```

Within the Compose network the main app reaches it at `http://renderer:3100`.

## Design notes

- **Single browser, page per request.** One Chromium instance is launched lazily
  on first use and reused; each request gets its own `Page`, closed in a
  `finally`. Launching Chromium per request would be far too slow.
- **Hono + `@hono/node-server`** for HTTP — Hono is already a dependency of the
  main app, has a tiny dependency surface, and is TypeScript-native.
- **Zod** validates the untrusted request body at the trust boundary (per repo
  convention).
- **Per-request timeout** is the Puppeteer navigation timeout
  (`PUPPETEER_NAV_TIMEOUT_MS`, ~30s) — the only slow operation is the render
  itself, so this is the effective request cap.
- **Graceful shutdown:** `SIGTERM`/`SIGINT` close the HTTP server and Chromium.

## Known limitations (E0.1 scope)

- The bundled Chromium makes the image large (~400 MB+). Acceptable for E0; a
  `puppeteer-core` + system-Chromium variant is a future optimization.
- `setContent` waits for the `load` event (puppeteer does not support
  `networkidle0` for `setContent`); `waitForSelector` covers lazy-rendered
  elements like charts.
- No auth on `/screenshot` — the service must live on an internal network
  (Compose/Easypanel) and not be exposed publicly. Auth lives in the main app's
  `/api/render` endpoint (E0.3), not here.
