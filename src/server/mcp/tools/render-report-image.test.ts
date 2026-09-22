import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/server/lib/errors";
import { RenderError } from "@/server/lib/render/renderer-client";
import { renderReportImageTool } from "./render-report-image";
import { makeToolContext, textContent } from "./tool-test-support";

const mocks = vi.hoisted(() => ({
  getProjectForOrganization: vi.fn(),
  renderReport: vi.fn(),
  consumeRenderBudget: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));
// Partial mock: only the render itself is faked, so the real
// `renderParamsSchema` owns defaults and competitor normalization here exactly
// as it does in production, and the real `RenderError` is the one thrown.
vi.mock("@/server/lib/render/render-report", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/server/lib/render/render-report")
  >()),
  renderReport: mocks.renderReport,
}));
vi.mock("@/server/lib/render/render-budget", () => ({
  consumeRenderBudget: mocks.consumeRenderBudget,
}));

const projectId = "project_1";
const PNG_BYTES = new Uint8Array(96_302);

const toolContext = makeToolContext();

const call = (args: Record<string, unknown>) =>
  renderReportImageTool.handler(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the SDK validates args against inputSchema before the handler runs
    { projectId, ...args } as Parameters<
      typeof renderReportImageTool.handler
    >[0],
    toolContext,
  );

beforeEach(() => {
  mocks.getProjectForOrganization.mockResolvedValue({ id: projectId });
  mocks.renderReport.mockResolvedValue(PNG_BYTES);
  mocks.consumeRenderBudget.mockResolvedValue(undefined);
});

describe("render_report_image", () => {
  it("answers with a link to the image, never the bytes", async () => {
    const result = await call({ report: "overview", domain: "example.com" });

    expect(result.structuredContent.url).toBe(
      "https://open-seo.test/api/render-image?projectId=project_1&report=overview&domain=example.com&country=ES&device=desktop",
    );
    expect(result.structuredContent.imageBytes).toBe(96_302);
    // A base64 run would mean someone "helpfully" attached the image: ~30,000
    // tokens a call, and mcpResponse puts the payload on the wire twice.
    const wire = textContent(result) + JSON.stringify(result.structuredContent);
    expect(wire).not.toMatch(/[A-Za-z0-9+/]{100,}={0,2}/);
  });

  it("refuses a foreign project without spending anything", async () => {
    mocks.getProjectForOrganization.mockResolvedValue(null);

    await expect(
      call({ report: "overview", domain: "example.com" }),
    ).rejects.toThrow(new AppError("FORBIDDEN"));
    expect(mocks.consumeRenderBudget).not.toHaveBeenCalled();
    expect(mocks.renderReport).not.toHaveBeenCalled();
  });

  it("refuses to render once the organization's budget is spent", async () => {
    mocks.consumeRenderBudget.mockRejectedValue(
      new AppError("RATE_LIMITED", "Too many renders."),
    );

    await expect(
      call({ report: "overview", domain: "example.com" }),
    ).rejects.toThrow(new AppError("RATE_LIMITED", "Too many renders."));
    // The brake only works before the spend.
    expect(mocks.renderReport).not.toHaveBeenCalled();
  });

  it("renders and links the same normalized competitor list", async () => {
    const result = await call({
      report: "competitors",
      domain: "example.com",
      competitors: ["b.com", "a.com", "c.com", "a.com"],
    });

    // The cache key is built from this list, so the render and the link have
    // to agree on it or the link resolves to a different PNG.
    expect(mocks.renderReport).toHaveBeenCalledWith(
      expect.objectContaining({ competitors: ["a.com", "b.com"] }),
    );
    expect(result.structuredContent.competitors).toEqual(["a.com", "b.com"]);
    expect(result.structuredContent.url).toContain(
      "competitors=a.com%2Cb.com",
    );
  });

  it.each([
    { keyword: undefined, subject: "seo tools" },
    { keyword: "link building", subject: "link building" },
  ])(
    "uses $subject as the keyword report's subject",
    async ({ keyword, subject }) => {
      const result = await call({
        report: "keywords",
        domain: "seo tools",
        keyword,
      });

      // Same invariant as the competitor list, on the branch where the subject
      // is not the domain: what was rendered must be what the link names.
      expect(mocks.renderReport).toHaveBeenCalledWith(
        expect.objectContaining({ domain: "seo tools", keyword }),
      );
      expect(result.structuredContent.subject).toBe(subject);
      expect(textContent(result)).toContain(`Keyword Research for ${subject}`);
    },
  );

  it("reports a renderer outage as a typed upstream failure", async () => {
    mocks.renderReport.mockRejectedValue(new RenderError("renderer timed out"));

    await expect(
      call({ report: "overview", domain: "example.com" }),
    ).rejects.toThrow(
      new AppError("UPSTREAM_UNAVAILABLE", "renderer timed out"),
    );
  });
});
