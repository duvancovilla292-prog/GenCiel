// ===== render.js · Reconciliación del DOM/SVG con el grafo =====
// render()          → reconcilia todo (altas, bajas, estilos). Se usa tras cambios de estructura.
// updateEdgesOf(id) → SOLO recalcula la geometría de las aristas incidentes a un nodo. Se usa al arrastrar:
//                     coste O(grado del nodo) por frame en lugar de O(total de aristas).
//
// Estilo n8n: cada nodo es una caja cuadrada (avatar o símbolo) con el nombre DEBAJO, un puerto de entrada,
// uno de salida con su botón "+" y una barrita de herramientas que aparece al pasar el mouse.

import { GEO, PLACEHOLDER, REL_LABEL, UNION_LABEL, UNION_TITLE, UNION_GLYPH, SVG_NS } from './config.js';
import { $, mk, state, nodeMap, edgesOf, on, emit, debounce, toast, outPt, inPt, bezier, isPartnerLink, nodeTitle, lifeLabel, initials, nodeRect } from './state.js';
import { reindex, getRelStatus, collectBranch, computeLevels } from './model.js';

export const nodeEls = new Map(), edgeEls = new Map();
const nodesLayer = $('nodes-layer'), edgesLayer = $('edges-layer'), bandsLayer = $('bands-layer');
let visible = null;                                   // Set de ids visibles (foco familiar) o null = todos
let lineage = null;                                   // familia de la persona seleccionada (lo demás se atenúa)
export const isVisible = (id) => !visible || visible.has(id);

// Errores de imagen: se agrupan en un único toast (evita avalancha al restaurar muchos nodos)
const imgFailQueue = [];
const flushImgFails = debounce(() => {
  const names = imgFailQueue.splice(0);
  if (!names.length) return;
  toast(names.length === 1 ? `No se pudo cargar la imagen${names[0] ? ' de ' + names[0] : ''}` : `No se pudieron cargar ${names.length} imágenes`, 'warn');
}, 500);

const ICON = {
  edit: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  focus: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M3 9V5a2 2 0 0 1 2-2h4M15 3h4a2 2 0 0 1 2 2v4M21 15v4a2 2 0 0 1-2 2h-4M9 21H5a2 2 0 0 1-2-2v-4"/></svg>',
  del: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>'
};

// ---------- Nodos ----------
function createNodeEl(n) {
  const el = mk('div'); el.dataset.id = n.id;
  const g = GEO[n.type];
  el.style.width = `${g.w}px`; el.style.height = `${g.box + g.label}px`;
  el.tabIndex = 0; el.setAttribute('role', 'button');            // accesible por teclado (Enter abre la ficha)
  const box = mk('div', 'nbox');
  if (n.type === 'person') {
    const img = mk('img'); img.draggable = false; img.alt = '';
    img.addEventListener('error', () => {
      if (img.dataset.failed) return;                             // el placeholder nunca entra en bucle
      img.dataset.failed = '1'; img.src = PLACEHOLDER;
      const d = nodeMap.get(n.id)?.data;
      imgFailQueue.push(d ? `${d.firstName || ''} ${d.lastName || ''}`.trim() : '');
      flushImgFails();
    });
    box.append(mk('span', 'ini'), img, mk('span', 'cross'));
    const label = mk('div', 'nlabel');
    label.append(mk('b', 'name'), mk('small', 'life'), mk('small', 'pair'));
    el.append(box, label);
  } else {
    box.appendChild(mk('span', 'glyph'));
    el.append(box, mk('div', 'ulabel'));
  }
  const tools = mk('div', 'ntools');
  tools.innerHTML = (n.type === 'person'
    ? `<button type="button" data-tool="open" title="Abrir ficha" aria-label="Abrir ficha">${ICON.edit}</button><button type="button" data-tool="focus" title="Ver su rama familiar" aria-label="Ver su rama familiar">${ICON.focus}</button>`
    : `<button type="button" data-tool="open" title="Editar unión" aria-label="Editar unión">${ICON.edit}</button>`)
    + `<button type="button" data-tool="delete" title="Eliminar" aria-label="Eliminar">${ICON.del}</button>`;
  const plus = mk('button', 'port-plus'); plus.type = 'button'; plus.textContent = '+';
  plus.title = n.type === 'person' ? 'Agregar familiar' : 'Agregar hijo/a o pareja'; plus.setAttribute('aria-label', plus.title);
  el.append(tools, mk('div', 'port-in'), mk('div', 'port'), plus);
  return el;
}

/** Posición por transform (compositor): mover un nodo no provoca reflow. */
export function placeNodeEl(n, el) {
  const g = GEO[n.type];
  el.style.transform = `translate(${n.position.x - g.w / 2}px, ${n.position.y - g.box / 2}px)`;
}

function syncNodeEl(n, el) {
  const d = n.data, status = d.status || 'active';
  const sel = state.selection?.kind === 'node' && state.selection.id === n.id;
  const lit = sel || state.highlightId === n.id;
  el.className = `node ${n.type}${n.type === 'union' ? ' status-' + status : (d.deathDate ? ' deceased' : '')}${lit ? ' selected' : ''}${lineage && !lineage.has(n.id) ? ' dim' : ''}`;
  el.hidden = !isVisible(n.id);
  placeNodeEl(n, el);
  if (n.type === 'person') {
    const img = el.querySelector('img'), src = (d.img || '').trim();
    if (img.dataset.src !== src) { img.dataset.src = src; delete img.dataset.failed; if (src) img.src = src; else img.removeAttribute('src'); }
    el.classList.toggle('has-photo', !!src);
    el.dataset.gender = d.gender || 'M';
    el.querySelector('.ini').textContent = initials(d);
    const full = nodeTitle(n), life = lifeLabel(d), rel = getRelStatus(n.id);
    el.querySelector('.name').textContent = full;
    el.querySelector('.life').textContent = life;
    el.querySelector('.cross').textContent = d.deathDate ? '✝' : '';
    const pair = el.querySelector('.pair'); pair.textContent = d.birthPlace || '';
    const tip = [full, life, d.deathDate ? 'Fallecido/a' : '', rel.replace(/^[●○] /, ''), d.birthPlace].filter(Boolean);
    el.title = tip.join('\n'); el.setAttribute('aria-label', tip.join(', '));
  } else {
    el.querySelector('.glyph').textContent = UNION_GLYPH[status] || '';
    const yr = (d.startDate || '').slice(0, 4);
    el.querySelector('.ulabel').textContent = UNION_LABEL[status] || (yr ? `desde ${yr}` : '');
    const tip = [UNION_TITLE[status] || 'Unión', d.startDate && `Inicio: ${d.startDate}`, d.endDate && `Fin: ${d.endDate}`].filter(Boolean);
    el.title = tip.join('\n'); el.setAttribute('aria-label', tip.join(', '));
  }
}

// ---------- Aristas ----------
function createEdgeEl(id) {
  const g = document.createElementNS(SVG_NS, 'g'); g.dataset.id = id;
  const mkSvg = (tag, cls) => { const el = document.createElementNS(SVG_NS, tag); el.setAttribute('class', cls); return el; };
  const rec = { g, hit: mkSvg('path', 'edge-hit'), path: mkSvg('path', 'edge'), text: mkSvg('text', 'edge-label') };
  g.append(rec.hit, rec.path, rec.text);
  return rec;
}

/** Solo geometría (barato): es lo único que cambia al arrastrar un nodo. */
function updateEdgeGeometry(rec, s, t) {
  const a = outPt(s), b = inPt(t), d = bezier(a, b);
  rec.hit.setAttribute('d', d); rec.path.setAttribute('d', d);
  rec.text.setAttribute('x', (a.x + b.x) / 2); rec.text.setAttribute('y', (a.y + b.y) / 2 - 6);
}

/** Estilo y etiqueta: solo cuando cambia el grafo o la selección. */
function updateEdgeStyle(rec, e, s, t) {
  const partner = isPartnerLink(s.type, t.type);
  const rel = partner ? null : (e.relationType || 'blood');
  const u = s.type === 'union' ? s : t.type === 'union' ? t : null;
  const ended = u && (u.data.status || 'active') !== 'active';
  const sel = state.selection?.kind === 'edge' && state.selection.id === e.id;
  const lit = lineage && lineage.has(s.id) && lineage.has(t.id);
  rec.g.setAttribute('class', 'edge-group' + (sel ? ' selected' : '') + (lit ? ' lit' : '') + (lineage && !lit ? ' dim' : ''));
  rec.g.style.display = isVisible(s.id) && isVisible(t.id) ? '' : 'none';
  rec.path.setAttribute('class', `edge ${partner ? 'partner' : 'child'}${rel ? ' rel-' + rel : ''}${ended ? ' ended' : ''}`);
  rec.text.textContent = REL_LABEL[rel] || '';
}

export function updateEdgesOf(nodeId) {
  for (const e of edgesOf.get(nodeId) || []) {
    const rec = edgeEls.get(e.id), s = nodeMap.get(e.source), t = nodeMap.get(e.target);
    if (rec && s && t) updateEdgeGeometry(rec, s, t);
  }
}

function renderEdges() {
  const seen = new Set();
  for (const e of state.graph.edges) {
    const s = nodeMap.get(e.source), t = nodeMap.get(e.target);
    if (!s || !t) continue;
    seen.add(e.id);
    let rec = edgeEls.get(e.id);
    if (!rec) { rec = createEdgeEl(e.id); edgeEls.set(e.id, rec); edgesLayer.appendChild(rec.g); }
    updateEdgeGeometry(rec, s, t); updateEdgeStyle(rec, e, s, t);
  }
  for (const [id, rec] of edgeEls) if (!seen.has(id)) { rec.g.remove(); edgeEls.delete(id); }
}

// ---------- Franjas de generación (detrás de todo) ----------
// Cada generación es una franja suave con su rótulo ("Generación 1"…): columna en horizontal, fila en vertical.
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
export function renderBands() {
  bandsLayer.replaceChildren();
  const persons = state.graph.nodes.filter(n => n.type === 'person' && isVisible(n.id));
  if (persons.length < 2) return;
  const level = computeLevels(), h = state.orient === 'h';
  const groups = new Map();
  persons.forEach(p => { const l = level.get(p.id); if (!groups.has(l)) groups.set(l, []); groups.get(l).push(p); });
  if (groups.size < 2) return;
  let s0 = Infinity, s1 = -Infinity;
  for (const n of state.graph.nodes) {
    if (!isVisible(n.id)) continue;
    const r = nodeRect(n);
    s0 = Math.min(s0, h ? r.y0 : r.x0); s1 = Math.max(s1, h ? r.y1 : r.x1);
  }
  s0 -= 70; s1 += 40;
  const keys = [...groups.keys()].sort((a, b) => a - b), base = keys[0];
  keys.forEach((l, i) => {
    const ps = groups.get(l), c = ps.reduce((s, p) => s + (h ? p.position.x : p.position.y), 0) / ps.length;
    const half = h ? 112 : 104, g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'band' + (i % 2 ? ' alt' : ''));
    const rect = document.createElementNS(SVG_NS, 'rect');
    const lbl = document.createElementNS(SVG_NS, 'text');
    if (h) {
      rect.setAttribute('x', c - half); rect.setAttribute('y', s0); rect.setAttribute('width', half * 2); rect.setAttribute('height', s1 - s0);
      lbl.setAttribute('x', c); lbl.setAttribute('y', s0 + 30); lbl.setAttribute('text-anchor', 'middle');
    } else {
      rect.setAttribute('x', s0); rect.setAttribute('y', c - 56); rect.setAttribute('width', s1 - s0); rect.setAttribute('height', half * 2);
      lbl.setAttribute('x', s0 + 16); lbl.setAttribute('y', c - 30);
    }
    rect.setAttribute('rx', 18);
    lbl.textContent = `Generación ${ROMAN[l - base] || l - base + 1}`;
    g.append(rect, lbl); bandsLayer.appendChild(g);
  });
}

// ---------- Barra de foco y estado vacío ----------
const MODE_TXT = { ancestors: 'Ascendentes', descendants: 'Descendientes', both: 'Ascendentes y descendientes' };
function syncFocusBar() {
  const bar = $('focus-bar'); bar.hidden = !state.focus;
  if (!state.focus) return;
  const n = nodeMap.get(state.focus.id);
  $('focus-label').textContent = `Rama de ${n ? nodeTitle(n) : ''} · ${MODE_TXT[state.focus.mode]}`;
  bar.querySelectorAll('[data-focus]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.focus === state.focus.mode)));
}

// ---------- Render completo ----------
export function render() {
  reindex();
  document.documentElement.dataset.orient = state.orient;
  if (state.focus && !nodeMap.has(state.focus.id)) state.focus = null;     // la persona enfocada fue eliminada
  visible = state.focus ? collectBranch(state.focus.id, state.focus.mode) : null;
  const selNode = state.selection?.kind === 'node' ? nodeMap.get(state.selection.id) : null;
  lineage = selNode?.type === 'person' && !state.focus ? collectBranch(selNode.id, 'both') : null;
  for (const n of state.graph.nodes) {
    let el = nodeEls.get(n.id);
    if (!el) { el = createNodeEl(n); nodeEls.set(n.id, el); nodesLayer.appendChild(el); }
    syncNodeEl(n, el);
  }
  for (const [id, el] of nodeEls) if (!nodeMap.has(id)) { el.remove(); nodeEls.delete(id); }
  renderEdges();
  renderBands();
  syncFocusBar();
  const empty = !state.loading && state.graph.nodes.length === 0;
  $('empty-state').hidden = !empty || state.tab !== 'tree';
  document.body.classList.toggle('is-empty', empty);
  emit('rendered');
}

on('render', render);
on('orient', () => {                                     // la geometría de todas las aristas cambia
  nodeEls.forEach((el) => el.remove()); nodeEls.clear();
  render();
});
