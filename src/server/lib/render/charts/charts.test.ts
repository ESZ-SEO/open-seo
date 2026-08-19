import { describe, expect, it } from "vitest";
import {
  placeholderSvg,
  renderAreaChart,
  renderBarPairChart,
  renderLineChart,
  renderNetworkGraph,
  renderPieChart,
  renderRadarChart,
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
