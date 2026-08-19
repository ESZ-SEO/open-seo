/* eslint-disable max-lines -- render-report.test.ts covers every dispatcher edge case (params, cache, orchestrator, schema, header/compliance). Splitting across files would scatter the contract regressions and lose cross-cutting helpers like the in-memory R2 fake. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock cloudflare:workers with a mutable env ---------------------------------------------
// A getter keeps `env` live so individual tests can swap bindings (R2 store,
// token presence, renderer URL). This mirrors how cache/r2-upload/renderer
// modules import env, and avoids per-test vi.doMock churn.
const mockEnv: Record<string, unknown> = {};

vi.mock("cloudflare:workers", () => ({
  get env() {
    return mockEnv;
  },
}));

// Imports below resolve the mock above (vitest hoists vi.mock).
import {
  checkAuth,
  constantTimeEquals,
  extractBearer,
  verifyToken,
} from "@/server/lib/render/auth";
import { renderHtmlToPng } from "@/server/lib/render/renderer-client";
import {
  getCachedReport,
  setCachedReport,
  RENDER_TTL_SECONDS,
} from "@/server/lib/render/cache";
import {
  renderParamsSchema,
  renderReport,
} from "@/server/lib/render/render-report";
import { renderReportShell } from "@/server/lib/render/templates/shell";

// --- Minimal in-memory R2 fake --------------------------------------------------------------
type R2Entry = {
  body: Uint8Array;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};

function createR2Fake() {
  const store = new Map<string, R2Entry>();
  return {
    store,
    async get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        customMetadata: entry.customMetadata,
        httpMetadata: entry.httpMetadata,
        // R2ObjectBody.arrayBuffer() resolves to the raw bytes. The fake hands
        // back the underlying buffer; consumers do `new Uint8Array(buffer)`.
        async arrayBuffer(): Promise<ArrayBufferLike> {
          return entry.body.buffer;
        },
      };
    },
    async put(
      key: string,
      body: Uint8Array,
      options: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
      } = {},
    ) {
      store.set(key, {
        body: new Uint8Array(body),
        httpMetadata: options.httpMetadata,
        customMetadata: options.customMetadata,
      });
    },
  };
}

/** Parse a JSON fetch body without leaking `any` to callers (mirrors repo idiom). */
function parseRequestBody(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== "string") {
    throw new Error("expected request body to be a string");
  }
  return JSON.parse(body) as unknown;
}

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function buildRequest(
  search: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://render.test/api/render/${search}`, { headers });
}

beforeEach(() => {
  // Reset env between tests.
  for (const key of Object.keys(mockEnv)) delete mockEnv[key];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// --------------------------------------------------------------------------------------------
// Auth (constant-time, refuse-when-unset)
// --------------------------------------------------------------------------------------------
describe("checkAuth", () => {
  it("refuses every request with 503 when RENDER_API_TOKEN is unset", async () => {
    const request = buildRequest("?report=overview&domain=example.com");
    await expect(checkAuth(request, undefined)).rejects.toMatchObject({
      status: 503,
      code: "RENDER_API_TOKEN_UNSET",
    });
    // Even with a presented token, unset means 503 — never open access.
    const withBearer = buildRequest("?report=overview&domain=example.com", {
      authorization: "Bearer whatever",
    });
    await expect(checkAuth(withBearer, undefined)).rejects.toMatchObject({
      status: 503,
    });
  });

  it("rejects with 401 when no token is presented", async () => {
    const request = buildRequest("?report=overview&domain=example.com");
    await expect(checkAuth(request, "secret")).rejects.toMatchObject({
      status: 401,
      code: "TOKEN_REQUIRED",
    });
  });

  it("rejects with 401 on a wrong token", async () => {
    const byHeader = buildRequest("?report=overview&domain=example.com", {
      authorization: "Bearer wrong-value",
    });
    await expect(checkAuth(byHeader, "secret")).rejects.toMatchObject({
      status: 401,
      code: "TOKEN_INVALID",
    });
    const byQuery = buildRequest(
      "?report=overview&domain=example.com&token=also-wrong",
    );
    await expect(checkAuth(byQuery, "secret")).rejects.toMatchObject({
      status: 401,
      code: "TOKEN_INVALID",
    });
  });

  it("accepts the correct token via Authorization header", async () => {
    const request = buildRequest("?report=overview&domain=example.com", {
      authorization: "Bearer secret",
    });
    await expect(checkAuth(request, "secret")).resolves.toBeUndefined();
  });

  it("accepts the correct token via ?token= query (for plain-HTTP n8n GET)", async () => {
    const request = buildRequest(
      "?report=overview&domain=example.com&token=secret",
    );
    await expect(checkAuth(request, "secret")).resolves.toBeUndefined();
  });
});

describe("constantTimeEquals", () => {
  it("returns true for equal strings and false otherwise", async () => {
    await expect(constantTimeEquals("abc", "abc")).resolves.toBe(true);
    await expect(constantTimeEquals("abc", "abd")).resolves.toBe(false);
    // Different lengths are normalised via the hash, no leakage on per-byte.
    await expect(constantTimeEquals("a", "long-but-wrong")).resolves.toBe(
      false,
    );
    await expect(constantTimeEquals("", "")).resolves.toBe(true);
  });

  it("verifyToken returns false when expected is undefined or presented is null", async () => {
    await expect(verifyToken("x", undefined)).resolves.toBe(false);
    await expect(verifyToken(null, "x")).resolves.toBe(false);
    await expect(verifyToken("x", "x")).resolves.toBe(true);
  });
});

describe("extractBearer", () => {
  it("parses a Bearer header case-insensitively and ignores non-Bearer schemes", () => {
    expect(extractBearer("Bearer abc")).toBe("abc");
    expect(extractBearer("bearer abc")).toBe("abc");
    expect(extractBearer("Bearer  multi-word-token  ")).toBe(
      "multi-word-token",
    );
    expect(extractBearer("Basic abc")).toBeNull();
    expect(extractBearer(null)).toBeNull();
  });
});

// --------------------------------------------------------------------------------------------
// Params (Zod) — drives the 400 path in the route
// --------------------------------------------------------------------------------------------
describe("renderParamsSchema", () => {
  it("accepts a full valid input", () => {
    const result = renderParamsSchema.parse({
      report: "backlinks",
      domain: "example.com",
      country: "ES",
      device: "desktop",
    });
    expect(result).toEqual({
      report: "backlinks",
      domain: "example.com",
      country: "ES",
      device: "desktop",
    });
  });

  it("applies country=ES and device=desktop defaults", () => {
    const result = renderParamsSchema.parse({
      report: "overview",
      domain: "example.com",
    });
    expect(result.country).toBe("ES");
    expect(result.device).toBe("desktop");
  });

  it("rejects an unknown report type", () => {
    const result = renderParamsSchema.safeParse({
      report: "magic",
      domain: "example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown device", () => {
    const result = renderParamsSchema.safeParse({
      report: "overview",
      domain: "example.com",
      device: "watch",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty domain (→ 400 in the route)", () => {
    const result = renderParamsSchema.safeParse({
      report: "overview",
      domain: "",
    });
    expect(result.success).toBe(false);
  });

  it("parses comma-separated competitors and dedupes against the primary", () => {
    const result = renderParamsSchema.parse({
      report: "competitors",
      domain: "example.com",
      competitors: "a.com, b.com,example.com,a.com",
    });
    expect(result.competitors).toEqual(["a.com", "b.com"]);
  });

  it("accepts an array of competitors and returns them sorted", () => {
    const result = renderParamsSchema.parse({
      report: "competitors",
      domain: "example.com",
      competitors: ["b.com", "a.com"],
    });
    expect(result.competitors).toEqual(["a.com", "b.com"]);
  });

  it("caps competitors at 2 entries (extra silently dropped after sort)", () => {
    const result = renderParamsSchema.parse({
      report: "competitors",
      domain: "example.com",
      competitors: "d.com,a.com,b.com,c.com",
    });
    expect(result.competitors?.length).toBe(2);
  });

  it("omits competitors when missing or empty", () => {
    const missing = renderParamsSchema.parse({
      report: "competitors",
      domain: "example.com",
    });
    expect(missing.competitors).toBeUndefined();
    const empty = renderParamsSchema.parse({
      report: "competitors",
      domain: "example.com",
      competitors: "",
    });
    expect(empty.competitors).toBeUndefined();
  });
});

// --------------------------------------------------------------------------------------------
// Cache key — competitor set must influence the hash so two distinct
// comparisons never collide on the same PNG.
// --------------------------------------------------------------------------------------------
describe("buildReportCacheKey (competitor set is part of the hash)", () => {
  it("returns the same key for no competitors and an explicit empty list", async () => {
    const { buildReportCacheKey } = await import("@/server/lib/render/cache");
    const a = await buildReportCacheKey(
      "competitors",
      "example.com",
      "ES",
      "desktop",
    );
    const b = await buildReportCacheKey(
      "competitors",
      "example.com",
      "ES",
      "desktop",
      [],
    );
    expect(a).toBe(b);
  });

  it("returns the same key regardless of the input order of competitors", async () => {
    const { buildReportCacheKey } = await import("@/server/lib/render/cache");
    const a = await buildReportCacheKey(
      "competitors",
      "example.com",
      "ES",
      "desktop",
      ["a.com", "b.com"],
    );
    const b = await buildReportCacheKey(
      "competitors",
      "example.com",
      "ES",
      "desktop",
      ["b.com", "a.com"],
    );
    expect(a).toBe(b);
  });

  it("returns DIFFERENT keys when the competitor set differs", async () => {
    const { buildReportCacheKey } = await import("@/server/lib/render/cache");
    const a = await buildReportCacheKey(
      "competitors",
      "example.com",
      "ES",
      "desktop",
      ["a.com"],
    );
    const b = await buildReportCacheKey(
      "competitors",
      "example.com",
      "ES",
      "desktop",
      ["b.com"],
    );
    expect(a).not.toBe(b);
  });
});

// --------------------------------------------------------------------------------------------
// Cache layer (binary-safe round trip)
// --------------------------------------------------------------------------------------------
describe("render cache (binary PNG)", () => {
  it("round-trips raw PNG bytes without corrupting them", async () => {
    const r2 = createR2Fake();
    mockEnv.R2 = r2;

    await setCachedReport("k1", PNG_BYTES, 60);
    const read = await getCachedReport("k1");
    expect(read).not.toBeNull();
    expect(Array.from(read!)).toEqual(Array.from(PNG_BYTES));
  });

  it("returns null on miss and on soft-expiry", async () => {
    const r2 = createR2Fake();
    mockEnv.R2 = r2;

    expect(await getCachedReport("missing")).toBeNull();

    // Soft-expired entry: expiresAt in the past.
    await r2.put("render-cache/expired", PNG_BYTES, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      },
    });
    expect(await getCachedReport("expired")).toBeNull();
  });

  it("uses the configured per-report TTLs", () => {
    expect(RENDER_TTL_SECONDS.backlinks).toBe(30 * 86_400);
    expect(RENDER_TTL_SECONDS.competitors).toBe(15 * 86_400);
    expect(RENDER_TTL_SECONDS.overview).toBe(7 * 86_400);
  });
});

// --------------------------------------------------------------------------------------------
// Renderer client (retries + PNG bytes)
// --------------------------------------------------------------------------------------------
describe("renderHtmlToPng", () => {
  it("returns PNG bytes from the renderer POST", async () => {
    mockEnv.RENDERER_URL = "http://renderer.test";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(PNG_BYTES, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const png = await renderHtmlToPng("<html></html>");
    expect(Array.from(png)).toEqual(Array.from(PNG_BYTES));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://renderer.test/screenshot");
    expect(init?.method).toBe("POST");
    const body = parseRequestBody(init);
    expect(body).toEqual(
      expect.objectContaining({
        html: "<html></html>",
        width: 1280,
        height: 800,
      }),
    );
  });

  it("retries and throws RenderError when the renderer keeps failing", async () => {
    mockEnv.RENDERER_URL = "http://renderer.test";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("upstream error", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(renderHtmlToPng("<html></html>")).rejects.toThrow(
      /renderer failed after 3 attempts/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("forwards fullPage:true in the request body when requested", async () => {
    mockEnv.RENDERER_URL = "http://renderer.test";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(PNG_BYTES, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderHtmlToPng("<html></html>", { fullPage: true });
    const [, init] = fetchMock.mock.calls[0];
    const body = parseRequestBody(init);
    expect(body).toEqual(
      expect.objectContaining({
        html: "<html></html>",
        width: 1280,
        height: 800,
        fullPage: true,
      }),
    );
  });

  it("omits fullPage from the body when not requested (backwards-compatible)", async () => {
    mockEnv.RENDERER_URL = "http://renderer.test";
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(PNG_BYTES, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderHtmlToPng("<html></html>");
    const [, init] = fetchMock.mock.calls[0];
    const body = parseRequestBody(init);
    expect(body).not.toHaveProperty("fullPage");
  });
});

// --------------------------------------------------------------------------------------------
// Orchestrator (cache hit short-circuits; miss → render → store)
// --------------------------------------------------------------------------------------------
describe("renderReport orchestrator", () => {
  it("returns cached PNG on hit without calling the renderer", async () => {
    const r2 = createR2Fake();
    mockEnv.R2 = r2;
    mockEnv.RENDERER_URL = "http://renderer.test";

    // Pre-seed the cache for this report coordinate.
    const { buildReportCacheKey } = await import("@/server/lib/render/cache");
    const key = await buildReportCacheKey(
      "overview",
      "example.com",
      "ES",
      "desktop",
    );
    await setCachedReport(key, PNG_BYTES, RENDER_TTL_SECONDS.overview);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const png = await renderReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
    });
    expect(Array.from(png)).toEqual(Array.from(PNG_BYTES));
    expect(fetchMock).not.toHaveBeenCalled(); // cache hit → no render call
  });

  it("on cache miss: renders, stores, and uploads the PNG", async () => {
    const r2 = createR2Fake();
    mockEnv.R2 = r2;
    mockEnv.RENDERER_URL = "http://renderer.test";

    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(PNG_BYTES, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const png = await renderReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
    });

    expect(Array.from(png)).toEqual(Array.from(PNG_BYTES)); // bytes returned
    expect(fetchMock).toHaveBeenCalledTimes(1); // renderer was called once

    // Cache was written — a second call short-circuits.
    const png2 = await renderReport({
      report: "overview",
      domain: "example.com",
      country: "ES",
      device: "desktop",
    });
    expect(Array.from(png2)).toEqual(Array.from(PNG_BYTES));
    expect(fetchMock).toHaveBeenCalledTimes(1); // still one render call

    // A durable upload key exists under rendered/<report>/.
    const uploadKeys = Array.from(r2.store.keys()).filter((k) =>
      k.startsWith("rendered/overview/"),
    );
    expect(uploadKeys).toHaveLength(1);
  });

  it("propagates renderer failure as RenderError (→ 502 in the route)", async () => {
    const r2 = createR2Fake();
    mockEnv.R2 = r2;
    mockEnv.RENDERER_URL = "http://renderer.test";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("err", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      renderReport({
        report: "overview",
        domain: "example.com",
        country: "ES",
        device: "desktop",
      }),
    ).rejects.toThrow(/renderer failed after 3 attempts/);
  });

  it("requests fullPage captures for the 3 reports (so vertical content is not clipped)", async () => {
    const r2 = createR2Fake();
    mockEnv.R2 = r2;
    mockEnv.RENDERER_URL = "http://renderer.test";
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      return new Response(PNG_BYTES, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    for (const report of ["backlinks", "competitors", "overview"] as const) {
      fetchMock.mockClear();
      await renderReport({
        report,
        domain: "example.com",
        country: "ES",
        device: "desktop",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0];
      const body = parseRequestBody(init);
      expect(body).toEqual(expect.objectContaining({ fullPage: true }));
    }
  });
});

// --------------------------------------------------------------------------------------------
// Template (brand compliance — no Semrush assets, renamed metric)
// --------------------------------------------------------------------------------------------
describe("renderReportShell", () => {
  it("renders a self-contained branded shell with renamed metric and no external CSS", () => {
    const html = renderReportShell({
      report: "backlinks",
      domain: "example.com",
      country: "es",
      device: "mobile",
    });

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<style>"); // inline styles, no external bundle
    expect(html).toContain("open-seo"); // own brand
    expect(html).toContain("Puntuación de autoridad"); // renamed proprietary metric
    expect(html).not.toMatch(/semrush/i); // no Semrush brand/assets
    expect(html).toContain("example.com");
    expect(html).toContain("ES");
    expect(html).toContain("Móvil");
  });
});
