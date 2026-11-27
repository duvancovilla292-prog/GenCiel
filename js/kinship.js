// ===== kinship.js · "¿Cómo son parientes?": calcula el parentesco entre dos personas =====
// 1) Consanguíneo: busca el ancestro común más cercano (A está a `da` generaciones y B a `db`) y lo nombra
//    (padre, abuelo, tío, sobrino, primo hermano/segundo…, medio hermano).
// 2) Si no hay ancestro común, revisa la familia política (pareja, suegro, yerno/nuera, cuñado, padrastro, hijastro, consuegro).

import { nodeMap, nodeTitle } from './state.js';
import { reindex, parentsOf, partnersOf, siblingsOf, childrenOf } from './model.js';

const w = (g, m, f) => (g === 'F' ? f : g === 'M' ? m : `${m}/${f.slice(-1) === 'a' ? 'a' : f}`);
const UP = [null, ['padre', 'madre'], ['abuelo', 'abuela'], ['bisabuelo', 'bisabuela'], ['tatarabuelo', 'tatarabuela'], ['trastatarabuelo', 'trastatarabuela']];
const DOWN = [null, ['hijo', 'hija'], ['nieto', 'nieta'], ['bisnieto', 'bisnieta'], ['tataranieto', 'tataranieta'], ['trastataranieto', 'trastataranieta']];
const UP_PLURAL = [null, 'los padres', 'los abuelos', 'los bisabuelos', 'los tatarabuelos'];
const ORD = [null, null, ['hermano', 'hermana'], ['segundo', 'segunda'], ['tercero', 'tercera'], ['cuarto', 'cuarta'], ['quinto', 'quinta']];

const up = (k, g) => UP[k] ? w(g, ...UP[k]) : w(g, 'ancestro', 'ancestra') + ` (${k} generaciones)`;
const down = (k, g) => DOWN[k] ? w(g, ...DOWN[k]) : w(g, 'descendiente', 'descendiente') + ` (${k} generaciones)`;
/** primo/a hermano/a (k=2), primo/a segundo/a (k=3)… k = generaciones hasta el ancestro común (igual para ambos). */
const cousin = (k, g) => `${w(g, 'primo', 'prima')} ${ORD[k] ? w(g, ...ORD[k]) : 'lejano/a'}`;

/** Ancestros con su distancia y el camino para llegar (BFS por padres y madres). */
function ancestors(id) {
  const dist = new Map([[id, 0]]), prev = new Map(), queue = [id];
  while (queue.length) {
    const cur = queue.shift();
    for (const p of parentsOf(cur)) if (!dist.has(p.id)) { dist.set(p.id, dist.get(cur) + 1); prev.set(p.id, cur); queue.push(p.id); }
  }
  return { dist, prev };
}
const chain = (prev, from, to) => { const out = [to]; let c = to; while (c !== from) { c = prev.get(c); out.push(c); } return out.reverse(); };

function blood(aId, bId) {
  const A = ancestors(aId), B = ancestors(bId);
  let best = null;
  for (const [x, da] of A.dist) if (B.dist.has(x)) { const db = B.dist.get(x); if (!best || da + db < best.da + best.db) best = { x, da, db }; }
  if (!best) return null;
  const { x, da, db } = best;
  const path = [...chain(A.prev, aId, x), ...chain(B.prev, bId, x).reverse().slice(1)];
  // Ancestros comunes a esa misma distancia (normalmente la pareja de abuelos): se nombran juntos
  const via = [...A.dist].filter(([y, d]) => d === da && B.dist.get(y) === db).map(([y]) => y);
  return { da, db, path, via };
}

function bloodLabel(a, b, r) {
  const g = a.data.gender, { da, db } = r;
  if (da === 0) return up(db, g);
  if (db === 0) return down(da, g);
  if (da === 1 && db === 1) {
    const half = siblingsOf(a.id).find(s => s.person.id === b.id)?.half;
    return (half ? 'medio ' : '') + w(g, 'hermano', 'hermana');
  }
  if (da === 1) return db === 2 ? w(g, 'tío', 'tía') : `${w(g, 'tío', 'tía')} ${w(g, ...(UP[db - 1] || ['ancestro', 'ancestra']))}`;
  if (db === 1) return da === 2 ? w(g, 'sobrino', 'sobrina') : `${w(g, 'sobrino', 'sobrina')} ${w(g, ...(DOWN[da - 1] || ['descendiente', 'descendiente']))}`;
  if (da === db) return cousin(da, g);
  if (db > da) return `${cousin(da, g)} de ${UP_PLURAL[db - da] || 'los ancestros'} de`;      // es primo de los padres/abuelos de B
  return `${down(da - db, g)} de un primo ${ORD[db] ? ORD[db][0] : 'lejano'} de`;   // es hijo/nieto de un primo de B
}

function affinity(a, b) {
  const g = a.data.gender;
  const pa = partnersOf(a.id), pb = partnersOf(b.id);
  const together = pa.find(x => x.person.id === b.id);
  if (together) {
    const st = together.union.data.status || 'active';
    return st === 'active' ? 'pareja' : st === 'divorced' ? w(g, 'expareja (divorciados)', 'expareja (divorciados)') : 'expareja (separados)';
  }
  const isParent = (p, c) => parentsOf(c).some(x => x.id === p);
  const isSibling = (x, y) => siblingsOf(x).some(s => s.person.id === y);
  if (pb.some(x => isParent(a.id, x.person.id))) return w(g, 'suegro', 'suegra');                       // A es padre de la pareja de B
  if (pa.some(x => isParent(b.id, x.person.id))) return w(g, 'yerno', 'nuera');                         // B es padre de la pareja de A
  if (pb.some(x => isSibling(a.id, x.person.id)) || pa.some(x => isSibling(b.id, x.person.id))) return w(g, 'cuñado', 'cuñada');
  if (parentsOf(b.id).some(p => pa.some(x => x.person.id === p.id)) && !isParent(a.id, b.id)) return w(g, 'padrastro', 'madrastra');
  if (parentsOf(a.id).some(p => pb.some(x => x.person.id === p.id)) && !isParent(b.id, a.id)) return w(g, 'hijastro', 'hijastra');
  const kidsA = childrenOf(a.id), kidsB = childrenOf(b.id);
  if (kidsA.some(k => partnersOf(k.id).some(x => kidsB.some(kb => kb.id === x.person.id)))) return w(g, 'consuegro', 'consuegra');
  return null;
}

/** Resultado: { text, kind: 'self'|'blood'|'affinity'|'none', path: [ids], via: [ids] } */
export function kinship(aId, bId) {
  reindex();
  const a = nodeMap.get(aId), b = nodeMap.get(bId);
  if (!a || !b) return { kind: 'none', text: 'Elige dos personas', path: [], via: [] };
  if (aId === bId) return { kind: 'self', text: 'Es la misma persona', path: [aId], via: [] };
  const r = blood(aId, bId);
  if (r) {
    const label = bloodLabel(a, b, r);
    return { kind: 'blood', label, text: `${nodeTitle(a)} es ${label} ${label.endsWith(' de') ? '' : 'de '}${nodeTitle(b)}`.replace(/\s+/g, ' '), path: r.path, via: r.via, da: r.da, db: r.db };
  }
  const af = affinity(a, b);
  if (af) return { kind: 'affinity', label: af, text: `${nodeTitle(a)} es ${af} de ${nodeTitle(b)}`, path: [aId, bId], via: [] };
  return { kind: 'none', text: `No hay un parentesco registrado entre ${nodeTitle(a)} y ${nodeTitle(b)}`, path: [], via: [] };
}
