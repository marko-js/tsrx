declare module "@tsrx/core" {
  import type * as AST from "estree";
  import type {
    CodeMapping,
    CompileError,
    CompileResult,
    LineOffsets,
    ParseOptions,
    ParseResult,
    PostProcessingChanges,
    VolarMappingsResult,
  } from "@tsrx/core/types";

  export function parseModule(
    source: string,
    filename?: string,
    options?: ParseOptions,
  ): ParseResult["ast"];

  export function dedupeMappings(mappings: CodeMapping[]): CodeMapping[];

  export function createVolarMappingsResult(params: {
    ast: AST.Program;
    ast_from_source: AST.Program;
    source: string;
    generated_code: string;
    source_map: CompileResult["js"]["map"];
    errors?: CompileError[];
    post_processing_changes?: PostProcessingChanges;
    line_offsets?: LineOffsets;
  }): VolarMappingsResult;
}
