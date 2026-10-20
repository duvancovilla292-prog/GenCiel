// ===== history.js · Undo / Redo por instantáneas =====
// commit() se llama DESPUÉS de cada acción que modifica el grafo. Si el estado no cambió, no añade nada.

import { HISTORY_LIMIT } from './config.js';
import { $, state, emit, toast } from './state.js';

const hist = { stack: [], idx: -1 };
const snap = () => JSON.stringify({ nodes: state.graph.nodes, edges: state.graph.edges });

function updateButtons() {
  $('btn-undo').disabled = hist.idx <= 0;
  $('btn-redo').disabled = hist.idx >= hist.stack.length - 1;
}

export function resetHistory() { hist.stack = [snap()]; hist.idx = 0; updateButtons(); }

/** @param {{persist?: boolean}} opts persist=false para cambios que vienen de la nube (no se re-suben) */
export function commit({ persist = true } = {}) {
  const s = snap();
  if (s !== hist.stack[hist.idx]) {
    hist.stack.length = hist.idx + 1;           // descarta el "futuro" al hacer una acción nueva
    hist.stack.push(s);
    if (hist.stack.length > HISTORY_LIMIT) hist.stack.shift();
    hist.idx = hist.stack.length - 1;
    updateButtons();
  }
  if (persist) emit('graph:changed');
}

function applySnapshot(s) {
  const d = JSON.parse(s);
  state.graph = { nodes: d.nodes, edges: d.edges };
  state.selection = null;
  emit('panel:close');                          // cierra el panel y renderiza
  emit('graph:replaced');
  emit('graph:changed');
  updateButtons();
}

export function undo() { if (hist.idx <= 0) return toast('Nada que deshacer'); hist.idx--; applySnapshot(hist.stack[hist.idx]); toast('Deshecho'); }
export function redo() { if (hist.idx >= hist.stack.length - 1) return toast('Nada que rehacer'); hist.idx++; applySnapshot(hist.stack[hist.idx]); toast('Rehecho'); }
