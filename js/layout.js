// ===== layout.js · Auto-organización por niveles (estilo Sugiyama simplificado) =====
// 1) Nivel (generación) de cada nodo: computeLevels() (pareja = mismo nivel, hijo = fuente + 1).
// 2) Capas verticales: personas en la capa 2·n y uniones en la 2·n+1 (la unión queda entre padres e hijos).
// 3) Orden y coordenada X por barridos de baricentro (hacia abajo / arriba / ambos): cada nodo se acerca a la media
//    de sus vecinos y las superposiciones se resuelven con regresión isotónica (desplazamiento mínimo).
// 4) Las parejas se mantienen contiguas y el resultado se centra donde estaba el árbol.

import { state, nodeMap, emit, toast } from './state.js';
import { reindex, computeLevels } from './model.js';
import { commit } from './history.js';
import { fitView } from './view.js';

const ROW = 250, UNION_DY = 120;                 // separación entre generaciones / de la unión respecto a sus padres
const GAP = { person: 250, union: 120 };         // distancia mínima entre centros dentro de una capa

/** Regresión isotónica (PAVA): secuencia no decreciente más cercana a `v` (mínimos cuadrados). */
function isotonic(v) {
  const blocks = [];
  for (const x of v) {
    blocks.push({ s: x, n: 1 });
    while (blocks.length > 1 && blocks.at(-2).s / blocks.at(-2).n > blocks.at(-1).s / blocks.at(-1).n) {
      const b = blocks.pop(), a = blocks.at(-1); a.s += b.s; a.n += b.n;
    }
  }
  return blocks.flatMap(b => Array(b.n).fill(b.s / b.n));
}

export function autoLayout() {
  const { nodes, edges } = state.graph;
  if (!nodes.length) return toast('No hay nada que organizar');
  reindex();
  const level = computeLevels();
  const layerOf = new Map(nodes.map(n => [n.id, level.get(n.id) * 2 + (n.type === 'union' ? 1 : 0)]));
  const x = new Map(nodes.map((n, i) => [n.id, n.position.x + i * 0.001]));        // el desempate conserva el orden actual
  const nbrs = new Map(nodes.map(n => [n.id, []]));
  const couples = new Map();                                                         // unión → [personas]
  for (const e of edges) {
    nbrs.get(e.source)?.push(e.target); nbrs.get(e.target)?.push(e.source);
    if (nodeMap.get(e.target)?.type === 'union' && nodeMap.get(e.source)?.type === 'person') {
      if (!couples.has(e.target)) couples.set(e.target, []);
      couples.get(e.target).push(e.source);
    }
  }
  const layers = new Map();
  for (const n of nodes) { const l = layerOf.get(n.id); if (!layers.has(l)) layers.set(l, []); layers.get(l).push(n.id); }
  const keys = [...layers.keys()].sort((a, b) => a - b);

  const mean = (id, k, dir) => {
    const v = nbrs.get(id).filter(o => dir === 'all' || (dir === 'up' ? layerOf.get(o) < k : layerOf.get(o) > k));
    return v.length ? v.reduce((s, o) => s + x.get(o), 0) / v.length : x.get(id);
  };

  function relayer(k, dir) {
    const ids = layers.get(k), want = new Map(ids.map(id => [id, mean(id, k, dir)]));
    if (k % 2 === 0) {                                                               // parejas contiguas
      for (const pair of couples.values()) {
        const [a, b] = pair; if (pair.length < 2 || !want.has(a) || !want.has(b)) continue;
        const m = (want.get(a) + want.get(b)) / 2, left = x.get(a) <= x.get(b) ? -1 : 1;
        want.set(a, m + left * 0.01); want.set(b, m - left * 0.01);
      }
    }
    ids.sort((p, q) => want.get(p) - want.get(q));
    const gap = k % 2 ? GAP.union : GAP.person;
    const fit = isotonic(ids.map((id, i) => want.get(id) - i * gap));
    ids.forEach((id, i) => x.set(id, fit[i] + i * gap));
  }

  for (let it = 0; it < 4; it++) {
    for (const k of keys) relayer(k, 'up');
    for (const k of [...keys].reverse()) relayer(k, 'down');
  }
  for (let it = 0; it < 2; it++) for (const k of keys) relayer(k, 'all');

  // Coordenadas finales, centradas sobre el centro previo del árbol
  const yOf = (n) => level.get(n.id) * ROW + (n.type === 'union' ? UNION_DY : 0);
  const mid = (vals) => (Math.min(...vals) + Math.max(...vals)) / 2;
  const dx = mid(nodes.map(n => n.position.x)) - mid(nodes.map(n => x.get(n.id)));
  const dy = mid(nodes.map(n => n.position.y)) - mid(nodes.map(yOf));
  for (const n of nodes) n.position = { x: Math.round(x.get(n.id) + dx), y: Math.round(yOf(n) + dy) };

  emit('render'); commit(); fitView();
  toast('Árbol reorganizado por generaciones');
}
