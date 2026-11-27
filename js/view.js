// ===== view.js · Transformación del lienzo, animaciones, centrado y foco familiar =====

import { GRID_SIZE, HIGHLIGHT_MS } from './config.js';
import { $, state, nodeMap, emit, clampScale, screenToWorld, nodeRect } from './state.js';
import { render, isVisible } from './render.js';

const viewport = $('viewport'), workspace = $('workspace');
let viewAnim = 0;

export const isDrawer = () => window.matchMedia('(max-width: 767px)').matches;   // panel como drawer inferior
export const stopViewAnimation = () => cancelAnimationFrame(viewAnim);

/** Área del lienzo no tapada por el panel (lateral en escritorio, inferior en móvil). */
export function visibleSize() {
  const r = viewport.getBoundingClientRect();
  let w = r.width, h = r.height;
  if (document.body.classList.contains('creator-open') && !isDrawer()) w -= 376;   // el panel "Agregar" tapa la derecha
  return { w, h };
}

/** Mueve el lienzo Y la cuadrícula de puntos del fondo (como el lienzo de n8n). */
export function applyTransform() {
  const { pan, scale } = state;
  workspace.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;
  let step = GRID_SIZE * scale; while (step < 10) step *= 2;       // evita una cuadrícula ilegible al alejar
  viewport.style.backgroundSize = `${step}px ${step}px`;
  viewport.style.backgroundPosition = `${pan.x}px ${pan.y}px`;
  workspace.classList.toggle('lod', scale < 0.5);                   // de lejos: solo avatar y nombre, más grande
  $('zoom-level') && ($('zoom-level').textContent = `${Math.round(scale * 100)}%`);
  emit('view');
}
export function zoomBy(k) {
  const { w, h } = visibleSize(), c = screenToWorld(viewport.getBoundingClientRect().left + w / 2, viewport.getBoundingClientRect().top + h / 2);
  const s = clampScale(state.scale * k);
  animateView(s, { x: w / 2 - c.x * s, y: h / 2 - c.y * s }, 200);
}
export function resetZoom() { zoomBy(1 / state.scale); }

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
    const r = nodeRect(n);
    x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1); y0 = Math.min(y0, r.y0); y1 = Math.max(y1, r.y1);
  }
  if (state.showBands && state.graph.nodes.filter(n => n.type === 'person' && isVisible(n.id)).length > 1) { if (state.orient === 'h') y0 -= 60; else x0 -= 40; }   // rótulos de generación
  // Márgenes: lo que tapan la barra de arriba y los controles de abajo (en celular, también la barra inferior)
  const { w: vw, h: vh } = visibleSize(), padX = isDrawer() ? 14 : 60, padTop = isDrawer() ? 20 : 70, padBot = isDrawer() ? 80 : 70;
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
