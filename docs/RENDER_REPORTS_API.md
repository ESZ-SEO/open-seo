# Render Reports API

Generates branded PNG snapshots of SEO reports (Backlinks, Competitors, Domain
Overview) for embedding into automated documents. Designed to be called by
n8n over plain HTTP GET — no custom SDK, no headers beyond the bearer token.

The endpoint is a thin Cloudflare Worker handler that orchestrates a
dedicated Puppeteer/Chromium microservice to render the report HTML and
captures a PNG. Results are cached in R2 to keep repeat renders cheap.

## Endpoint

```
GET /api/render/
```

The trailing slash is required. TanStack Router mounts the handler at
`src/routes/api/render/$.ts`; the `$` is a path-component placeholder that
matches the empty string, so the public URL is `/api/render/`.

All report coordinates travel as query-string parameters. Auth is accepted
two ways (see [Auth](#auth)).

## Auth

Two mechanisms are accepted; the bearer-header form takes priority when both
are present.

**Bearer header** (preferred for anything that supports custom headers):

```bash
curl -H "Authorization: Bearer $RENDER_API_TOKEN" \
  "http://localhost:3001/api/render/?report=overview&domain=example.com&country=ES&device=desktop" \
  -o overview.png
```

**`?token=` query parameter** (for plain HTTP GET clients — e.g. n8n's HTTP
Request node, where setting custom headers is awkward):

```bash
curl "http://localhost:3001/api/render/?report=overview&domain=example.com&country=ES&device=desktop&token=$RENDER_API_TOKEN" \
  -o overview.png
```

The token is the shared secret bound to the `RENDER_API_TOKEN` environment
variable. Comparison is constant-time (SHA-256 both inputs, XOR-accumulate),
so timing does not leak the expected token.

| Status | Body                                 | When                                                   |
| ------ | ------------------------------------ | ------------------------------------------------------ |
| 401    | `{"error":"TOKEN_REQUIRED"}`         | No `Authorization` header and no `?token=` query param |
| 401    | `{"error":"TOKEN_INVALID"}`          | Presented token does not match `RENDER_API_TOKEN`      |
| 503    | `{"error":"RENDER_API_TOKEN_UNSET"}` | `RENDER_API_TOKEN` env is empty / unset                |

`503` indicates a deployment misconfiguration — the endpoint refuses every
request when no secret is set, never permits open access.

## Parameters

All parameters are query-string. `report` and `domain` are required; the rest
have product defaults.

| Name          | Required | Type                                          | Default   | Example                   |
| ------------- | -------- | --------------------------------------------- | --------- | ------------------------- |
| `report`      | yes      | `backlinks` \| `competitors` \| `overview`    | —         | `report=backlinks`        |
| `domain`      | yes      | string (trimmed, non-empty)                   | —         | `domain=example.com`      |
| `country`     | no       | string (trimmed, non-empty)                   | `ES`      | `country=US`              |
| `device`      | no       | `desktop` \| `mobile` \| `tablet`             | `desktop` | `device=mobile`           |
| `competitors` | no       | CSV (max 2, deduped, self-references dropped) | —         | `competitors=a.com,b.com` |

`competitors` is only consulted when `report=competitors`. When omitted on a
`competitors` report, the report degrades to a single-domain view
(see [Competitors report](#competitors-report)).

Note: `device` is validated and passed to the report template as an
informational chip — it does **not** change the renderer's viewport, which is
fixed at 1280×800px. See [Limitations](#limitations).

Unknown `report` or `device` values, missing `domain`, or empty `domain` all
return `400 INVALID_PARAMS`:

```bash
$ curl -H "Authorization: Bearer test-token" \
    "http://localhost:3001/api/render/?report=algo-invalido&domain=example.com&country=ES&device=desktop"
{"error":"INVALID_PARAMS","details":{"formErrors":[],"fieldErrors":{"report":["Invalid option: expected one of \"backlinks\"|\"competitors\"|\"overview\""]}}}
```

## Report types

### Backlinks report

`report=backlinks` — summary of the referring-domain profile for `domain` in
`country`: top referring domains, anchor-text distribution, follow/nofollow
split, and a few trend series. Implemented in E1.

### Competitors report

`report=competitors` — comparison of `domain` against up to two competitor
domains. The Venn-style intersection and the side-by-side KPI table are the
signature elements. When `competitors` is omitted, the report renders a
single-domain view (no comparison panel). Implemented in E2.

### Overview report

`report=overview` — one-page Domain Overview summary: 5 KPI tiles, country
distribution table, two charts. Implemented in E3.

## Examples

All three report types, called against the local dev stack
(`pnpm dev` on port 3001, with `RENDERER_URL=http://localhost:3100` pointing
at a running `renderer/` microservice and `RENDER_API_TOKEN=test-token`).

### Backlinks

```bash
$ curl -H "Authorization: Bearer test-token" \
    "http://localhost:3001/api/render/?report=backlinks&domain=example.com&country=ES&device=desktop" \
    -o backlinks.png -w "STATUS:%{http_code}|TYPE:%{content_type}|BYTES:%{size_download}|TIME:%{time_total}s\n"
STATUS:200|TYPE:image/png|BYTES:58781|TIME:0.023s
```

PNG: 58781 bytes, 1280×800.

### Competitors

```bash
$ curl -H "Authorization: Bearer test-token" \
    "http://localhost:3001/api/render/?report=competitors&domain=example.com&country=ES&device=desktop" \
    -o competitors.png -w "STATUS:%{http_code}|TYPE:%{content_type}|BYTES:%{size_download}|TIME:%{time_total}s\n"
STATUS:200|TYPE:image/png|BYTES:54293|TIME:0.220s
```

With explicit competitors via CSV:

```bash
$ curl -H "Authorization: Bearer test-token" \
    "http://localhost:3001/api/render/?report=competitors&domain=example.com&country=ES&device=desktop&competitors=foo.com,bar.com" \
    -o competitors-csv.png -w "STATUS:%{http_code}|TYPE:%{content_type}|BYTES:%{size_download}|TIME:%{time_total}s\n"
STATUS:200|TYPE:image/png|BYTES:59987|TIME:0.183s
```

### Overview

```bash
$ curl -H "Authorization: Bearer test-token" \
    "http://localhost:3001/api/render/?report=overview&domain=example.com&country=ES&device=desktop" \
    -o overview.png -w "STATUS:%{http_code}|TYPE:%{content_type}|BYTES:%{size_download}|TIME:%{time_total}s\n"
STATUS:200|TYPE:image/png|BYTES:63334|TIME:0.180s
```

### n8n-style (`?token=` query)

```bash
$ curl \
    "http://localhost:3001/api/render/?report=overview&domain=example.com&country=ES&device=desktop&token=test-token" \
    -o overview-n8n.png -w "STATUS:%{http_code}|BYTES:%{size_download}|TIME:%{time_total}s\n" -D -
HTTP/1.1 200 OK
content-type: image/png
cache-control: private, max-age=300
content-length: 63334
…
STATUS:200|BYTES:63334|TIME:0.020s
```

## Cache

Two caching layers cooperate; they serve different purposes and have different
TTLs.

**Internal soft-TTL** (the `render-cache/` R2 prefix): exact-match by
`report` + `domain` + `country` + `device` + sorted/deduped `competitors`.
Served from R2 with `customMetadata.expiresAt`; expired-on-read. Soft, not
hard — physical cleanup is deferred to E5.2.

| Report type   | Internal TTL |
| ------------- | ------------ |
| `backlinks`   | 30 days      |
| `competitors` | 15 days      |
| `overview`    | 7 days       |

Empirical cache-hit speedup (same `report=backlinks&domain=example.com&...`):

| Call | Wall time | Bytes |
| ---- | --------- | ----- |
| 1st  | 23 ms     | 58781 |
| 2nd  | 15 ms     | 58781 |

Identical bytes confirm a real cache hit (not a re-render that happened to be
fast).

**HTTP `cache-control`**: the response carries `private, max-age=300`
(5 minutes). This only affects browsers and intermediate HTTP caches — it
does not gate the internal soft-TTL above. `private` means the response must
not be stored by a shared cache (it carries the same auth secret a shared
cache would otherwise need to honour).

## Errors

| Status | `error` code             | When                                                                         | Body shape                                                             |
| ------ | ------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 200    | —                        | Render succeeded                                                             | `image/png` bytes                                                      |
| 400    | `INVALID_PARAMS`         | Missing `report`, missing/empty `domain`, or unknown `report`/`device` value | `{error:"INVALID_PARAMS", details:{formErrors:[], fieldErrors:{...}}}` |
| 401    | `TOKEN_REQUIRED`         | No `Authorization` header and no `?token=` query param                       | `{error:"TOKEN_REQUIRED"}`                                             |
| 401    | `TOKEN_INVALID`          | Presented token does not match `RENDER_API_TOKEN`                            | `{error:"TOKEN_INVALID"}`                                              |
| 502    | `RENDERER_UNAVAILABLE`   | Renderer microservice (`RENDERER_URL`) unreachable, timed out, or rejected   | `{error:"RENDERER_UNAVAILABLE", detail:"..."}`                         |
| 503    | `RENDER_API_TOKEN_UNSET` | `RENDER_API_TOKEN` env is empty / unset                                      | `{error:"RENDER_API_TOKEN_UNSET"}`                                     |

`502` is the only status that surfaces a `detail` field — it carries the
renderer-side error message for diagnostics. The other JSON errors are
stable contracts.

## Limitations

**Viewport is fixed at 1280×800px.** The renderer microservice captures a
1280×800 window. The Backlinks, Competitors, and Overview reports all carry
more vertical content than fits in 800px — the PNG returned by the
endpoint **clips the content that overflows the bottom edge**. This is
visible in real renders (the section headings at the bottom of the
template are truncated). Documented as a known limitation pending the
upstream fix in the renderer microservice (candidate: `fullPage: true` in
Puppeteer). It is not a bug in your integration; do not interpret a
clipped PNG as a sign that n8n is misconfigured.

**`device` is informational.** The parameter is validated and rendered as a
chip in the report header (so consumers know which view was requested) but
the actual viewport does not change. `desktop`, `mobile`, and `tablet`
today produce visually identical captures. Choose based on which label you
want on the report; ignore for layout fidelity.

**Soft TTL, not hard.** Expired cache entries are ignored on read but not
physically deleted (physical cleanup is a separate workstream). R2 usage
grows monotonically until cleanup runs; size is bounded by the
`(report, domain, country, device, competitors)` Cartesian product.

## n8n configuration reference

For a node-by-node walkthrough of the n8n workflow that consumes this
endpoint, see the project's n8n integration docs (out of scope for this
document — only the endpoint contract is documented here).

Minimal HTTP Request node configuration:

| Field           | Value                                            |
| --------------- | ------------------------------------------------ |
| Method          | GET                                              |
| URL             | `https://app.openseo.so/api/render/?{{ query }}` |
| Authentication  | None (token in the URL, see below)               |
| Response Format | File / Binary                                    |

`{{ query }}` is built from the workflow's data:

```
report=overview&domain={{ $json.domain }}&country={{ $json.country || 'ES' }}&device={{ $json.device || 'desktop' }}&token={{ $env.RENDER_API_TOKEN }}
```

For higher-security deployments, prefer `Header Auth` with
`Authorization: Bearer {{ $env.RENDER_API_TOKEN }}` instead of putting the
token in the URL.
