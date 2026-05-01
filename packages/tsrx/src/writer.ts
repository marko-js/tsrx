import { encode } from "@jridgewell/sourcemap-codec";

export type SourceMap = {
  version: "3";
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
};

/** A single source ↔ generated mapping with exact token lengths. */
export type MappingEntry = {
  sourceOffset: number;
  generatedOffset: number;
  length: number;
  generatedLength: number;
};

// ─── Writer ───────────────────────────────────────────────────────────────────
//
// The Marko target emits a string in a different language (not a new AST), so
// we can't reuse esrap's print() like the JSX targets do. Writer builds the
// output while tracking which segments correspond to positions in the source.
//
//   write(text)             — emit literal text with no source mapping
//   writeNode(text, offset) — emit text mapped back to `offset` in the source
//   writeSrc(node)          — slice source[node.start..node.end] + map it

// Each segment: [generatedCol, sourceIndex=0, sourceLine, sourceCol]
type Segment = [number, 0, number, number];

export class Writer {
  #chunks: string[] = [];
  #source: string;
  #genOffset = 0;
  #genLine = 0;
  #genCol = 0;
  #lines: Segment[][] = [[]];
  #srcLineStarts: number[];
  #mappingEntries: MappingEntry[] = [];

  constructor(source: string) {
    this.#source = source;
    const starts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "\n") starts.push(i + 1);
    }
    this.#srcLineStarts = starts;
  }

  write(text: string): this {
    if (!text) return this;
    this.#chunks.push(text);
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") {
        this.#genLine++;
        this.#genCol = 0;
        this.#lines.push([]);
      } else {
        this.#genCol++;
      }
    }
    this.#genOffset += text.length;
    return this;
  }

  writeNode(text: string, sourceOffset: number, sourceLength?: number): this {
    if (!text) return this;
    const [srcLine, srcCol] = this.#srcLineCol(sourceOffset);
    this.#lines[this.#genLine]!.push([this.#genCol, 0, srcLine, srcCol]);
    this.#mappingEntries.push({
      sourceOffset,
      generatedOffset: this.#genOffset,
      length: sourceLength ?? text.length,
      generatedLength: text.length,
    });
    return this.write(text);
  }

  /**
   * Emit the *value* of a quoted string literal (quotes already stripped)
   * as a single mapping.  The source length covers the raw source bytes
   * between the quotes (escape sequences count as multiple source bytes),
   * while the generated length is the resolved value length.
   *
   * @param value   The already-resolved string value (JS string).
   * @param srcStart  Offset in the source file of the first char after the opening quote.
   * @param srcEnd    Offset in the source file of the closing quote.
   */
  writeLiteralSegments(value: string, srcStart: number, srcEnd: number): this {
    return this.writeNode(value, srcStart, srcEnd - srcStart);
  }

  writeSrc(node: { start?: number; end?: number }): this {
    if (node.start == null || node.end == null) return this;
    return this.writeNode(this.#source.slice(node.start, node.end), node.start);
  }

  nl(): this {
    return this.write("\n");
  }

  /** True when the last character written was a newline (or nothing has been written). */
  get atLineStart(): boolean {
    return this.#genCol === 0;
  }

  toString(): string {
    return this.#chunks.join("");
  }

  get mappingEntries(): MappingEntry[] {
    return this.#mappingEntries;
  }

  generateMap(filename: string | undefined, source: string): SourceMap {
    return {
      version: "3",
      sources: [filename ?? ""],
      sourcesContent: [source],
      names: [],
      mappings: encode(this.#lines),
    };
  }

  #srcLineCol(offset: number): [number, number] {
    let lo = 0;
    let hi = this.#srcLineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.#srcLineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return [lo, offset - this.#srcLineStarts[lo]!];
  }
}
