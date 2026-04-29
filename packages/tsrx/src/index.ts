import {
  parseModule,
  dedupeMappings,
  createVolarMappingsResult,
} from "@tsrx/core";
import { transform } from "./transform.js";

/**
 * Compile a `.tsrx` module to Marko Tags API template text.
 */
export function compile(source: string, filename?: string) {
  const ast = parseModule(source, filename);
  const { ast: _ast, ...result } = transform(ast, source, filename);
  return result;
}

/**
 * Compile tsrx-marko source to virtual TSX plus Volar mappings for editor tooling.
 */
export function compile_to_volar_mappings(source: string, filename?: string) {
  const ast = parseModule(source, filename);
  const transformed = transform(ast, source, filename);
  const result = createVolarMappingsResult({
    ast: transformed.ast,
    ast_from_source: ast,
    source,
    generated_code: transformed.code,
    source_map: transformed.map,
    errors: [],
  });

  return {
    ...result,
    mappings: dedupeMappings(result.mappings),
  };
}
