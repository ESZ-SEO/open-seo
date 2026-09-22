import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { isHostedAuthMode } from "@/lib/auth-mode";
import { resolveUserContextFromHeaders } from "@/middleware/ensure-user/resolve";
import { ProjectRepository } from "@/server/features/projects/repositories/ProjectRepository";
import { asAppError } from "@/server/lib/errors";
import { buildReportCacheKey } from "@/server/lib/render/cache";
import { renderParamsSchema } from "@/server/lib/render/render-report";
import { textResponse } from "@/shared/report-sandbox";

// Reads back a PNG that `render_report_image` has already rendered. The render
// pipeline writes a durable copy to R2 under `rendered/<report>/<key>.png`, and
// nothing else in the app can read it over HTTP — the bucket has no public
// domain — so this route is the only thing that turns that copy into a link an
// agent can hand a person.
//
// It NEVER renders. A route that re-rendered on a cache miss would be a
// DataForSEO spend surface anyone with a browser session could hit by
// refreshing; the 404 below sends them back through the tool, where the
// authorization and the render budget live.
//
// Authorization is org membership, nothing more: any member of the project's
// organization may read any rendered PNG whose coordinates they can name, which
// is exactly what calling the tool themselves would get them. The key is NOT a
// capability — it is an unsalted SHA-256 over the coordinates, so anyone who
// knows the domain can compute it. The org check is the whole of the security.

// One body for "no such project" and "another organization's project", so
// project ids cannot be probed for existence. The two cases below name
// themselves: both only happen for a project the reader already belongs to.
const NOT_FOUND_BODY =
  "This report image does not exist or you do not have access to it.";

const NOT_RENDERED_BODY =
  "This report image has not been rendered yet, or it has been cleaned up. Run render_report_image again with the same options to regenerate it.";

const requestSchema = renderParamsSchema.extend({
  projectId: z.string().min(1),
});

async function handleRenderImageRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const parsed = requestSchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parsed.success) {
    return textResponse("Invalid report image parameters.", 400);
  }
  const { projectId, report, domain, keyword, country, device, competitors } =
    parsed.data;

  let context;
  try {
    context = await resolveUserContextFromHeaders(request.headers);
  } catch (error) {
    // Only a missing session is answered here, and only in hosted mode. A
    // config or session-store failure must not masquerade as "you are logged
    // out", and the self-hosted modes have no sign-in page to complete.
    if (asAppError(error)?.code !== "UNAUTHENTICATED") throw error;
    if (!isHostedAuthMode(env.AUTH_MODE)) {
      return textResponse("Sign in to view this report image.", 401);
    }
    const target = `${url.pathname}${url.search}`;
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/sign-in?redirect=${encodeURIComponent(target)}`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  // The canonical project-access check — org ownership plus "not archived" —
  // the same one ensureUserMiddleware uses for server functions. Org ids are
  // never compared by hand. Authorize before touching R2, so an unauthorized
  // request never pulls image bytes onto the worker's heap.
  const project = await ProjectRepository.getProjectForOrganization(
    projectId,
    context.organizationId,
  );
  if (!project) {
    const archived = await ProjectRepository.getArchivedProjectForOrganization(
      projectId,
      context.organizationId,
    );
    if (!archived) return textResponse(NOT_FOUND_BODY, 404);
    return textResponse(
      `This project is archived, so its report images are hidden. Restore ${archived.name} to view them.`,
      404,
    );
  }

  // Derived exactly as `renderReport` derives it, because the cache key is
  // built from it: if the two ever drift, every link the tool has handed out
  // resolves to a different key and 404s.
  const subject = report === "keywords" ? (keyword ?? domain) : domain;
  const cacheKey = await buildReportCacheKey(
    report,
    subject,
    country,
    device,
    competitors,
  );

  const object = await env.R2.get(`rendered/${report}/${cacheKey}.png`);
  if (!object) return textResponse(NOT_RENDERED_BODY, 404);

  return new Response(await object.arrayBuffer(), {
    headers: {
      "content-type": "image/png",
      "cache-control": "private, max-age=300",
    },
  });
}

// Handler only, and no `component` on purpose: a component would pull this file
// (and `cloudflare:workers` with it) into the client bundle.
export const Route = createFileRoute("/api/render-image")({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) =>
        handleRenderImageRequest(request),
    },
  },
});

export { handleRenderImageRequest, NOT_FOUND_BODY, NOT_RENDERED_BODY };
