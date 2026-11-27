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

// Separación entre generaciones, de la unión respecto a sus padres y mínima entre centros dentro de una capa.
// Horizontal (estilo n8n): las generaciones van de izquierda a derecha. Vertical: de arriba abajo.
const SPACING = {
  h: { step: 300, union: 150, gap: { person: 178, union: 80 } },
  v: { step: 270, union: 160, gap: { person: 196, union: 110 } }
};
// "sec" = coordenada a lo ancho de la generación (y en horizontal, x en vertical)
const sec = (p) => (state.orient === 'h' ? p.y : p.x), prim = (p) => (state.orient === 'h' ? p.x : p.y);

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

export function autoLayout({ quiet = false } = {}) {
  const { nodes, edges } = state.graph;
  if (!nodes.length) return toast('No hay nada que organizar');
  reindex();
  const level = computeLevels();
  const layerOf = new Map(nodes.map(n => [n.id, level.get(n.id) * 2 + (n.type === 'union' ? 1 : 0)]));
  const S = SPACING[state.orient], GAP = S.gap;
  const x = new Map(nodes.map((n, i) => [n.id, sec(n.position) + i * 0.001]));     // el desempate conserva el orden actual
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
  const pOf = (n) => level.get(n.id) * S.step + (n.type === 'union' ? S.union : 0);
  const mid = (vals) => (Math.min(...vals) + Math.max(...vals)) / 2;
  const ds = mid(nodes.map(n => sec(n.position))) - mid(nodes.map(n => x.get(n.id)));
  const dp = mid(nodes.map(n => prim(n.position))) - mid(nodes.map(pOf));
  for (const n of nodes) {
    const a = Math.round(pOf(n) + dp), b = Math.round(x.get(n.id) + ds);
    n.position = state.orient === 'h' ? { x: a, y: b } : { x: b, y: a };
  }

  emit('render'); commit(); fitView();
  if (!quiet) toast('Árbol organizado por generaciones');
}
