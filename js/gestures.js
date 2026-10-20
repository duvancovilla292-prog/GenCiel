// ===== gestures.js · Gestos unificados con Pointer Events (ratón, dedo y lápiz) =====
// Rendimiento del arrastre: los eventos pointermove se agrupan por requestAnimationFrame y, por frame, solo se
// actualiza (1) el transform del nodo y (2) la geometría de SUS aristas (updateEdgesOf). Nada más se recalcula.

import { DRAG_THRESHOLD, SNAP_RADIUS, SVG_NS } from './config.js';
import { $, state, nodeMap, emit, clampScale, screenToWorld, outPt, bezier } from './state.js';
import { validateConnection, addEdge } from './model.js';
import { commit } from './history.js';
import { nodeEls, isVisible, placeNodeEl, updateEdgesOf } from './render.js';
import { applyTransform, stopViewAnimation } from './view.js';
import { openPanel, closePanel } from './panel.js';

const viewport = $('viewport'), edgesLayer = $('edges-layer');
const pointers = new Map();
let gesture = null, tracker = null, dropId = null;

function findTargetNode(cx, cy, excludeId) {
  const el = document.elementFromPoint(cx, cy)?.closest('.node');
  if (el) return el.dataset.id === excludeId ? null : el.dataset.id;
  const r = viewport.getBoundingClientRect();
  let best = null, bestD = SNAP_RADIUS;
  for (const n of state.graph.nodes) {
    if (n.id === excludeId || !isVisible(n.id)) continue;
    const d = Math.hypot(r.left + state.pan.x + n.position.x * state.scale - cx, r.top + state.pan.y + n.position.y * state.scale - cy);
    if (d < bestD) { bestD = d; best = n.id; }
  }
  return best;
}

// Resalta el destino; en rojo si la conexión no es válida
function setDropTarget(id, sourceId) {
  if (dropId === id) return;
  nodeEls.get(dropId)?.classList.remove('drop-target', 'drop-invalid');
  dropId = id;
  const el = nodeEls.get(id); if (!el) return;
  el.classList.add(validateConnection(sourceId, id).error ? 'drop-invalid' : 'drop-target');
}

function beginTracking() {
  if (tracker) return;
  tracker = new AbortController();
  const opt = { signal: tracker.signal };
  window.addEventListener('pointermove', onPointerMove, opt);
  window.addEventListener('pointerup', onPointerUp, opt);
  window.addEventListener('pointercancel', onPointerCancel, opt);
  window.addEventListener('blur', onPointerCancel, opt);
}
function endTracking() { tracker?.abort(); tracker = null; }

/** Aplica la última posición pendiente del arrastre (máx. 1 vez por frame). */
function applyDrag(g) {
  g.raf = 0;
  if (!g.pending) return;
  const { x, y } = g.pending; g.pending = null;
  g.node.position.x = g.node0.x + (x - g.x0) / state.scale;
  g.node.position.y = g.node0.y + (y - g.y0) / state.scale;
  placeNodeEl(g.node, nodeEls.get(g.node.id));
  updateEdgesOf(g.node.id);                     // ← solo las aristas vinculadas a este nodo
  emit('nodemoved');
}

function finishDrag(g) {
  cancelAnimationFrame(g.raf); applyDrag(g);
  nodeEls.get(g.node.id)?.classList.remove('dragging');
  if (g.moved) commit();                        // mover un nodo = un paso de historial
}

function cancelGesture() {
  if (gesture?.type === 'connect') { gesture.temp.remove(); setDropTarget(null); }
  else if (gesture?.type === 'drag') finishDrag(gesture);
  gesture = null;
}

viewport.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  stopViewAnimation();                           // el usuario toma el control: detiene animaciones de vista
  try { viewport.setPointerCapture(e.pointerId); } catch (_) { /* opcional */ }
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) { startPinch(); beginTracking(); return; }
  if (pointers.size > 2) return;
  cancelGesture();

  const base = { pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false };
  const nodeEl = e.target.closest('.node'), edgeEl = e.target.closest('.edge-group');

  if (nodeEl && e.target.classList.contains('port')) {
    const src = nodeMap.get(nodeEl.dataset.id);
    const temp = document.createElementNS(SVG_NS, 'path');
    temp.setAttribute('class', 'edge temp');
    temp.setAttribute('d', bezier(outPt(src), outPt(src)));
    edgesLayer.appendChild(temp);
    gesture = { ...base, type: 'connect', sourceId: src.id, temp };
  } else if (nodeEl) {
    const n = nodeMap.get(nodeEl.dataset.id);
    gesture = { ...base, type: 'drag', node: n, node0: { ...n.position }, pending: null, raf: 0, click: { kind: 'node', id: n.id } };
  } else {
    gesture = { ...base, type: 'pan', pan0: { ...state.pan }, click: edgeEl ? { kind: 'edge', id: edgeEl.dataset.id } : null };
  }
  beginTracking();
});

function onPointerMove(e) {
  const p = pointers.get(e.pointerId); if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  const g = gesture; if (!g) return;
  if (g.type === 'pinch') return updatePinch(g);
  if (g.pointerId !== e.pointerId) return;

  const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
  if (g.type === 'connect') {
    g.moved = true;
    g.temp.setAttribute('d', bezier(outPt(nodeMap.get(g.sourceId)), screenToWorld(e.clientX, e.clientY)));
    setDropTarget(findTargetNode(e.clientX, e.clientY, g.sourceId), g.sourceId);
    return;
  }
  if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
  if (!g.moved) { g.moved = true; if (g.type === 'drag') nodeEls.get(g.node.id)?.classList.add('dragging'); }
  if (g.type === 'pan') {
    state.pan.x = g.pan0.x + dx; state.pan.y = g.pan0.y + dy; applyTransform();
  } else if (g.type === 'drag') {
    g.pending = { x: e.clientX, y: e.clientY };
    if (!g.raf) g.raf = requestAnimationFrame(() => applyDrag(g));
  }
}

function onPointerUp(e) {
  const g = gesture;
  pointers.delete(e.pointerId);
  if (g?.type === 'pinch') { if (pointers.size < 2) gesture = null; }
  else if (g && g.pointerId === e.pointerId) {
    gesture = null;
    if (g.type === 'connect') {
      const target = findTargetNode(e.clientX, e.clientY, g.sourceId);
      g.temp.remove(); setDropTarget(null);
      if (target) addEdge(g.sourceId, target);
    } else if (g.type === 'drag') {
      finishDrag(g);
      if (!g.moved) openPanel(g.click.kind, g.click.id);
    } else if (!g.moved) {
      if (g.click) openPanel(g.click.kind, g.click.id);
      else if (state.selection) closePanel();               // tocar el fondo cierra el panel
    }
  }
  if (!pointers.size) endTracking();
}

function onPointerCancel(e) {
  if (e.type === 'blur') pointers.clear(); else pointers.delete(e.pointerId);
  cancelGesture();
  if (!pointers.size) endTracking();
}

function startPinch() {
  cancelGesture();
  const [a, b] = [...pointers.values()];
  gesture = {
    type: 'pinch', dist0: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale0: state.scale,
    world0: screenToWorld((a.x + b.x) / 2, (a.y + b.y) / 2)
  };
}

function updatePinch(g) {
  const [a, b] = [...pointers.values()]; if (!b) return;
  const r = viewport.getBoundingClientRect();
  state.scale = clampScale(g.scale0 * Math.hypot(a.x - b.x, a.y - b.y) / g.dist0);
  state.pan.x = (a.x + b.x) / 2 - r.left - g.world0.x * state.scale;
  state.pan.y = (a.y + b.y) / 2 - r.top - g.world0.y * state.scale;
  applyTransform();
}
