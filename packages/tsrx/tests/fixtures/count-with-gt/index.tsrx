export default component Count() {
  let count = 0;

  <button onClick={() => {
    count++;
  }}>{count}</button>

  if (count > 5) {
    {"Large value"}
  }
}
