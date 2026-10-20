// ===== render.js · Reconciliación del DOM/SVG con el grafo =====
// render()          → reconcilia todo (altas, bajas, estilos). Se usa tras cambios de estructura.
// updateEdgesOf(id) → SOLO recalcula la geometría de las aristas incidentes a un nodo. Se usa al arrastrar:
//                     coste O(grado del nodo) por frame en lugar de O(total de aristas).

import { NODE_SIZE, PLACEHOLDER, REL_LABEL, UNION_LABEL, UNION_TITLE, UNION_GLYPH, SVG_NS } from './config.js';
import { $, mk, state, nodeMap, edgesOf, on, emit, debounce, toast, outPt, inPt, bezier, isPartnerLink, nodeTitle, ageLabel } from './state.js';
import { reindex, getRelStatus, collectBranch } from './model.js';

export const nodeEls = new Map(), edgeEls = new Map();
const nodesLayer = $('nodes-layer'), edgesLayer = $('edges-layer');
let visible = null;                                   // Set de ids visibles (foco familiar) o null = todos
export const isVisible = (id) => !visible || visible.has(id);

// Errores de imagen: se agrupan en un único toast (evita avalancha al restaurar muchos nodos)
const imgFailQueue = [];
const flushImgFails = debounce(() => {
  const names = imgFailQueue.splice(0);
  if (!names.length) return;
  toast(names.length === 1 ? `No se pudo cargar la imagen${names[0] ? ' de ' + names[0] : ''}` : `No se pudieron cargar ${names.length} imágenes`, 'warn');
}, 500);

// ---------- Nodos ----------
function createNodeEl(n) {
  const el = mk('div'); el.dataset.id = n.id;
  el.style.width = `${NODE_SIZE[n.type].w}px`; el.style.height = `${NODE_SIZE[n.type].h}px`;
  el.tabIndex = 0; el.setAttribute('role', 'button');            // accesible por teclado (Enter abre el panel)
  const wrap = mk('div', 'img-wrapper');
  if (n.type === 'person') {
    const img = mk('img'); img.draggable = false; img.alt = '';
    img.addEventListener('error', () => {
      if (img.dataset.failed) return;                             // el placeholder nunca entra en bucle
      img.dataset.failed = '1'; img.src = PLACEHOLDER;
      const d = nodeMap.get(n.id)?.data;
      imgFailQueue.push(d ? `${d.firstName || ''} ${d.lastName || ''}`.trim() : '');
      flushImgFails();
    });
    wrap.appendChild(img);
    const info = mk('div', 'info'), meta = mk('div', 'meta');
    meta.append(mk('span', 'age'), mk('span', 'badge'));
    info.append(mk('div', 'label'), meta);
    el.append(wrap, info, mk('span', 'state-dot'));
  } else {
    wrap.appendChild(mk('span', 'glyph'));
    el.append(wrap, mk('div', 'label'));
  }
  el.append(mk('div', 'port-in'), mk('div', 'port'));
  return el;
}

/** Posición por transform (compositor): mover un nodo no provoca reflow. */
export function placeNodeEl(n, el) {
  const { w, h } = NODE_SIZE[n.type];
  el.style.transform = `translate(${n.position.x - w / 2}px, ${n.position.y - h / 2}px)`;
}

function syncNodeEl(n, el) {
  const d = n.data, status = d.status || 'active';
  const lit = (state.selection?.kind === 'node' && state.selection.id === n.id) || state.highlightId === n.id;
  el.className = `node ${n.type}${n.type === 'union' ? ' status-' + status : (d.deathDate ? ' deceased' : '')}${lit ? ' selected' : ''}`;
  el.hidden = !isVisible(n.id);
  placeNodeEl(n, el);
  if (n.type === 'person') {
    const img = el.querySelector('img'), src = (d.img || '').trim() || PLACEHOLDER;
    if (img.dataset.src !== src) { img.dataset.src = src; delete img.dataset.failed; img.src = src; }
    el.dataset.gender = d.gender || 'M';
    const full = nodeTitle(n), ageTxt = ageLabel(d), rel = getRelStatus(n.id);
    el.querySelector('.label').textContent = full;
    el.querySelector('.age').textContent = ageTxt;
    const badge = el.querySelector('.badge'); badge.textContent = rel; badge.classList.toggle('paired', rel.startsWith('●'));
    const tip = [full, ageTxt, d.deathDate ? 'Fallecido/a' : 'Vivo/a', rel].filter(Boolean);
    el.title = tip.join('\n'); el.setAttribute('aria-label', tip.join(', '));
  } else {
    el.querySelector('.glyph').textContent = UNION_GLYPH[status] || '';
    el.querySelector('.label').textContent = UNION_LABEL[status] || '';
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
  rec.text.setAttribute('x', (a.x + b.x) / 2); rec.text.setAttribute('y', (a.y + b.y) / 2);
}

/** Estilo y etiqueta: solo cuando cambia el grafo o la selección. */
function updateEdgeStyle(rec, e, s, t) {
  const partner = isPartnerLink(s.type, t.type);
  const rel = partner ? null : (e.relationType || 'blood');
  const u = s.type === 'union' ? s : t.type === 'union' ? t : null;
  const ended = u && (u.data.status || 'active') !== 'active';
  const sel = state.selection?.kind === 'edge' && state.selection.id === e.id;
  rec.g.setAttribute('class', 'edge-group' + (sel ? ' selected' : ''));
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

// ---------- Barra de foco y estado vacío ----------
const MODE_TXT = { ancestors: 'Ascendentes', descendants: 'Descendientes', both: 'Ascendentes y descendientes' };
function syncFocusBar() {
  const bar = $('focus-bar'); bar.hidden = !state.focus;
  if (!state.focus) return;
  const n = nodeMap.get(state.focus.id);
  $('focus-label').textContent = `Foco: ${n ? nodeTitle(n) : ''} · ${MODE_TXT[state.focus.mode]}`;
  bar.querySelectorAll('[data-focus]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.focus === state.focus.mode)));
}

// ---------- Render completo ----------
export function render() {
  reindex();
  if (state.focus && !nodeMap.has(state.focus.id)) state.focus = null;     // la persona enfocada fue eliminada
  visible = state.focus ? collectBranch(state.focus.id, state.focus.mode) : null;
  for (const n of state.graph.nodes) {
    let el = nodeEls.get(n.id);
    if (!el) { el = createNodeEl(n); nodeEls.set(n.id, el); nodesLayer.appendChild(el); }
    syncNodeEl(n, el);
  }
  for (const [id, el] of nodeEls) if (!nodeMap.has(id)) { el.remove(); nodeEls.delete(id); }
  renderEdges();
  syncFocusBar();
  const empty = !state.loading && state.graph.nodes.length === 0;
  $('empty-state').hidden = !empty;
  document.body.classList.toggle('is-empty', empty);
  emit('rendered');
}

on('render', render);
