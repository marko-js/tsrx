import { encode } from "@jridgewell/sourcemap-codec";

export type SourceMap = {
  version: "3";
  sources: string[];
  sourcesContent: string[];
  names: string[];
  mappings: string;
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
  #genLine = 0;
  #genCol = 0;
  #lines: Segment[][] = [[]];
  #lineStarts: number[];
  #source: string;

  constructor(source: string) {
    this.#source = source;
    const starts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "\n") starts.push(i + 1);
    }
    this.#lineStarts = starts;
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
    return this;
  }

  writeNode(text: string, sourceOffset: number): this {
    if (!text) return this;
    const [srcLine, srcCol] = this.#offsetToLineCol(sourceOffset);
    this.#lines[this.#genLine]!.push([this.#genCol, 0, srcLine, srcCol]);
    return this.write(text);
  }

  writeSrc(node: { start?: number; end?: number }): this {
    if (node.start == null || node.end == null) return this;
    return this.writeNode(this.#source.slice(node.start, node.end), node.start);
  }

  nl(): this {
    return this.write("\n");
  }

  toString(): string {
    return this.#chunks.join("");
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

  #offsetToLineCol(offset: number): [number, number] {
    let lo = 0;
    let hi = this.#lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.#lineStarts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return [lo, offset - this.#lineStarts[lo]!];
  }
}
