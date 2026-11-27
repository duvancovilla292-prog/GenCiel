// ===== exporter.js · Exportar el árbol como imagen (SVG vectorial o PNG) =====
// Se construye un SVG autónomo a partir del MODELO (no del DOM), así el resultado no depende del zoom ni de lo que
// esté en pantalla. Respeta el foco familiar activo (exporta solo lo visible). Los avatares se incrustan como
// data-URI; si una imagen remota no permite CORS se sustituye por el avatar genérico.

import { themeColors, PLACEHOLDER, UNION_LABEL, UNION_GLYPH } from './config.js';
import { state, nodeMap, toast, downloadBlob, outPt, inPt, bezier, isPartnerLink, nodeTitle, lifeLabel, initials, nodeRect } from './state.js';
import { isVisible } from './render.js';
import { reindex } from './model.js';

const PAD = 60, MAX_PX = 8192, FONT = "'Open Sans', 'Segoe UI', system-ui, sans-serif";
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const DASH = { adopted: '9 6', stepchild: '1 7' };

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
  const C = themeColors();
  const nodes = state.graph.nodes.filter(n => isVisible(n.id));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) { const r = nodeRect(n); x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1); y0 = Math.min(y0, r.y0); y1 = Math.max(y1, r.y1); }
  x0 -= PAD; y0 -= PAD; x1 += PAD; y1 += PAD;
  const W = Math.ceil(x1 - x0), H = Math.ceil(y1 - y0);
  const imgs = new Map(await Promise.all(nodes.filter(n => n.type === 'person' && (n.data.img || '').trim()).map(async n => [n.id, await toDataUrl(n.data.img.trim())])));

  let edgesSvg = '';
  for (const e of state.graph.edges) {
    const s = nodeMap.get(e.source), t = nodeMap.get(e.target);
    if (!s || !t || !isVisible(s.id) || !isVisible(t.id)) continue;
    const partner = isPartnerLink(s.type, t.type), rel = partner ? null : (e.relationType || 'blood');
    const u = s.type === 'union' ? s : t.type === 'union' ? t : null, ended = u && (u.data.status || 'active') !== 'active';
    const stroke = ended ? C.ended : partner ? C.union : C.rel[rel];
    const dash = partner ? (ended ? '7 6' : '') : (DASH[rel] || '');
    edgesSvg += `<path d="${bezier(outPt(s), inPt(t))}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  }

  let nodesSvg = '', defs = `<pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1.1" fill="${C.dot}"/></pattern>`;
  nodes.forEach((n, i) => {
    const { x, y } = n.position;
    if (n.type === 'person') {
      const gc = C.gender[n.data.gender] || C.dim, dead = !!n.data.deathDate;
      const name = nodeTitle(n), shown = name.length > 24 ? name.slice(0, 23) + '…' : name;
      defs += `<clipPath id="c${i}"><circle cx="${x}" cy="${y}" r="30"/></clipPath>`;
      const avatar = imgs.has(n.id)
        ? `<image href="${esc(imgs.get(n.id))}" x="${x - 30}" y="${y - 30}" width="60" height="60" clip-path="url(#c${i})" preserveAspectRatio="xMidYMid slice"${dead ? ' style="filter:grayscale(1)"' : ''}/>`
        : `<circle cx="${x}" cy="${y}" r="30" fill="${gc}"/><text x="${x}" y="${y + 7}" text-anchor="middle" fill="#fff" font-family="${FONT}" font-size="20" font-weight="700">${esc(initials(n.data))}</text>`;
      nodesSvg += `<g${dead ? ' opacity=".85"' : ''}>
<rect x="${x - 46}" y="${y - 46}" width="92" height="92" rx="16" fill="${C.surface}" stroke="${C.border}" stroke-width="2"/>
${avatar}<circle cx="${x}" cy="${y}" r="30" fill="none" stroke="${gc}" stroke-width="2.5"/>
${dead ? `<text x="${x + 34}" y="${y - 28}" text-anchor="middle" fill="${C.dim}" font-family="${FONT}" font-size="13">✝</text>` : ''}
<text x="${x}" y="${y + 66}" text-anchor="middle" fill="${C.text}" font-family="${FONT}" font-size="14" font-weight="700">${esc(shown)}</text>
<text x="${x}" y="${y + 84}" text-anchor="middle" fill="${C.dim}" font-family="${FONT}" font-size="11.5">${esc(lifeLabel(n.data))}</text></g>`;
    } else {
      const st = n.data.status || 'active', col = st === 'divorced' ? C.danger : st === 'separated' ? C.ended : C.union, label = UNION_LABEL[st] || '';
      nodesSvg += `<g><circle cx="${x}" cy="${y}" r="18" fill="${C.surface}" stroke="${col}" stroke-width="2.5"${st === 'separated' ? ' stroke-dasharray="3 2"' : ''}/>
<text x="${x}" y="${y + 5}" text-anchor="middle" fill="${col}" font-family="${FONT}" font-size="15" font-weight="700">${esc(UNION_GLYPH[st] || '♥')}</text>
${label ? `<text x="${x}" y="${y + 36}" text-anchor="middle" fill="${C.dim}" font-family="${FONT}" font-size="11">${esc(label)}</text>` : ''}</g>`;
    }
  });

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${x0} ${y0} ${W} ${H}">
<defs>${defs}</defs><rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="${C.bg}"/><rect x="${x0}" y="${y0}" width="${W}" height="${H}" fill="url(#dots)"/>
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
      downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `genciel_${stamp}.svg`);
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
    downloadBlob(blob, `genciel_${stamp}.png`);
    toast('PNG exportado');
  } catch (err) { toast('No se pudo exportar: ' + err.message, 'error'); }
}
