import { beforeEach, describe, expect, it, vi } from "vitest";

// A getter keeps `env` live so the test can supply its own KV, mirroring how
// the module under test imports env.
const mockEnv: Record<string, unknown> = {};

vi.mock("cloudflare:workers", () => ({
  get env() {
    return mockEnv;
  },
}));

import { consumeRenderBudget } from "./render-budget";

function createKvFake() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

beforeEach(() => {
  mockEnv.KV = createKvFake();
});

describe("consumeRenderBudget", () => {
  it("refuses once the hourly limit is spent", async () => {
    // 20 renders in the window is the hourly cap; the 21st is the one a
    // runaway loop hits, and it has to be refused rather than rendered.
    for (let i = 0; i < 20; i++) await consumeRenderBudget("org_1");

    await expect(consumeRenderBudget("org_1")).rejects.toThrow(
      /rendered 20 report images in the past hour/,
    );
    // Another organization's loop is not this one's problem.
    await expect(consumeRenderBudget("org_2")).resolves.toBeUndefined();
  });
});
