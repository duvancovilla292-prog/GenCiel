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
//   panel:close      → pide cerrar la ficha
//   sync:status      → cambió el estado de sincronización
//   auth             → cambió la sesión {user}
//   orient           → cambió la dirección del árbol (horizontal / vertical)
//   trees            → cambió la lista de árboles de la cuenta (Inicio)
//   treename         → cambió el nombre del árbol abierto

import { GEO } from './config.js';

export const $ = (id) => document.getElementById(id);
export const mk = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };

/** Estado mutable de la aplicación. Se accede siempre vía `state.*` (los módulos ES no permiten reasignar imports). */
export const state = {
  graph: { nodes: [], edges: [] },
  orient: 'h',            // 'h' = de izquierda a derecha (estilo n8n) · 'v' = de arriba abajo
  selection: null,        // { kind: 'node' | 'edge', id }
  highlightId: null,      // nodo resaltado por el buscador
  focus: null,            // { id, mode: 'ancestors' | 'descendants' | 'both' } | null
  scale: 1, pan: { x: 0, y: 0 },
  loading: true,          // true mientras se espera la primera respuesta de la nube con el lienzo vacío
  viewRestored: false,    // true si el respaldo local trajo una vista guardada
  tab: 'home',            // 'home' | 'tree' | 'timeline' | 'kin' | 'stats'
  user: null,             // { uid, name, email, photo } cuando hay sesión de Google
  treeName: '',           // nombre del árbol abierto
  trees: null             // árboles de la cuenta [{ id, name, persons, updatedAt }] (null = aún no cargados)
};
export const DEFAULT_TREE_NAME = 'Mi árbol familiar';

/** Solo con sesión iniciada se puede agregar o editar. Sin sesión, el árbol se ve en modo lectura. */
export const canEdit = () => !!state.user;
export function requireEdit() {
  if (canEdit()) return true;
  toast('Inicia sesión con Google para agregar o editar', 'warn');
  return false;
}

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
export const clampScale = (s) => Math.min(Math.max(0.15, s), 3);
export const isPartnerLink = (sType, tType) => sType === 'person' && tType === 'union';
export const fold = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Geometría (depende de la dirección del árbol) ----------
   La caja de la persona está arriba y su nombre debajo. En horizontal las conexiones salen por la derecha de la caja
   y entran por la izquierda (como n8n); en vertical salen por debajo del nombre y entran por arriba. */
const below = (n) => GEO[n.type].box / 2 + (n.type === 'person' ? GEO.person.label : 0);
export const outPt = (n) => state.orient === 'h'
  ? { x: n.position.x + GEO[n.type].box / 2, y: n.position.y }
  : { x: n.position.x, y: n.position.y + below(n) };
export const inPt = (n) => state.orient === 'h'
  ? { x: n.position.x - GEO[n.type].box / 2, y: n.position.y }
  : { x: n.position.x, y: n.position.y - GEO[n.type].box / 2 };
export function bezier(a, b) {
  if (state.orient === 'h') {
    const off = Math.max(46, Math.abs(b.x - a.x) * 0.5);
    return `M ${a.x} ${a.y} C ${a.x + off} ${a.y}, ${b.x - off} ${b.y}, ${b.x} ${b.y}`;
  }
  const off = Math.max(40, Math.abs(b.y - a.y) * 0.5);
  return `M ${a.x} ${a.y} C ${a.x} ${a.y + off}, ${b.x} ${b.y - off}, ${b.x} ${b.y}`;
}
/** Rectángulo que ocupa un nodo en el mundo (caja + rótulo). */
export function nodeRect(n) {
  const g = GEO[n.type], { x, y } = n.position;
  return { x0: x - g.w / 2, x1: x + g.w / 2, y0: y - g.box / 2, y1: y + below(n) };
}

export const nodeTitle = (n) => (n.type === 'person' ? `${n.data.firstName || 'Sin'} ${n.data.lastName || 'Nombre'}`.trim() : 'Unión');
export function initials(d) {
  const a = (d.firstName || '').trim()[0] || '', b = (d.lastName || '').trim()[0] || '';
  return (a + b).toUpperCase() || '?';
}

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
/** "1968 – 2015 · 47 años" / "1995 · 31 años" / "" */
export function lifeLabel(d) {
  const b = (d.birthDate || '').slice(0, 4), x = (d.deathDate || '').slice(0, 4);
  const a = d.birthDate ? calculateAge(d.birthDate, d.deathDate) : null;
  const years = b ? (x ? `${b} – ${x}` : b) : (x ? `† ${x}` : '');
  const age = Number.isFinite(a) && a >= 0 ? `${a} años` : '';
  return [years, age].filter(Boolean).join(' · ');
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

/** Reduce una foto elegida en el dispositivo a un cuadrado pequeño (JPEG) para guardarla dentro del árbol. */
export function shrinkPhoto(file, px) {
  return new Promise((res, rej) => {
    if (!file || !/^image\//.test(file.type)) return rej(new Error('El archivo no es una imagen'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const s = Math.min(img.naturalWidth, img.naturalHeight), cv = document.createElement('canvas');
      cv.width = cv.height = px;
      cv.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, px, px);
      URL.revokeObjectURL(url);
      res(cv.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la imagen')); };
    img.src = url;
  });
}
