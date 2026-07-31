import { env } from "cloudflare:workers";

/**
 * Persist a rendered PNG to R2 under `rendered/...`. This is the durable copy
 * (separate from the TTL cache) so other consumers — e.g. n8n fetching the
 * image later — can reference it. Returns the R2 key written.
 */

export async function uploadPng(
  key: string,
  png: Uint8Array,
): Promise<string> {
  await env.R2.put(key, png, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { generatedAt: new Date().toISOString() },
  });
  return key;
}
