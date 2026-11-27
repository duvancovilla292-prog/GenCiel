// ===== timeline.js · Línea de tiempo: una barra por vida, ordenadas por año de nacimiento =====

import { $, state, emit, esc, nodeTitle, lifeLabel, calculateAge } from './state.js';
import { reindex, ownUnionsOf, unionMembers } from './model.js';
import { avatarHtml } from './panel.js';

const yearOf = (d) => (d ? +d.slice(0, 4) : null);

export function renderTimeline() {
  reindex();
  const box = $('timeline'), now = new Date(), nowY = now.getFullYear() + now.getMonth() / 12;
  const persons = state.graph.nodes.filter(n => n.type === 'person');
  const dated = persons.filter(p => yearOf(p.data.birthDate)).sort((a, b) => a.data.birthDate.localeCompare(b.data.birthDate));
  const undated = persons.filter(p => !yearOf(p.data.birthDate));
  if (!dated.length) {
    box.innerHTML = `<div class="page-empty">${persons.length ? 'Agrega fechas de nacimiento en las fichas para ver la línea de tiempo.' : 'Tu árbol está vacío.'}</div>`;
    return;
  }
  const frac = (d) => { const t = new Date(d); return t.getFullYear() + t.getMonth() / 12 + (t.getDate() - 1) / 365; };
  const y0 = Math.floor((frac(dated[0].data.birthDate) - 2) / 10) * 10, y1 = Math.ceil((nowY + 1) / 10) * 10;
  const pct = (y) => ((y - y0) / (y1 - y0) * 100).toFixed(3);
  let ticks = '';
  for (let y = y0; y <= y1; y += 10) if (Math.abs(y - nowY) > (y1 - y0) * 0.05) ticks += `<span class="tick" style="left:${pct(y)}%"><i>${y}</i></span>`;   // sin chocar con "Hoy"
  const rows = dated.map(p => {
    const d = p.data, a = frac(d.birthDate), b = d.deathDate ? frac(d.deathDate) : nowY;
    const age = calculateAge(d.birthDate, d.deathDate);
    const marks = ownUnionsOf(p.id).filter(u => u.data.startDate).map(u => {
      const who = unionMembers(u.id).filter(m => m.id !== p.id).map(nodeTitle).join(', ');
      return `<span class="tl-mark" style="left:${pct(frac(u.data.startDate))}%" title="${esc(`Unión${who ? ' con ' + who : ''} · ${u.data.startDate.slice(0, 4)}`)}">♥</span>`;
    }).join('');
    const tip = `${nodeTitle(p)} · ${d.birthDate.slice(0, 4)} – ${d.deathDate ? d.deathDate.slice(0, 4) : 'hoy'} (${age} años)`;
    return `<div class="tl-row">
      <button type="button" class="tl-name" data-person="${esc(p.id)}">${avatarHtml(p)}<span><b>${esc(nodeTitle(p))}</b><small>${esc(lifeLabel(d))}</small></span></button>
      <div class="tl-track"><span class="tl-bar${d.deathDate ? ' ended' : ''}" data-g="${esc(d.gender)}" style="left:${pct(a)}%;width:${Math.max(0.6, pct(b) - pct(a))}%" title="${esc(tip)}"></span>${marks}</div>
    </div>`;
  }).join('');
  box.innerHTML = `<div class="tl-axis"><span class="tl-name-sp"></span><div class="tl-ticks">${ticks}<span class="tick now" style="left:${pct(nowY)}%"><i>Hoy</i></span></div></div>
    <div class="tl-rows" style="--now:${pct(nowY)}%">${rows}</div>
    ${undated.length ? `<div class="tl-undated"><h3>Sin fecha de nacimiento (${undated.length})</h3><div>${undated.map(p => `<button type="button" class="chip-btn" data-person="${esc(p.id)}">${avatarHtml(p)}${esc(nodeTitle(p))}</button>`).join('')}</div></div>` : ''}`;
}

$('timeline').addEventListener('click', (e) => { const b = e.target.closest('[data-person]'); if (b) emit('goto:person', b.dataset.person); });
