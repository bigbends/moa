document.body.innerHTML = `
  <style>body{display:grid;gap:12px}label{display:grid;gap:4px}</style>
  <p id="page"></p>
  <label>Note <textarea id="note" rows="6"></textarea></label>
  <button id="save">Save note</button>
  <label>Search <input id="query"></label>
  <button id="search">Search MOA</button>
  <p id="status" role="status"></p>
`;
const note = document.querySelector('#note'), status = document.querySelector('#status');
let pageKey = '', revision = 0;
moa.on('routechange', async page => {
  const version = ++revision;
  pageKey = page.pathname + page.search;
  document.querySelector('#page').textContent = pageKey;
  note.value = '';
  note.disabled = true;
  status.textContent = '';
  const saved = await moa.storage.get();
  if (version === revision) { note.value = saved[pageKey] || ''; note.disabled = false; }
});
document.querySelector('#save').onclick = async () => {
  const key = pageKey, text = note.value;
  try {
    const saved = await moa.storage.get();
    await moa.storage.set({ ...saved, [key]: text });
    if (key === pageKey) status.textContent = 'Saved';
  } catch (error) { status.textContent = error.message; }
};
document.querySelector('#search').onclick = async () => {
  try {
    await moa.ui.close();
    await moa.app.navigate(`/search?q=${encodeURIComponent(document.querySelector('#query').value)}`);
  } catch (error) { status.textContent = error.message; }
};
