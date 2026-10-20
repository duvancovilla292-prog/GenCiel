// ===== model.js · Modelo del grafo: normalización, índices, validación, CRUD, niveles y ramas =====
// No toca el DOM: pide el redibujado con emit('render') y registra historial con commit().

import { REL_LABEL, UNION_LABEL } from './config.js';
import { state, nodeMap, unionsOf, edgesOf, emit, uid, toast, isPartnerLink, nodeTitle, calculateAge } from './state.js';
import { commit } from './history.js';

// ---------- Normalización (import / nube / respaldo local) ----------
export function normalizeGraph(raw) {
  if (!raw || !Array.isArray(raw.nodes)) throw new Error('Formato inválido');
  const seen = new Set();
  const nodes = raw.nodes.filter(n => n && n.id && !seen.has(n.id) && seen.add(n.id)).map(n => {
    const type = n.type === 'union' ? 'union' : 'person';
    const data = type === 'union'
      ? { status: 'active', startDate: '', endDate: '', ...n.data }
      : { firstName: '', lastName: '', gender: 'M', birthPlace: '', birthDate: '', deathDate: '', description: '', img: '', ...n.data };
    if (type === 'union' && !(data.status in UNION_LABEL)) data.status = 'active';
    return { id: String(n.id), type, data, position: { x: +n.position?.x || 0, y: +n.position?.y || 0 } };
  });
  const types = new Map(nodes.map(n => [n.id, n.type]));
  const eSeen = new Set();
  const edges = (raw.edges || []).filter(e => e && types.has(e.source) && types.has(e.target) && e.source !== e.target).map(e => {
    const id = e.id && !eSeen.has(e.id) ? String(e.id) : uid('e');
    eSeen.add(id);
    const out = { id, source: e.source, target: e.target };
    if (!isPartnerLink(types.get(e.source), types.get(e.target))) out.relationType = e.relationType in REL_LABEL ? e.relationType : 'blood';
    return out;
  });
  return { nodes, edges };
}

// ---------- Índices derivados ----------
export function reindex() {
  nodeMap.clear(); unionsOf.clear(); edgesOf.clear();
  state.graph.nodes.forEach(n => { nodeMap.set(n.id, n); edgesOf.set(n.id, []); });
  state.graph.edges.forEach(e => {
    const s = nodeMap.get(e.source), t = nodeMap.get(e.target);
    if (!s || !t) return;
    edgesOf.get(s.id).push(e); edgesOf.get(t.id).push(e);
    if (isPartnerLink(s.type, t.type)) {
      if (!unionsOf.has(s.id)) unionsOf.set(s.id, []);
      unionsOf.get(s.id).push(t);
    }
  });
}

// Estado de pareja DERIVADO (no se guarda, así nunca queda desincronizado)
export function getRelStatus(personId) {
  const us = unionsOf.get(personId);
  if (!us || !us.length) return '';
  return us.some(u => (u.data.status || 'active') === 'active') ? '● En pareja' : '○ Sin pareja';
}

// ---------- Validación ----------
function wouldCreateCycle(source, target, ignoreEdgeId) {
  const stack = [target], visited = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === source) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    state.graph.edges.forEach(e => { if (e.source === cur && e.id !== ignoreEdgeId) stack.push(e.target); });
  }
  return false;
}

/** Devuelve { error?: string, warnings: string[] }. "error" bloquea; "warnings" crea la conexión pero avisa. */
export function validateConnection(sourceId, targetId, ignoreEdgeId) {
  const s = nodeMap.get(sourceId), t = nodeMap.get(targetId), warnings = [];
  const fail = (error) => ({ error, warnings });
  if (!s || !t || s === t) return fail('Conexión inválida');
  if (s.type === 'union' && t.type === 'union') return fail('Una unión no se conecta con otra unión');

  const others = state.graph.edges.filter(e => e.id !== ignoreEdgeId);
  if (others.some(e => (e.source === sourceId && e.target === targetId) || (e.source === targetId && e.target === sourceId)))
    return fail('Estos nodos ya están conectados');
  if (wouldCreateCycle(sourceId, targetId, ignoreEdgeId)) return fail('Crearía un ciclo: alguien sería su propio ancestro');

  if (isPartnerLink(s.type, t.type)) {
    const partners = others.filter(e => e.target === t.id && nodeMap.get(e.source)?.type === 'person').length;
    if (partners >= 2) return fail('Una unión admite como máximo 2 integrantes');
    return { warnings };
  }

  // Vínculo "hijo/a" (unión→persona o persona→persona)
  if (s.type === 'person') warnings.push('Conexión directa persona→persona: lo habitual es Padre/Madre → Unión → Hijo/a');
  const parentLinks = others.filter(e => e.target === t.id).length;
  if (parentLinks >= 2) warnings.push(`${nodeTitle(t)} ya tiene ${parentLinks} vínculos de ascendencia`);

  const parents = s.type === 'union'
    ? others.filter(e => e.target === s.id).map(e => nodeMap.get(e.source)).filter(n => n?.type === 'person')
    : [s];
  if (t.data.birthDate) {
    for (const p of parents) {
      if (!p.data.birthDate) continue;
      const gap = calculateAge(p.data.birthDate, t.data.birthDate);
      if (!Number.isFinite(gap)) continue;
      if (gap < 0) { warnings.push(`${nodeTitle(t)} nació antes que ${nodeTitle(p)}`); break; }
      if (gap < 12) { warnings.push(`${nodeTitle(p)} tendría solo ${gap} años al nacer ${nodeTitle(t)}`); break; }
    }
  }
  return { warnings };
}

// ---------- CRUD ----------
export function addNode(type, at) {
  const node = type === 'person'
    ? { id: uid('p'), type, position: { ...at }, data: { firstName: 'Nueva', lastName: 'Persona', gender: 'M', birthPlace: '', birthDate: '', deathDate: '', description: '', img: '' } }
    : { id: uid('u'), type, position: { ...at }, data: { status: 'active', startDate: '', endDate: '' } };
  state.graph.nodes.push(node);
  emit('render'); commit();
  return node;
}

export function addEdge(sourceId, targetId) {
  const v = validateConnection(sourceId, targetId);
  if (v.error) { toast(v.error, 'error'); return null; }
  const s = nodeMap.get(sourceId), t = nodeMap.get(targetId);
  const edge = { id: uid('e'), source: sourceId, target: targetId };
  const partner = isPartnerLink(s.type, t.type);
  if (!partner) edge.relationType = 'blood';
  state.graph.edges.push(edge);
  emit('render'); commit();
  if (v.warnings.length) toast(`Conectado, pero: ${v.warnings[0]}`, 'warn');
  else toast(partner ? 'Pareja añadida a la unión' : 'Hijo/a añadido (sangre). Cambia el tipo tocando la línea');
  return edge;
}

export function removeEdge(id) {
  state.graph.edges = state.graph.edges.filter(e => e.id !== id);
  if (state.selection?.kind === 'edge' && state.selection.id === id) emit('panel:close'); else emit('render');
  commit();
}

export function removeNode(id) {
  state.graph.nodes = state.graph.nodes.filter(n => n.id !== id);
  state.graph.edges = state.graph.edges.filter(e => e.source !== id && e.target !== id);
  emit('panel:close'); commit();
}

export function clearGraph() {
  state.graph = { nodes: [], edges: [] };
  state.focus = null;
  emit('panel:close'); emit('graph:replaced'); commit();
}

// ---------- Generaciones ----------
/** Nivel estimado por relajación: pareja = mismo nivel; hijo = fuente + 1. Requiere reindex() previo. */
export function computeLevels() {
  const { nodes, edges } = state.graph;
  const level = new Map(nodes.map(n => [n.id, 0]));
  const lift = (id, v) => { if (level.get(id) < v) { level.set(id, v); return true; } return false; };
  for (let i = 0; i < nodes.length + 2; i++) {          // tope: tolera datos importados raros
    let changed = false;
    for (const e of edges) {
      const s = nodeMap.get(e.source), t = nodeMap.get(e.target); if (!s || !t) continue;
      if (isPartnerLink(s.type, t.type)) {
        const v = Math.max(level.get(s.id), level.get(t.id));
        if (lift(s.id, v)) changed = true;
        if (lift(t.id, v)) changed = true;
      } else if (lift(t.id, level.get(s.id) + 1)) changed = true;
    }
    if (!changed) break;
  }
  return level;
}

// ---------- Ramas (foco familiar) ----------
/**
 * Conjunto de ids visibles al enfocar a `rootId`.
 * ancestors: persona ← unión ← integrantes ← sus uniones padre … · descendants: persona → uniones → hijos → …
 * En ambos casos se añaden los integrantes (cónyuges) de las uniones incluidas.
 */
export function collectBranch(rootId, mode) {
  const out = new Map(), inn = new Map();
  for (const e of state.graph.edges) {
    if (!out.has(e.source)) out.set(e.source, []);
    if (!inn.has(e.target)) inn.set(e.target, []);
    out.get(e.source).push(e.target); inn.get(e.target).push(e.source);
  }
  const walk = (adj) => {
    const seen = new Set([rootId]), stack = [rootId];
    while (stack.length) for (const nx of adj.get(stack.pop()) || []) if (!seen.has(nx)) { seen.add(nx); stack.push(nx); }
    return seen;
  };
  const keep = new Set([rootId]);
  if (mode !== 'descendants') walk(inn).forEach(id => keep.add(id));
  if (mode !== 'ancestors') walk(out).forEach(id => keep.add(id));
  for (const id of [...keep]) if (nodeMap.get(id)?.type === 'union') (inn.get(id) || []).forEach(p => keep.add(p));
  return keep;
}
