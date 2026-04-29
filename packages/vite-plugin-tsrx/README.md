# @marko/vite-plugin-tsrx

Vite plugin that compiles `.tsrx` files to [Marko Tags API](https://markojs.com/docs/reference/language.md) source via [`@marko/tsrx`](../tsrx), then lets `@marko/vite` / `@marko/run` handle the `.marko` → JS stage — **without writing any files to disk**.

## Installation

```bash
npm add -D @marko/vite-plugin-tsrx
```

You'll also need `@marko/vite` (or `@marko/run`) and `vite` installed.

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import marko from "@marko/vite";
import { tsrxMarko } from "@marko/vite-plugin-tsrx";

export default defineConfig({
  plugins: [
    tsrxMarko(), // must come before @marko/vite
    marko(),
  ],
});
```

### Options

| Option    | Type     | Default      | Description                                                        |
| --------- | -------- | ------------ | ------------------------------------------------------------------ |
| `include` | `RegExp` | `/\.tsrx$/`  | Pattern matched against file paths to select tsrx source modules.  |

```ts
tsrxMarko({ include: /\.tsrx$/ })
```

## How it works

Each `.tsrx` source is presented to the toolchain as a **virtual sibling `.marko` file** with the same stem:

```
src/tags/Counter.tsrx  →  src/tags/Counter.marko  (virtual, never written to disk)
```

A proxy around Node's `fs` intercepts `readFileSync`, `statSync`, and `readdirSync` so that `@marko/compiler`'s synchronous import-graph walk and taglib scanner both see the virtual `.marko` files transparently. This lets `<Counter/>` resolve as a static tag without any manual taglib registration.

### Vite hooks (all `enforce: "pre"`)

- **`resolveId`** — explicit `.tsrx` imports get their extension swapped to `.marko`; compiler-emitted `.marko` imports for virtual tags are resolved to their absolute path.
- **`load`** — serves compiled Marko source for any `.marko` module whose sibling `.tsrx` exists on disk.
- **`handleHotUpdate`** — on `.tsrx` save, clears the compile cache and invalidates the virtual `.marko` module for full HMR.

## License

MIT © Luke LaValva
