// ===== panel.js · Ficha de una persona, unión o conexión (como la vista de detalle de un nodo en n8n) =====
// Escritorio: tres columnas → izquierda "Viene de" (padres y hermanos), centro los datos, derecha "Continúa en"
// (parejas e hijos). Celular: pantalla completa con pestañas Datos / Familia / Notas.
// Los cambios se aplican al momento (cada campo confirmado es un paso de historial); "Listo" solo cierra.

import { PHOTO_PX, UNION_TITLE, UNION_GLYPH } from './config.js';
import { $, state, nodeMap, on, emit, toast, isPartnerLink, nodeTitle, calculateAge, lifeLabel, initials, esc, shrinkPhoto } from './state.js';
import { validateConnection, removeEdge, removeNode, reindex, parentsOf, siblingsOf, partnersOf, childrenOf, unionMembers, unionChildren, quickParents, quickPartner, quickChild, quickSibling } from './model.js';
import { commit } from './history.js';
import { render } from './render.js';
import { setFocus, focusNode } from './view.js';

const overlay = $('ndv'), ndv = overlay.querySelector('.ndv');
const selNode = () => (state.selection?.kind === 'node' ? nodeMap.get(state.selection.id) : null);
const selEdge = () => (state.selection?.kind === 'edge' ? state.graph.edges.find(e => e.id === state.selection.id) : null);
export const panelOpen = () => !overlay.hidden;

function setOpen(open) {
  overlay.hidden = !open;
  document.body.classList.toggle('panel-open', open);
  if (!open) ndv.classList.remove('show-family');
}

/** Avatar: foto, o las iniciales sobre el color de su género. */
export function avatarHtml(n, cls = '') {
  if (n.type !== 'person') return `<span class="av av-union ${cls}">${UNION_GLYPH[n.data.status || 'active'] || '♥'}</span>`;
  const src = (n.data.img || '').trim();
  return src ? `<span class="av ${cls}" data-g="${esc(n.data.gender)}"><img src="${esc(src)}" alt=""></span>`
    : `<span class="av ${cls}" data-g="${esc(n.data.gender)}">${esc(initials(n.data))}</span>`;
}
const card = (n, note = '') => `<button type="button" class="rel-card${n.data.deathDate ? ' deceased' : ''}" data-goto="${esc(n.id)}">${avatarHtml(n)}<span><b>${esc(nodeTitle(n))}</b><small>${esc([note, lifeLabel(n.data)].filter(Boolean).join(' · '))}</small></span></button>`;
const group = (title, html, empty) => `<div class="rel-group"><h4>${title}</h4>${html || `<p class="rel-empty">${empty}</p>`}</div>`;
const addBtn = (what, label) => `<button type="button" class="add-rel" data-add="${what}">＋ ${label}</button>`;
const word = (g, m, f) => (g === 'F' ? f : g === 'M' ? m : `${m}/${f.slice(-1)}`);

function fillFamily(n) {
  reindex();
  let left = '', right = '';
  if (n.type === 'person') {
    const pars = parentsOf(n.id), sibs = siblingsOf(n.id), parts = partnersOf(n.id), kids = childrenOf(n.id);
    left = group('Padres', pars.map(p => card(p, word(p.data.gender, 'Padre', 'Madre'))).join(''), 'Sin padres registrados')
      + (pars.length < 2 ? addBtn('parents', pars.length ? 'Completar padres' : 'Agregar padres') : '')
      + group('Hermanos', sibs.map(s => card(s.person, (s.half ? 'Medio ' : '') + word(s.person.data.gender, 'hermano', 'hermana'))).join(''), 'Sin hermanos registrados')
      + (pars.length ? addBtn('sibling', 'Agregar hermano/a') : '');
    right = group('Pareja', parts.map(x => card(x.person, UNION_TITLE[x.union.data.status || 'active'])
      + `<button type="button" class="rel-union" data-goto="${esc(x.union.id)}">${UNION_GLYPH[x.union.data.status || 'active']} Editar la unión</button>`).join(''), 'Sin pareja registrada')
      + addBtn('partner', 'Agregar pareja')
      + group('Hijos', kids.map(k => card(k, word(k.data.gender, 'Hijo', 'Hija'))).join(''), 'Sin hijos registrados')
      + addBtn('child', 'Agregar hijo/a');
  } else {
    const mem = unionMembers(n.id), kids = unionChildren(n.id);
    left = group('Integrantes', mem.map(p => card(p)).join(''), 'Sin integrantes');
    right = group('Hijos', kids.map(k => card(k, word(k.data.gender, 'Hijo', 'Hija'))).join(''), 'Sin hijos registrados') + addBtn('child', 'Agregar hijo/a');
  }
  $('ndv-in').innerHTML = left; $('ndv-out').innerHTML = right;
}

function fillHead(n) {
  if (n.type === 'person') {
    $('ndv-avatar').innerHTML = avatarHtml(n, 'big');
    $('ndv-title').textContent = nodeTitle(n);
    $('ndv-sub').textContent = [lifeLabel(n.data), n.data.birthPlace].filter(Boolean).join(' · ') || 'Completa sus datos';
  } else {
    const mem = unionMembers(n.id);
    $('ndv-avatar').innerHTML = avatarHtml(n, 'big');
    $('ndv-title').textContent = mem.length ? `Unión de ${mem.map(nodeTitle).join(' y ')}` : 'Unión';
    $('ndv-sub').textContent = [UNION_TITLE[n.data.status || 'active'], n.data.startDate && `desde ${n.data.startDate.slice(0, 4)}`].filter(Boolean).join(' · ');
  }
}

function setPreview(n) {
  const p = $('f-img-preview'), src = (n.data.img || '').trim();
  p.hidden = !src; if (src) p.src = src;
  $('btn-photo-del').hidden = !src;
  p.parentElement.dataset.g = n.data.gender; p.parentElement.dataset.ini = initials(n.data);
}

export function openPanel(kind, id) {
  state.selection = { kind, id };
  ['person', 'union', 'edge'].forEach(k => { $('sec-' + k).hidden = true; });
  showPane('data');
  if (kind === 'node') {
    const n = nodeMap.get(id); if (!n) return;
    ndv.classList.toggle('is-union', n.type === 'union'); ndv.classList.remove('is-edge');
    if (n.type === 'person') {
      const d = n.data;
      $('f-name').value = d.firstName || ''; $('f-lastname').value = d.lastName || '';
      $('f-gender').value = d.gender || 'M'; $('f-birthplace').value = d.birthPlace || '';
      $('f-birthdate').value = d.birthDate || ''; $('f-deathdate').value = d.deathDate || '';
      $('f-desc').value = d.description || ''; $('f-img').value = (d.img || '').startsWith('data:') ? '' : (d.img || '');
      setPreview(n); updateAgeDisplay();
      $('btn-delete-node').textContent = 'Eliminar persona';
      $('sec-person').hidden = false;
    } else {
      $('f-union-status').value = n.data.status || 'active';
      $('f-union-start').value = n.data.startDate || ''; $('f-union-end').value = n.data.endDate || '';
      $('btn-delete-node').textContent = 'Eliminar unión';
      $('sec-union').hidden = false;
    }
    fillHead(n); fillFamily(n);
    $('ndv-focus').hidden = $('ndv-kin').hidden = n.type !== 'person';
  } else {
    const e = selEdge(); if (!e) return;
    ndv.classList.add('is-edge'); ndv.classList.remove('is-union');
    const s = nodeMap.get(e.source), t = nodeMap.get(e.target);
    const partner = isPartnerLink(s.type, t.type);
    $('f-edge-info').textContent = `${nodeTitle(s)} → ${nodeTitle(t)} (${partner ? 'integrante de la unión' : 'hijo/a'})`;
    $('row-reltype').hidden = partner;
    $('f-reltype').value = e.relationType || 'blood';
    $('btn-delete-node').textContent = 'Eliminar conexión';
    $('ndv-avatar').innerHTML = '<span class="av av-union big">⟶</span>';
    $('ndv-title').textContent = 'Conexión'; $('ndv-sub').textContent = partner ? 'Pareja' : 'Padres → hijo/a';
    $('ndv-in').innerHTML = $('ndv-out').innerHTML = '';
    $('ndv-focus').hidden = $('ndv-kin').hidden = true;
    $('sec-edge').hidden = false;
  }
  setOpen(true);
  render();
}

export function closePanel() { state.selection = null; setOpen(false); render(); }
on('panel:close', closePanel);

// Si un cambio remoto elimina lo que se está editando, se cierra; si no, se refresca la familia
on('graph:replaced', () => {
  const s = state.selection;
  if (!s || overlay.hidden) return;
  const gone = s.kind === 'node' ? !state.graph.nodes.some(n => n.id === s.id) : !state.graph.edges.some(e => e.id === s.id);
  if (gone) closePanel(); else if (s.kind === 'node') { reindex(); const n = nodeMap.get(s.id); fillHead(n); fillFamily(n); }
});

// ---------- Pestañas (Datos / Familia / Notas) ----------
function showPane(p) {
  ndv.classList.toggle('show-family', p === 'family');
  ndv.querySelectorAll('[data-ndv]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.ndv === p)));
  ndv.querySelectorAll('.pane').forEach(el => { el.hidden = el.dataset.pane !== (p === 'family' ? 'data' : p); });
}
ndv.querySelectorAll('[data-ndv]').forEach(b => b.addEventListener('click', () => showPane(b.dataset.ndv)));

// ---------- Campos: se aplican al momento ----------
function updateAgeDisplay() {
  const a = calculateAge($('f-birthdate').value, $('f-deathdate').value);
  $('f-age').textContent = Number.isFinite(a) && a >= 0 ? `${a} años${$('f-deathdate').value ? ' (al fallecer)' : ''}` : '—';
}
const FIELDS = { 'f-name': 'firstName', 'f-lastname': 'lastName', 'f-gender': 'gender', 'f-birthplace': 'birthPlace', 'f-birthdate': 'birthDate', 'f-deathdate': 'deathDate', 'f-desc': 'description' };
Object.entries(FIELDS).forEach(([id, key]) => {
  const el = $(id);
  const apply = () => {
    const n = selNode(); if (n?.type !== 'person') return;
    n.data[key] = el.value;
    if (key === 'birthDate' || key === 'deathDate') updateAgeDisplay();
    fillHead(n); setPreview(n); render();
  };
  el.addEventListener('input', apply);                                       // en vivo (sin ensuciar el historial)
  el.addEventListener('change', () => { apply(); commit(); });               // confirmado = un paso de historial
});

// Foto: subida desde el dispositivo (se reduce a un cuadrado pequeño) o por enlace
$('btn-photo').addEventListener('click', () => $('input-photo').click());
$('input-photo').addEventListener('change', async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  const n = selNode(); if (!file || n?.type !== 'person') return;
  try {
    n.data.img = await shrinkPhoto(file, PHOTO_PX);
    $('f-img').value = ''; setPreview(n); fillHead(n); render(); commit(); toast('Foto guardada');
  } catch (err) { toast(err.message, 'error'); }
});
$('btn-photo-del').addEventListener('click', () => { const n = selNode(); if (n?.type !== 'person') return; n.data.img = ''; $('f-img').value = ''; setPreview(n); fillHead(n); render(); commit(); });
$('f-img').addEventListener('change', () => { const n = selNode(); if (n?.type !== 'person') return; n.data.img = $('f-img').value.trim(); setPreview(n); fillHead(n); render(); commit(); });

// Unión y arista: cambios en vivo, cada uno es un paso de historial
const setUnion = (k, v) => { const n = selNode(); if (n?.type === 'union') { n.data[k] = v; fillHead(n); render(); commit(); } };
$('f-union-status').addEventListener('change', (e) => setUnion('status', e.target.value));
$('f-union-start').addEventListener('change', (e) => setUnion('startDate', e.target.value));
$('f-union-end').addEventListener('change', (e) => setUnion('endDate', e.target.value));
$('f-reltype').addEventListener('change', (e) => { const ed = selEdge(); if (ed) { ed.relationType = e.target.value; render(); commit(); } });

$('btn-flip-edge').addEventListener('click', () => {
  const e = selEdge(); if (!e) return;
  const v = validateConnection(e.target, e.source, e.id);   // se valida la arista invertida ignorando la actual
  if (v.error) return toast(v.error.startsWith('Crearía un ciclo') ? 'Invertir crearía un ciclo' : v.error, 'error');
  [e.source, e.target] = [e.target, e.source];
  const partner = isPartnerLink(nodeMap.get(e.source).type, nodeMap.get(e.target).type);
  if (partner) delete e.relationType; else e.relationType = e.relationType || 'blood';
  commit(); openPanel('edge', e.id);
  if (v.warnings.length) toast(`Invertido, pero: ${v.warnings[0]}`, 'warn');
});

$('node-form').addEventListener('submit', (ev) => ev.preventDefault());
$('btn-delete-node').addEventListener('click', () => {
  const s = state.selection; if (!s) return;
  const what = s.kind === 'edge' ? 'esta conexión' : nodeMap.get(s.id)?.type === 'person' ? `a ${nodeTitle(nodeMap.get(s.id))}` : 'esta unión';
  if (!confirm(`¿Eliminar ${what}? Puedes deshacerlo con Ctrl+Z.`)) return;
  s.kind === 'edge' ? removeEdge(s.id) : removeNode(s.id);
  toast('Eliminado. Ctrl+Z para deshacer');
});

// ---------- Familia: navegar y agregar ----------
const QUICK = { parents: quickParents, partner: quickPartner, child: quickChild, sibling: quickSibling };
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) return closePanel();
  const go = e.target.closest('[data-goto]');
  if (go) return openPanel('node', go.dataset.goto);
  const add = e.target.closest('[data-add]');
  if (add) {
    const n = selNode(); if (!n) return;
    const made = QUICK[add.dataset.add](n.id);
    if (made) openPanel('node', made.id);
  }
});
$('ndv-close').addEventListener('click', closePanel);
$('ndv-focus').addEventListener('click', () => { const n = selNode(); if (!n) return; closePanel(); setFocus(n.id, 'both'); });
$('ndv-kin').addEventListener('click', () => { const n = selNode(); if (!n) return; closePanel(); emit('kin:from', n.id); });

// Enter/Espacio sobre un nodo = abrir la ficha · doble clic en una línea = eliminarla
$('viewport').addEventListener('dblclick', (e) => { const g = e.target.closest('.edge-group'); if (g) removeEdge(g.dataset.id); });
$('nodes-layer').addEventListener('keydown', (e) => {
  const el = e.target.closest('.node');
  if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPanel('node', el.dataset.id); }
});

/** Abrir la ficha de alguien desde otra vista (línea de tiempo, parentesco): vuelve al árbol, lo centra y la abre. */
on('open:person', (id) => { focusNode(id); openPanel('node', id); });

setOpen(false);
