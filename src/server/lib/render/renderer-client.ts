import { env } from "cloudflare:workers";

/**
 * Client for the external renderer microservice (`renderer/`, separate
 * container). The renderer is intentionally dumb: it receives HTML and returns
 * a PNG screenshot. Retries and timeouts live here so callers get a typed
 * error rather than a raw fetch failure.
 */

export class RenderError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RenderError";
  }
}

export type RenderOptions = {
  width?: number;
  height?: number;
  waitForSelector?: string;
  /**
   * Capture the full document instead of clipping to `width`×`height`.
   * Reported PNGs are taller (and slightly larger) than the fixed-clip
   * legacy form, so this is only used by callers whose templates assume
   * a dynamic height (the 3 SEO reports).
   */
  fullPage?: boolean;
};

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const MAX_ATTEMPTS = 3;
/** Hard total budget across all retries, to keep the worker request bounded. */
const TOTAL_TIMEOUT_MS = 30_000;
const BASE_BACKOFF_MS = 200;

function rendererBaseUrl(): string {
  const configured = env.RENDERER_URL ?? "http://localhost:3100";
  return configured.replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Render an HTML document to a PNG via the renderer microservice.
 *
 * POSTs `{html, width, height, waitForSelector, fullPage}` to
 * `{RENDERER_URL}/screenshot` and returns the binary PNG. Retries up to
 * {@link MAX_ATTEMPTS} times within a shared {@link TOTAL_TIMEOUT_MS} budget,
 * then throws a {@link RenderError}.
 */
export async function renderHtmlToPng(
  html: string,
  opts: RenderOptions = {},
): Promise<Uint8Array> {
  const width = opts.width ?? DEFAULT_WIDTH;
  const height = opts.height ?? DEFAULT_HEIGHT;
  const body = JSON.stringify({
    html,
    width,
    height,
    waitForSelector: opts.waitForSelector,
    fullPage: opts.fullPage,
  });

  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new RenderError(
        `renderer timed out after ${TOTAL_TIMEOUT_MS}ms`,
        lastError,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      const response = await fetch(`${rendererBaseUrl()}/screenshot`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new RenderError(
          `renderer returned HTTP ${response.status} ${response.statusText}`,
        );
      }

      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < MAX_ATTEMPTS) {
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new RenderError(
    `renderer failed after ${MAX_ATTEMPTS} attempts: ${detail}`,
    lastError,
  );
}
