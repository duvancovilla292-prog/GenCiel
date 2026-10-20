// ===== minimap.js · Minimapa de navegación =====
// Dibuja en <canvas> los nodos visibles y el rectángulo del viewport. Pulsar/arrastrar sobre el minimapa
// centra la vista en ese punto. Los redibujados se agrupan con requestAnimationFrame.

import { NODE_SIZE, COLORS } from './config.js';
import { $, state, on } from './state.js';
import { isVisible } from './render.js';
import { applyTransform, visibleSize, stopViewAnimation } from './view.js';

const box = $('minimap'), cv = $('minimap-canvas'), ctx = cv.getContext('2d');
let raf = 0, frozen = null, dragging = false;

function bounds() {
  const vp = $('viewport').getBoundingClientRect(), { pan, scale } = state;
  const vx = -pan.x / scale, vy = -pan.y / scale;
  let x0 = vx, y0 = vy, x1 = vx + vp.width / scale, y1 = vy + vp.height / scale;
  for (const n of state.graph.nodes) {
    if (!isVisible(n.id)) continue;
    const { w, h } = NODE_SIZE[n.type];
    x0 = Math.min(x0, n.position.x - w / 2); x1 = Math.max(x1, n.position.x + w / 2);
    y0 = Math.min(y0, n.position.y - h / 2); y1 = Math.max(y1, n.position.y + h / 2);
  }
  return { x0: x0 - 60, y0: y0 - 60, x1: x1 + 60, y1: y1 + 60 };
}

function mapping(b) {
  const w = cv.clientWidth, h = cv.clientHeight, bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const k = Math.min(w / bw, h / bh);
  return { k, ox: (w - bw * k) / 2 - b.x0 * k, oy: (h - bh * k) / 2 - b.y0 * k };
}

function draw() {
  raf = 0;
  if (box.hidden) return;
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const m = frozen || mapping(bounds());

  for (const n of state.graph.nodes) {
    if (!isVisible(n.id)) continue;
    const { w: nw, h: nh } = NODE_SIZE[n.type];
    if (n.type === 'union') {
      ctx.fillStyle = COLORS.union; ctx.beginPath();
      ctx.arc(n.position.x * m.k + m.ox, n.position.y * m.k + m.oy, Math.max(1.6, nw * m.k / 2), 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = COLORS.gender[n.data.gender] || COLORS.dim;
      const rw = Math.max(3, nw * m.k), rh = Math.max(2, nh * m.k);
      ctx.fillRect(n.position.x * m.k + m.ox - rw / 2, n.position.y * m.k + m.oy - rh / 2, rw, rh);
    }
  }

  // Rectángulo del viewport actual
  const vp = $('viewport').getBoundingClientRect(), { pan, scale } = state;
  const rx = (-pan.x / scale) * m.k + m.ox, ry = (-pan.y / scale) * m.k + m.oy;
  const rw = (vp.width / scale) * m.k, rh = (vp.height / scale) * m.k;
  ctx.fillStyle = 'rgba(59,158,255,.14)'; ctx.fillRect(rx, ry, rw, rh);
  ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1.5; ctx.strokeRect(rx, ry, rw, rh);
}

export const scheduleMinimap = () => { if (!raf) raf = requestAnimationFrame(draw); };

function moveTo(e) {
  const r = cv.getBoundingClientRect(), m = frozen;
  const wx = (e.clientX - r.left - m.ox) / m.k, wy = (e.clientY - r.top - m.oy) / m.k;
  const { w, h } = visibleSize();
  state.pan.x = w / 2 - wx * state.scale; state.pan.y = h / 2 - wy * state.scale;
  applyTransform();
}

cv.addEventListener('pointerdown', (e) => {
  stopViewAnimation(); cv.setPointerCapture(e.pointerId);
  dragging = true; frozen = mapping(bounds());            // mapeo congelado: evita realimentación mientras se arrastra
  moveTo(e);
});
cv.addEventListener('pointermove', (e) => { if (dragging) moveTo(e); });
const end = () => { dragging = false; frozen = null; scheduleMinimap(); };
cv.addEventListener('pointerup', end);
cv.addEventListener('pointercancel', end);

on('view', scheduleMinimap);
on('rendered', scheduleMinimap);
on('nodemoved', scheduleMinimap);
window.addEventListener('resize', scheduleMinimap);

export function setMinimapVisible(show) {
  box.hidden = !show;
  $('btn-minimap').setAttribute('aria-pressed', String(show));
  if (show) scheduleMinimap();
}
