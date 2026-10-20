// ===== view.js · Transformación del lienzo, animaciones, centrado y foco familiar =====

import { GRID_SIZE, NODE_SIZE, HIGHLIGHT_MS } from './config.js';
import { $, state, nodeMap, emit, clampScale, screenToWorld } from './state.js';
import { render, isVisible } from './render.js';

const viewport = $('viewport'), workspace = $('workspace'), panel = $('details-panel');
let viewAnim = 0;

export const isDrawer = () => window.matchMedia('(max-width: 767px)').matches;   // panel como drawer inferior
export const stopViewAnimation = () => cancelAnimationFrame(viewAnim);

/** Área del lienzo no tapada por el panel (lateral en escritorio, inferior en móvil). */
export function visibleSize() {
  const r = viewport.getBoundingClientRect();
  let w = r.width, h = r.height;
  if (document.body.classList.contains('panel-open')) { if (isDrawer()) h -= panel.offsetHeight; else w -= panel.offsetWidth; }
  return { w, h };
}

/** Mueve el lienzo Y la cuadrícula de fondo (2 capas: punto mayor cada 5 menores). */
export function applyTransform() {
  const { pan, scale } = state;
  workspace.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
  let step = GRID_SIZE * scale; while (step < 12) step *= 2;       // evita una cuadrícula ilegible al alejar
  const big = step * 5, p = `${pan.x}px ${pan.y}px`;
  viewport.style.backgroundSize = `${big}px ${big}px, ${step}px ${step}px`;
  viewport.style.backgroundPosition = `${p}, ${p}`;
  emit('view');
}

export function animateView(toScale, toPan, ms = 350) {
  cancelAnimationFrame(viewAnim);
  const s0 = state.scale, p0 = { ...state.pan }, t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    state.scale = s0 + (toScale - s0) * e;
    state.pan.x = p0.x + (toPan.x - p0.x) * e; state.pan.y = p0.y + (toPan.y - p0.y) * e;
    applyTransform();
    if (k < 1) viewAnim = requestAnimationFrame(step);
  };
  viewAnim = requestAnimationFrame(step);
}

export const centerPoint = () => { const { w, h } = visibleSize(); return screenToWorld(w / 2, h / 2); };

/** Encuadra los nodos VISIBLES (respeta el foco familiar). */
export function fitView() {
  const nodes = state.graph.nodes.filter(n => isVisible(n.id));
  if (!nodes.length) return animateView(1, { x: 0, y: 0 });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    const { w, h } = NODE_SIZE[n.type];
    x0 = Math.min(x0, n.position.x - w / 2); x1 = Math.max(x1, n.position.x + w / 2);
    y0 = Math.min(y0, n.position.y - h / 2); y1 = Math.max(y1, n.position.y + h / 2);
  }
  const { w: vw, h: vh } = visibleSize(), padX = 60, padTop = isDrawer() ? 130 : 90, padBot = 70;
  const s = clampScale(Math.min(1.2, (vw - padX * 2) / (x1 - x0 || 1), (vh - padTop - padBot) / (y1 - y0 || 1)));
  animateView(s, { x: vw / 2 - ((x0 + x1) / 2) * s, y: padTop + (vh - padTop - padBot) / 2 - ((y0 + y1) / 2) * s });
}

export function focusNode(id) {
  const n = nodeMap.get(id); if (!n) return;
  const s = clampScale(Math.max(state.scale, 1)), { w, h } = visibleSize();
  animateView(s, { x: w / 2 - n.position.x * s, y: h / 2 - n.position.y * s });
  state.highlightId = id; render();
  clearTimeout(focusNode.t);
  focusNode.t = setTimeout(() => { state.highlightId = null; render(); }, HIGHLIGHT_MS);   // .selected temporal
}

/** En móvil, desplaza el lienzo si el nodo quedaría tapado por el drawer inferior. */
export function revealNode(id) {
  const n = nodeMap.get(id); if (!n || !isDrawer()) return;
  const { h } = visibleSize(), sy = n.position.y * state.scale + state.pan.y;
  if (sy > h - 50 || sy < 120) animateView(state.scale, { x: state.pan.x, y: Math.max(130, h / 2) - n.position.y * state.scale });
}

/** Activa (o limpia con id = null) el foco familiar y reencuadra. */
export function setFocus(id, mode = 'both') {
  state.focus = id ? { id, mode } : null;
  render();
  if (id) fitView();
}

// Zoom con rueda, centrado en el cursor
viewport.addEventListener('wheel', (e) => {
  e.preventDefault();
  cancelAnimationFrame(viewAnim);
  const w = screenToWorld(e.clientX, e.clientY), r = viewport.getBoundingClientRect();
  state.scale = clampScale(state.scale * Math.exp(-e.deltaY * 0.0015));
  state.pan.x = e.clientX - r.left - w.x * state.scale;
  state.pan.y = e.clientY - r.top - w.y * state.scale;
  applyTransform();
}, { passive: false });
