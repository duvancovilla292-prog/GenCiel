// ===== config.js · Constantes y configuración (sin lógica) =====

export const SCHEMA_VERSION = 2;
export const STORAGE_KEY = 'genealogy-engine:autosave:v1';  // misma clave que la versión anterior: el respaldo local existente se conserva
export const TREE_KEY = 'genealogy-engine:tree-id';
export const HISTORY_LIMIT = 100;
export const GRID_SIZE = 24;            // px del punto menor de la cuadrícula (a zoom 1)
export const HIGHLIGHT_MS = 2600;       // duración del resaltado tras buscar
export const DRAG_THRESHOLD = 4;        // px antes de considerar "arrastre"
export const SNAP_RADIUS = 44;          // px: tolerancia de soltado (útil con el dedo)
export const LOCAL_DEBOUNCE_MS = 300;   // respaldo local
export const CLOUD_DEBOUNCE_MS = 800;   // escritura en Firestore
export const SVG_NS = 'http://www.w3.org/2000/svg';

// Tamaño fijo por tipo de nodo: ancla las aristas (salida abajo, entrada arriba) y el layout
export const NODE_SIZE = { person: { w: 208, h: 68 }, union: { w: 34, h: 34 } };

export const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#2a2a2a"/><circle cx="40" cy="31" r="14" fill="#666"/><path d="M12 80c0-18 12-28 28-28s28 10 28 28z" fill="#666"/></svg>');

export const REL_LABEL = { blood: '', adopted: 'Adoptado/a', stepchild: 'Hijastro/a' };
export const UNION_LABEL = { active: '', divorced: 'Divorciados', separated: 'Separados' };
export const UNION_TITLE = { active: 'Unión activa', divorced: 'Divorciados', separated: 'Separados' };
export const UNION_GLYPH = { active: '♥', divorced: '✕', separated: '/' };

// Colores compartidos por el minimapa y el exportador de imagen (espejo de las variables CSS)
export const COLORS = {
  bg: '#14151a', surface: '#1d1f26', border: '#353947', text: '#e8eaf0', dim: '#9aa1b2', accent: '#3b9eff',
  gender: { M: '#5aa9ff', F: '#ff7eb6', O: '#b48cff' },
  rel: { blood: '#7f8799', adopted: '#64B5F6', stepchild: '#BA68C8' },
  union: '#FF9800', ended: '#5b616f', danger: '#ef5350'
};

// ---------- Firebase ----------
// Versión del SDK modular que se carga por CDN (se importa dinámicamente en sync.js).
export const FIREBASE_VERSION = '13.0.0';
export const firebaseConfig = {
  apiKey: 'AIzaSyDyl26ev3_6QXPaiblXjfxc0bDWOUMhLCQ',
  authDomain: 'genciel-ee18b.firebaseapp.com',
  projectId: 'genciel-ee18b',
  storageBucket: 'genciel-ee18b.firebasestorage.app',
  messagingSenderId: '1016562584520',
  appId: '1:1016562584520:web:b8e19963df145a63b20efd'
};
export const FIRESTORE_COLLECTION = 'trees';   // documento: trees/{treeId}
