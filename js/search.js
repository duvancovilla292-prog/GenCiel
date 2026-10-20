// ===== search.js · Buscador rápido (Ctrl+K) con navegación por teclado =====

import { $, mk, state, fold, nodeTitle } from './state.js';
import { focusNode } from './view.js';

const input = $('search-input'), list = $('search-results');
let hits = [], idx = -1;

function hide() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); idx = -1; }

function renderList() {
  list.replaceChildren();
  if (idx >= hits.length) idx = -1;
  if (!input.value.trim()) return hide();
  if (!hits.length) {
    const li = mk('li', 'empty'); li.textContent = 'Sin resultados'; list.appendChild(li);
  } else {
    hits.forEach((n, i) => {
      const li = mk('li', i === idx ? 'active' : ''); li.dataset.id = n.id; li.id = `hit-${i}`;
      li.setAttribute('role', 'option'); li.setAttribute('aria-selected', String(i === idx));
      const name = mk('span'); name.textContent = nodeTitle(n);
      const sub = mk('small'); sub.textContent = n.data.birthDate ? n.data.birthDate.slice(0, 4) : '';
      li.append(name, sub); list.appendChild(li);
    });
    if (idx >= 0) input.setAttribute('aria-activedescendant', `hit-${idx}`);
  }
  list.hidden = false; input.setAttribute('aria-expanded', 'true');
}

function run() {
  const tokens = fold(input.value).split(/\s+/).filter(Boolean);
  hits = tokens.length
    ? state.graph.nodes.filter(n => n.type === 'person' && tokens.every(t => fold(`${n.data.firstName} ${n.data.lastName}`).includes(t))).slice(0, 8)
    : [];
  idx = hits.length ? 0 : -1;
  renderList();
}

function pick(id) {
  if (!id) return;
  input.value = ''; hide(); input.blur();
  focusNode(id);
}

export function focusSearch() { input.focus(); input.select(); }

input.addEventListener('input', run);
input.addEventListener('focus', () => { if (input.value.trim()) run(); });
input.addEventListener('blur', hide);
input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!hits.length) return;
    e.preventDefault();
    idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
    renderList();
  } else if (e.key === 'Enter') { e.preventDefault(); pick(hits[Math.max(idx, 0)]?.id); }
  else if (e.key === 'Escape') { input.value = ''; hide(); input.blur(); }
});
list.addEventListener('mousedown', (e) => e.preventDefault());   // mantiene el foco del input al tocar un resultado
list.addEventListener('click', (e) => pick(e.target.closest('li[data-id]')?.dataset.id));
