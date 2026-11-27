// ===== home.js · Inicio: los árboles de la cuenta (como la lista de flujos de n8n) =====
// Crear, abrir, renombrar, duplicar y eliminar. Sin sesión invita a entrar con Google.

import { $, state, on, emit, esc, fold, toast, DEFAULT_TREE_NAME } from './state.js';
import { openTree, createTree, renameTree, duplicateTree, deleteTree, currentTreeId, signIn } from './sync.js';

const list = $('home-list');
let q = '', sort = 'recent';

function ago(ms) {
  if (!ms) return 'sin cambios aún';
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  if (s < 86400 * 30) { const d = Math.round(s / 86400); return `hace ${d} ${d === 1 ? 'día' : 'días'}`; }
  return new Date(ms).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}
const ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><circle cx="18" cy="12" r="3"/><path d="M10 6.5c4 0 4 5.5 5 5.5M10 17.5c4 0 4-5.5 5-5.5"/></svg>';

export function renderHome() {
  $('home-new').hidden = !state.user;
  $('home-tools').hidden = !state.user || !state.trees?.length;
  if (!state.user) {
    const here = state.graph.nodes.filter(n => n.type === 'person').length;
    list.innerHTML = `<div class="home-login">
      <div class="home-login-art">${ICON}</div>
      <h2>Entra para ver tus árboles</h2>
      <p>Con tu cuenta de Google puedes crear varios árboles, editarlos y verlos en todos tus dispositivos. Sin sesión, GenCiel es solo de lectura.</p>
      <button type="button" class="btn-primary" data-home="signin">Entrar con Google</button>
      ${here ? `<button type="button" class="btn-ghost" data-home="peek">Ver el árbol guardado en este dispositivo (${here} personas, solo lectura)</button>` : ''}
    </div>`;
    return;
  }
  if (!state.trees) { list.innerHTML = '<div class="page-empty">Cargando tus árboles…</div>'; return; }
  // El árbol abierto se muestra con sus datos actuales aunque aún no esté en la nube
  const trees = state.trees.slice();
  if (!trees.some(t => t.id === currentTreeId) && state.graph.nodes.length) trees.push({ id: currentTreeId, name: state.treeName || DEFAULT_TREE_NAME, persons: state.graph.nodes.filter(n => n.type === 'person').length, updatedAt: Date.now() });
  const cur = trees.find(t => t.id === currentTreeId);
  if (cur) { cur.persons = state.graph.nodes.filter(n => n.type === 'person').length; cur.name = state.treeName || cur.name; }
  if (!trees.length) {
    list.innerHTML = `<div class="home-login"><div class="home-login-art">${ICON}</div><h2>Aún no tienes árboles</h2><p>Crea el primero y empieza por una persona.</p><button type="button" class="btn-primary" data-home="new">＋ Crear mi primer árbol</button></div>`;
    return;
  }
  const shown = trees.filter(t => !q || fold(t.name).includes(fold(q)))
    .sort((a, b) => sort === 'name' ? fold(a.name).localeCompare(fold(b.name)) : b.updatedAt - a.updatedAt);
  list.innerHTML = shown.length ? `<ul class="tree-list">${shown.map(t => `
    <li class="tree-row${t.id === currentTreeId ? ' current' : ''}">
      <button type="button" class="tree-open" data-home="open" data-id="${esc(t.id)}">
        <span class="tree-ico">${ICON}</span>
        <span class="tree-txt"><b>${esc(t.name)}</b><small>${t.persons} ${t.persons === 1 ? 'persona' : 'personas'} · Editado ${esc(ago(t.updatedAt))}</small></span>
        ${t.id === currentTreeId ? '<span class="tree-badge">Abierto</span>' : ''}
      </button>
      <div class="tree-acts">
        <button type="button" class="icon-btn" data-home="rename" data-id="${esc(t.id)}" title="Renombrar" aria-label="Renombrar ${esc(t.name)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
        <button type="button" class="icon-btn" data-home="dup" data-id="${esc(t.id)}" title="Duplicar" aria-label="Duplicar ${esc(t.name)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>
        <button type="button" class="icon-btn danger" data-home="del" data-id="${esc(t.id)}" title="Eliminar" aria-label="Eliminar ${esc(t.name)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>
      </div>
    </li>`).join('')}</ul>` : '<div class="page-empty">Ningún árbol coincide.</div>';
}

/** Pide un nombre en una ventanita (crear o renombrar). */
function askName(title, value) {
  return new Promise((res) => {
    const dlg = $('name-dialog'), inp = $('name-input');
    $('name-title').textContent = title; inp.value = value || '';
    dlg.hidden = false; setTimeout(() => { inp.focus(); inp.select(); }, 30);
    const done = (v) => { dlg.hidden = true; $('name-form').onsubmit = null; $('name-cancel').onclick = null; res(v); };
    $('name-form').onsubmit = (e) => { e.preventDefault(); const v = inp.value.trim().slice(0, 60); if (v) done(v); else inp.focus(); };
    $('name-cancel').onclick = () => done(null);
    dlg.onclick = (e) => { if (e.target === dlg) done(null); };
  });
}

const nameOf = (id) => (state.trees || []).find(t => t.id === id)?.name || (id === currentTreeId ? state.treeName : '') || DEFAULT_TREE_NAME;
async function act(kind, id) {
  try {
    if (kind === 'signin') return signIn();
    if (kind === 'peek') return emit('goto:tab', 'tree');
    if (kind === 'open') return openTree(id);
    if (kind === 'new') { const n = await askName('Nuevo árbol', ''); if (n) await createTree(n); return; }
    if (kind === 'rename') { const n = await askName('Renombrar árbol', nameOf(id)); if (n) { await renameTree(id, n); toast('Nombre actualizado'); } return; }
    if (kind === 'dup') return duplicateTree(id);
    if (kind === 'del') {
      if (!confirm(`¿Eliminar el árbol “${nameOf(id)}”? Se borra de tu cuenta y no se puede deshacer.\n\nSi quieres, primero descarga un respaldo (⋮ → Exportar respaldo).`)) return;
      return deleteTree(id);
    }
  } catch (err) { toast('No se pudo completar: ' + (err.code === 'permission-denied' ? 'la nube denegó el permiso (revisa las reglas)' : err.message), 'error'); }
}
list.addEventListener('click', (e) => { const b = e.target.closest('[data-home]'); if (b) act(b.dataset.home, b.dataset.id); });
$('home-new').addEventListener('click', () => act('new'));
$('home-q').addEventListener('input', (e) => { q = e.target.value; renderHome(); });
$('home-sort').addEventListener('change', (e) => { sort = e.target.value; renderHome(); });
on('trees', () => { if (state.tab === 'home') renderHome(); });
on('auth', () => { if (state.tab === 'home') renderHome(); });
