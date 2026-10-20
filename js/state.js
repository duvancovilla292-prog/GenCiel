// ===== state.js · Estado único, bus de eventos y utilidades puras =====
// Regla de arquitectura: los módulos NO se importan en círculo; se comunican por eventos (bus).
//
// Eventos del bus:
//   render           → pide reconciliar el DOM con el grafo (lo atiende render.js)
//   rendered         → el DOM ya está al día (minimapa)
//   graph:changed    → el contenido del grafo cambió → persistir (sync.js)
//   graph:replaced   → el grafo se sustituyó entero (undo, import, nube) {fit?: boolean}
//   view             → cambió pan/zoom (minimapa, respaldo local)
//   nodemoved        → un nodo se mueve durante un arrastre (minimapa)
//   panel:close      → pide cerrar el panel de detalles
//   sync:status      → cambió el estado de sincronización

import { NODE_SIZE } from './config.js';

export const $ = (id) => document.getElementById(id);
export const mk = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };

/** Estado mutable de la aplicación. Se accede siempre vía `state.*` (los módulos ES no permiten reasignar imports). */
export const state = {
  graph: { nodes: [], edges: [] },
  selection: null,        // { kind: 'node' | 'edge', id }
  highlightId: null,      // nodo resaltado por el buscador
  focus: null,            // { id, mode: 'ancestors' | 'descendants' | 'both' } | null
  scale: 1, pan: { x: 0, y: 0 },
  loading: true,          // true mientras se espera la primera respuesta de la nube con el lienzo vacío
  viewRestored: false     // true si el respaldo local trajo una vista guardada
};

// Índices derivados (se reconstruyen en reindex(), model.js)
export const nodeMap = new Map();    // id → nodo
export const unionsOf = new Map();   // personId → [uniones]
export const edgesOf = new Map();    // nodeId → [aristas incidentes]  ← base de la actualización parcial al arrastrar

// ---------- Bus de eventos ----------
const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));

// ---------- Utilidades ----------
export const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const clampScale = (s) => Math.min(Math.max(0.2, s), 3);
export const isPartnerLink = (sType, tType) => sType === 'person' && tType === 'union';
export const fold = (s) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export const outPt = (n) => ({ x: n.position.x, y: n.position.y + NODE_SIZE[n.type].h / 2 });  // salida: borde inferior
export const inPt = (n) => ({ x: n.position.x, y: n.position.y - NODE_SIZE[n.type].h / 2 });   // entrada: borde superior
export function bezier(a, b) {
  const off = Math.max(40, Math.abs(b.y - a.y) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + off}, ${b.x} ${b.y - off}, ${b.x} ${b.y}`;
}

export const nodeTitle = (n) => (n.type === 'person' ? `${n.data.firstName || 'Sin'} ${n.data.lastName || 'Nombre'}` : 'Unión');

export function calculateAge(birthDate, deathDate) {
  if (!birthDate) return 'N/A';
  const birth = new Date(birthDate), end = deathDate ? new Date(deathDate) : new Date();
  let age = end.getFullYear() - birth.getFullYear();
  const m = end.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && end.getDate() < birth.getDate())) age--;
  return age;
}

export function ageLabel(d) {
  const a = d.birthDate ? calculateAge(d.birthDate, d.deathDate) : null;
  return Number.isFinite(a) && a >= 0 ? `${d.deathDate ? '† ' : ''}${a} años` : (d.deathDate ? '†' : '');
}

export function screenToWorld(cx, cy) {
  const r = $('viewport').getBoundingClientRect();
  return { x: (cx - r.left - state.pan.x) / state.scale, y: (cy - r.top - state.pan.y) / state.scale };
}

// type: '' | 'warn' | 'error'
export function toast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg; t.className = `show ${type}`;
  clearTimeout(toast.id); toast.id = setTimeout(() => { t.className = ''; }, type ? 3600 : 2400);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
