import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { checkAuth, RenderAuthError } from "@/server/lib/render/auth";
import {
  RenderError,
  renderParamsSchema,
  renderReport,
} from "@/server/lib/render/render-report";

/**
 * Render endpoint — produces a branded PNG snapshot of an SEO report.
 *
 * `GET /api/render/$?report=<backlinks|competitors|overview>&domain=<...>&country=ES&device=desktop`
 * Auth: shared-secret `RENDER_API_TOKEN` via `Authorization: Bearer <token>`
 * OR `?token=<token>` (for plain-HTTP GET calls from n8n). Returns the PNG
 * binary with a short private cache window.
 *
 * Status codes: 200 image/png · 400 bad params · 401 auth · 502 renderer down
 * · 503 misconfigured (no token set).
 */
async function handleRenderRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = renderParamsSchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "INVALID_PARAMS", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    await checkAuth(request, env.RENDER_API_TOKEN);
  } catch (error) {
    if (error instanceof RenderAuthError) {
      return Response.json({ error: error.code }, { status: error.status });
    }
    throw error;
  }

  try {
    const png = await renderReport(parsed.data);
    // Copy the view into a standalone buffer for the response body. lib.dom
    // types `Uint8Array.buffer` as `ArrayBufferLike` (ArrayBuffer |
    // SharedArrayBuffer); only ArrayBuffer is a valid BodyInit, so narrow with
    // a runtime check rather than an assertion. PNG bytes always arrive as a
    // plain ArrayBuffer from the renderer / R2, so this never throws.
    const view = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength);
    if (!(view instanceof ArrayBuffer)) {
      throw new Error("rendered PNG buffer is not an ArrayBuffer");
    }
    return new Response(view, {
      headers: {
        "content-type": "image/png",
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    if (error instanceof RenderError) {
      return Response.json(
        { error: "RENDERER_UNAVAILABLE", detail: error.message },
        { status: 502 },
      );
    }
    throw error;
  }
}

export const Route = createFileRoute("/api/render/$")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) =>
        handleRenderRequest(request),
    },
  },
});
