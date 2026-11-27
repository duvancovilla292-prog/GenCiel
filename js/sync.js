// ===== sync.js · Persistencia: cuenta de Google + Firestore en tiempo real + respaldo local =====
//
// Modelo de datos:  users/{uid}/trees/{treeId}  →  { schemaVersion, nodes[], edges[], orient, updatedAt, updatedBy }
// Cada cuenta de Google solo puede leer y escribir lo suyo (ver las reglas en el README).
// La vista —pan/zoom— es por dispositivo y solo se guarda en localStorage.
//
// Estrategia:
//  • Sin sesión, el árbol vive solo en este dispositivo (localStorage). Con sesión se sincroniza en tiempo real.
//  • Cada cambio del grafo (evento graph:changed) incrementa `localVersion`. Hay cambios sin sincronizar mientras
//    localVersion !== savedVersion. savedVersion solo avanza cuando Firestore CONFIRMA la escritura.
//  • El respaldo local guarda el flag `dirty` y el dueño (`ownerUid`): si cierras con cambios sin subir, al volver
//    ganan los cambios locales; si otra cuenta inicia sesión en este dispositivo, NO recibe el árbol de la anterior.
//  • Primera vez con una cuenta: si la nube está vacía se sube lo de este dispositivo, o se trae el árbol de la
//    versión anterior (trees/{treeId}, que era público) para no perder nada.
//  • Conflictos entre dispositivos: last-write-wins (documento completo).

import { STORAGE_KEY, TREE_KEY, SCHEMA_VERSION, FIREBASE_VERSION, LEGACY_COLLECTION, firebaseConfig, LOCAL_DEBOUNCE_MS, CLOUD_DEBOUNCE_MS } from './config.js';
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

let localVersion = 0, savedVersion = 0, busy = false, localTimer = 0, cloudTimer = 0, warnedLocal = false, ownerUid = '', freshDevice = false;
const cloud = { A: null, fs: null, auth: null, db: null, ref: null, unsub: null, ready: false, fromCache: false, failed: false, slow: false, error: null };
export const isDirty = () => localVersion !== savedVersion;

// ---------- Estado visible ----------
function computeStatus() {
  if (cloud.failed) return ['local', 'Solo en este dispositivo'];
  if (!state.user) return ['signedout', 'Sin cuenta · solo en este dispositivo'];
  if (!navigator.onLine || cloud.slow) return ['offline', isDirty() ? 'Sin conexión · cambios en cola' : 'Sin conexión'];
  if (cloud.error) return ['error', 'Error de sincronización'];
  if (!cloud.ready) return ['connecting', 'Conectando…'];
  if (cloud.fromCache) return ['offline', isDirty() ? 'Sin conexión · cambios en cola' : 'Sin conexión'];
  return isDirty() ? ['saving', 'Guardando…'] : ['saved', 'Guardado en tu cuenta'];
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
      meta: { schemaVersion: SCHEMA_VERSION, savedAt: Date.now(), dirty: isDirty(), ownerUid },
      nodes: state.graph.nodes, edges: state.graph.edges, orient: state.orient, view: { scale: state.scale, pan: state.pan }
    }));
  } catch (_) {
    if (!warnedLocal) { warnedLocal = true; toast('No se pudo guardar el respaldo local (almacenamiento lleno o bloqueado).', 'warn'); }
  }
}
const saveLocalSoon = () => { clearTimeout(localTimer); localTimer = setTimeout(saveLocal, LOCAL_DEBOUNCE_MS); };

/** Árboles de la versión anterior (sin campo orient) estaban organizados de arriba abajo. */
const orientOf = (d) => (d.orient === 'h' || d.orient === 'v' ? d.orient : (d.nodes?.length ? 'v' : 'h'));

function loadLocal() {
  let raw = null;
  try {
    raw = localStorage.getItem(localKey);
    if (!raw) return false;
    const d = JSON.parse(raw);
    state.graph = normalizeGraph(d);
    state.orient = orientOf(d);
    ownerUid = typeof d.meta?.ownerUid === 'string' ? d.meta.ownerUid : '';
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
  const o = orientOf(d), turned = o !== state.orient;
  state.orient = o;
  savedVersion = localVersion;                               // el estado local coincide con la nube
  if (first) resetHistory(); else commit({ persist: false }); // el cambio remoto entra en el historial sin re-subirse
  if (turned) emit('orient');
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

async function handleServerDoc(snap, first) {
  if (!snap.exists()) {                                      // la cuenta aún no tiene este árbol
    if (!first) return;
    if (state.graph.nodes.length) { localVersion++; flush(); return; }   // se sube lo de este dispositivo
    if (!freshDevice) return;                                // otra cuenta en este dispositivo: empieza vacía
    try {                                                    // …o se trae el de la versión anterior (pública)
      const old = await cloud.fs.getDoc(cloud.fs.doc(cloud.db, LEGACY_COLLECTION, treeId));
      const d = old.exists() ? old.data() : null;
      if (d && Array.isArray(d.nodes) && d.nodes.length) {
        applyRemote({ ...d, orient: orientOf(d) }, true);
        localVersion++; flush();
        toast(`Se trajo tu árbol anterior (${d.nodes.filter(n => n.type !== 'union').length} personas) a tu cuenta`);
      }
    } catch (_) { /* sin permiso o sin árbol anterior: se empieza vacío */ }
    return;
  }
  const d = snap.data();
  if (d.updatedBy === clientId) return;                      // eco de nuestra propia escritura
  if (first && freshDevice && state.graph.nodes.length) {
    // Primera vez con esta cuenta en este dispositivo y la cuenta YA tiene árbol: gana el de la cuenta,
    // y lo que había aquí se guarda como copia (Archivo → Importar si se necesita)
    try { localStorage.setItem(`${localKey}:antes-de-iniciar`, JSON.stringify({ nodes: state.graph.nodes, edges: state.graph.edges, orient: state.orient })); } catch (_) { /* opcional */ }
    freshDevice = false; localVersion = savedVersion;
    applyRemote(d, first);
    toast('Se cargó el árbol de tu cuenta. Lo que había en este dispositivo quedó guardado como copia.');
    return;
  }
  freshDevice = false;
  if (isDirty()) { if (first) flush(); return; }             // lo local sin subir prevalece (last-write-wins)
  applyRemote(d, first);
}

function onSnapshotError(err) {
  cloud.error = err; finishLoading(); refreshStatus();
  toast(err.code === 'permission-denied'
    ? 'La nube denegó el acceso: publica las reglas de seguridad del README en Firebase.' : 'Error de sincronización con la nube.', 'error');
}

async function flush() {
  clearTimeout(cloudTimer);
  if (busy || !cloud.ref || !state.user || !isDirty()) return;
  busy = true;
  const version = localVersion;
  const payload = JSON.parse(JSON.stringify({           // elimina `undefined`, que Firestore rechaza
    schemaVersion: SCHEMA_VERSION, nodes: state.graph.nodes, edges: state.graph.edges, orient: state.orient, updatedAt: Date.now(), updatedBy: clientId
  }));
  const kb = JSON.stringify(payload).length / 1024;
  if (kb > 850) toast(`El árbol pesa ${Math.round(kb)} KB y el límite es ~1000 KB: usa fotos por enlace en vez de subidas.`, 'warn');
  try {
    await cloud.fs.setDoc(cloud.ref, payload);               // se resuelve cuando el SERVIDOR confirma (offline: queda en cola)
    savedVersion = Math.max(savedVersion, version); cloud.error = null;
  } catch (err) {
    cloud.error = err;
    toast(err.code === 'permission-denied'
      ? 'La nube denegó la escritura: publica las reglas de seguridad del README.' : 'No se pudo guardar en la nube. Se reintentará al próximo cambio.', 'error');
  } finally { busy = false; }
  saveLocal(); refreshStatus();
  if (isDirty() && !cloud.error) cloudTimer = setTimeout(flush, CLOUD_DEBOUNCE_MS);   // hubo cambios mientras se escribía
}

/** Cambió la sesión: se desconecta lo anterior y, con cuenta, se escucha su árbol. */
function onUser(u) {
  if (cloud.unsub) { cloud.unsub(); cloud.unsub = null; }
  cloud.ref = null; cloud.ready = false; cloud.error = null; cloud.slow = false;
  if (!u) {
    state.user = null;
    emit('auth', { user: null }); finishLoading(); refreshStatus();
    return;
  }
  state.user = { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' };
  if (ownerUid && ownerUid !== u.uid) {
    // Este dispositivo tenía el árbol de OTRA cuenta: se guarda aparte (no se mezcla ni se sube) y se carga el de esta
    try { localStorage.setItem(`${localKey}:otra-cuenta`, localStorage.getItem(localKey) || ''); } catch (_) { /* opcional */ }
    state.graph = { nodes: [], edges: [] }; state.focus = null; state.selection = null;
    localVersion = savedVersion = 0;
    emit('panel:close'); emit('graph:replaced'); resetHistory();
  }
  freshDevice = !ownerUid;
  ownerUid = u.uid; saveLocal();
  emit('auth', { user: state.user });
  cloud.ref = cloud.fs.doc(cloud.db, 'users', u.uid, 'trees', treeId);
  cloud.unsub = cloud.fs.onSnapshot(cloud.ref, { includeMetadataChanges: true }, onSnapshot, onSnapshotError);
  setTimeout(() => { if (state.user && !cloud.ready) { cloud.slow = true; refreshStatus(); } finishLoading(); }, 8000);
  refreshStatus();
}

async function connect() {
  const base = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}`;
  try {
    const [appMod, authMod, fsMod] = await Promise.all([import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`), import(`${base}/firebase-firestore.js`)]);
    const app = appMod.initializeApp(firebaseConfig);
    cloud.A = authMod; cloud.fs = fsMod; cloud.auth = authMod.getAuth(app);
    try {   // caché persistente (IndexedDB): escrituras sin conexión en cola, multi-pestaña
      cloud.db = fsMod.initializeFirestore(app, { localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }) });
    } catch (_) { cloud.db = fsMod.getFirestore(app); }
  } catch (_) {
    cloud.failed = true; finishLoading(); refreshStatus();
    toast('No se pudo cargar Firebase. Trabajando solo con el respaldo local.', 'warn');
    return;
  }
  cloud.A.getRedirectResult(cloud.auth).catch(authError);
  cloud.A.onAuthStateChanged(cloud.auth, onUser);
}

function authError(err) {
  const c = err?.code || '';
  if (!c || c === 'auth/popup-closed-by-user' || c === 'auth/cancelled-popup-request') return;
  if (c === 'auth/configuration-not-found' || c === 'auth/operation-not-allowed') return toast('El inicio de sesión con Google aún no está activado en Firebase (ver README).', 'error');
  if (c === 'auth/unauthorized-domain') return toast('Este dominio no está autorizado en Firebase → Authentication → Settings (ver README).', 'error');
  toast('No se pudo iniciar sesión: ' + (err.message || c), 'error');
}

// ---------- API ----------
export async function signIn() {
  if (!cloud.auth) return toast(cloud.failed ? 'Firebase no está disponible: revisa tu conexión.' : 'Conectando…', cloud.failed ? 'error' : '');
  const provider = new cloud.A.GoogleAuthProvider();
  try { await cloud.A.signInWithPopup(cloud.auth, provider); }
  catch (err) {
    if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/operation-not-supported-in-this-environment') {
      try { await cloud.A.signInWithRedirect(cloud.auth, provider); } catch (e) { authError(e); }
    } else authError(err);
  }
}
/** Cierra sesión. wipe = además borra el árbol de este dispositivo (útil en un equipo prestado). */
export async function signOut(wipe) {
  if (!cloud.auth || !state.user) return;
  if (isDirty() && navigator.onLine) await flush();
  if (isDirty() && !confirm('Hay cambios que aún no llegan a la nube. Si cierras sesión ahora quedan solo en este dispositivo. ¿Continuar?')) return;
  await cloud.A.signOut(cloud.auth);
  if (wipe) {
    state.graph = { nodes: [], edges: [] }; state.focus = null; ownerUid = ''; localVersion = savedVersion = 0;
    try { localStorage.removeItem(localKey); } catch (_) { /* opcional */ }
    emit('panel:close'); emit('graph:replaced'); resetHistory(); emit('render');
    toast('Sesión cerrada y árbol borrado de este dispositivo');
  } else toast('Sesión cerrada. El árbol queda en este dispositivo.');
}
/** Cambio de dirección del árbol: se guarda con el árbol (se sincroniza). */
export function markChanged() { emit('graph:changed'); }

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
  // Protector de cierre accidental: solo con cuenta y cambios sin confirmar por la nube
  window.addEventListener('beforeunload', (e) => {
    if (!state.user || !isDirty() || cloud.failed) return;
    saveLocal(); e.preventDefault(); e.returnValue = '';
  });

  setTimeout(finishLoading, 4000);
  refreshStatus();
  connect();
  return restored;
}
