import { describe, expect, it } from "vitest";

// ── Path-formula tests ────────────────────────────────────────────────────────
//
// Each `.tsrx` source is presented to `@marko/vite` as a sibling `.marko`
// file with a CLEAN stem: `Counter.tsrx` → `Counter.marko`.
//
// The stem must be clean (no extra dots) because `@marko/compiler`'s taglib
// scanner maps `Counter.marko` → tag name `counter` using
// `filename.slice(0, -'.marko'.length)`. Any extra dots (e.g. `Counter.tsrx`)
// would produce the wrong tag name and break `<Counter/>` static resolution.
//
// The virtual `.marko` file has no physical existence on disk; it is served by
// our `load` hook (enforced "pre") and intercepted by our custom `fileSystem`
// proxy injected into `@marko/compiler`.

function tsrx_to_marko(tsrx_path: string): string {
  return tsrx_path.replace(/\.tsrx$/, ".marko");
}

describe("@marko/vite-plugin-tsrx virtual-marko path formula", () => {
  it("replaces .tsrx extension with .marko, keeping directory and stem", () => {
    expect(tsrx_to_marko("/proj/src/tags/Counter.tsrx")).toBe(
      "/proj/src/tags/Counter.marko",
    );
  });

  it("works for deeply nested paths", () => {
    expect(tsrx_to_marko("/proj/src/deep/nested/Foo.tsrx")).toBe(
      "/proj/src/deep/nested/Foo.marko",
    );
  });

  it("is idempotent", () => {
    const tsrx = "/proj/src/App.tsrx";
    expect(tsrx_to_marko(tsrx)).toBe(tsrx_to_marko(tsrx));
  });

  it("produces a clean stem with no dots (taglib scanner requirement)", () => {
    const marko = tsrx_to_marko("/proj/src/tags/Counter.tsrx");
    const basename = marko.split("/").at(-1)!;
    const stem = basename.slice(0, -".marko".length);
    expect(stem).toBe("Counter");
    expect(stem).not.toContain(".");
  });

  it("differs from a .tsrx.marko suffix (which would break tag discovery)", () => {
    const clean = tsrx_to_marko("/proj/src/tags/Counter.tsrx");
    const broken = "/proj/src/tags/Counter.tsrx.marko";
    expect(clean).not.toBe(broken);
    expect(clean).toBe("/proj/src/tags/Counter.marko");
  });
});

// ── Include-pattern filter tests ─────────────────────────────────────────────

describe("@marko/vite-plugin-tsrx include-pattern filtering", () => {
  function test_pattern(pattern: RegExp, path: string): boolean {
    pattern.lastIndex = 0;
    return pattern.test(path);
  }

  const DEFAULT = /\.tsrx$/;

  it("default pattern matches .tsrx and nothing else", () => {
    expect(test_pattern(DEFAULT, "/abs/App.tsrx")).toBe(true);
    expect(test_pattern(DEFAULT, "/abs/App.ts")).toBe(false);
    expect(test_pattern(DEFAULT, "/abs/App.tsx")).toBe(false);
    expect(test_pattern(DEFAULT, "/abs/App.marko")).toBe(false);
    // The virtual sibling should NOT re-trigger compilation
    expect(test_pattern(DEFAULT, "/abs/App.tsrx.marko")).toBe(false);
  });

  it("custom additive pattern", () => {
    const p = /\.(tsrx|mts)$/;
    expect(test_pattern(p, "/abs/App.tsrx")).toBe(true);
    expect(test_pattern(p, "/abs/App.mts")).toBe(true);
    expect(test_pattern(p, "/abs/App.ts")).toBe(false);
  });

  it("custom narrowing pattern", () => {
    const p = /\/src\/.*\.tsrx$/;
    expect(test_pattern(p, "/proj/src/App.tsrx")).toBe(true);
    expect(test_pattern(p, "/proj/tests/App.tsrx")).toBe(false);
  });

  it("g-flagged regex stays consistent across multiple calls", () => {
    const p = /\.tsrx$/g;
    expect(test_pattern(p, "/abs/App.tsrx")).toBe(true);
    expect(test_pattern(p, "/abs/App.tsrx")).toBe(true);
    expect(test_pattern(p, "/abs/App.tsrx")).toBe(true);
  });
});

// ── Virtual fs proxy behaviour ────────────────────────────────────────────────

describe("@marko/vite-plugin-tsrx virtual-fs readdirSync injection", () => {
  // Simulate what the readdirSync proxy does: for each .tsrx in the listing,
  // inject a sibling .marko with a clean stem.
  function inject_marko_entries(entries: string[]): string[] {
    const result = [...entries];
    for (const e of entries) {
      if (e.endsWith(".tsrx")) {
        const marko = e.replace(/\.tsrx$/, ".marko");
        if (!result.includes(marko)) result.push(marko);
      }
    }
    return result;
  }

  it("injects Counter.marko for Counter.tsrx", () => {
    const entries = inject_marko_entries(["Counter.tsrx", "styles.css"]);
    expect(entries).toContain("Counter.marko");
    expect(entries).toContain("Counter.tsrx");
    expect(entries).toContain("styles.css");
  });

  it("does not duplicate if Counter.marko already exists", () => {
    const entries = inject_marko_entries(["Counter.tsrx", "Counter.marko"]);
    expect(entries.filter((e) => e === "Counter.marko").length).toBe(1);
  });

  it("stem of injected file matches tag name convention", () => {
    const entries = inject_marko_entries(["MyWidget.tsrx"]);
    const injected = entries.find((e) => e.endsWith(".marko"))!;
    const stem = injected.slice(0, -".marko".length);
    expect(stem).toBe("MyWidget");
    expect(stem).not.toContain(".");
  });
});
