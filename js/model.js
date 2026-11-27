// ===== model.js · Modelo del grafo: normalización, índices, validación, CRUD, niveles y ramas =====
// No toca el DOM: pide el redibujado con emit('render') y registra historial con commit().

import { REL_LABEL, UNION_LABEL, GEO } from './config.js';
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

// ---------- Familia (lectura) ----------
const personsInto = (uId) => state.graph.edges.filter(e => e.target === uId && nodeMap.get(e.source)?.type === 'person').map(e => nodeMap.get(e.source));
/** Uniones de las que la persona es hija. */
export const parentUnionsOf = (pid) => state.graph.edges.filter(e => e.target === pid && nodeMap.get(e.source)?.type === 'union').map(e => nodeMap.get(e.source));
export function parentsOf(pid) {
  const out = [];
  parentUnionsOf(pid).forEach(u => personsInto(u.id).forEach(p => out.push(p)));
  state.graph.edges.forEach(e => { if (e.target === pid && nodeMap.get(e.source)?.type === 'person') out.push(nodeMap.get(e.source)); });
  return [...new Set(out)];
}
/** Uniones en las que la persona es integrante (pareja). */
export const ownUnionsOf = (pid) => state.graph.edges.filter(e => e.source === pid && nodeMap.get(e.target)?.type === 'union').map(e => nodeMap.get(e.target));
export function partnersOf(pid) {
  return ownUnionsOf(pid).flatMap(u => personsInto(u.id).filter(p => p.id !== pid).map(p => ({ person: p, union: u })));
}
export function childrenOf(pid) {
  const kids = [];
  ownUnionsOf(pid).forEach(u => state.graph.edges.forEach(e => { if (e.source === u.id && nodeMap.get(e.target)?.type === 'person') kids.push(nodeMap.get(e.target)); }));
  state.graph.edges.forEach(e => { if (e.source === pid && nodeMap.get(e.target)?.type === 'person') kids.push(nodeMap.get(e.target)); });
  return [...new Set(kids)];
}
export const unionChildren = (uId) => state.graph.edges.filter(e => e.source === uId).map(e => nodeMap.get(e.target)).filter(n => n?.type === 'person');
export const unionMembers = personsInto;
/** Hermanos: comparten al menos un padre o madre. `half` = no comparten todos. */
export function siblingsOf(pid) {
  const mine = new Set(parentsOf(pid).map(p => p.id)), out = new Map();
  parentsOf(pid).forEach(par => childrenOf(par.id).forEach(k => {
    if (k.id === pid || out.has(k.id)) return;
    const theirs = new Set(parentsOf(k.id).map(p => p.id));
    const half = mine.size !== theirs.size || [...mine].some(id => !theirs.has(id));
    out.set(k.id, { person: k, half });
  }));
  return [...out.values()];
}

// ---------- Agregar rápido (botón "+" de cada nodo, como en n8n) ----------
// Las posiciones nuevas se calculan relativas al nodo según la dirección del árbol:
// "along" = hacia la siguiente generación, "across" = hacia el lado.
const STEP = () => (state.orient === 'h' ? 300 : 270), UN = () => (state.orient === 'h' ? 150 : 160), ACROSS = () => (state.orient === 'h' ? 180 : 190);
const at = (n, along, across) => state.orient === 'h'
  ? { x: n.position.x + along, y: n.position.y + across }
  : { x: n.position.x + across, y: n.position.y + along };
function freeSpot(p, type) {
  const g = GEO[type], step = ACROSS();
  const busy = (q) => state.graph.nodes.some(n => Math.abs(n.position.x - q.x) < (GEO[n.type].w + g.w) / 2 - 4 && Math.abs(n.position.y - q.y) < (GEO[n.type].box + g.box) / 2 + (type === 'person' || n.type === 'person' ? GEO.person.label : 0));
  let q = { ...p };
  for (let i = 1; busy(q) && i < 60; i++) q = state.orient === 'h' ? { x: p.x, y: p.y + step * Math.ceil(i / 2) * (i % 2 ? 1 : -1) } : { x: p.x + step * Math.ceil(i / 2) * (i % 2 ? 1 : -1), y: p.y };
  return q;
}
const firstWord = (s) => (s || '').trim().split(/\s+/)[0] || '';
function newPerson(pos, data = {}) {
  const n = { id: uid('p'), type: 'person', position: freeSpot(pos, 'person'), data: { firstName: '', lastName: '', gender: 'M', birthPlace: '', birthDate: '', deathDate: '', description: '', img: '', ...data } };
  state.graph.nodes.push(n); return n;
}
function newUnion(pos) {
  const n = { id: uid('u'), type: 'union', position: freeSpot(pos, 'union'), data: { status: 'active', startDate: '', endDate: '' } };
  state.graph.nodes.push(n); return n;
}
const link = (s, t, child) => state.graph.edges.push(child ? { id: uid('e'), source: s, target: t, relationType: 'blood' } : { id: uid('e'), source: s, target: t });
const done = (msg) => { emit('render'); commit(); toast(msg); };

/** Agrega una pareja: usa una unión de la persona que tenga un solo integrante o crea una nueva. Devuelve la pareja. */
export function quickPartner(pid) {
  reindex();
  const p = nodeMap.get(pid); if (p?.type !== 'person') return null;
  let u = ownUnionsOf(pid).find(x => personsInto(x.id).length < 2);
  const gender = p.data.gender === 'M' ? 'F' : p.data.gender === 'F' ? 'M' : 'O';
  const partner = newPerson(at(p, 0, ACROSS()), { gender });
  if (!u) { u = newUnion(at(p, UN(), ACROSS() / 2)); link(pid, u.id); }
  link(partner.id, u.id);
  done('Pareja agregada: escribe su nombre');
  return partner;
}
/** Agrega un hijo/a a una unión (o a una persona: a su primera unión, o a una unión nueva de un solo integrante). */
export function quickChild(id) {
  reindex();
  const n = nodeMap.get(id); if (!n) return null;
  let u = n;
  if (n.type === 'person') {
    const us = ownUnionsOf(id);
    u = us.find(x => (x.data.status || 'active') === 'active') || us[0];
    if (!u) { u = newUnion(at(n, UN(), 0)); link(id, u.id); }
  }
  const parents = personsInto(u.id), kids = unionChildren(u.id);
  const last = kids.sort((a, b) => (state.orient === 'h' ? a.position.y - b.position.y : a.position.x - b.position.x)).at(-1);
  const base = last ? (state.orient === 'h' ? { x: last.position.x, y: last.position.y + ACROSS() } : { x: last.position.x + ACROSS(), y: last.position.y }) : at(u, STEP() - UN(), 0);
  const dad = parents.find(p => p.data.gender === 'M') || parents[0], mom = parents.find(p => p !== dad);
  const child = newPerson(base, { lastName: [firstWord(dad?.data.lastName), firstWord(mom?.data.lastName)].filter(Boolean).join(' ') });
  link(u.id, child.id, true);
  done('Hijo/a agregado: escribe su nombre');
  return child;
}
/** Agrega padres (padre y madre con su unión). Si ya tiene una unión de padres con un integrante, completa la pareja. */
export function quickParents(pid) {
  reindex();
  const p = nodeMap.get(pid); if (p?.type !== 'person') return null;
  const pu = parentUnionsOf(pid)[0];
  if (pu) {
    const members = personsInto(pu.id);
    if (members.length >= 2) { toast('Ya tiene padre y madre registrados', 'warn'); return null; }
    const g = members[0]?.data.gender === 'M' ? 'F' : 'M';
    const par = newPerson(at(pu, -UN(), members.length ? ACROSS() : 0), { gender: g });
    link(par.id, pu.id);
    done(`${g === 'F' ? 'Madre' : 'Padre'} agregado: escribe su nombre`);
    return par;
  }
  if (parentsOf(pid).length) { toast('Ya tiene un vínculo directo de ascendencia', 'warn'); return null; }
  const u = newUnion(at(p, -UN(), 0));
  const words = (p.data.lastName || '').trim().split(/\s+/);
  const dad = newPerson(at(p, -STEP(), -ACROSS() / 2), { gender: 'M', lastName: words[0] || '' });
  const mom = newPerson(at(p, -STEP(), ACROSS() / 2), { gender: 'F', lastName: words[1] || '' });
  link(dad.id, u.id); link(mom.id, u.id); link(u.id, pid, true);
  done('Padres agregados: escribe sus nombres');
  return dad;
}
/** Agrega un hermano/a (hijo/a de la misma unión de padres). */
export function quickSibling(pid) {
  reindex();
  const pu = parentUnionsOf(pid)[0];
  if (!pu) { toast('Primero agrega sus padres', 'warn'); return null; }
  return quickChild(pu.id);
}
