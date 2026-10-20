// ===== main.js · Punto de entrada: cableado de la barra, atajos y arranque =====
// Orden de arranque: respaldo local → render → conexión con Firebase (asíncrona).

import { SCHEMA_VERSION } from './config.js';
import { $, state, on, emit, toast, downloadBlob } from './state.js';
import { normalizeGraph, addNode, clearGraph } from './model.js';
import { commit, resetHistory, undo, redo } from './history.js';
import { render } from './render.js';
import { applyTransform, fitView, centerPoint, setFocus, isDrawer } from './view.js';
import { closePanel } from './panel.js';
import './gestures.js';
import { setMinimapVisible } from './minimap.js';
import { autoLayout } from './layout.js';
import { exportImage } from './exporter.js';
import { focusSearch } from './search.js';
import { closeStats, statsOpen } from './stats.js';
import { initSync } from './sync.js';

// ---------- Acciones ----------
function addAtCenter(type) {
  state.focus = null;                                    // un nodo nuevo quedaría oculto bajo un foco activo
  addNode(type, centerPoint());
}

$('btn-add-person').addEventListener('click', () => addAtCenter('person'));
$('btn-add-union').addEventListener('click', () => addAtCenter('union'));
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('btn-center').addEventListener('click', fitView);
$('btn-layout').addEventListener('click', autoLayout);
$('btn-minimap').addEventListener('click', () => setMinimapVisible($('minimap').hidden));

$('btn-new').addEventListener('click', () => {
  if (!state.graph.nodes.length) return;
  clearGraph(); toast('Lienzo vacío. Puedes deshacer con Ctrl+Z');
});

// JSON
$('btn-export').addEventListener('click', () => {
  downloadBlob(new Blob([JSON.stringify({ meta: { schemaVersion: SCHEMA_VERSION }, ...state.graph }, null, 2)], { type: 'application/json' }), 'arbol_genealogico.json');
});
const importPicker = () => $('input-import').click();
$('btn-import').addEventListener('click', importPicker);
$('empty-import').addEventListener('click', importPicker);
$('input-import').addEventListener('change', (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      state.graph = normalizeGraph(JSON.parse(ev.target.result));
      state.focus = null;
      closePanel(); emit('graph:replaced'); commit(); fitView();     // importar es una acción deshacible
      toast(`Importados ${state.graph.nodes.length} nodos`);
    } catch (err) { toast('Error de formato JSON: ' + err.message, 'error'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

// Estado vacío
$('empty-add').addEventListener('click', () => { addAtCenter('person'); fitView(); });

// Menú de exportar imagen
const exportBtn = $('btn-export-img'), exportMenu = $('export-menu');
const setExportMenu = (open) => { exportMenu.hidden = !open; exportBtn.setAttribute('aria-expanded', String(open)); };
exportBtn.addEventListener('click', (e) => { e.stopPropagation(); setExportMenu(exportMenu.hidden); });
exportMenu.addEventListener('click', (e) => {
  const fmt = e.target.closest('[data-export]')?.dataset.export;
  if (fmt) { setExportMenu(false); exportImage(fmt); }
});
document.addEventListener('click', (e) => { if (!exportMenu.hidden && !exportMenu.contains(e.target)) setExportMenu(false); });

// Barra de foco familiar
$('focus-bar').querySelectorAll('[data-focus]').forEach(b => b.addEventListener('click', () => state.focus && setFocus(state.focus.id, b.dataset.focus)));
$('btn-focus-exit').addEventListener('click', () => { setFocus(null); fitView(); });

// Menú de la barra en móvil (☰)
const toolbar = document.querySelector('.toolbar'), menuBtn = $('btn-menu');
const setMenu = (open) => { toolbar.classList.toggle('open', open); menuBtn.setAttribute('aria-expanded', String(open)); };
menuBtn.addEventListener('click', () => setMenu(!toolbar.classList.contains('open')));
$('toolbar-more').addEventListener('click', (e) => { if (e.target.closest('button') && !e.target.closest('#btn-export-img')) setMenu(false); });

// ---------- Atajos de teclado ----------
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'k') { e.preventDefault(); focusSearch(); return; }
  if (e.key === 'Escape') {
    if (statsOpen()) closeStats();
    else if (!exportMenu.hidden) setExportMenu(false);
    else if (toolbar.classList.contains('open')) setMenu(false);
    else if (state.selection) closePanel();
    else if (state.focus) { setFocus(null); fitView(); }
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  if (typing) return;                                    // en campos de texto, Ctrl+Z conserva su función nativa
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (!mod && !e.altKey) {
    if (k === '0') fitView();
    else if (k === 'l') autoLayout();
    else if (k === 'm') setMinimapVisible($('minimap').hidden);
  }
});

// Un árbol traído de la nube sin vista guardada se encuadra al llegar
on('graph:replaced', (d) => { if (d?.fit) fitView(); });

// ---------- Arranque ----------
const restored = initSync();            // carga el respaldo local y conecta con Firestore
resetHistory();
applyTransform();
setMinimapVisible(!isDrawer());         // en móvil el minimapa empieza oculto (se activa con el botón)
render();
if (restored) { toast('Progreso restaurado'); if (!state.viewRestored) fitView(); }
