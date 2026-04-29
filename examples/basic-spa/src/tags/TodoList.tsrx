export default component TodoList() {
  let items: string[] = ["Buy groceries", "Walk the dog"];
  let draft = "";

  const add = () => {
    if (draft.trim()) {
      items = [...items, draft.trim()];
      draft = "";
    }
  };
  const remove = (i: number) => {
    items = items.filter((_, idx) => idx !== i);
  };

  <div class="todo">
    <h2>{'Todo'}</h2>
    <div class="add-row">
      <input
        type="text"
        value={draft}
        valueChange={(v) => draft = v}
        onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter") add(); }}
      />
      <button onClick={add}>{'Add'}</button>
    </div>
    <ul>
      for (const item of items; index i) {
        <li class="todo-item">
          {text item}
          <button class="remove" onClick={() => { remove(i); }}>{'×'}</button>
        </li>
      }
    </ul>
    if (items.length === 0) {
      <p class="empty">{'Nothing to do!'}</p>
    }
  </div>
}
