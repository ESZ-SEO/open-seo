import { describe, expect, it } from "vitest";
import { ES } from "country-flag-icons/string/3x2";
import { loadCountryFlags } from "@/server/lib/render/country-flags";

describe("loadCountryFlags", () => {
  it("resolves the codes it recognises and drops the rest", async () => {
    // "WW" is the worldwide aggregate and "ZZ" is unassigned: neither has
    // artwork, and inventing one would put the wrong flag beside a country.
    const flags = await loadCountryFlags(["es", "WW", "ZZ"]);
    expect(flags).toEqual({ ES });
  });

  it("returns an empty map without loading the flag set", async () => {
    await expect(loadCountryFlags([])).resolves.toEqual({});
  });
});
