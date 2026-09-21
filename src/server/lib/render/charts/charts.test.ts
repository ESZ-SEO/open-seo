import { describe, expect, it } from "vitest";
import {
  placeholderSvg,
  renderAreaChart,
  renderAuthorityProfile,
  renderBarPairChart,
  renderDivergingBarChart,
  renderDonutChart,
  renderLineChart,
  renderMultiLineChart,
  renderNetworkGraph,
  renderOrganicNetworkGraph,
  renderPieChart,
  renderRadarChart,
  renderStackedAreaChart,
  renderStackedBar,
  renderVennDiagram,
  renderWordCloud,
} from "@/server/lib/render/charts/charts";
import type {
  BacklinksGraphLink,
  BacklinksGraphNode,
} from "@/server/lib/render/reports/backlinks-report";

describe("charts · pure SVG helpers", () => {
  it("renderPieChart returns a valid <svg> with slices and labels", () => {
    const svg = renderPieChart([
      { name: "Texto", value: 60 },
      { name: "Imagen", value: 40 },
    ]);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('viewBox="0 0 320 240"');
    // Two slices drawn (paths).
    const pathCount = (svg.match(/<path /g) ?? []).length;
    expect(pathCount).toBeGreaterThanOrEqual(2);
    // Legend mentions both data points.
    expect(svg).toContain("Texto");
    expect(svg).toContain("Imagen");
  });

  it("renderPieChart placeholder for empty input", () => {
    expect(renderPieChart([])).toContain("Sin datos");
    expect(renderPieChart([{ name: "x", value: 0 }])).toContain("Sin datos");
  });

  it("renderRadarChart returns a <svg> with grid spokes and a polygon", () => {
    const svg = renderRadarChart([
      { label: "Autoridad", value: 80 },
      { label: "Spam", value: 30 },
      { label: "Diversidad", value: 60 },
    ]);
    expect(svg.startsWith("<svg")).toBe(true);
    // Grid web of polygons (5 levels).
    const polygonCount = (svg.match(/<polygon /g) ?? []).length;
    expect(polygonCount).toBeGreaterThanOrEqual(5);
    // Spokes = number of axes.
    const spokeCount = (svg.match(/<line /g) ?? []).length;
    expect(spokeCount).toBeGreaterThanOrEqual(3);
  });

  it("renderRadarChart placeholder for empty input", () => {
    expect(renderRadarChart([])).toContain("Sin datos");
  });

  it("renderAreaChart returns an SVG with an area path and tick labels", () => {
    const svg = renderAreaChart([
      { date: "2026-01-01", value: 100 },
      { date: "2026-01-08", value: 110 },
      { date: "2026-01-15", value: 95 },
      { date: "2026-01-22", value: 105 },
    ]);
    expect(svg.startsWith("<svg")).toBe(true);
    // Area path closes the polygon back to the baseline (Z command).
    expect(svg).toMatch(/<path d="M [^"]+ Z"/);
    // X axis labels render a few short dates.
    expect(svg).toContain("01-01");
    expect(svg).toContain("01-22");
  });

  it("renderAreaChart placeholder when empty", () => {
    expect(renderAreaChart([])).toContain("Sin histórico");
  });

  it("renderBarPairChart emits paired bars + legend", () => {
    const svg = renderBarPairChart([
      { date: "2026-01-01", new: 10, lost: 4 },
      { date: "2026-01-08", new: 8, lost: 6 },
      { date: "2026-01-15", new: 12, lost: 3 },
    ]);
    expect(svg.startsWith("<svg")).toBe(true);
    // Two rects per group × 3 groups = 6.
    expect((svg.match(/<rect /g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(svg).toContain("Nuevos");
    expect(svg).toContain("Perdidos");
  });

  it("renderLineChart emits a stroke path and dots", () => {
    const svg = renderLineChart([
      { date: "2026-01-01", value: 50 },
      { date: "2026-01-08", value: 65 },
      { date: "2026-01-15", value: 60 },
    ]);
    expect(svg.startsWith("<svg")).toBe(true);
    // The line is a single open path (no Z close).
    expect(svg).toMatch(/<path d="M [^"]+ L /);
    // Dots are circles.
    expect(svg).toContain("<circle");
  });

  it("renderLineChart honours a fixed domain instead of auto-zooming a flat series", () => {
    const svg = renderLineChart(
      [
        { date: "2026-01-01", value: 73 },
        { date: "2026-01-08", value: 75 },
        { date: "2026-01-15", value: 74 },
      ],
      { domain: [0, 100] },
    );
    // Gridline labels come straight from the fixed domain, not a padded
    // auto-range that would round 73–75 into duplicate ticks.
    expect(svg).toContain(">0<");
    expect(svg).toContain(">100<");
  });

  it("renderLineChart de-duplicates consecutive x-axis tick labels and anchors the endpoints", () => {
    // 13 weekly samples spanning ~3 months — the real capture that surfaced
    // this: under `monthYear`, "Jun 2026 Jun 2026 Jul 2026 Jul 2026 … Sep
    // 202" (duplicated AND clipped). `Date.UTC` here is just building the
    // fixture (deterministic, no host-timezone dependency); the renderer
    // itself never touches `Date`.
    const points = Array.from({ length: 13 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 5, 15) + i * 7 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      value: 75,
    }));
    const svg = renderLineChart(points, {
      domain: [0, 100],
      dateFormat: "monthYear",
    });
    const ticks = [
      ...svg.matchAll(
        /<text[^>]*text-anchor="([^"]+)"[^>]*font-size="10"[^>]*>([^<]+)<\/text>/g,
      ),
    ].map((m) => ({ anchor: m[1], label: m[2] }));
    expect(ticks.length).toBeGreaterThan(1);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]?.label).not.toBe(ticks[i - 1]?.label);
    }
    expect(ticks[0]?.anchor).toBe("start");
    expect(ticks.at(-1)?.anchor).toBe("end");
    // The last label survives whole — no clipped "Sep 202".
    expect(ticks.at(-1)?.label).toBe("Sep 2026");
  });

  it("renderDivergingBarChart drops an overlapping neighbour instead of colliding with the forced last tick", () => {
    // 26 weekly periods, the New/Lost charts' real span, where an
    // evenly-spaced stride plus the forced final index used to overlap two
    // labels into each other ("Aug 3Sep 7").
    const points = Array.from({ length: 26 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 2, 16) + i * 7 * 86_400_000)
        .toISOString()
        .slice(0, 10),
      new: 500,
      lost: 200,
    }));
    const svg = renderDivergingBarChart(points, { dateFormat: "monthDay" });
    const ticks = [
      ...svg.matchAll(
        /<text[^>]*text-anchor="([^"]+)"[^>]*font-size="10"[^>]*>([^<]+)<\/text>/g,
      ),
    ].map((m) => ({ anchor: m[1], label: m[2] }));
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]?.label).not.toBe(ticks[i - 1]?.label);
    }
    expect(ticks[0]?.anchor).toBe("start");
    expect(ticks.at(-1)?.anchor).toBe("end");
    expect(ticks.at(-1)?.label).toBe("Sep 7");
  });

  it("renderLineChart/renderAreaChart opt into en-US month tick formats without moving the default", () => {
    const points = [
      { date: "2025-10-01", value: 10 },
      { date: "2026-03-09", value: 20 },
    ];
    // Default stays byte-for-byte "short" (MM-DD) — the pinned test above
    // ("renderAreaChart returns an SVG with area path and tick labels")
    // already locks this in; this just makes the "unopted-in" case explicit.
    expect(renderLineChart(points)).toContain("10-01");
    expect(renderAreaChart(points)).toContain("10-01");
    // Opt-in formats.
    expect(renderLineChart(points, { dateFormat: "monthDay" })).toContain(
      "Mar 9",
    );
    expect(renderAreaChart(points, { dateFormat: "monthYear" })).toContain(
      "Oct 2025",
    );
  });

  it("renderDivergingBarChart opts into en-US month tick formats without moving the default", () => {
    const points = [
      { date: "2026-03-09", new: 10, lost: 4 },
      { date: "2026-04-06", new: 8, lost: 6 },
    ];
    expect(renderDivergingBarChart(points)).toContain("03-09");
    expect(
      renderDivergingBarChart(points, { dateFormat: "monthDay" }),
    ).toContain("Mar 9");
  });

  it("renderNetworkGraph returns a hand-rolled SVG with circles + curved links", () => {
    const nodes: BacklinksGraphNode[] = [
      { id: "example.com", rank: 100, spamSeverity: 0, backlinks: 1000 },
      { id: "a.com", rank: 60, spamSeverity: 1, backlinks: 100 },
      { id: "b.com", rank: 80, spamSeverity: 3, backlinks: 80 },
    ];
    const links: BacklinksGraphLink[] = [
      { source: "example.com", target: "a.com" },
      { source: "example.com", target: "b.com" },
    ];
    const svg = renderNetworkGraph("example.com", nodes, links);
    expect(svg.startsWith("<svg")).toBe(true);
    // Centre + satellites = 3 circles minimum.
    const circleCount = (svg.match(/<circle /g) ?? []).length;
    expect(circleCount).toBeGreaterThanOrEqual(3);
    // Two curved <path d="M" Q links.
    const linkCount = (svg.match(/<path d="M [^"]+ Q /g) ?? []).length;
    expect(linkCount).toBe(2);
  });

  it("renderNetworkGraph placeholder when no links", () => {
    const nodes: BacklinksGraphNode[] = [
      { id: "example.com", rank: 100, spamSeverity: 0, backlinks: 0 },
    ];
    expect(renderNetworkGraph("example.com", nodes, [])).toContain(
      "Sin dominios de referencia",
    );
  });

  it("placeholderSvg returns a stable, XML-escape-safe SVG", () => {
    const svg = placeholderSvg("Hola <mundo>");
    expect(svg).toContain("&lt;mundo&gt;");
    expect(svg.startsWith("<svg")).toBe(true);
  });
});

describe("charts · E2 venn + donut", () => {
  it("renderVennDiagram sizes each circle by its set, area-proportional", () => {
    const svg = renderVennDiagram({
      sets: [
        { label: "primary.com", value: 1200, color: "#6868d8" },
        { label: "comp1.com", value: 300, color: "#14b8a6" },
      ],
      pairs: [{ left: "primary.com", right: "comp1.com", value: 80 }],
      total: 1420,
    });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("primary.com");
    expect(svg).toContain("comp1.com");
    expect(svg).toContain("∩");
    // A set 4x larger draws a circle 2x the radius (area scales with value).
    const radii = [...svg.matchAll(/ r="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(radii).toHaveLength(2);
    const [big, small] = [Math.max(...radii), Math.min(...radii)];
    expect(big / small).toBeCloseTo(2, 1);
  });

  it("renderVennDiagram renders an approximated lobe as ≈, not as a count", () => {
    const svg = renderVennDiagram({
      sets: [
        { label: "a.com", value: 100 },
        { label: "b.com", value: 80 },
      ],
      pairs: [{ left: "a.com", right: "b.com", value: 0, approximate: true }],
    });
    expect(svg).toContain("≈");
    expect(svg).not.toContain("∩ 0");
  });

  it("renderVennDiagram placeholder for empty sets", () => {
    // No sets → no overlap math, fall back to placeholder.
    expect(renderVennDiagram({ sets: [] })).toContain("No data");
  });

  it("renderDonutChart reuses renderPieChart's hollow centre and accepts a centerLabel", () => {
    const svg = renderDonutChart(
      [
        { name: "primary", value: 60 },
        { name: "competitor-1", value: 30 },
      ],
      { width: 320, height: 240, centerLabel: "Tráfico" },
    );
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Tráfico");
    // Two slices.
    const paths = (svg.match(/<path /g) ?? []).length;
    expect(paths).toBeGreaterThanOrEqual(2);
  });

  it("renderStackedBar spans the full width, split by each segment's share", () => {
    const svg = renderStackedBar(
      [
        { label: "Top 3", value: 5 },
        { label: "4–10", value: 7 },
        { label: "11–20", value: 12 },
      ],
      { width: 240 },
    );
    expect(svg.startsWith("<svg")).toBe(true);
    // Segments are laid out left to right, each 1px short of its share so a
    // white sliver separates it from the next; the last one ends at `width`.
    expect(svg).toContain('x="0.0" y="30" width="49.0"'); // 5/24 * 240 = 50
    expect(svg).toContain('x="50.0" y="30" width="69.0"'); // 7/24 * 240 = 70
    expect(svg).toContain('x="120.0" y="30" width="119.0"'); // 12/24 * 240 = 120
    // Legend includes every label with its value.
    expect(svg).toContain("Top 3 5");
    expect(svg).toContain("4–10 7");
    expect(svg).toContain("11–20 12");
  });

  it("renderStackedBar placeholder when every segment is zero", () => {
    expect(renderStackedBar([{ label: "x", value: 0 }])).toContain("Sin datos");
  });

  it("renderStackedAreaChart stacks each series on top of the previous one", () => {
    const dates = ["2025-01-01", "2025-02-01", "2025-03-01"];
    const flat = (value: number) => dates.map((date) => ({ date, value }));
    const svg = renderStackedAreaChart(
      [
        { label: "bottom", points: flat(200) },
        { label: "top", points: flat(300) },
      ],
      { width: 300, height: 130 },
    );
    // The stacked total is 500, which the axis rounds up to 600 so the ticks
    // land on 0 / 150 / 300 / 450 / 600 rather than 0 / 125 / 250 / 375 / 500.
    expect(svg).toContain(">600<");
    expect(svg).toContain(">0<");
    // Band 1's ceiling is y=79.3 (200 of 600 up a 74px plot from y=104), and
    // band 2 closes back down onto that same y: the bands touch rather than
    // both starting from the baseline.
    expect(svg).toContain('d="M 4.0 79.3 C');
    expect(svg).toContain("L 248.0 79.3 C");
  });

  it("renderMultiLineChart draws one bare line per series", () => {
    const svg = renderMultiLineChart([
      { label: "organic", points: [{ date: "2025-01-01", value: 10 }] },
      { label: "paid", points: [{ date: "2025-01-01", value: 4 }] },
    ]);
    expect((svg.match(/<path /g) ?? []).length).toBe(2);
    // Point markers turn a dense series into a dotted band; the reference has
    // none.
    expect(svg).not.toContain("<circle");
    expect(svg).toContain("organic");
    expect(svg).toContain("paid");
  });

  it("time-series charts fall back to a placeholder without any history", () => {
    expect(renderStackedAreaChart([])).toContain("Sin histórico");
    expect(renderMultiLineChart([{ label: "x", points: [] }])).toContain(
      "Sin histórico",
    );
  });
});

describe("charts · backlinks parity renderers", () => {
  it("renderDivergingBarChart draws bars above and below the zero baseline, with a negative tick", () => {
    const svg = renderDivergingBarChart([
      { date: "2026-01-01", new: 10, lost: 4 },
      { date: "2026-01-08", new: 8, lost: 6 },
      { date: "2026-01-15", new: 12, lost: 3 },
    ]);
    expect(svg.startsWith("<svg")).toBe(true);
    // 3 periods × 2 rects (new + lost) = 6.
    expect((svg.match(/<rect /g) ?? []).length).toBe(6);
    // A negative tick label on the lower half of the symmetric axis.
    expect(svg).toMatch(/>-\d/);
    // Each bar's tooltip names both series.
    expect(svg).toMatch(/New: \d+, Lost: \d+/);
  });

  it("renderDivergingBarChart placeholder for empty input", () => {
    expect(renderDivergingBarChart([])).toContain("Sin histórico");
  });

  it("renderWordCloud keeps every word inside the viewBox and sizes fonts by weight", () => {
    const svg = renderWordCloud(
      [
        { text: "world wildlife fund", weight: 100 },
        { text: "wwf", weight: 60 },
        { text: "worldwildlife.org", weight: 40 },
        { text: "empty anchor", weight: 20 },
        { text: "travel", weight: 10 },
      ],
      { width: 320, height: 160 },
    );
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('width="320" height="160"');
    // Distinct font sizes across the weight range, not one size for all.
    const sizes = new Set(
      [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => m[1]),
    );
    expect(sizes.size).toBeGreaterThan(1);
    // No word starts past the right edge of its own canvas.
    const xs = [...svg.matchAll(/<text x="([\d.]+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(xs.every((x) => x >= 0 && x <= 320)).toBe(true);
  });

  it("renderWordCloud placeholder for empty input", () => {
    expect(renderWordCloud([])).toContain("Sin datos");
  });

  it("renderOrganicNetworkGraph is deterministic and renders the target node", () => {
    const nodes: BacklinksGraphNode[] = [
      { id: "example.com", rank: 100, spamSeverity: 0, backlinks: 1000 },
      { id: "a.com", rank: 60, spamSeverity: 1, backlinks: 100 },
      { id: "b.com", rank: 80, spamSeverity: 0, backlinks: 80 },
      { id: "c.com", rank: 40, spamSeverity: 2, backlinks: 40 },
    ];
    const links: BacklinksGraphLink[] = [
      { source: "example.com", target: "a.com" },
      { source: "example.com", target: "b.com" },
      { source: "example.com", target: "c.com" },
    ];
    const first = renderOrganicNetworkGraph("example.com", nodes, links);
    const second = renderOrganicNetworkGraph("example.com", nodes, links);
    expect(first).toBe(second);
    expect(first.startsWith("<svg")).toBe(true);
    expect(first).toContain("example.com");
  });

  it("renderOrganicNetworkGraph placeholder when there are no links", () => {
    const nodes: BacklinksGraphNode[] = [
      { id: "example.com", rank: 100, spamSeverity: 0, backlinks: 0 },
    ];
    expect(renderOrganicNetworkGraph("example.com", nodes, [])).toContain(
      "Sin dominios de referencia",
    );
  });

  it("renderAuthorityProfile emits exactly 3 axis labels and a closed profile curve", () => {
    const svg = renderAuthorityProfile([
      { label: "Link Power", value: 80 },
      { label: "Organic Traffic", value: 65 },
      { label: "Natural Profile", value: 90 },
    ]);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("Link Power");
    expect(svg).toContain("Organic Traffic");
    expect(svg).toContain("Natural Profile");
    // Closed Catmull-Rom curve (ends with Z), not a hard-edged polygon.
    expect(svg).toMatch(/<path d="M [^"]+ Z"/);
  });

  it("renderAuthorityProfile placeholder for empty input", () => {
    expect(renderAuthorityProfile([])).toContain("Sin datos");
  });
});
