export default component Counter({ label, initial = 0 }: {
  label: string;
  initial?: number;
}) {
  let count = initial;
  const dec = () => { count--; };
  const inc = () => { count++; };

  <div class="counter">
    <span class="label">{text label}</span>
    <button onClick={dec}>{'−'}</button>
    <span class="value">{count}</span>
    <button onClick={inc}>{'+'}</button>
  </div>
}
