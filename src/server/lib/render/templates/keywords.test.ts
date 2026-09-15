import { describe, expect, it } from "vitest";
import { ES } from "country-flag-icons/string/3x2";
import {
  keywordsFlagCodes,
  renderKeywordsReport,
  type KeywordsTemplateInput,
} from "@/server/lib/render/templates/keywords";
import {
  TABLE_ROW_LIMIT,
  type KeywordRow,
  type KeywordsReportData,
} from "@/server/lib/render/reports/keywords-report";

/** A row carrying every metric — the reference's first five rows. */
function fullRow(overrides: Partial<KeywordRow> = {}): KeywordRow {
  return {
    keyword: "tartas de queso zaragoza",
    intent: "informational",
    relevance: 100,
    volume: 720,
    difficulty: 13,
    cpc: 0,
    serpFeatureCount: 5,
    results: 134,
    updated: "1 month",
    ...overrides,
  };
}

/** A row whose SERP-side metrics never refreshed — the reference's rows 6+. */
function staleRow(overrides: Partial<KeywordRow> = {}): KeywordRow {
  return fullRow({
    keyword: "bascake zaragoza fotos",
    intent: "unknown",
    relevance: 86,
    volume: 30,
    difficulty: null,
    serpFeatureCount: null,
    results: null,
    updated: null,
    ...overrides,
  });
}

function makeFixture(overrides: Partial<KeywordsReportData> = {}) {
  const data: KeywordsReportData = {
    input: {
      keyword: "tartas de queso Zaragoza",
      country: "ES",
      countryName: "Spain",
      currency: "EUR",
    },
    healthy: true,
    sampleSize: 46_774,
    summary: {
      keywordCount: { value: 46_774, source: "ok" },
      totalVolume: { value: 839_160, source: "ok" },
      averageDifficulty: { value: 22, source: "ok" },
    },
    tables: {
      keywords: { value: [fullRow(), staleRow()], source: "ok" },
      topics: {
        value: [{ topic: "bascake zaragoza", keywords: 207 }],
        source: "ok",
      },
    },
    actionBadges: { updateMetrics: "489/1,000", manageColumns: "9/11" },
    pagination: { currentPage: 1, totalPages: 468 },
    staleLabel: "For metrics, try to refresh",
    ...overrides,
  };
  return data;
}

function render(overrides: Partial<KeywordsTemplateInput> = {}): string {
  return renderKeywordsReport({
    keyword: "tartas de queso Zaragoza",
    country: "ES",
    flags: {},
    data: makeFixture(),
    ...overrides,
  });
}

/** The results table alone — the topic rail carries its own table and would
 *  otherwise be the first one any selector finds. */
function resultsTable(html: string): string {
  const start = html.indexOf('<table class="kw">');
  return html.slice(start, html.indexOf("</table>", start));
}

/** The results table's body alone, so an assertion about row cells never
 *  catches the header or the pager. */
function tableBody(html: string): string {
  const table = resultsTable(html);
  return table.slice(table.indexOf("<tbody>"), table.indexOf("</tbody>"));
}

/** One `<tr>` of the body, zero-indexed. */
function bodyRow(html: string, index: number): string {
  return tableBody(html).split("<tr>")[index + 1] ?? "";
}

/** Strip inline SVGs before counting digits: a path's coordinates are
 *  legitimately full of them (playbook §4). */
function withoutIcons(markup: string): string {
  return markup.replace(/<svg[\s\S]*?<\/svg>/g, "");
}

/** The three label/value pairs of the summary bar, without the action buttons
 *  beside them — those carry their own figures. */
function summaryMetrics(html: string): string {
  return (html.match(/<span class="metric">[\s\S]*?<\/span>/g) ?? []).join("");
}

/** One `<td>` of a row, found by its class. Sliced to its own closing tag: a
 *  slice that runs to the end of the row swallows every cell after it. */
function cell(row: string, className: string): string {
  const start = row.indexOf(`class="${className}"`);
  return start === -1 ? "" : row.slice(start, row.indexOf("</td>", start));
}

describe("renderKeywordsReport · template", () => {
  it("produces a self-contained unbranded HTML document", () => {
    const html = render();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("<style>");
    expect(html).toContain("tartas de queso Zaragoza");
    expect(html).not.toContain("open-seo");
  });

  it("carries no reference branding — not the vendor, not its product name", () => {
    const html = render();
    expect(html).not.toMatch(/semrush/i);
    expect(html).not.toMatch(/keyword magic/i);
    // What it calls itself instead.
    expect(html).toContain("Keyword Research");
  });

  it("renders the nine reference columns in order, after the selection column", () => {
    const head =
      resultsTable(render()).match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? "";
    const columns = Array.from(head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)).map(
      (match) => match[1].replace(/<[^>]*>/g, "").trim(),
    );
    expect(columns).toEqual([
      "",
      "Keyword",
      "Intent",
      "Relevance",
      "Volume",
      "KD %",
      "CPC (EUR)",
      "SERP Features",
      "Results",
      "Updated",
    ]);
  });

  it("renders the match-type strip with one active tab per group", () => {
    const html = render();
    for (const label of [
      "All Keywords",
      "Broad Match",
      "Phrase Match",
      "Exact Match",
      "Related",
      "Questions",
      "Languages",
    ]) {
      expect(html).toContain(label);
    }
    // Two match-type groups plus the rail's Topics/Groups toggle.
    expect(html.match(/class="seg-item active"/g)).toHaveLength(3);
  });

  it("names the report's own market and the currency the CPC column uses", () => {
    const html = render();
    expect(html).toContain("Database:");
    expect(html).toContain("Spain");
    // The CPC column and the currency selector must never disagree.
    expect(html).toContain("CPC (EUR)");
    expect(html.match(/EUR/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("renders the summary figures the way the reference prints them", () => {
    const html = render();
    expect(html).toContain("<strong>46,774</strong>");
    expect(html).toContain("<strong>839,160</strong>");
    expect(html).toContain("<strong>22%</strong>");
  });

  it("falls back to a dash in the summary, never to zero", () => {
    const data = makeFixture({
      summary: {
        keywordCount: { value: null, source: "error" },
        totalVolume: { value: null, source: "error" },
        averageDifficulty: { value: null, source: "error" },
      },
    });
    const summary = withoutIcons(summaryMetrics(render({ data })));
    expect(summary).not.toMatch(/\d/);
    expect(summary.match(/—/g)).toHaveLength(3);
  });

  it("badges an action only when a figure backs it", () => {
    expect(render()).toContain('<span class="btn-badge">489/1,000</span>');
    expect(render()).toContain('<span class="btn-badge">9/11</span>');

    // A quota nobody measured is a fabricated number in a small font.
    const data = makeFixture({
      actionBadges: { updateMetrics: null, manageColumns: null },
    });
    const html = render({ data });
    expect(html).toContain("Update metrics");
    // Asserted on the markup, not the phrase: the class also names a rule in
    // the inline <style>, which ships in the same string.
    expect(html).not.toContain('<span class="btn-badge">');
  });

  it("fills every column on a row that carries its metrics", () => {
    const row = bodyRow(render(), 0);
    expect(row).toContain("tartas de queso zaragoza");
    expect(row).toContain(">100<"); // Relevance
    expect(row).toContain(">720<"); // Volume
    expect(row).toContain(">134<"); // Results
    expect(row).toContain("1 month"); // Updated
    expect(row).toContain("0.00"); // CPC
    // No cell on a complete row falls back.
    expect(withoutIcons(row)).not.toContain("—");
    expect(withoutIcons(row)).not.toContain("n/a");
  });

  it("draws one SERP mark per feature the row reports", () => {
    const serp = cell(bodyRow(render(), 0), "num serp");
    expect((serp.match(/<svg /g) ?? []).length).toBe(5);
  });

  it("takes the stale wording from the caller rather than owning one", () => {
    // The sentence is a claim about WHY the cells are empty, and the two modes
    // have different reasons: the reference's rows await a crawl, ours are out
    // of scope. A template that hard-coded one would put the reference's
    // promise of a refresh on a report that can never refresh.
    const data = makeFixture({ staleLabel: "Not fetched for this report" });
    const row = bodyRow(render({ data }), 1);
    expect(row).toContain("Not fetched for this report");
    expect(row).not.toContain("try to refresh");
  });

  it("collapses the three SERP-fed columns into one message on a stale row", () => {
    const row = bodyRow(render(), 1);
    // One cell spanning three columns, not three separate blanks: one gap with
    // one cause.
    expect(row).toContain('colspan="3"');
    expect(row).toContain("For metrics, try to refresh");
    // The metrics the row DOES carry are still shown.
    expect(row).toContain(">86<"); // Relevance
    expect(row).toContain(">30<"); // Volume
    // ...and the two it doesn't say so, without inventing a classification.
    expect(row.match(/n\/a/g)).toHaveLength(2); // intent + KD
  });

  it("colours the difficulty dot from the number beside it, and greys a missing one", () => {
    // The app screen's own tiers: 20 / 35 / 50 / 65 / 80.
    const bands: [number | null, string][] = [
      [13, "#0ea47a"],
      [30, "#22c55e"],
      [39, "#eab308"],
      [58, "#f97316"],
      [75, "#ef4444"],
      [92, "#b91c1c"],
      [null, "#d6d8dc"],
    ];
    for (const [difficulty, color] of bands) {
      const data = makeFixture({
        tables: {
          keywords: { value: [fullRow({ difficulty })], source: "ok" },
          topics: { value: [], source: "ok" },
        },
      });
      expect(tableBody(render({ data }))).toContain(
        `class="kd-dot" style="background:${color}"`,
      );
    }
  });

  it("keeps the reference's measured row pitch, fraction and all", () => {
    // 44px at the reference's 1582px canvas x (1316/1582) = 36.6. The fraction
    // is the point: rounded to 36 it costs 0.6px a row, invisible on one row
    // and 18px of drift down a full table. Pinned because "36.6px" looks like
    // a typo to anyone who hasn't measured it.
    expect(render()).toContain("--row-height: 36.6px;");
  });

  it("keeps the table's height when there is no data to draw", () => {
    const data = makeFixture({
      sampleSize: 0,
      tables: {
        keywords: { value: [], source: "error" },
        topics: { value: [], source: "error" },
      },
      pagination: { currentPage: 1, totalPages: 1 },
    });
    const html = render({ data });
    // The empty body is one row pinned to a FULL table's height — a bare
    // message row would pull everything below it up the page.
    expect(html).toContain('<tr class="is-empty">');
    expect(html).toContain(
      `table.kw tr.is-empty td { height: calc(${TABLE_ROW_LIMIT} * var(--row-height)); }`,
    );
    expect(html).toContain("No keyword data for this seed");
    expect(html).toContain("No topics for this seed");
  });

  it("never renders more rows than the table is sized for", () => {
    const many = Array.from({ length: TABLE_ROW_LIMIT + 7 }, (_, i) =>
      fullRow({ keyword: `keyword ${i}` }),
    );
    const data = makeFixture({
      tables: {
        keywords: { value: many, source: "ok" },
        topics: { value: [], source: "ok" },
      },
    });
    // One extra row past the limit and the empty state's height stops matching
    // the populated one, which is the reflow the pinned height prevents.
    expect(tableBody(render({ data })).match(/<tr>/g)).toHaveLength(
      TABLE_ROW_LIMIT,
    );
  });

  it("renders the topic rail with an All row over the reference's total", () => {
    const html = render();
    expect(html).toContain("<th>Topic</th>");
    expect(html).toContain('<tr class="topic-all">');
    // The rail abbreviates; the exact figure survives on the cell's title.
    expect(html).toContain('title="46,774">46.8K<');
    expect(html).toContain("bascake zaragoza");
  });

  it("shows the page position the caller reports", () => {
    const html = render();
    expect(html).toContain('class="pager-input">1<');
    expect(html).toContain('class="pager-total">468<');
  });

  it("draws the market flag as inline SVG, never an emoji", () => {
    const html = render({ flags: { ES } });
    expect(html).toContain(`<span class="flag">${ES}</span>`);
    // The renderer's Chromium ships no colour emoji font, so a flag emoji
    // would degrade to bare letterforms.
    expect(html).not.toMatch(/\p{Regional_Indicator}/u);
  });

  it("asks the caller for every flag it can draw", () => {
    expect(keywordsFlagCodes("es")).toEqual(["ES"]);
  });

  it("inlines styles and loads nothing from the network", () => {
    const html = render();
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
    expect(html).not.toMatch(/@import/);
    expect(html).not.toMatch(/<script/);
    expect(html).not.toMatch(/src="https?:/);
  });

  it("escapes a user-controlled seed to avoid HTML injection", () => {
    const html = render({ keyword: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
