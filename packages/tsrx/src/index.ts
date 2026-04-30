import { parseModule } from "@tsrx/core";
import type { CodeMapping, VolarMappingsResult } from "@tsrx/core/types";
import { transform } from "./transform.js";

/**
 * Compile a `.tsrx` module to Marko Tags API template text.
 */
export function compile(source: string, filename?: string) {
  const ast = parseModule(source, filename);
  const { ast: _ast, ...result } = transform(ast, source, filename);
  return result;
}

// All editor features enabled; format disabled (generated code isn't user-editable).
const MAPPING_DATA: CodeMapping["data"] = {
  verification: true,
  completion: true,
  semantic: true,
  navigation: true,
  structure: true,
  format: false,
  customData: {},
} as CodeMapping["data"];

/**
 * Compile tsrx-marko source to virtual Marko template code plus Volar
 * `CodeMapping[]` for editor tooling (hover, go-to-definition, diagnostics).
 */
export function compile_to_volar_mappings(
  source: string,
  filename?: string,
): VolarMappingsResult {
  const ast = parseModule(source, filename);
  const { code, writer } = transform(ast, source, filename);

  const mappings: CodeMapping[] = writer.mappingEntries.map((e) => ({
    sourceOffsets: [e.sourceOffset],
    generatedOffsets: [e.generatedOffset],
    lengths: [e.length],
    generatedLengths: [e.length],
    data: MAPPING_DATA,
  }));

  return { code, mappings, cssMappings: [], errors: [] };
}
