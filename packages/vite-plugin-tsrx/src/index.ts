import type { Plugin, ResolvedConfig } from "vite";
import realFs from "node:fs";
import { readFile } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  resolve as path_resolve,
  join as path_join,
} from "node:path";
import { compile } from "@marko/tsrx";

export interface TsrxMarkoOptions {
  /**
   * Regular expression matched against file paths to decide which modules
   * the plugin should compile as tsrx sources. Defaults to `/\.tsrx$/`.
   */
  include?: RegExp;
}

const DEFAULT_TSRX_PATTERN = /\.tsrx$/;

/**
 * Vite plugin that compiles `.tsrx` files to Marko Tags API source via
 * `@marko/tsrx`, then lets `@marko/vite` / `@marko/run` handle the
 * `.marko` → JS stage — **without writing any files to disk**.
 *
 * ### Virtual module strategy
 *
 * Each `.tsrx` source is presented to the toolchain as a virtual sibling
 * `.marko` file with the same stem:
 *
 *   `src/tags/Counter.tsrx` → `src/tags/Counter.marko` (virtual)
 *
 * The stem must be clean (no extra dots) because `@marko/compiler`'s taglib
 * scanner derives the tag name as `basename.slice(0, -".marko".length)`. Any
 * extra dots would produce the wrong name and break `<Counter/>` resolution.
 *
 * ### Why `@marko/compiler` needs a custom `fileSystem`
 *
 * `@marko/compiler`'s `output: "hydrate"` pass follows the **entire static
 * import graph synchronously** using `readFileSync` — not through Vite's
 * module graph. It must read every template it discovers to find reactive
 * scopes (`<let>`, etc.) and emit per-scope hydration init imports. Because
 * `Counter.marko` doesn't exist on disk, we intercept those reads with a
 * proxy that compiles on demand.
 *
 * The same proxy intercepts `readdirSync` so the taglib scanner injects
 * `Counter.marko` alongside `Counter.tsrx` in `tags/` directories, enabling
 * `<Counter/>` static tag resolution without any manual taglib registration.
 *
 * ### Installing the proxy
 *
 * We call `compiler.configure({ fileSystem: virtual_fs })` in `configResolved`,
 * which fires **after** `@marko/vite`'s `config` hook — the only place
 * `compiler.configure()` is called by that plugin. No wrapper or sentinel
 * is needed; a simple call in the right lifecycle hook is sufficient.
 *
 * `@marko/compiler`'s babel plugin sets `taglibConfig.fs = markoOpts.fileSystem`
 * at the start of every compilation and restores it afterwards, so patching
 * `taglibConfig.fs` directly is unnecessary — `configure()` is the only hook
 * we need.
 *
 * ### Vite hooks
 *
 * - **`resolveId`** (`enforce: "pre"`): two cases —
 *   1. Explicit `.tsrx` import → swap extension to `.marko`, return abs path.
 *   2. Compiler-emitted `.marko` import (e.g. from taglib resolution) →
 *      resolve to abs path if a sibling `.tsrx` exists; `load` serves it.
 * - **`load`** (`enforce: "pre"`): intercepts `.marko` ids whose sibling
 *   `.tsrx` exists; compiles and returns Marko source. Runs before
 *   `@marko/vite`'s load (which returns `null` for plain `.marko` files,
 *   falling back to a disk read that would fail for our virtual files).
 * - **`handleHotUpdate`**: on `.tsrx` save, clears the cache entry and
 *   invalidates the virtual `.marko` module.
 */
export function tsrxMarko(options: TsrxMarkoOptions = {}): Plugin {
  let root_dir = process.cwd();

  const include_pattern = options.include ?? DEFAULT_TSRX_PATTERN;

  /** Returns true if `path` matches the tsrx include pattern. */
  const is_tsrx_source = (path: string): boolean => {
    include_pattern.lastIndex = 0;
    return include_pattern.test(path);
  };

  /**
   * Given an absolute `.marko` path, returns the sibling `.tsrx` path if it
   * exists on disk and matches the include pattern — otherwise `null`.
   *
   * `src/tags/Counter.marko` → `src/tags/Counter.tsrx` (if it exists)
   */
  const sibling_tsrx = (marko_path: string): string | null => {
    if (!marko_path.endsWith(".marko")) return null;
    const candidate = marko_path.slice(0, -".marko".length) + ".tsrx";
    if (!is_tsrx_source(candidate)) return null;
    try {
      realFs.statSync(candidate);
      return candidate;
    } catch {
      return null;
    }
  };

  /**
   * In-memory cache: virtual `.marko` abs path → compiled Marko source.
   * Shared between the synchronous `fs` proxy (called by `@marko/compiler`)
   * and the async `load` hook (called by Vite). Entries are invalidated in
   * `handleHotUpdate`.
   */
  const compiled_cache = new Map<string, string>();

  /**
   * Compile `tsrx_path` to Marko source (synchronous), writing the result
   * into `compiled_cache` keyed by `marko_path`. Returns cached output on
   * subsequent calls with the same key.
   */
  const compile_and_cache = (tsrx_path: string, marko_path: string): string => {
    const hit = compiled_cache.get(marko_path);
    if (hit !== undefined) return hit;
    const source = realFs.readFileSync(tsrx_path, "utf-8");
    const { code } = compile(source, tsrx_path);
    compiled_cache.set(marko_path, code);
    return code;
  };

  /**
   * Proxy around Node's `fs` that makes virtual `Counter.marko` files
   * transparent to `@marko/compiler` without touching the real filesystem.
   *
   * Three operations are intercepted for paths where a sibling `.tsrx` exists:
   * - `readFileSync` → compile on demand and return Marko source.
   * - `statSync`     → proxy to the real `.tsrx` stat so `loadTagFromProps`
   *                    can verify the template exists (it calls `statSync` on
   *                    the template path after `scanTagsDir` sets it).
   * - `readdirSync`  → inject `Counter.marko` for every `Counter.tsrx` in the
   *                    listing so the taglib scanner discovers the tag.
   */
  const virtual_fs = new Proxy(realFs, {
    get(target, prop: string) {
      if (prop === "readFileSync") {
        return (file_path: string, ...args: unknown[]) => {
          const tsrx = sibling_tsrx(file_path);
          if (tsrx) return compile_and_cache(tsrx, file_path);
          return (target.readFileSync as Function)(file_path, ...args);
        };
      }
      if (prop === "statSync") {
        return (file_path: string, ...args: unknown[]) => {
          const tsrx = sibling_tsrx(file_path);
          if (tsrx) return target.statSync(tsrx);
          return (target.statSync as Function)(file_path, ...args);
        };
      }
      if (prop === "readdirSync") {
        return (dir_path: string, ...args: unknown[]) => {
          const entries = (target.readdirSync as Function)(dir_path, ...args) as string[];
          for (const entry of entries) {
            if (is_tsrx_source(entry)) {
              const marko_name = entry.replace(/\.tsrx$/, ".marko");
              if (!entries.includes(marko_name)) entries.push(marko_name);
            }
          }
          return entries;
        };
      }
      const val = (target as Record<string, unknown>)[prop];
      return typeof val === "function" ? (val as Function).bind(target) : val;
    },
  });

  /**
   * Install `virtual_fs` into `@marko/compiler`. Called in `configResolved`,
   * which fires after `@marko/vite`'s `config` hook — the only lifecycle point
   * where that plugin calls `compiler.configure()`. A single call here is
   * sufficient: the babel plugin propagates `globalConfig.fileSystem` into
   * `taglibConfig.fs` automatically at the start of every compilation.
   */
  const install_virtual_fs = async () => {
    const { configure, taglib } = await import("@marko/compiler");
    configure({ fileSystem: virtual_fs });
    taglib.clearCaches();
  };

  return {
    name: "@marko/vite-plugin-tsrx",
    enforce: "pre",

    async configResolved(config: ResolvedConfig) {
      root_dir = config.root;
      await install_virtual_fs();
    },

    async resolveId(source, importer, opts) {
      // Case 1: explicit `.tsrx` import → swap extension to `.marko`.
      if (is_tsrx_source(source)) {
        const resolved = await this.resolve(source, importer, {
          ...opts,
          skipSelf: true,
        });
        const tsrx_path = resolved?.id
          ? isAbsolute(resolved.id)
            ? resolved.id
            : path_resolve(root_dir, resolved.id)
          : isAbsolute(source)
            ? source
            : importer
              ? path_join(dirname(importer), source)
              : path_resolve(root_dir, source);
        if (!is_tsrx_source(tsrx_path)) return null;
        const marko_path = tsrx_path.replace(/\.tsrx$/, ".marko");
        return resolved ? { ...resolved, id: marko_path } : marko_path;
      }

      // Case 2: compiler-emitted `.marko` import for a virtual tag.
      // @marko/compiler emits e.g. `../tags/Counter.marko` in its hydrate
      // output after taglib resolution. Rollup cannot find it on disk; we
      // resolve it here so our `load` hook can serve the content.
      if (source.endsWith(".marko") && importer) {
        const abs = isAbsolute(source)
          ? source
          : path_join(dirname(importer.split("?")[0]), source);
        if (sibling_tsrx(abs)) return abs;
      }

      return null;
    },

    async load(id) {
      // Serve any `.marko` module whose sibling `.tsrx` exists on disk.
      // Running enforce:"pre" means this fires before @marko/vite's load,
      // which returns null for plain .marko files and lets Vite fall back to
      // a disk read that would fail for our virtual modules.
      const clean_id = id.split("?")[0];
      const tsrx = sibling_tsrx(clean_id);
      if (!tsrx) return null;

      // The fs proxy (compile_and_cache) may have already compiled this file
      // synchronously when @marko/compiler walked the import graph. Use that
      // result if available; otherwise compile now.
      const cached = compiled_cache.get(clean_id);
      if (cached !== undefined) return { code: cached };

      const source = await readFile(tsrx, "utf-8");
      const { code, map } = compile(source, tsrx);
      compiled_cache.set(clean_id, code);
      return { code, map: map as never };
    },

    handleHotUpdate(ctx) {
      if (!is_tsrx_source(ctx.file)) return;
      const marko_path = ctx.file.replace(/\.tsrx$/, ".marko");
      compiled_cache.delete(marko_path);
      const mod = ctx.server.moduleGraph.getModuleById(marko_path);
      if (mod) return [mod, ...ctx.modules];
      return ctx.modules;
    },
  };
}

export default tsrxMarko;
