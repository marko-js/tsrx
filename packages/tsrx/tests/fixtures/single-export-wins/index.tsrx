component Helper() {
  <span>{'helper text'}</span>
}

export component Page({ title }: { title: string }) {
  <div>
    <h1>{text title}</h1>
    <Helper />
  </div>
}
