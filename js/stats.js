// ===== stats.js · Estadísticas del árbol (vista) =====
// Recuadros con los números clave y gráficas de barras horizontales de un solo color (magnitud),
// con el valor escrito y un tooltip al pasar el mouse. El género usa los colores de género de toda la app.

import { $, state, esc, calculateAge, fold } from './state.js';
import { reindex, computeLevels } from './model.js';

const top = (map, k) => [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, k);
function count(list, keyFn) { const m = new Map(); list.forEach(x => { const k = keyFn(x); if (k) m.set(k, (m.get(k) || 0) + 1); }); return m; }

function bars(title, rows, opts = {}) {
  if (!rows.length) return `<section class="chart"><h3>${title}</h3><p class="rel-empty">${opts.empty || 'Sin datos todavía.'}</p></section>`;
  const max = Math.max(...rows.map(r => r.v), 1);
  return `<section class="chart"><h3>${title}</h3>${opts.note ? `<p class="chart-note">${opts.note}</p>` : ''}<div class="bars">${rows.map(r => `
    <div class="bar-row" title="${esc(r.label)}: ${r.v}${opts.unit ? ' ' + opts.unit : ''}">
      <span class="bl">${esc(r.label)}</span>
      <span class="track"><i style="width:${Math.max(r.v ? 2 : 0, r.v / max * 100)}%${r.color ? `;background:${r.color}` : ''}"></i></span>
      <b>${r.v}</b></div>`).join('')}</div></section>`;
}
const tile = (v, label, sub) => `<div class="tile"><b>${esc(String(v))}</b><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;

export function renderStats() {
  reindex();
  const persons = state.graph.nodes.filter(n => n.type === 'person'), unions = state.graph.nodes.filter(n => n.type === 'union');
  if (!persons.length) { $('stats').innerHTML = '<div class="page-empty">Tu árbol está vacío.</div>'; return; }
  const level = computeLevels(), deceased = persons.filter(p => p.data.deathDate).length;
  const ages = persons.filter(p => p.data.birthDate).map(p => calculateAge(p.data.birthDate, p.data.deathDate)).filter(a => Number.isFinite(a) && a >= 0);
  const minL = Math.min(...persons.map(p => level.get(p.id)));
  const gens = count(persons, p => String(level.get(p.id) - minL + 1));
  const oldest = persons.filter(p => p.data.birthDate && !p.data.deathDate).sort((a, b) => a.data.birthDate.localeCompare(b.data.birthDate))[0];
  const byStatus = (s) => unions.filter(u => (u.data.status || 'active') === s).length;
  // Apellidos: cada palabra del apellido cuenta (en Colombia se usan dos)
  const surnames = new Map();
  persons.forEach(p => (p.data.lastName || '').trim().split(/\s+/).filter(w => w.length > 1).forEach(w => {
    const k = w[0].toUpperCase() + w.slice(1).toLowerCase(); surnames.set(k, (surnames.get(k) || 0) + 1);
  }));
  const places = new Map();
  persons.forEach(p => { const pl = (p.data.birthPlace || '').trim(); if (pl) { const k = [...places.keys()].find(x => fold(x) === fold(pl)) || pl; places.set(k, (places.get(k) || 0) + 1); } });
  const decades = count(persons.filter(p => p.data.birthDate), p => `${Math.floor(+p.data.birthDate.slice(0, 4) / 10) * 10}s`);
  const g = count(persons, p => p.data.gender || 'M');

  $('stats').innerHTML = `<div class="tiles">
      ${tile(persons.length, 'Personas', `${persons.length - deceased} con vida · ${deceased} fallecidas`)}
      ${tile(gens.size, gens.size === 1 ? 'Generación' : 'Generaciones', 'según las conexiones')}
      ${tile(ages.length ? (ages.reduce((a, b) => a + b, 0) / ages.length).toFixed(0) : '—', 'Edad promedio', ages.length ? `${ages.length} de ${persons.length} con fecha` : 'sin fechas de nacimiento')}
      ${tile(unions.length, unions.length === 1 ? 'Unión' : 'Uniones', `${byStatus('active')} activas · ${byStatus('separated') + byStatus('divorced')} terminadas`)}
      ${oldest ? tile(calculateAge(oldest.data.birthDate) + ' años', 'La persona mayor', `${oldest.data.firstName} ${oldest.data.lastName}`.trim()) : ''}
    </div>
    <div class="charts">
      ${bars('Personas por generación', [...gens.entries()].sort((a, b) => +a[0] - +b[0]).map(([k, v]) => ({ label: `Generación ${k}`, v })))}
      ${bars('Nacimientos por década', [...decades.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ label: k, v })), { empty: 'Agrega fechas de nacimiento.' })}
      ${bars('Apellidos más comunes', top(surnames, 6).map(([k, v]) => ({ label: k, v })), { empty: 'Sin apellidos.' })}
      ${bars('Lugares de nacimiento', top(places, 6).map(([k, v]) => ({ label: k, v })), { empty: 'Agrega lugares de nacimiento.' })}
      ${bars('Género', [['M', 'Masculino'], ['F', 'Femenino'], ['O', 'Otro']].filter(([k]) => g.get(k)).map(([k, l]) => ({ label: l, v: g.get(k), color: `var(--g-${k.toLowerCase()})` })))}
      ${bars('Uniones', [['active', 'Activas'], ['separated', 'Separados'], ['divorced', 'Divorciados']].map(([k, l]) => ({ label: l, v: byStatus(k) })).filter(r => r.v), { empty: 'Sin uniones.' })}
    </div>`;
}
