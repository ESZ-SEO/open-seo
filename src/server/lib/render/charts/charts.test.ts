import { describe, expect, it } from "vitest";
import {
  placeholderSvg,
  renderAreaChart,
  renderBarPairChart,
  renderDonutChart,
  renderLineChart,
  renderNetworkGraph,
  renderPieChart,
  renderRadarChart,
  renderStackedBarChart,
  renderVennDiagram,
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
  it("renderVennDiagram returns three overlapping <circle>s + count labels", () => {
    const svg = renderVennDiagram({
      sets: [
        { label: "primary.com", value: 1200, color: "#1f6feb" },
        { label: "comp1.com", value: 540, color: "#14b8a6" },
        { label: "comp2.com", value: 410, color: "#f59e0b" },
      ],
      pairs: [
        { left: "primary.com", right: "comp1.com", value: 80 },
        { left: "primary.com", right: "comp2.com", value: 60 },
        { left: "comp1.com", right: "comp2.com", value: 0 },
      ],
      total: 2150,
    });
    expect(svg.startsWith("<svg")).toBe(true);
    // Three rings.
    const circles = (svg.match(/<circle /g) ?? []).length;
    expect(circles).toBeGreaterThanOrEqual(3);
    // Domain labels + pair intersection labels.
    expect(svg).toContain("primary.com");
    expect(svg).toContain("comp1.com");
    expect(svg).toContain("comp2.com");
    expect(svg).toContain("∩");
  });

  it("renderVennDiagram placeholder for empty sets", () => {
    // No sets → no overlap math, fall back to placeholder.
    expect(renderVennDiagram({ sets: [] })).toContain("Sin datos");
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

  it("renderStackedBarChart draws one column with one rect per segment", () => {
    const svg = renderStackedBarChart([
      {
        label: "Hoy",
        segments: [
          { label: "Top 3", value: 5 },
          { label: "4–10", value: 7 },
          { label: "11–20", value: 12 },
        ],
      },
    ]);
    expect(svg.startsWith("<svg")).toBe(true);
    // 3 segments → 3 rects.
    const rects = (svg.match(/<rect /g) ?? []).length;
    expect(rects).toBeGreaterThanOrEqual(3);
    // Legend includes every label.
    expect(svg).toContain("Top 3");
    expect(svg).toContain("4–10");
    expect(svg).toContain("11–20");
  });

  it("renderStackedBarChart placeholder for empty columns", () => {
    expect(renderStackedBarChart([])).toContain("Sin datos");
  });

  it("renderStackedBarChart placeholder when every segment is zero", () => {
    expect(
      renderStackedBarChart([
        { label: "Hoy", segments: [{ label: "x", value: 0 }] },
      ]),
    ).toContain("Sin datos");
  });
});
