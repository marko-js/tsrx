export default component App({ onClick }: { onClick: () => void }) {
  <button onClick={onClick}>{'click'}</button>
  <button onClick={() => { onClick(); }}>{'wrap'}</button>
  <input onInput={function (e: InputEvent) { console.log(e); }} />
}
