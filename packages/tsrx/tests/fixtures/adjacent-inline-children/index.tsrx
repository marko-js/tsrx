export default component App({ name }: { name: string }) {
  <p>{'Hello, '}{name}{'!'}</p>
  <span>{'before '}{html '<em>mid</em>'}{' after'}</span>
  <p><b>{'Bold'}</b>{', '}{name}{'!'}</p>
  <div>
    <span>{'a'}</span>
    {'between'}
    <span>{'b'}</span>
  </div>
}
