component Foo(bar: Baz) {
  <span>{text bar.label}</span>
}

export default component App() {
  <Foo bar={myBaz} />
}
