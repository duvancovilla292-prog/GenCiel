// ===== panel.js · Panel de detalles (lateral en escritorio, drawer inferior < 768px) =====

import { PLACEHOLDER } from './config.js';
import { $, state, nodeMap, on, emit, debounce, toast, isPartnerLink, nodeTitle, calculateAge } from './state.js';
import { validateConnection, removeEdge, removeNode } from './model.js';
import { commit } from './history.js';
import { render } from './render.js';
import { isDrawer, revealNode, setFocus } from './view.js';

const panel = $('details-panel');
const selNode = () => (state.selection?.kind === 'node' ? nodeMap.get(state.selection.id) : null);
const selEdge = () => (state.selection?.kind === 'edge' ? state.graph.edges.find(e => e.id === state.selection.id) : null);

function setPanelOpen(open) {
  panel.classList.toggle('hidden', !open);
  panel.inert = !open;                                    // fuera de la tabulación y del árbol de accesibilidad
  panel.setAttribute('aria-hidden', String(!open));
  document.body.classList.toggle('panel-open', open);
  panel.style.transform = '';
}

function setPreview(url) {
  const p = $('f-img-preview'); delete p.dataset.failed; p.classList.remove('failed');
  p.src = (url || '').trim() || PLACEHOLDER;
}
$('f-img-preview').addEventListener('error', (e) => {
  if (!e.target.dataset.failed) { e.target.dataset.failed = '1'; e.target.classList.add('failed'); e.target.src = PLACEHOLDER; }
});

export function openPanel(kind, id) {
  state.selection = { kind, id };
  ['person', 'union', 'edge'].forEach(k => { $('sec-' + k).hidden = true; });
  if (kind === 'node') {
    const n = nodeMap.get(id); if (!n) return;
    if (n.type === 'person') {
      const d = n.data;
      $('f-name').value = d.firstName || ''; $('f-lastname').value = d.lastName || '';
      $('f-gender').value = d.gender || 'M'; $('f-birthplace').value = d.birthPlace || '';
      $('f-birthdate').value = d.birthDate || ''; $('f-deathdate').value = d.deathDate || '';
      $('f-desc').value = d.description || ''; $('f-img').value = d.img || '';
      setPreview(d.img); updateAgeDisplay();
      $('panel-title').textContent = 'Persona'; $('btn-delete-node').textContent = 'Eliminar persona';
      $('sec-person').hidden = false;
    } else {
      $('f-union-status').value = n.data.status || 'active';
      $('f-union-start').value = n.data.startDate || ''; $('f-union-end').value = n.data.endDate || '';
      $('panel-title').textContent = 'Unión'; $('btn-delete-node').textContent = 'Eliminar unión';
      $('sec-union').hidden = false;
    }
  } else {
    const e = selEdge(); if (!e) return;
    const s = nodeMap.get(e.source), t = nodeMap.get(e.target);
    const partner = isPartnerLink(s.type, t.type);
    $('f-edge-info').textContent = `${nodeTitle(s)} → ${nodeTitle(t)} (${partner ? 'pareja de la unión' : 'hijo/a'})`;
    $('row-reltype').hidden = partner;
    $('f-reltype').value = e.relationType || 'blood';
    $('panel-title').textContent = 'Conexión'; $('btn-delete-node').textContent = 'Eliminar conexión';
    $('sec-edge').hidden = false;
  }
  setPanelOpen(true);
  render();
  if (kind === 'node') revealNode(id);
}

export function closePanel() { state.selection = null; setPanelOpen(false); render(); }
on('panel:close', closePanel);

// Si un cambio remoto elimina lo que se está editando, se cierra el panel
on('graph:replaced', () => {
  const s = state.selection;
  if (!s) return;
  const gone = s.kind === 'node' ? !state.graph.nodes.some(n => n.id === s.id) : !state.graph.edges.some(e => e.id === s.id);
  if (gone) closePanel();
});

// ---------- Formulario ----------
function updateAgeDisplay() { $('f-age').textContent = calculateAge($('f-birthdate').value, $('f-deathdate').value); }
$('f-birthdate').addEventListener('change', updateAgeDisplay);
$('f-deathdate').addEventListener('change', updateAgeDisplay);

// Imagen: se refleja en vivo (debounce) sin ensuciar el historial; se confirma en "change"
const applyImg = () => { const n = selNode(); if (n?.type === 'person') { n.data.img = $('f-img').value.trim(); render(); emit('graph:changed'); } };
const applyImgSoon = debounce(applyImg, 600);
$('f-img').addEventListener('input', () => { setPreview($('f-img').value); applyImgSoon(); });
$('f-img').addEventListener('change', () => { applyImg(); commit(); });

// Unión y arista: cambios en vivo, cada uno es un paso de historial
const setUnion = (k, v) => { const n = selNode(); if (n?.type === 'union') { n.data[k] = v; render(); commit(); } };
$('f-union-status').addEventListener('change', (e) => setUnion('status', e.target.value));
$('f-union-start').addEventListener('change', (e) => setUnion('startDate', e.target.value));
$('f-union-end').addEventListener('change', (e) => setUnion('endDate', e.target.value));
$('f-reltype').addEventListener('change', (e) => { const ed = selEdge(); if (ed) { ed.relationType = e.target.value; render(); commit(); } });

$('btn-flip-edge').addEventListener('click', () => {
  const e = selEdge(); if (!e) return;
  const v = validateConnection(e.target, e.source, e.id);   // se valida la arista invertida ignorando la actual
  if (v.error) return toast(v.error.startsWith('Crearía un ciclo') ? 'Invertir crearía un ciclo' : v.error, 'error');
  [e.source, e.target] = [e.target, e.source];
  const partner = isPartnerLink(nodeMap.get(e.source).type, nodeMap.get(e.target).type);
  if (partner) delete e.relationType; else e.relationType = e.relationType || 'blood';
  commit(); openPanel('edge', e.id);
  if (v.warnings.length) toast(`Invertido, pero: ${v.warnings[0]}`, 'warn');
});

$('node-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const n = selNode();
  if (n?.type === 'person') {
    Object.assign(n.data, {
      firstName: $('f-name').value, lastName: $('f-lastname').value, gender: $('f-gender').value,
      birthPlace: $('f-birthplace').value, birthDate: $('f-birthdate').value, deathDate: $('f-deathdate').value,
      description: $('f-desc').value, img: $('f-img').value.trim()
    });
  }
  closePanel(); commit();
});
$('btn-close-panel').addEventListener('click', closePanel);
$('btn-delete-node').addEventListener('click', () => {
  if (!state.selection) return;
  state.selection.kind === 'edge' ? removeEdge(state.selection.id) : removeNode(state.selection.id);
});

// Foco familiar desde el panel de una persona
panel.querySelectorAll('[data-focus]').forEach(b => b.addEventListener('click', () => {
  const n = selNode(); if (n?.type !== 'person') return;
  setFocus(n.id, b.dataset.focus);
  if (isDrawer()) closePanel();                              // en móvil libera la pantalla para ver el resultado
}));

// Doble clic en una arista = eliminarla · Enter/Espacio sobre un nodo = abrir el panel
$('viewport').addEventListener('dblclick', (e) => { const g = e.target.closest('.edge-group'); if (g) removeEdge(g.dataset.id); });
$('nodes-layer').addEventListener('keydown', (e) => {
  const el = e.target.closest('.node');
  if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPanel('node', el.dataset.id); }
});

// ---------- Drawer móvil: arrastrar el asa hacia abajo para cerrar ----------
const handle = $('drawer-handle');
let swipe = null;
handle.addEventListener('pointerdown', (e) => {
  handle.setPointerCapture(e.pointerId);
  swipe = { y0: e.clientY, dy: 0 }; panel.style.transition = 'none';
});
handle.addEventListener('pointermove', (e) => {
  if (!swipe) return;
  swipe.dy = Math.max(0, e.clientY - swipe.y0);
  panel.style.transform = `translateY(${swipe.dy}px)`;
});
const endSwipe = () => {
  if (!swipe) return;
  const close = swipe.dy > 90; swipe = null;
  panel.style.transition = '';
  if (close) closePanel(); else panel.style.transform = '';
};
handle.addEventListener('pointerup', endSwipe);
handle.addEventListener('pointercancel', endSwipe);

setPanelOpen(false);
