// ===== stats.js · Estadísticas del árbol (modal) =====

import { $, mk, state, calculateAge } from './state.js';
import { reindex, computeLevels } from './model.js';

function computeStats() {
  reindex();
  const persons = state.graph.nodes.filter(n => n.type === 'person'), unions = state.graph.nodes.filter(n => n.type === 'union');
  const ages = persons.filter(p => p.data.birthDate).map(p => calculateAge(p.data.birthDate, p.data.deathDate)).filter(a => Number.isFinite(a) && a >= 0);
  const byStatus = (s) => unions.filter(u => (u.data.status || 'active') === s).length;
  const deceased = persons.filter(p => p.data.deathDate).length;
  const level = computeLevels();
  return {
    members: persons.length, deceased, living: persons.length - deceased,
    generations: persons.length ? Math.max(...persons.map(p => level.get(p.id))) + 1 : 0,
    avgAge: ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null, ageSample: ages.length,
    unions: unions.length, active: byStatus('active'), separated: byStatus('separated'), divorced: byStatus('divorced')
  };
}

export function openStats() {
  const s = computeStats(), grid = $('stats-grid');
  grid.replaceChildren();
  const card = (value, label, sub) => {
    const d = mk('div', 'stat'), b = mk('b'), l = mk('span');
    b.textContent = value; l.textContent = label; d.append(b, l);
    if (sub) { const m = mk('small'); m.textContent = sub; d.appendChild(m); }
    grid.appendChild(d);
  };
  card(s.members, 'Miembros', `${s.living} vivos · ${s.deceased} fallecidos`);
  card(s.generations, 'Generaciones (est.)');
  card(s.avgAge === null ? 'N/D' : s.avgAge.toFixed(1), 'Edad promedio', s.ageSample ? `${s.ageSample} de ${s.members} con fecha de nacimiento` : 'Sin fechas de nacimiento');
  card(s.unions, 'Uniones', `${s.active} activas · ${s.separated} separadas · ${s.divorced} divorciadas`);
  $('stats-modal').hidden = false;
  $('btn-stats-close').focus();
}

export const closeStats = () => { $('stats-modal').hidden = true; };
export const statsOpen = () => !$('stats-modal').hidden;

$('btn-stats').addEventListener('click', openStats);
$('btn-stats-close').addEventListener('click', closeStats);
$('stats-modal').addEventListener('click', (e) => { if (e.target === $('stats-modal')) closeStats(); });
