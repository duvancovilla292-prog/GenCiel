// ===== config.js · Constantes y configuración (sin lógica) =====

export const SCHEMA_VERSION = 3;
export const STORAGE_KEY = 'genealogy-engine:autosave:v1';  // misma clave que la versión anterior: el respaldo local existente se conserva
export const TREE_KEY = 'genealogy-engine:tree-id';
export const THEME_KEY = 'genciel:theme';
export const HISTORY_LIMIT = 100;
export const GRID_SIZE = 20;            // px del punto de la cuadrícula (a zoom 1)
export const HIGHLIGHT_MS = 2600;       // duración del resaltado tras buscar
export const DRAG_THRESHOLD = 4;        // px antes de considerar "arrastre"
export const SNAP_RADIUS = 48;          // px: tolerancia de soltado (útil con el dedo)
export const LOCAL_DEBOUNCE_MS = 300;   // respaldo local
export const CLOUD_DEBOUNCE_MS = 800;   // escritura en Firestore
export const SVG_NS = 'http://www.w3.org/2000/svg';
export const PHOTO_PX = 160;            // las fotos subidas se reducen a este tamaño (cuadradas, JPEG)

/* Geometría de los nodos (estilo n8n: una caja cuadrada con el nombre DEBAJO).
   position = centro de la caja. La persona ocupa además el rótulo de abajo (nombre + años). */
export const GEO = {
  person: { box: 92, w: 168, label: 58 },
  union: { box: 36, w: 36, label: 22 }
};

export const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#c9ccd6"/><circle cx="40" cy="31" r="14" fill="#fff"/><path d="M12 80c0-18 12-28 28-28s28 10 28 28z" fill="#fff"/></svg>');

export const REL_LABEL = { blood: '', adopted: 'Adoptado/a', stepchild: 'Hijastro/a' };
export const UNION_LABEL = { active: '', divorced: 'Divorciados', separated: 'Separados' };
export const UNION_TITLE = { active: 'Unión activa', divorced: 'Divorciados', separated: 'Separados' };
export const UNION_GLYPH = { active: '♥', divorced: '✕', separated: '/' };
export const GENDER_LABEL = { M: 'Masculino', F: 'Femenino', O: 'Otro' };

/** Colores del tema activo (se leen de las variables CSS: el minimapa y el exportador siguen al tema). */
export function themeColors() {
  const cs = getComputedStyle(document.documentElement), v = (k, d) => (cs.getPropertyValue(k).trim() || d);
  return {
    bg: v('--canvas', '#f5f5f7'), surface: v('--surface', '#ffffff'), border: v('--border', '#dbdee6'), text: v('--text', '#2b2d33'),
    dim: v('--text-dim', '#6b7080'), accent: v('--accent', '#ef6b55'), dot: v('--dot', '#c9ccd6'),
    gender: { M: v('--g-m', '#3d8bfd'), F: v('--g-f', '#e8558f'), O: v('--g-o', '#8b63e8') },
    rel: { blood: v('--rel-blood', '#9aa0ad'), adopted: v('--rel-adopted', '#3d8bfd'), stepchild: v('--rel-step', '#8b63e8') },
    union: v('--union', '#f29d38'), ended: v('--ended', '#a3a8b4'), danger: v('--danger', '#e5484d')
  };
}

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
export const LEGACY_COLLECTION = 'trees';      // versión anterior (pública): trees/{treeId}; solo se lee para migrar
// Ahora cada cuenta tiene sus árboles en users/{uid}/trees/{treeId}
