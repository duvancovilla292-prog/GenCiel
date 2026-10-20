// ===== exporter.js · Exportar el árbol como imagen (SVG vectorial o PNG) =====
// Se construye un SVG autónomo a partir del MODELO (no del DOM), así el resultado no depende del zoom ni de lo que
// esté en pantalla. Respeta el foco familiar activo (exporta solo lo visible). Los avatares se incrustan como
// data-URI; si una imagen remota no permite CORS se sustituye por el avatar genérico.

import { NODE_SIZE, COLORS, PLACEHOLDER, UNION_LABEL, UNION_GLYPH } from './config.js';
import { state, nodeMap, toast, downloadBlob, outPt, inPt, bezier, isPartnerLink, nodeTitle, ageLabel } from './state.js';
import { isVisible } from './render.js';
import { reindex } from './model.js';

const PAD = 60, MAX_PX = 8192, FONT = "'Segoe UI', system-ui, sans-serif";
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DASH = { adopted: '9 6', stepchild: '1 7' };
const UNION_STYLE = {
  active: { fill: '#2b2418', stroke: COLORS.union, dash: '' },
  divorced: { fill: '#3a1d1d', stroke: COLORS.danger, dash: '' },
  separated: { fill: '#2a2c33', stroke: COLORS.dim, dash: '3 2' }
};

async function toDataUrl(src) {
  if (!src) return PLACEHOLDER;
  if (src.startsWith('data:')) return src;
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch(src, { mode: 'cors', signal: ctl.signal });
    if (!r.ok) throw new Error(r.status);
    const blob = await r.blob();
    return await new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = rej; f.readAsDataURL(blob); });
  } catch (_) { return PLACEHOLDER; } finally { clearTimeout(t); }
}

async function buildSvg() {
  reindex();
  const nodes = state.graph.nodes.filter(n => isVisible(n.id));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    const { w, h } = NODE_SIZE[n.type];
    x0 = Math.min(x0, n.position.x - w / 2); x1 = Math.max(x1, n.position.x + w / 2 + (n.type === 'union' ? 90 : 0));
    y0 = Math.min(y0, n.position.y - h / 2); y1 = Math.max(y1, n.position.y + h / 2);
  }
  x0 -= PAD; y0 -= PAD; x1 += PAD; y1 += PAD;
  const W = Math.ceil(x1 - x0), H = Math.ceil(y1 - y0);
  const imgs = new Map(await Promise.all(nodes.filter(n => n.type === 'person').map(async n => [n.id, await toDataUrl((n.data.img || '').trim())])));

  let edgesSvg = '';
  for (const e of state.graph.edges) {
    const s = nodeMap.get(e.source), t = nodeMap.get(e.target);
    if (!s || !t || !isVisible(s.id) || !isVisible(t.id)) continue;
    const partner = isPartnerLink(s.type, t.type), rel = partner ? null : (e.relationType || 'blood');
    const u = s.type === 'union' ? s : t.type === 'union' ? t : null, ended = u && (u.data.status || 'active') !== 'active';
    const stroke = ended ? COLORS.ended : partner ? COLORS.union : COLORS.rel[rel];
    const dash = partner ? (ended ? '7 6' : '') : (DASH[rel] || '');
    const a = outPt(s), b = inPt(t);
    edgesSvg += `<path d="${bezier(a, b)}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}${ended ? ' opacity=".85"' : ''}/>`;
  }

  let nodesSvg = '', defs = '';
  nodes.forEach((n, i) => {
    const { x, y } = n.position, { w, h } = NODE_SIZE[n.type];
    if (n.type === 'person') {
      const gc = COLORS.gender[n.data.gender] || COLORS.dim, left = x - w / 2, top = y - h / 2, cx = left + 14 + 22;
      const name = nodeTitle(n), shown = name.length > 17 ? name.slice(0, 16) + '…' : name;
      defs += `<clipPath id="c${i}"><circle cx="${cx}" cy="${y}" r="22"/></clipPath>`;
      nodesSvg += `<g${n.data.deathDate ? ' opacity=".9"' : ''}>
<rect x="${left}" y="${top}" width="${w}" height="${h}" rx="14" fill="${COLORS.surface}" stroke="${COLORS.border}" stroke-width="1.5"/>
<rect x="${left}" y="${top + 12}" width="4" height="${h - 24}" rx="2" fill="${gc}"/>
<image href="${esc(imgs.get(n.id))}" x="${cx - 22}" y="${y - 22}" width="44" height="44" clip-path="url(#c${i})" preserveAspectRatio="xMidYMid slice"${n.data.deathDate ? ' style="filter:grayscale(1)"' : ''}/>
<circle cx="${cx}" cy="${y}" r="22" fill="none" stroke="${gc}" stroke-width="2"/>
<text x="${left + 68}" y="${y - 3}" fill="${COLORS.text}" font-family="${FONT}" font-size="14" font-weight="600">${esc(shown)}</text>
<text x="${left + 68}" y="${y + 15}" fill="${COLORS.dim}" font-family="${FONT}" font-size="11">${esc(ageLabel(n.data))}</text>
<circle cx="${left + w - 14}" cy="${top + 13}" r="4" fill="${n.data.deathDate ? '#6b717f' : '#7bd88f'}"/></g>`;
    } else {
      const st = UNION_STYLE[n.data.status] || UNION_STYLE.active, label = UNION_LABEL[n.data.status] || '';
      nodesSvg += `<g><circle cx="${x}" cy="${y}" r="${w / 2}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="2"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>
<text x="${x}" y="${y + 5}" text-anchor="middle" fill="${st.stroke}" font-family="${FONT}" font-size="15" font-weight="700">${esc(UNION_GLYPH[n.data.status] || '♥')}</text>
${label ? `<text x="${x + w / 2 + 8}" y="${y + 4}" fill="${COLORS.dim}" font-family="${FONT}" font-size="11">${esc(label)}</text>` : ''}</g>`;
    }
  });

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${x0} ${y0} ${W} ${H}">
<defs>${defs}</defs><rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="${COLORS.bg}"/>
${edgesSvg}${nodesSvg}</svg>`;
  return { svg, W, H };
}

/** @param {'png' | 'svg'} format */
export async function exportImage(format) {
  if (!state.graph.nodes.some(n => isVisible(n.id))) return toast('No hay nada que exportar');
  toast('Generando imagen…');
  try {
    const { svg, W, H } = await buildSvg();
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'svg') {
      downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `arbol_genealogico_${stamp}.svg`);
      return toast('SVG exportado');
    }
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('No se pudo rasterizar el SVG')); img.src = url; });
    const k = Math.min(2, MAX_PX / Math.max(W, H));                // 2× de resolución, con tope para no exceder el límite del canvas
    const cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(H * k);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(url);
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    if (!blob) throw new Error('El lienzo es demasiado grande para este navegador');
    downloadBlob(blob, `arbol_genealogico_${stamp}.png`);
    toast('PNG exportado');
  } catch (err) { toast('No se pudo exportar: ' + err.message, 'error'); }
}
