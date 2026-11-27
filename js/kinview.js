// ===== kinview.js · Vista "¿Cómo son parientes?" =====

import { $, state, on, emit, esc, nodeTitle, nodeMap, fold } from './state.js';
import { kinship } from './kinship.js';
import { avatarHtml } from './panel.js';

const selA = $('kin-a'), selB = $('kin-b');
let pickA = '', pickB = '';

function fill(sel, value) {
  const persons = state.graph.nodes.filter(n => n.type === 'person').sort((a, b) => fold(nodeTitle(a)).localeCompare(fold(nodeTitle(b))));
  sel.innerHTML = '<option value="">Elige una persona…</option>' + persons.map(p => `<option value="${esc(p.id)}">${esc(nodeTitle(p))}${p.data.birthDate ? ' (' + p.data.birthDate.slice(0, 4) + ')' : ''}</option>`).join('');
  sel.value = persons.some(p => p.id === value) ? value : '';
}

export function renderKin() {
  fill(selA, pickA); fill(selB, pickB);
  pickA = selA.value; pickB = selB.value;
  const out = $('kin-result');
  if (!pickA || !pickB) { out.innerHTML = `<div class="page-empty">${state.graph.nodes.some(n => n.type === 'person') ? 'Elige a dos personas.' : 'Tu árbol está vacío.'}</div>`; return; }
  const r = kinship(pickA, pickB);
  const via = new Set(r.via || []);
  let path = '';
  if (r.path.length > 1) {
    const top = r.kind === 'blood' ? r.da : -1;                  // índice del ancestro común dentro del camino
    path = `<ol class="kin-path">${r.path.map((id, i) => {
      const n = nodeMap.get(id); if (!n) return '';
      const arrow = i === 0 ? '' : `<span class="kin-arrow" aria-hidden="true">${r.kind !== 'blood' ? '↔' : i <= top ? '↑' : '↓'}</span>`;
      const tag = i === top && r.kind === 'blood' && top > 0 && i < r.path.length - 1 ? '<em>Ancestro común</em>' : i === 0 ? '<em>A</em>' : i === r.path.length - 1 ? '<em>B</em>' : '';
      return `<li>${arrow}<button type="button" class="rel-card${via.has(id) ? ' via' : ''}" data-person="${esc(id)}">${avatarHtml(n)}<span><b>${esc(nodeTitle(n))}</b>${tag}</span></button></li>`;
    }).join('')}</ol>`;
    const others = [...via].filter(id => !r.path.includes(id)).map(id => nodeMap.get(id)).filter(Boolean);
    if (others.length) path += `<p class="kin-note">También por ${others.map(n => `<b>${esc(nodeTitle(n))}</b>`).join(' y ')}.</p>`;
  }
  const icon = { blood: '🧬', affinity: '💍', self: '🙂', none: '🤷' }[r.kind];
  out.innerHTML = `<div class="kin-card ${r.kind}"><span class="kin-icon" aria-hidden="true">${icon}</span><p class="kin-text">${esc(r.text)}</p>
    ${r.kind === 'blood' && r.da && r.db ? `<p class="kin-sub">${esc(nodeTitle(nodeMap.get(pickA)))} está a ${r.da} y ${esc(nodeTitle(nodeMap.get(pickB)))} a ${r.db} ${r.db === 1 ? 'generación' : 'generaciones'} del ancestro común.</p>` : ''}
    ${r.kind === 'affinity' ? '<p class="kin-sub">Familia política (por matrimonio o pareja).</p>' : ''}</div>${path}`;
}

selA.addEventListener('change', () => { pickA = selA.value; renderKin(); });
selB.addEventListener('change', () => { pickB = selB.value; renderKin(); });
$('kin-swap').addEventListener('click', () => { [pickA, pickB] = [pickB, pickA]; renderKin(); });
$('kin-result').addEventListener('click', (e) => { const b = e.target.closest('[data-person]'); if (b) emit('goto:person', b.dataset.person); });
on('kin:from', (id) => { pickA = id; if (pickB === id) pickB = ''; emit('goto:tab', 'kin'); setTimeout(() => selB.focus(), 50); });
