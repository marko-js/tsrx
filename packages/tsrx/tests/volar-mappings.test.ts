/**
 * Volar source-map regression tests for compile_to_volar_mappings().
 *
 * Users were hitting:
 *   Error: Unhandled AST node type in mapping walker: Component
 *
 * The old implementation passed the raw .tsrx AST into createVolarMappingsResult()
 * from @tsrx/core, whose walker only understands Svelte/Ripple-lowered trees.
 * The function now builds CodeMapping[] directly from the Writer source map.
 *
 * This test file:
 *   1. Calls compile_to_volar_mappings() on every non-error fixture (catches the crash).
 *   2. Validates structural correctness of every CodeMapping (bounds checks).
 *   3. Snapshots all mappings as a single human-readable file so regressions
 *      are visible as diffs without hunting across dozens of snapshot files.
 *
 * Snapshot format — one block per fixture:
 *   === fixture-name ===
 *     src:N "source snippet" -> "generated snippet"
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile_to_volar_mappings } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesRoot = join(here, "fixtures");
const ERROR_FIXTURES = new Set(["lazy-error", "parse-error", "server-error"]);

const fixtures = readdirSync(fixturesRoot)
  .filter((n) => statSync(join(fixturesRoot, n)).isDirectory())
  .filter((n) => !ERROR_FIXTURES.has(n))
  .sort();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build one block of the snapshot for a single fixture. */
function fixtureBlock(
  name: string,
  source: string,
  result: ReturnType<typeof compile_to_volar_mappings>,
): string {
  const SNIP = 40;
  const srcLines = source.split("\n");
  const genLines = result.code.split("\n");

  // Build a line-offset table so we can convert flat offsets → line numbers.
  const srcOffsets = buildLineOffsets(source);
  const genOffsets = buildLineOffsets(result.code);

  const rows: string[] = [];
  for (const m of result.mappings) {
    const srcOff = m.sourceOffsets[0]!;
    const genOff = m.generatedOffsets[0]!;
    const srcLen = m.lengths[0]!;
    const genLen = m.generatedLengths[0]!;

    const srcLine = lineOf(srcOff, srcOffsets);
    const srcSnip = source.slice(srcOff, srcOff + Math.min(srcLen, SNIP));
    const genSnip = result.code.slice(genOff, genOff + Math.min(genLen, SNIP));

    rows.push(
      `  src:${String(srcLine + 1).padStart(2)} ${JSON.stringify(srcSnip)} -> ${JSON.stringify(genSnip)}`,
    );
  }

  return [`=== ${name} ===`, ...rows, ""].join("\n");
}

function buildLineOffsets(text: string): number[] {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

function lineOf(offset: number, lineOffsets: number[]): number {
  let lo = 0,
    hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineOffsets[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("compile_to_volar_mappings", () => {
  // Accumulate all fixture blocks into one snapshot.
  const blocks: string[] = [];

  for (const name of fixtures) {
    it(name, () => {
      const source = readFileSync(join(fixturesRoot, name, "index.tsrx"), "utf8");

      // 1. Must not throw — the old code crashed with
      //    "Unhandled AST node type in mapping walker: Component"
      //    on every single .tsrx file.
      const result = compile_to_volar_mappings(source, "index.tsrx");

      expect(result.errors).toEqual([]);
      expect(result.cssMappings).toEqual([]);

      // 2. Every mapping must have valid, in-bounds offsets and lengths.
      for (const m of result.mappings) {
        const srcOff = m.sourceOffsets[0]!;
        const genOff = m.generatedOffsets[0]!;
        const srcLen = m.lengths[0]!;
        const genLen = m.generatedLengths[0]!;

        expect(srcLen).toBeGreaterThan(0);
        expect(genLen).toBeGreaterThan(0);
        expect(srcOff).toBeGreaterThanOrEqual(0);
        expect(srcOff + srcLen).toBeLessThanOrEqual(source.length);
        expect(genOff).toBeGreaterThanOrEqual(0);
        expect(genOff + genLen).toBeLessThanOrEqual(result.code.length);
      }

      blocks.push(fixtureBlock(name, source, result));
    });
  }

  // 3. Single snapshot for all fixtures — easy to grep, one diff to review.
  it("snapshot", async () => {
    await expect(blocks.join("\n")).toMatchFileSnapshot(
      join(here, "__snapshots__", "volar-mappings.txt"),
    );
  });
});
