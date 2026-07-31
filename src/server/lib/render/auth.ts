/**
 * Shared-secret auth for the render endpoint.
 *
 * The render endpoint is consumed by n8n over plain HTTP GET, so we accept the
 * secret token from either an `Authorization: Bearer <token>` header or a
 * `?token=<token>` query parameter. Comparison is constant-time via Web Crypto
 * (hash both inputs to fixed-length digests, then XOR-accumulate) so that
 * timing does not leak the expected token.
 *
 * Auth state is intentionally a pure function of its inputs: the route layer
 * reads `env.RENDER_API_TOKEN` and passes it here. When the token is unset the
 * endpoint refuses every request with 503 — open access is never permitted.
 */

export class RenderAuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "RenderAuthError";
  }
}

/** Extract a bearer token from the `authorization` header, or null. */
export function extractBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const trimmed = authHeader.trim();
  const match = /^Bearer\s+(.+)$/i.exec(trimmed);
  return match ? match[1].trim() : null;
}

/** Extract the token presented by the request (header takes priority). */
export function extractTokenFromRequest(request: Request): string | null {
  const bearer = extractBearer(request.headers.get("authorization"));
  if (bearer) return bearer;
  return new URL(request.url).searchParams.get("token");
}

/**
 * Constant-time equality check using Web Crypto. Both inputs are SHA-256
 * hashed to fixed 32-byte digests, then compared byte-by-byte with XOR so the
 * return does not short-circuit on the first differing byte. Lengths are
 * normalised by the hash, avoiding per-byte length leakage.
 */
export async function constantTimeEquals(
  a: string,
  b: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [aDigest, bDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const aBytes = new Uint8Array(aDigest);
  const bBytes = new Uint8Array(bDigest);
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

/**
 * Verify a presented token against the expected token. Returns false when the
 * presented value is missing or does not match. Exposed for direct unit
 * testing of the constant-time comparison.
 */
export async function verifyToken(
  presented: string | null,
  expected: string | undefined,
): Promise<boolean> {
  if (!expected) return false;
  if (!presented) return false;
  return constantTimeEquals(presented, expected);
}

/**
 * Throws a {@link RenderAuthError} when access is not permitted:
 * - 503 RENDER_API_TOKEN_UNSET — the endpoint is misconfigured (no secret set)
 * - 401 TOKEN_REQUIRED — no token was presented by the caller
 * - 401 TOKEN_INVALID — the presented token does not match
 */
export async function checkAuth(
  request: Request,
  expectedToken: string | undefined,
): Promise<void> {
  if (!expectedToken) {
    throw new RenderAuthError(503, "RENDER_API_TOKEN_UNSET");
  }
  const presented = extractTokenFromRequest(request);
  if (!presented) {
    throw new RenderAuthError(401, "TOKEN_REQUIRED");
  }
  if (!(await constantTimeEquals(presented, expectedToken))) {
    throw new RenderAuthError(401, "TOKEN_INVALID");
  }
}
