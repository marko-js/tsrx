export default component App() {
  <main class="app">
    <h1>{'tsrx demo'}</h1>
    <section>
      <h2>{'Counters'}</h2>
      <Counter label="Apples" initial={3} />
      <Counter label="Oranges" />
    </section>
    <section>
      <h2>{'Todo'}</h2>
      <TodoList />
    </section>
  </main>
}
