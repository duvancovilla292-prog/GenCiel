// ===== sync.js · Persistencia: Firestore en tiempo real + respaldo local + estado de sincronización =====
//
// Modelo de datos:  trees/{treeId}  →  { schemaVersion, nodes[], edges[], updatedAt, updatedBy }
// (la vista —pan/zoom— es por dispositivo y solo se guarda en localStorage).
//
// Estrategia:
//  • Cada cambio del grafo (evento graph:changed) incrementa `localVersion`. Hay cambios sin sincronizar mientras
//    localVersion !== savedVersion. savedVersion solo avanza cuando Firestore CONFIRMA la escritura (el servidor
//    responde a setDoc), por eso `isDirty()` es fiable para el aviso beforeunload.
//  • El respaldo local (localStorage) se escribe siempre y guarda el flag `dirty`: si cierras con cambios sin subir,
//    al volver ganan los cambios locales (edición sin conexión); si no, gana la nube.
//  • Conflictos entre dispositivos: last-write-wins (documento completo).
//  • Si el SDK de Firebase no carga (sin red en la primera visita), la app sigue funcionando en modo local.

import { STORAGE_KEY, TREE_KEY, SCHEMA_VERSION, FIREBASE_VERSION, FIRESTORE_COLLECTION, firebaseConfig, LOCAL_DEBOUNCE_MS, CLOUD_DEBOUNCE_MS } from './config.js';
import { $, state, on, emit, toast, clampScale } from './state.js';
import { normalizeGraph } from './model.js';
import { commit, resetHistory } from './history.js';

const clientId = Math.random().toString(36).slice(2, 10);   // distingue esta pestaña de otras (eco de escrituras propias)

// Id del árbol: ?tree=abc → se recuerda; por defecto "principal"
export const treeId = (() => {
  let id = new URLSearchParams(location.search).get('tree');
  try { id = id || localStorage.getItem(TREE_KEY); } catch (_) { /* almacenamiento bloqueado */ }
  id = (id || 'principal').replace(/[^\w-]/g, '').slice(0, 60) || 'principal';
  try { localStorage.setItem(TREE_KEY, id); } catch (_) { /* opcional */ }
  return id;
})();
const localKey = treeId === 'principal' ? STORAGE_KEY : `${STORAGE_KEY}:${treeId}`;

let localVersion = 0, savedVersion = 0, busy = false, localTimer = 0, cloudTimer = 0, warnedLocal = false;
const cloud = { fs: null, ref: null, ready: false, fromCache: false, failed: false, slow: false, error: null };
export const isDirty = () => localVersion !== savedVersion;

// ---------- Estado visible ----------
function computeStatus() {
  if (cloud.failed) return ['local', isDirty() ? 'Solo local · sin subir' : 'Solo local'];
  if (!navigator.onLine || cloud.slow) return ['offline', isDirty() ? 'Sin conexión · cambios en cola' : 'Sin conexión'];
  if (cloud.error) return ['error', 'Error de sincronización'];
  if (!cloud.ready) return ['connecting', 'Conectando…'];
  if (cloud.fromCache) return ['offline', isDirty() ? 'Sin conexión · cambios en cola' : 'Sin conexión'];
  return isDirty() ? ['saving', 'Guardando…'] : ['saved', 'Guardado en la nube'];
}
function refreshStatus() {
  const [s, text] = computeStatus(), el = $('sync-status');
  if (el.dataset.state !== s || el.lastElementChild.textContent !== text) {
    el.dataset.state = s; el.lastElementChild.textContent = text; el.title = text;
    emit('sync:status', { state: s });
  }
}

// ---------- Respaldo local ----------
function saveLocal() {
  clearTimeout(localTimer);
  try {
    localStorage.setItem(localKey, JSON.stringify({
      meta: { schemaVersion: SCHEMA_VERSION, savedAt: Date.now(), dirty: isDirty() },
      nodes: state.graph.nodes, edges: state.graph.edges, view: { scale: state.scale, pan: state.pan }
    }));
  } catch (_) {
    if (!warnedLocal) { warnedLocal = true; toast('No se pudo guardar el respaldo local (almacenamiento lleno o bloqueado).', 'warn'); }
  }
}
const saveLocalSoon = () => { clearTimeout(localTimer); localTimer = setTimeout(saveLocal, LOCAL_DEBOUNCE_MS); };

function loadLocal() {
  let raw = null;
  try {
    raw = localStorage.getItem(localKey);
    if (!raw) return false;
    const d = JSON.parse(raw);
    state.graph = normalizeGraph(d);
    if (d.view) {
      state.scale = clampScale(+d.view.scale || 1);
      state.pan = { x: +d.view.pan?.x || 0, y: +d.view.pan?.y || 0 };
      state.viewRestored = true;
    }
    if (d.meta?.dirty) localVersion = 1;                     // quedaron cambios sin subir en la sesión anterior
    return state.graph.nodes.length > 0;
  } catch (_) {
    try { if (raw) localStorage.setItem(localKey + ':corrupt', raw); } catch (__) { /* opcional */ }
    state.graph = { nodes: [], edges: [] };
    toast('No se pudo restaurar el respaldo local (copia conservada)', 'warn');
    return false;
  }
}

// ---------- Nube ----------
const finishLoading = () => { if (state.loading) { state.loading = false; emit('render'); } };

function applyRemote(d, first) {
  try { state.graph = normalizeGraph(d); } catch (_) { return; }
  savedVersion = localVersion;                               // el estado local coincide con la nube
  if (first) resetHistory(); else commit({ persist: false }); // el cambio remoto entra en el historial sin re-subirse
  emit('graph:replaced', { fit: first && !state.viewRestored });
  emit('render');
  saveLocalSoon();
}

function onSnapshot(snap) {
  const { fromCache, hasPendingWrites } = snap.metadata;
  cloud.fromCache = fromCache; cloud.error = null;
  if (!fromCache) {                                          // solo confiamos en datos confirmados por el servidor
    const first = !cloud.ready;
    cloud.ready = true; cloud.slow = false;
    if (!hasPendingWrites) handleServerDoc(snap, first);
    finishLoading();
  }
  refreshStatus();
}

function handleServerDoc(snap, first) {
  if (!snap.exists()) {                                      // la nube no tiene este árbol: se suben los datos locales
    if (first && state.graph.nodes.length) { localVersion++; flush(); }
    return;
  }
  const d = snap.data();
  if (d.updatedBy === clientId) return;                      // eco de nuestra propia escritura
  if (isDirty()) { if (first) flush(); return; }             // lo local sin subir prevalece (last-write-wins)
  applyRemote(d, first);
}

function onSnapshotError(err) {
  cloud.error = err; finishLoading(); refreshStatus();
  toast(err.code === 'permission-denied'
    ? 'Firestore denegó la lectura: revisa las reglas de seguridad del proyecto.' : 'Error de sincronización con la nube.', 'error');
}

async function flush() {
  clearTimeout(cloudTimer);
  if (busy || !cloud.ref || !isDirty()) return;
  busy = true;
  const version = localVersion;
  const payload = JSON.parse(JSON.stringify({           // elimina `undefined`, que Firestore rechaza
    schemaVersion: SCHEMA_VERSION, nodes: state.graph.nodes, edges: state.graph.edges, updatedAt: Date.now(), updatedBy: clientId
  }));
  try {
    await cloud.fs.setDoc(cloud.ref, payload);               // se resuelve cuando el SERVIDOR confirma (offline: queda en cola)
    savedVersion = Math.max(savedVersion, version); cloud.error = null;
  } catch (err) {
    cloud.error = err;
    toast(err.code === 'permission-denied'
      ? 'Firestore denegó la escritura: revisa las reglas de seguridad.' : 'No se pudo guardar en la nube. Se reintentará al próximo cambio.', 'error');
  } finally { busy = false; }
  saveLocal(); refreshStatus();
  if (isDirty() && !cloud.error) cloudTimer = setTimeout(flush, CLOUD_DEBOUNCE_MS);   // hubo cambios mientras se escribía
}

async function connect() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  let app, fs;
  try {
    const [appMod, fsMod] = await Promise.all([import(`${base}/firebase-app.js`), import(`${base}/firebase-firestore.js`)]);
    fs = fsMod; app = appMod.initializeApp(firebaseConfig);
  } catch (_) {
    cloud.failed = true; finishLoading(); refreshStatus();
    toast('No se pudo cargar Firebase. Trabajando solo con el respaldo local.', 'warn');
    return;
  }
  let db;
  try {   // caché persistente (IndexedDB): escrituras sin conexión en cola, multi-pestaña
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch (_) { db = fs.getFirestore(app); }
  cloud.fs = fs; cloud.ref = fs.doc(db, FIRESTORE_COLLECTION, treeId);
  fs.onSnapshot(cloud.ref, { includeMetadataChanges: true }, onSnapshot, onSnapshotError);
}

// ---------- API ----------
/** Carga el respaldo local, conecta con la nube y engancha eventos. Devuelve true si restauró datos locales. */
export function initSync() {
  const restored = loadLocal();
  state.loading = !restored;                                 // si hay datos locales, no se muestra "cargando"
  on('graph:changed', () => { localVersion++; refreshStatus(); saveLocalSoon(); clearTimeout(cloudTimer); cloudTimer = setTimeout(flush, CLOUD_DEBOUNCE_MS); });
  on('view', saveLocalSoon);

  window.addEventListener('online', () => { refreshStatus(); flush(); });
  window.addEventListener('offline', refreshStatus);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { saveLocal(); flush(); } });
  window.addEventListener('pagehide', saveLocal);
  // Protector de cierre accidental: solo si hay cambios sin confirmar por la nube
  window.addEventListener('beforeunload', (e) => {
    if (!isDirty() || cloud.failed) return;                  // en modo solo local los datos ya están en el respaldo
    saveLocal(); e.preventDefault(); e.returnValue = '';
  });

  setTimeout(() => { if (!cloud.ready) { cloud.slow = !cloud.failed; refreshStatus(); } finishLoading(); }, 8000);
  refreshStatus();
  connect();
  return restored;
}
