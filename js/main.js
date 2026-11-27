// ===== main.js · Punto de entrada: pestañas, controles del lienzo, panel "Agregar", menús, atajos y arranque =====
// Orden de arranque: respaldo local → render → conexión con Firebase (asíncrona, con cuenta de Google).

import { SCHEMA_VERSION, THEME_KEY } from './config.js';
import { $, state, on, emit, toast, downloadBlob, esc, nodeMap, nodeTitle, fold, requireEdit, DEFAULT_TREE_NAME } from './state.js';
import { normalizeGraph, addNode, clearGraph, removeNode, parentUnionsOf, parentsOf, unionMembers, quickParents, quickPartner, quickChild, quickSibling, reindex } from './model.js';
import { commit, resetHistory, undo, redo } from './history.js';
import { render } from './render.js';
import { applyTransform, fitView, centerPoint, setFocus, isDrawer, zoomBy, resetZoom, focusNode } from './view.js';
import { openPanel, closePanel, panelOpen } from './panel.js';
import './gestures.js';
import { setMinimapVisible, scheduleMinimap } from './minimap.js';
import { autoLayout } from './layout.js';
import { exportImage } from './exporter.js';
import { focusSearch } from './search.js';
import { renderStats } from './stats.js';
import { renderTimeline } from './timeline.js';
import { renderKin } from './kinview.js';
import { initSync, signIn, signOut, currentTreeId } from './sync.js';
import { renderHome } from './home.js';

// ---------- Pestañas (Árbol · Línea de tiempo · Parentesco · Estadísticas) ----------
const VIEWS = { home: renderHome, tree: null, timeline: renderTimeline, kin: renderKin, stats: renderStats };
function setTab(tab) {
  if (!(tab in VIEWS)) return;
  state.tab = tab;
  document.body.dataset.tab = tab;
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.id !== 'view-' + tab; });
  document.querySelectorAll('.tab[data-tab]').forEach(b => { const on_ = b.dataset.tab === tab; b.classList.toggle('active', on_); b.setAttribute('aria-selected', String(on_)); });
  if (tab !== 'tree') { closeCreator(); hideMenus(); VIEWS[tab](); }
  syncReadonly();
  render();
}
$('btn-home').addEventListener('click', () => setTab('home'));

// ---------- Solo lectura sin sesión ----------
function syncReadonly() {
  const ro = !state.user;
  document.body.classList.toggle('readonly', ro);
  $('readonly-bar').hidden = !ro || state.tab !== 'tree' || !state.graph.nodes.length;
  if (ro) closeCreator();
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-signin]')) signIn(); });
function syncTreeName() {
  const n = state.treeName || (currentTreeId === 'principal' ? DEFAULT_TREE_NAME : 'Árbol sin nombre');
  $('tree-name').textContent = n;
  document.title = `${n} · GenCiel`;
}
on('treename', syncTreeName);
on('rendered', () => { $('readonly-bar').hidden = !!state.user || state.tab !== 'tree' || !state.graph.nodes.length; });
document.querySelectorAll('.tab[data-tab]').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
on('goto:tab', setTab);
on('goto:person', (id) => { setTab('tree'); setTimeout(() => emit('open:person', id), 30); });
on('rendered', () => { if (state.tab !== 'tree') VIEWS[state.tab](); });

// ---------- Controles del lienzo ----------
$('btn-fit').addEventListener('click', fitView);
$('btn-zoom-in').addEventListener('click', () => zoomBy(1.25));
$('btn-zoom-out').addEventListener('click', () => zoomBy(0.8));
$('btn-zoom-reset').addEventListener('click', resetZoom);
$('btn-layout').addEventListener('click', () => requireEdit() && autoLayout());
$('btn-minimap').addEventListener('click', () => setMinimapVisible($('minimap').hidden));
// Franjas de generación: se prenden y apagan (preferencia de cada dispositivo; no cambia el árbol)
function setBands(on_) {
  state.showBands = on_;
  try { localStorage.setItem('genciel:bands', on_ ? 'on' : 'off'); } catch (_) { /* opcional */ }
  $('btn-bands').setAttribute('aria-pressed', String(on_));
  $('bands-label').textContent = on_ ? '▤ Ocultar generaciones' : '▤ Mostrar generaciones';
  render();
}
$('btn-bands').addEventListener('click', () => { setBands(!state.showBands); toast(state.showBands ? 'Generaciones visibles' : 'Generaciones ocultas'); });
$('btn-legend').addEventListener('click', () => { const l = $('legend'); l.hidden = !l.hidden; $('btn-legend').setAttribute('aria-pressed', String(!l.hidden)); });
$('btn-undo').addEventListener('click', () => requireEdit() && undo());
$('btn-redo').addEventListener('click', () => requireEdit() && redo());

// ---------- Agregar ----------
function addAtCenter(type) {
  if (!requireEdit()) return null;
  state.focus = null;                                    // un nodo nuevo quedaría oculto bajo un foco activo
  const n = addNode(type, centerPoint());
  if (type === 'person') { n.data.firstName = ''; n.data.lastName = ''; render(); openPanel('node', n.id); }
  return n;
}
const QUICK = { partner: quickPartner, child: quickChild, parents: quickParents, sibling: quickSibling };
function runQuick(kind, id) {
  if (!requireEdit()) return;
  state.focus = null;
  const made = QUICK[kind](id);
  if (made) { focusNode(made.id); openPanel('node', made.id); }
}

/** Opciones según la persona o unión de referencia (como el "+" de un nodo en n8n). */
function quickOptions(n) {
  if (!n) return [];
  reindex();
  if (n.type === 'union') {
    const mem = unionMembers(n.id);
    return [
      { kind: 'child', icon: '👶', label: 'Hijo/a de esta unión', desc: 'Una nueva persona conectada como hijo/a' },
      ...(mem.length === 1 ? [{ kind: 'partner', icon: '💑', label: 'Segundo integrante', desc: `Pareja de ${nodeTitle(mem[0])}`, target: mem[0].id }] : [])
    ];
  }
  const name = nodeTitle(n), hasPU = parentUnionsOf(n.id).length > 0, nPar = parentsOf(n.id).length;
  return [
    { kind: 'partner', icon: '💑', label: 'Pareja', desc: `Crea la unión con ${name}` },
    { kind: 'child', icon: '👶', label: 'Hijo/a', desc: `De ${name} (y su pareja)` },
    ...(nPar < 2 ? [{ kind: 'parents', icon: '👪', label: nPar ? 'Completar padres' : 'Padres', desc: nPar ? 'Agrega al otro padre o madre' : 'Padre y madre con su unión' }] : []),
    ...(hasPU ? [{ kind: 'sibling', icon: '🧒', label: 'Hermano/a', desc: 'Otro hijo/a de los mismos padres' }] : [])
  ];
}

// Panel "Agregar al árbol" (a la derecha)
let lastNodeId = null;
on('rendered', () => { if (state.selection?.kind === 'node') lastNodeId = state.selection.id; });
function renderCreator() {
  const q = fold($('creator-q').value.trim()), ref = nodeMap.get(lastNodeId);
  const base = [
    { cmd: 'person', icon: '🧑', label: 'Persona', desc: 'Una persona suelta en el centro del lienzo' },
    { cmd: 'union', icon: '♥', label: 'Unión (pareja)', desc: 'Para conectar a dos personas y sus hijos' }
  ];
  const ctx = quickOptions(ref).map(o => ({ ...o, label: `${o.label}${ref?.type === 'person' ? ' de ' + nodeTitle(ref) : ''}` }));
  const all = [...ctx, ...base].filter(o => !q || fold(o.label + ' ' + o.desc).includes(q));
  $('creator-ctx').textContent = ref ? `Para ${ref.type === 'person' ? nodeTitle(ref) : 'la unión seleccionada'}:` : 'Toca una tarjeta para ver opciones de familia.';
  $('creator-list').innerHTML = all.length ? all.map(o => `<li><button type="button" ${o.cmd ? `data-cmd="${o.cmd}"` : `data-kind="${o.kind}" data-id="${esc(o.target || ref.id)}"`}><span class="ci">${o.icon}</span><span><b>${esc(o.label)}</b><small>${esc(o.desc)}</small></span></button></li>`).join('') : '<li class="rel-empty">Nada coincide.</li>';
}
function openCreator() { if (!requireEdit()) return; if (state.tab !== 'tree') setTab('tree'); $('creator').hidden = false; document.body.classList.add('creator-open'); $('creator-q').value = ''; renderCreator(); if (!isDrawer()) $('creator-q').focus(); }
function closeCreator() { $('creator').hidden = true; document.body.classList.remove('creator-open'); }
$('btn-creator').addEventListener('click', () => ($('creator').hidden ? openCreator() : closeCreator()));
$('creator-close').addEventListener('click', closeCreator);
$('creator-q').addEventListener('input', renderCreator);
$('creator-list').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  closeCreator();
  if (b.dataset.cmd) addAtCenter(b.dataset.cmd); else runQuick(b.dataset.kind, b.dataset.id);
});

// Menú del "+" de cada tarjeta
const addMenu = $('add-menu');
on('addmenu', ({ id, anchor }) => {
  if (!requireEdit()) return;
  const opts = quickOptions(nodeMap.get(id)); if (!opts.length) return;
  hideMenus();
  addMenu.innerHTML = `<p class="menu-title">Agregar</p>` + opts.map(o => `<button type="button" role="menuitem" data-kind="${o.kind}" data-id="${esc(o.target || id)}"><span class="ci">${o.icon}</span><span><b>${esc(o.label)}</b><small>${esc(o.desc)}</small></span></button>`).join('')
    + `<p class="menu-hint">También puedes arrastrar desde el punto de la tarjeta hasta otra para conectarlas.</p>`;
  addMenu.hidden = false;
  const r = anchor.getBoundingClientRect(), w = addMenu.offsetWidth, h = addMenu.offsetHeight;
  addMenu.style.left = `${Math.max(8, Math.min(r.right + 8, innerWidth - w - 8))}px`;
  addMenu.style.top = `${Math.max(8, Math.min(r.top - 10, innerHeight - h - 8))}px`;
});
addMenu.addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (!b) return; addMenu.hidden = true; runQuick(b.dataset.kind, b.dataset.id); });

// Barrita de cada tarjeta
on('nodetool', ({ id, tool }) => {
  const n = nodeMap.get(id); if (!n) return;
  if (tool === 'open') openPanel('node', id);
  else if (tool === 'focus') setFocus(id, 'both');
  else if (tool === 'delete' && requireEdit() && confirm(`¿Eliminar ${n.type === 'person' ? 'a ' + nodeTitle(n) : 'esta unión'}? Puedes deshacerlo con Ctrl+Z.`)) { removeNode(id); toast('Eliminado. Ctrl+Z para deshacer'); }
});

// ---------- Menú ⋮ (archivo y opciones) ----------
const fileBtn = $('btn-file'), fileMenu = $('file-menu'), accBtn = $('btn-account'), accMenu = $('account-menu');
function hideMenus() {
  fileMenu.hidden = true; fileBtn.setAttribute('aria-expanded', 'false');
  accMenu.hidden = true; accBtn.setAttribute('aria-expanded', 'false');
  addMenu.hidden = true;
}
fileBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = fileMenu.hidden; hideMenus(); fileMenu.hidden = !open; fileBtn.setAttribute('aria-expanded', String(open)); });
document.addEventListener('click', (e) => { if (!e.target.closest('.menu, #btn-file, #btn-account, .port-plus')) hideMenus(); });

function exportJson() {
  downloadBlob(new Blob([JSON.stringify({ meta: { schemaVersion: SCHEMA_VERSION, app: 'GenCiel' }, orient: state.orient, ...state.graph }, null, 2)], { type: 'application/json' }), `genciel_${new Date().toISOString().slice(0, 10)}.json`);
}
const importPicker = () => $('input-import').click();
const CMDS = {
  undo, redo,
  theme: () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true),
  orient: () => {
    state.orient = state.orient === 'h' ? 'v' : 'h';
    emit('orient'); syncLabels();
    if (state.graph.nodes.length) autoLayout({ quiet: true }); else emit('graph:changed');
    toast(state.orient === 'h' ? 'Árbol de izquierda a derecha' : 'Árbol de arriba abajo');
  },
  bands: () => setBands(!state.showBands),
  png: () => exportImage('png'), svg: () => exportImage('svg'), export: exportJson, import: importPicker,
  new: () => {
    if (!state.graph.nodes.length) return;
    if (!confirm('¿Vaciar todo el árbol? Puedes deshacerlo con Ctrl+Z mientras no recargues la página.')) return;
    clearGraph(); toast('Árbol vacío. Ctrl+Z para deshacer');
  }
};
const NEEDS_EDIT = new Set(['undo', 'redo', 'orient', 'import', 'new']);
fileMenu.addEventListener('click', (e) => { const c = e.target.closest('[data-cmd]')?.dataset.cmd; if (c) { hideMenus(); if (NEEDS_EDIT.has(c) && !requireEdit()) return; CMDS[c](); } });

$('empty-import').addEventListener('click', () => requireEdit() && importPicker());
$('input-import').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const raw = JSON.parse(ev.target.result);
      state.graph = normalizeGraph(raw);
      const o = raw.orient === 'h' || raw.orient === 'v' ? raw.orient : 'v';
      if (o !== state.orient) { state.orient = o; emit('orient'); syncLabels(); }
      state.focus = null;
      closePanel(); emit('graph:replaced'); commit(); fitView();     // importar es una acción deshacible
      toast(`Importadas ${state.graph.nodes.filter(n => n.type === 'person').length} personas`);
    } catch (err) { toast('El archivo no es un respaldo válido: ' + err.message, 'error'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});
$('empty-add').addEventListener('click', () => { addAtCenter('person'); fitView(); });

// ---------- Tema claro / oscuro (por dispositivo) ----------
function setTheme(t, save) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#1e1f24' : '#ffffff';
  if (save) { try { localStorage.setItem(THEME_KEY, t); } catch (_) { /* opcional */ } }
  syncLabels(); scheduleMinimap();
}
function syncLabels() {
  $('theme-label').textContent = document.documentElement.dataset.theme === 'dark' ? '☀ Modo claro' : '🌙 Modo oscuro';
  $('orient-label').textContent = state.orient === 'h' ? '↕ Árbol de arriba abajo' : '↔ Árbol de izquierda a derecha';
}

// ---------- Cuenta de Google ----------
function syncAccount() {
  const u = state.user;
  $('acc-label').textContent = u ? (u.name.split(' ')[0] || 'Mi cuenta') : 'Entrar';
  $('acc-avatar').innerHTML = u
    ? (u.photo ? `<img src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : esc((u.name || u.email || '?')[0].toUpperCase()))
    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>';
  accBtn.classList.toggle('signed', !!u);
  accBtn.title = u ? `Sesión: ${u.email}` : 'Entrar con Google para guardar tu árbol en tu cuenta';
  accMenu.innerHTML = u
    ? `<div class="acc-head">${$('acc-avatar').innerHTML}<span><b>${esc(u.name || 'Tu cuenta')}</b><small>${esc(u.email)}</small></span></div>
       <p class="menu-hint">Tu árbol se guarda en tu cuenta y se sincroniza entre tus dispositivos.</p>
       <button role="menuitem" data-acc="out">Cerrar sesión</button>
       <button role="menuitem" data-acc="wipe" class="danger">Cerrar sesión y borrar de este dispositivo</button>`
    : '';
}
accBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!state.user) { hideMenus(); signIn(); return; }
  const open = accMenu.hidden; hideMenus(); accMenu.hidden = !open; accBtn.setAttribute('aria-expanded', String(open));
});
accMenu.addEventListener('click', (e) => { const a = e.target.closest('[data-acc]')?.dataset.acc; if (!a) return; hideMenus(); signOut(a === 'wipe'); });
on('auth', ({ user }) => { syncAccount(); syncReadonly(); render(); if (user) toast(`Hola, ${user.name.split(' ')[0] || user.email}. Tu árbol se guarda en tu cuenta.`); });

// Buscador en celular: se despliega desde la lupa
$('btn-search').addEventListener('click', () => { document.body.classList.add('search-open'); setTimeout(() => $('search-input').focus(), 30); });
$('search-input').addEventListener('blur', () => setTimeout(() => document.body.classList.remove('search-open'), 150));

// Barra del foco familiar
$('focus-bar').querySelectorAll('[data-focus]').forEach(b => b.addEventListener('click', () => state.focus && setFocus(state.focus.id, b.dataset.focus)));
$('btn-focus-exit').addEventListener('click', () => { setFocus(null); fitView(); });

// ---------- Atajos de teclado ----------
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'k') { e.preventDefault(); setTab('tree'); focusSearch(); return; }
  if (e.key === 'Escape') {
    if (!addMenu.hidden || !fileMenu.hidden || !accMenu.hidden) hideMenus();
    else if (panelOpen()) closePanel();
    else if (!$('creator').hidden) closeCreator();
    else if (state.focus) { setFocus(null); fitView(); }
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if (typing || panelOpen()) return;                     // en campos de texto, Ctrl+Z conserva su función nativa
  if (mod && k === 'z') { e.preventDefault(); if (requireEdit()) e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); if (requireEdit()) redo(); }
  else if (!mod && !e.altKey && state.tab === 'tree') {
    if (k === '0') fitView();
    else if (k === 'l') { if (requireEdit()) autoLayout(); }
    else if (k === 'm') setMinimapVisible($('minimap').hidden);
    else if (k === 'g') setBands(!state.showBands);
    else if (k === 'n') { e.preventDefault(); openCreator(); }
    else if (k === '+' || k === '=') zoomBy(1.25);
    else if (k === '-') zoomBy(0.8);
  }
});

// Un árbol traído de la nube sin vista guardada se encuadra al llegar
on('graph:replaced', (d) => { if (d?.fit) fitView(); });

// ---------- Arranque ----------
const restored = initSync();            // carga el respaldo local y conecta con Firebase
resetHistory();
applyTransform();
setTheme(document.documentElement.dataset.theme || 'light', false);
syncAccount();
syncTreeName();
setBands(state.showBands);
setMinimapVisible(!isDrawer());         // en celular el minimapa empieza oculto
setTab(new URLSearchParams(location.search).has('tree') ? 'tree' : 'home');   // como n8n: se entra por la lista de árboles
if (restored) { if (!state.viewRestored) fitView(); }
