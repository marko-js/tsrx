# @marko/tsrx

Compiles `.tsrx` source to [Marko Tags API](https://markojs.com/docs/reference/language.md) template text. Output is plain Marko source; a downstream pass through [`@marko/compiler`](https://markojs.com/docs/guide/marko-5-interop.md) (for example via a Marko bundler plugin) produces the final JS.

## Installation

```bash
pnpm add @marko/tsrx
```

## Usage

```js
import { compile } from "@marko/tsrx";

const { files } = compile(source, "App.tsrx");
```

`compile` returns:

- `ast` — the ast built from `@tsrx/core`
- `files` — array of `.marko` files, each mapped from a single `component` definition

## TSRX → Marko mapping (MVP)

| TSRX                                                      | Marko                                                                                                                       |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `component App(props: T) { ... }`                         | `export type Input = T;` + `<const/props=input/>`                                                                           |
| `component App({ a, b }: T) { ... }`                      | `export type Input = T;` + `<const/{ a, b }=input/>`                                                                        |
| `component App() { ... }`                                 | (no Input type, no binding)                                                                                                 |
| `<div class="x">{expr}</div>`                             | `<div class="x">${expr}</div>`                                                                                              |
| `{text "safe string"}`                                    | `safe string` (plain text when value contains none of `< > $ {`)                                                            |
| `{text expr}`                                             | `${expr}`                                                                                                                   |
| `{html expr}`                                             | `$!{expr}`                                                                                                                  |
| `attr={expr}`                                             | `attr=expr` (wrapped in `(...)` if expr contains an unenclosed `>` or `<`)                                                  |
| `<div {attr}>`                                            | `<div attr=attr>`                                                                                                           |
| `<div {ref el}>`                                          | `<div/el>` (tag variable)                                                                                                   |
| `<div {...rest}>`                                         | `<div ...rest>`                                                                                                             |
| `const name = expr`                                       | `<const/name=expr/>`                                                                                                        |
| `let name` / `let name = expr`                            | `<let/name/>` / `<let/name=expr/>`                                                                                          |
| `const title = <tsx><span class="x">{"Hi"}</span></tsx>;` | `<define/title><span class="x">${"Hi"}</span></define>` · use `{title}` → Marko `<${title}/>`                               |
| `<input.content/>`                                        | `<${input.content}/>` (member expression tag names map to dynamic tags)                                                     |
| `if / else if / else`                                     | `<if=...>`, `<else if=...>`, `<else>`                                                                                       |
| `for (const x of xs; index i; key x.id)`                  | `<for\|x, i\| of=xs by=(x) => x.id>`                                                                                        |
| `switch (d) { case a: ...; default: ...; }`               | chained `<if=d===a>` / `<else>`                                                                                             |
| `try { ... } pending { ... } catch (err) { ... }`         | `<try>` … `<@placeholder>` … `<@catch\|err\|>` … `</try>` (catch param name replaces `err`)                                 |
| `<style>...</style>`                                      | `<style>...</style>` (passed through as CSS-modules-friendly; scoped hash is applied by the existing `@tsrx/core` pipeline) |

## Not yet supported (MVP)

- `&[...]` / `&{...}` lazy destructuring — surfaces a clear "not yet supported" error.
- `#server { ... }` blocks — not supported; `compile()` throws a clear error (parse still succeeds when `@tsrx/core` accepts the syntax).

## License

MIT © Luke LaValva
