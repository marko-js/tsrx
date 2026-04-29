export default component Counter({ label, initial = 0 }: {
  label: string;
  initial?: number;
}) {
  let count = initial;

  <div class="counter">
    <span class="label">{text label}</span>
    <button onClick={() => { count--; }}>{"−"}</button>
    <span class="value">{count}</span>
    <button onClick={() => { count++; }}>{"+"}</button>
  </div>

  <style>
    .counter { display: flex; align-items: center; gap: 0.75rem; margin: 1rem 0; }
    .counter .label { min-width: 6rem; font-weight: bold; }
    .counter .value { min-width: 2rem; text-align: center; font-size: 1.25rem; }
    .counter button { width: 2rem; height: 2rem; font-size: 1.25rem; cursor: pointer; }
  </style>
}
