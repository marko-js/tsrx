# tsrx · Marko

Write [Marko](https://markojs.com/) components in [TSRX](https://tsrx.dev/).

Each item in a keyed list gets its **own independent reactive state** —
Marko surgically updates only the counter that changed, with no virtual DOM.

<table>
<tr>
<th>TSRX</th>
<th>Marko</th>
</tr>
<tr>
<td>

```tsrx
export default component() {
  <h1>{"Groceries"}</h1>

  let items = [];

  <ul>
    for (const counter of items; index i; key counter.id) {
      let count = 1;

      <li>
        <span>{text counter.label}</span>
        <button onClick={() => {
          if (--count < 1) {
            items = items.toSpliced(i, 1);
          }
        }}>{"−"}</button>
        <span>{count}</span>
        <button onClick={() => { count++ }}>{"+"}</button>
      </li>
    }
  </ul>

  let id = 0;

  <form onSubmit={(e) => {
    e.preventDefault();
    items = items.concat({ id: id++, label: e.target.item.value });
    e.target.reset();
  }}>
    <input name="item" />
    <button>{"Add"}</button>
  </form>
}
```

</td>
<td>

```marko
<h1>Groceries</h1>

<let/items=[]>

<ul>
  <for|counter, i| of=items by="id">
    <let/count=1>

    <li>
      <span>${counter.label}</span>
      <button onClick() {
        if (--count < 1) {
          items = items.toSpliced(i, 1);
        }
      }>−</button>
      <span>${count}</span>
      <button onClick() { count++ }>+</button>
    </li>
  </for>
</ul>

<let/id=0>

<form onSubmit(e) {
  e.preventDefault();
  items = items.concat({ id: id++, label: e.target.item.value });
  e.target.reset();
}>
  <input name="item">
  <button>Add</button>
</form>
```

</td>
</tr>
</table>

## Packages

- [`@marko/tsrx`](./packages/tsrx): compiles `.tsrx` to `.marko` Tags API
- [`@marko/vite-plugin-tsrx`](./packages/vite-plugin-tsrx): Vite plugin that serves compiled output as virtual `.marko` files

## Examples

- [`examples/basic-spa`](./examples/basic-spa) — Vite SPA
- [`examples/marko-run`](./examples/marko-run) — full-stack with `@marko/run`

## Development

```bash
npm install
npm run build
npm test
```
