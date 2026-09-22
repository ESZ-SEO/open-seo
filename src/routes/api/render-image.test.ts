import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/lib/errors";

// A getter keeps `env` live so a test can swap the R2 store and the auth mode,
// mirroring how the cache and route modules import env.
const mockEnv: Record<string, unknown> = {};

vi.mock("cloudflare:workers", () => ({
  get env() {
    return mockEnv;
  },
}));

const mocks = vi.hoisted(() => ({
  resolveUserContextFromHeaders: vi.fn(),
  getProjectForOrganization: vi.fn(),
  getArchivedProjectForOrganization: vi.fn(),
  r2Get: vi.fn(),
  renderReport: vi.fn(),
}));

vi.mock("@/middleware/ensure-user/resolve", () => ({
  resolveUserContextFromHeaders: mocks.resolveUserContextFromHeaders,
}));
vi.mock("@/server/features/projects/repositories/ProjectRepository", () => ({
  ProjectRepository: {
    getProjectForOrganization: mocks.getProjectForOrganization,
    getArchivedProjectForOrganization: mocks.getArchivedProjectForOrganization,
  },
}));
// Partial mock: the route parses with the real `renderParamsSchema`, and
// `renderReport` is here only so the tests can prove it is never reached.
vi.mock("@/server/lib/render/render-report", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/lib/render/render-report")
  >()),
  renderReport: mocks.renderReport,
}));

import { buildReportCacheKey } from "@/server/lib/render/cache";
import {
  handleRenderImageRequest,
  NOT_FOUND_BODY,
  NOT_RENDERED_BODY,
} from "./render-image";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]);

const QUERY =
  "projectId=project_1&report=overview&domain=example.com&country=ES&device=desktop";

const get = (query = QUERY) =>
  handleRenderImageRequest(
    new Request(`https://open-seo.test/api/render-image?${query}`),
  );

beforeEach(() => {
  mockEnv.AUTH_MODE = "hosted";
  mockEnv.R2 = { get: mocks.r2Get };
  mocks.resolveUserContextFromHeaders.mockResolvedValue({
    organizationId: "org_1",
  });
  mocks.getProjectForOrganization.mockResolvedValue({ id: "project_1" });
  mocks.getArchivedProjectForOrganization.mockResolvedValue(null);
  mocks.r2Get.mockResolvedValue(null);
});

describe("GET /api/render-image", () => {
  it("serves the PNG the render pipeline stored", async () => {
    // The key is computed the way `renderReport` computes it. If either side
    // changes the prefix or the hash inputs, every link the tool ever handed
    // out 404s and nothing else in the codebase notices.
    const key = await buildReportCacheKey(
      "overview",
      "example.com",
      "ES",
      "desktop",
      undefined,
    );
    mocks.r2Get.mockImplementation(async (objectKey: string) =>
      objectKey === `rendered/overview/${key}.png`
        ? { arrayBuffer: async () => PNG_BYTES.buffer }
        : null,
    );

    const response = await get();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("does not re-render a missing image", async () => {
    const response = await get();

    expect(response.status).toBe(404);
    expect(await response.text()).toBe(NOT_RENDERED_BODY);
    // A route that re-rendered on a miss would be a spend surface anyone with
    // a browser session could hit by refreshing.
    expect(mocks.renderReport).not.toHaveBeenCalled();
  });

  it("hides another organization's project behind the generic body", async () => {
    mocks.getProjectForOrganization.mockResolvedValue(null);

    const response = await get();

    expect(response.status).toBe(404);
    expect(await response.text()).toBe(NOT_FOUND_BODY);
    expect(mocks.r2Get).not.toHaveBeenCalled();
  });

  it.each([
    { mode: "hosted", status: 302 },
    { mode: "cloudflare_access", status: 401 },
  ])("answers $status to a request with no session ($mode)", async ({
    mode,
    status,
  }) => {
    mockEnv.AUTH_MODE = mode;
    mocks.resolveUserContextFromHeaders.mockRejectedValue(
      new AppError("UNAUTHENTICATED"),
    );

    const response = await get();

    expect(response.status).toBe(status);
    expect(mocks.r2Get).not.toHaveBeenCalled();
  });
});
