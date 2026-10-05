// Кабинет мастера — схема помещения в выборе работы: план и развёртки,
// на которых подсвечено, где будет выполняться выбранная работа.
// Подключается из calc.html после calc-rooms.js; порядок подключения важен.

/* ===================== СХЕМА В ВЫБОРЕ РАБОТЫ ===================== */
// Мастер выбрал работу и смотрит, что считать: стены, потолок, откосы…
// Над вариантами — чертёж помещения (вид сверху или развёртка стены),
// и выбранный вариант подсвечивается на нём оранжевым.

let wpView = { room: 0, mode: 'plan', wall: 0 };
let wpHl = null; // ключ поверхности, которая сейчас подсвечена

const WP_HL = '#ff8a00';
const WP_HL_FILL = 'rgba(255,138,0,.28)';

// Что подсвечивать: стены/потолок/пол/проёмы/углы/лепнина…
const WP_KIND = {
walls: 'walls', wallsMinus: 'wallsMinus', parts: 'parts', partStrips: 'partStrips', tileWalls: 'tileWalls',
ceiling: 'ceiling', ceilingNet: 'ceilingNet', tileFloor: 'floor', tileAll: 'tileAll',
ceilNiche: 'ceilEls:niche', ceilBox: 'ceilEls:box', ceilFin: 'ceilEls', ceilFinArea: 'ceilEls', ceilLight: 'ceilEls:light',
radFin: 'rad', radFinArea: 'rad', slopes: 'slopes', narrow: 'narrow',
corners: 'corners', cornersOut: 'corners:out', cornersIn: 'corners:in',
molCornice: 'cornice', molPlinth: 'plinth', molCeil: 'molCeil', molWall: 'molWall',
};

function wpRoomGeo(m) {
let g = null;
try { g = rulerGeometry(m); } catch (e) { g = null; }
return g && g.segs.length ? g : null;
}

// Стены, где плитка: по выбору во вкладке «Плитка» (пусто — все)
function wpTileWalls(m) {
const t = typeof tileGet === 'function' ? tileGet(m).walls : null;
if (!t || !t.on) return [];
return typeof molWalls === 'function' ? molWalls(t.walls, m) : (m.walls || []).map((w, i) => i);
}

// Есть ли на стене i что подсветить — чтобы развёртка сама переходила на нужную стену
function wpWallHas(m, i, key) {
const kind = WP_KIND[key] || '';
const L = mNum((m.walls || [])[i]);
if (!(L > 0)) return false;
if (kind === 'walls' || kind === 'wallsMinus') return L >= 1;
if (kind === 'tileWalls' || kind === 'tileAll') return wpTileWalls(m).includes(i) || kind === 'tileAll';
if (kind === 'narrow') return L < 1;
if (kind === 'parts') return partsCompute(m).some(e => e.wall === i);
if (kind === 'partStrips') return partStripsCompute(m, partsCompute(m)).list.some(x => x.wall === i);
if (kind === 'slopes') return (m.openings || []).some(o => o.wall === i && o.slopes !== false && openingWidth(o) > 0);
if (kind === 'rad') return radNichesCompute(m).list.some(e => e.wall === i);
if (kind === 'molWall') return typeof molWallLayout === 'function' && (molWallLayout(m, i).frames.length || molWallLayout(m, i).lines.length) > 0;
if (kind.startsWith('ceilEls')) { const r = computeMeasure(m); return (r.ceilEls || []).some(e => e.strips.some(p => p.q && p.q.i === i)); }
if (kind === 'cornice' || kind === 'plinth') { const md = molGet(m); const k = kind === 'cornice' ? md.cornice : md.plinth; return k.on && molWalls(k.walls, m).includes(i); }
return true;
}

/* ---------- вид сверху ---------- */
function wpPlanSvg(m, key) {
const g = wpRoomGeo(m);
const W = 320, H = 210, P = 26;
if (!g || !g.closed) {
return `<svg viewBox="0 0 ${W} 80" width="100%"><text x="${W / 2}" y="44" text-anchor="middle" font-size="13" fill="#586270">${g ? 'Контур помещения не замкнут — смотрите развёртки' : 'Нет чертежа: стены не введены по отдельности'}</text></svg>`;
}
const kind = WP_KIND[key] || '';
const r = computeMeasure(m);
const xs = [0, ...g.segs.map(s => s.x2)], ys = [0, ...g.segs.map(s => s.y2)];
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
const k = Math.min((W - 2 * P) / Math.max(maxX - minX, 0.5), (H - 2 * P) / Math.max(maxY - minY, 0.5));
const ox = (W - (maxX - minX) * k) / 2 - minX * k, oy = (H - (maxY - minY) * k) / 2 - minY * k;
const X = v => ox + v * k, Y = v => oy + v * k;
const o = g.orient || 1;
const pts = [[0, 0], ...g.segs.map(s => [s.x2, s.y2])];
const poly = `M${pts.map(p => `${X(p[0])} ${Y(p[1])}`).join('L')}Z`;
const line = (s, a, b, d, col, w, dash = '') => {
const nx = -s.dy * o, ny = s.dx * o;
return `<path d="M${X(s.x1 + s.dx * a) + nx * d} ${Y(s.y1 + s.dy * a) + ny * d}L${X(s.x1 + s.dx * b) + nx * d} ${Y(s.y1 + s.dy * b) + ny * d}" stroke="${col}" stroke-width="${w}" stroke-linecap="butt"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
};
const opSpans = i => (m.openings || []).filter(op => op.wall === i && openingWidth(op) > 0).map(op => openingSpan(op, g.segs[i].len)).sort((a, b) => a[0] - b[0]);
// отрезки стены без проёмов (и без вычитаемых кусков)
const free = (i, extra = []) => {
const L = g.segs[i].len, cuts = [...opSpans(i), ...extra].sort((a, b) => a[0] - b[0]);
const out = []; let x = 0;
cuts.forEach(([a, b]) => { if (a > x + 0.005) out.push([x, a]); x = Math.max(x, b); });
if (L > x + 0.005) out.push([x, L]);
return out;
};
let base = '', hl = '';
const floorHl = kind === 'ceiling' || kind === 'ceilingNet' || kind === 'floor' || kind === 'tileAll';
base += `<path d="${poly}" fill="${floorHl ? WP_HL_FILL : '#f6f7f9'}"/>`;
// ниши и короба потолка
(r.ceilEls || []).forEach(e => e.strips.forEach(p => {
const on = kind === 'ceilEls' || kind === 'ceilEls:' + e.type || (kind === 'ceilEls:light' && e.light);
base += `<path d="M${p.poly.map(([x, y]) => `${X(x)} ${Y(y)}`).join('L')}Z" fill="${on ? WP_HL_FILL : kind === 'ceilingNet' ? '#ffffff' : '#e8ecf2'}" stroke="${on ? WP_HL : '#9aa3ad'}" stroke-width="${on ? 1.6 : 0.8}" stroke-dasharray="4 2"/>`;
}));
// рамки молдингов на потолке
if (kind === 'molCeil' && typeof moldingCompute === 'function') {
moldingCompute(m).ceil.forEach(f => [f.poly, f.inner].forEach(pp => {
if (pp) hl += `<path d="M${pp.pts.map(([x, y]) => `${X(x)} ${Y(y)}`).join('L')}Z" fill="none" stroke="${WP_HL}" stroke-width="2.4"/>`;
}));
}
// стены
g.segs.forEach(s => { base += `<path d="M${X(s.x1)} ${Y(s.y1)}L${X(s.x2)} ${Y(s.y2)}" stroke="#14181f" stroke-width="4" stroke-linecap="square"/>`; });
// проёмы — разрыв в стене
(m.openings || []).forEach(op => {
const s = g.segs[op.wall];
if (typeof op.wall !== 'number' || !s) return;
const [a0, a1] = openingSpan(op, s.len);
base += line(s, a0, a1, 0, '#ffffff', 5) + line(s, a0, a1, 0, op.type === 'door' ? '#c9a227' : '#4a7fc1', 1.4);
});
// подсветка вдоль стен
const tw = wpTileWalls(m);
// мебель на плане: контур шкафа с глубиной (или полоса вдоль стены), бока — полосой
const cov = typeof coversCompute === 'function' ? coversCompute(m) : { list: [], pieces: [], narrowCut: {} };
const narrowHidden = i => (cov.narrowCut[i] || 0) >= (wallHeightOf(m, i) || 0) - 0.005;
cov.list.filter(e => e.span && g.segs[e.wall]).forEach(e => {
const s = g.segs[e.wall], nx = -s.dy * o, ny = s.dx * o, d = e.d > 0 ? e.d : 0.12;
const P = (a, t) => `${X(s.x1 + s.dx * a + nx * t)} ${Y(s.y1 + s.dy * a + ny * t)}`;
const t0 = 2.5 / k;
base += `<path d="M${P(e.span[0], t0)}L${P(e.span[1], t0)}L${P(e.span[1], d)}L${P(e.span[0], d)}Z" fill="#dfe3e8" stroke="#8a939d" stroke-width="1"/>`;
});
const coverCuts = i => (typeof coversCompute === 'function' ? coversCompute(m).pieces : []).filter(p => p.wall === i && !p.narrow && p.toCeil && p.bottom < 0.005).map(p => p.span);
g.segs.forEach((s, i) => {
if (!(s.len > 0)) return;
const narrow = s.len < 1;
if ((kind === 'walls' || kind === 'wallsMinus') && !narrow) {
const parts = kind === 'wallsMinus' ? partsCompute(m).filter(e => e.wall === i && e.span).map(e => e.span) : [];
free(i, [...coverCuts(i), ...parts]).forEach(([a, b]) => { hl += line(s, a, b, 5, WP_HL, 5); });
}
if ((kind === 'tileWalls' || kind === 'tileAll') && tw.includes(i)) free(i).forEach(([a, b]) => { hl += line(s, a, b, 5, WP_HL, 5); });
if (kind === 'narrow' && narrow && !narrowHidden(i)) hl += line(s, 0, s.len, 5, WP_HL, 6);
if (kind === 'parts') partsCompute(m).filter(e => e.wall === i && e.span).forEach(e => { hl += line(s, e.span[0], e.span[1], 5, WP_HL, 5); });
if (kind === 'partStrips') partStripsCompute(m, partsCompute(m)).list.filter(x => x.wall === i).forEach(x => { const sp = x.where === 'у угла Б' ? [x.e.span[1], x.e.span[1] + x.gap] : (x.where === 'снизу' || x.where === 'сверху') ? x.e.span : [x.e.span[0] - x.gap, x.e.span[0]]; hl += line(s, sp[0], sp[1], 5, WP_HL, 5); });
if (kind === 'rad') radNichesCompute(m).list.filter(e => e.wall === i && e.span).forEach(e => { hl += line(s, e.span[0], e.span[1], 5, WP_HL, 6); });
if (kind === 'molWall' && wpWallHas(m, i, 'molWall')) hl += line(s, 0, s.len, 5, WP_HL, 3, '6 3');
});
// откосы — проёмы
if (kind === 'slopes') (m.openings || []).forEach(op => {
const s = g.segs[op.wall];
if (typeof op.wall !== 'number' || !s || op.slopes === false) return;
const [a0, a1] = openingSpan(op, s.len);
hl += line(s, a0, a1, 0, WP_HL, 9);
});
// карниз и плинтус — линией вдоль стен
if (kind === 'cornice' || kind === 'plinth') {
const md = molGet(m), kd = kind === 'cornice' ? md.cornice : md.plinth;
if (kd.on) molWalls(kd.walls, m).forEach(i => {
const s = g.segs[i]; if (!s || !(s.len > 0)) return;
if (kind === 'cornice') { molCorniceSpans(m, i, s.len).forEach(([a, b]) => { hl += line(s, a, b, 6, WP_HL, 3.5); }); return; }
let x = 0;
molPlinthGaps(m, i, s.len).sort((a, b) => a[0] - b[0]).forEach(([a0, a1]) => { if (a0 > x) hl += line(s, x, a0, 6, WP_HL, 3.5); x = Math.max(x, a1); });
if (s.len > x) hl += line(s, x, s.len, 6, WP_HL, 3.5);
});
}
// углы
if (kind.startsWith('corners')) {
const want = kind.split(':')[1];
// углы, которые считаются: отмеченные и не спрятанные за мебелью
(r.cornerItems || []).filter(it => it.group === 'walls' && it.on && it.pieces.length && (!want || it.kind === want)).forEach(it => {
const q = g.segs[it.wall];
if (q) hl += `<circle cx="${X(q.x2)}" cy="${Y(q.y2)}" r="6" fill="${WP_HL}" stroke="#ffffff" stroke-width="1.5"/>`;
});
}
// номера стен
let nums = '';
g.segs.forEach(s => {
const nx = -s.dy * o, ny = s.dx * o;
const mx = (X(s.x1) + X(s.x2)) / 2 + nx * 15, my = (Y(s.y1) + Y(s.y2)) / 2 + ny * 15;
nums += `<circle cx="${mx}" cy="${my}" r="8" fill="#ffffff" stroke="#14181f" stroke-width="1"/><text x="${mx}" y="${my + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="#14181f">${s.i + 1}</text>`;
});
return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="План помещения" font-family="inherit">${base}${hl}${nums}</svg>`;
}

/* ---------- развёртка стены ---------- */
function wpElevSvg(m, i, key) {
const W = 320, H = 200;
const L = mNum((m.walls || [])[i]), Hh = wallHeightOf(m, i);
if (!(L > 0) || !(Hh > 0)) return `<svg viewBox="0 0 ${W} 80" width="100%"><text x="${W / 2}" y="44" text-anchor="middle" font-size="13" fill="#586270">Нет длины или высоты стены ${i + 1}</text></svg>`;
const kind = WP_KIND[key] || '';
const left = 30, right = 14, top = 18, bottom = 30;
const k = Math.min((W - left - right) / L, (H - top - bottom) / Hh);
const x0 = left + ((W - left - right) - L * k) / 2, yF = top + Hh * k;
const g = wpRoomGeo(m);
const flip = !!g && (g.orient || 1) < 0;
const XA = a => flip ? x0 + (L - a) * k : x0 + a * k;
const Yh = h => yF - h * k;
const rect = (a0, a1, b0, b1, fill, stroke = 'none', sw = 0, dash = '') => {
const xl = Math.min(XA(a0), XA(a1)), w = Math.abs(XA(a1) - XA(a0));
return `<rect x="${xl}" y="${Yh(b1)}" width="${w}" height="${(b1 - b0) * k}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
};
let s = '';
const wallHl = ((kind === 'walls' || kind === 'wallsMinus') && L >= 1) || (kind === 'narrow' && L < 1) || ((kind === 'tileWalls' || kind === 'tileAll') && wpTileWalls(m).includes(i));
const tileH = (kind === 'tileWalls' || kind === 'tileAll') && typeof tileWallH === 'function' ? tileWallH(m, tileGet(m).walls, i) : Hh;
s += `<rect x="${x0}" y="${Yh(Hh)}" width="${L * k}" height="${Hh * k}" fill="#ffffff" stroke="#14181f" stroke-width="1.4"/>`;
if (wallHl) s += rect(0, L, 0, Math.min(Hh, tileH || Hh), WP_HL_FILL);
// участки стен
partsCompute(m).filter(e => e.wall === i && e.span).forEach(e => {
const on = kind === 'parts';
s += rect(e.span[0], e.span[1], e.bottom, e.top, on ? WP_HL_FILL : kind === 'wallsMinus' ? '#ffffff' : 'none', on ? WP_HL : '#2f6fc0', on ? 1.8 : 1, '5 3');
});
// узкие полосы у участков: подсвечены сами или (для «стены − участки») вырезаны
if (kind === 'partStrips' || kind === 'wallsMinus') partStripsCompute(m, partsCompute(m)).list.filter(x => x.wall === i).forEach(x => {
const e = x.e;
const r0 = x.where === 'снизу' ? [e.span[0], e.span[1], e.bottom - x.gap, e.bottom] : x.where === 'сверху' ? [e.span[0], e.span[1], e.top, e.top + x.gap] : x.where === 'у угла Б' ? [e.span[1], e.span[1] + x.gap, e.bottom, e.top] : [e.span[0] - x.gap, e.span[0], e.bottom, e.top];
s += rect(r0[0], r0[1], r0[2], r0[3], kind === 'partStrips' ? WP_HL_FILL : '#ffffff', kind === 'partStrips' ? WP_HL : 'none', kind === 'partStrips' ? 1.8 : 0);
});
// мебель — штриховкой, не обрабатывается
(typeof coversCompute === 'function' ? coversCompute(m).pieces : []).filter(p => p.wall === i).forEach(p => {
s += rect(p.span[0], p.span[1], p.bottom, p.top, '#e4e7eb', '#8a939d', 1);
});
// ниши
radNichesCompute(m).list.filter(e => e.wall === i && e.span).forEach(e => {
const on = kind === 'rad';
s += rect(e.span[0], e.span[1], e.bottom, e.top, on ? WP_HL_FILL : '#f1ece4', on ? WP_HL : '#8a6d3b', on ? 2.2 : 1, '4 2');
});
// рамки и линии молдингов
if (typeof molWallLayout === 'function') {
const lay = molWallLayout(m, i), on = kind === 'molWall';
lay.frames.forEach(f => [f, f.inner].filter(Boolean).forEach(q => { s += rect(q.x0, q.x1, q.y0, q.y1, 'none', on ? WP_HL : '#b9a6cc', on ? 2.2 : 0.8); }));
lay.lines.forEach(l => { s += `<path d="M${XA(l.x0)} ${Yh(l.y)}H${XA(l.x1)}" stroke="${on ? WP_HL : '#b9a6cc'}" stroke-width="${on ? 2.2 : 0.8}"/>`; });
}
// проёмы
(m.openings || []).filter(o => o.wall === i && openingWidth(o) > 0).forEach(o => {
const [a0, a1] = openingSpan(o, L);
const v = openingVert(o, Hh);
const col = '#14181f', sw = 1.2;
let bp = null;
if (o.type === 'balcony') {
bp = balconyParts(o, a0, a1);
s += rect(bp.door[0], bp.door[1], 0, v.door[1], '#fff7dc', col, sw) + rect(bp.win[0], bp.win[1], v.y0, v.y1, '#eef4ff', col, sw);
} else s += rect(a0, a1, v.y0, v.y1, o.type === 'door' ? '#fff7dc' : '#eef4ff', col, sw);
// откосы — только отмеченные стороны
if (kind === 'slopes' && o.slopes !== false && typeof slopeSides === 'function') {
const vl = (a, y0, y1) => `<path d="M${XA(a)} ${Yh(y0)}V${Yh(y1)}" stroke="${WP_HL}" stroke-width="5"/>`;
const hz = (x0, x1, y) => `<path d="M${XA(x0)} ${Yh(y)}H${XA(x1)}" stroke="${WP_HL}" stroke-width="5"/>`;
slopeSides(m, o).filter(x => x.on).forEach(x => {
if (bp) {
const doorAtA = o.side !== 'end';
const dOuter = doorAtA ? bp.door[0] : bp.door[1], wOuter = doorAtA ? bp.win[1] : bp.win[0], mid = doorAtA ? bp.door[1] : bp.door[0];
if (x.key === 'door') s += vl(dOuter, 0, v.door[1]);
if (x.key === 'win') s += vl(wOuter, v.y0, v.y1);
if (x.key === 'under') s += vl(mid, 0, v.y0);
if (x.key === 'top') s += hz(a0, a1, Math.max(v.y1, v.door[1]));
} else {
if (x.key === 'a') s += vl(a0, v.y0, v.y1);
if (x.key === 'b') s += vl(a1, v.y0, v.y1);
if (x.key === 'top') s += hz(a0, a1, v.y1);
if (x.key === 'sill') s += hz(a0, a1, v.y0);
}
});
}
});
// потолок, пол, карниз, плинтус
const band = (y0, y1) => rect(0, L, y0, y1, WP_HL);
if (kind === 'ceiling' || kind === 'ceilingNet') s += `<path d="M${x0} ${Yh(Hh)}h${L * k}" stroke="${WP_HL}" stroke-width="5"/>`;
if (kind === 'floor' || kind === 'tileAll') s += `<path d="M${x0} ${yF}h${L * k}" stroke="${WP_HL}" stroke-width="5"/>`;
if (kind.startsWith('ceilEls')) {
const r = computeMeasure(m);
(r.ceilEls || []).forEach(e => {
const on = kind === 'ceilEls' || kind === 'ceilEls:' + e.type || (kind === 'ceilEls:light' && e.light);
if (!on) return;
e.strips.filter(p => p.q && p.q.i === i).forEach(p => { const sp = p.span || [0, L]; s += rect(sp[0], sp[1], Math.max(0, Hh - (e.h || 0.1)), Hh, WP_HL_FILL, WP_HL, 1.6); });
});
}
if (kind === 'cornice' || kind === 'plinth') {
const md = molGet(m), kd = kind === 'cornice' ? md.cornice : md.plinth;
if (kd.on && molWalls(kd.walls, m).includes(i)) {
if (kind === 'cornice') molCorniceSpans(m, i, L).forEach(([a, b]) => { s += rect(a, b, Hh - 0.08, Hh, WP_HL); });
else {
let x = 0;
molPlinthGaps(m, i, L).sort((a, b) => a[0] - b[0]).forEach(([a0, a1]) => { if (a0 > x) s += rect(x, a0, 0, 0.08, WP_HL); x = Math.max(x, a1); });
if (L > x) s += rect(x, L, 0, 0.08, WP_HL);
}
}
}
// углы — вертикальные рёбра по краям стены (кроме выключенных и спрятанных за мебелью)
if (kind.startsWith('corners') && g) {
const want = kind.split(':')[1], n = g.segs.length;
const items = computeMeasure(m).cornerItems || [];
const at = w => items.find(it => it.group === 'walls' && it.wall === w);
[[0, at((i - 1 + n) % n)], [L, at(i)]].forEach(([a, it]) => {
if (!it || !it.on || !it.pieces.length || (want && want !== it.kind)) return;
s += `<path d="M${XA(a)} ${yF}V${Yh(Math.min(Hh, it.pieces[0]))}" stroke="${WP_HL}" stroke-width="5"/>`;
});
}
s += `<path d="M${x0 - 6} ${yF}H${x0 + L * k + 6}" stroke="#14181f" stroke-width="3"/>`;
// углы А и Б, длина и высота
[[0, 'А'], [L, 'Б']].forEach(([a, t]) => { s += `<text x="${XA(a)}" y="${Yh(Hh) - 6}" text-anchor="middle" font-size="10" font-weight="700" fill="#586270">${t}</text>`; });
s += `<text x="${x0 + L * k / 2}" y="${yF + 18}" text-anchor="middle" font-size="12" font-weight="700" fill="#14181f">${mFmt(L)} м</text>`;
s += `<text x="${x0 - 8}" y="${(yF + Yh(Hh)) / 2}" text-anchor="middle" font-size="11" fill="#14181f" transform="rotate(-90 ${x0 - 8} ${(yF + Yh(Hh)) / 2})">${mFmt(Hh)}</text>`;
return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Развёртка стены ${i + 1}" font-family="inherit">${s}</svg>`;
}

/* ---------- блок в выборе работы ---------- */
function wpViewHtml(rooms) {
if (!rooms.length) return '';
if (wpView.room >= rooms.length) wpView.room = 0;
const room = rooms[wpView.room];
const m = room.measure || {};
const n = (m.walls || []).length;
if (wpView.wall >= n) wpView.wall = 0;
const tabs = rooms.length > 1 ? `<div class="wpv-rooms">${rooms.map((r, j) => `<button type="button" class="chip${j === wpView.room ? ' active' : ''}" onclick="wpSetRoom(${j})">${escapeHtml(roomName(r))}</button>`).join('')}</div>` : '';
const label = wpHl ? (SURFACES.find(s => s.key === wpHl) || {}).label || '' : '';
return `<div class="wpv">
${tabs}
<div class="wpv-bar">
<div class="rl-view wpv-mode" role="group" aria-label="Вид">
<button type="button" class="${wpView.mode === 'plan' ? 'on' : ''}" onclick="wpSetMode('plan')">План</button>
<button type="button" class="${wpView.mode === 'elev' ? 'on' : ''}" onclick="wpSetMode('elev')">Развёртки</button>
</div>
</div>
${wpView.mode === 'elev' && n ? `<div class="rl-elev-nav wpv-nav"><button type="button" onclick="wpStepWall(-1)" aria-label="Предыдущая стена">‹</button><span>Стена ${wpView.wall + 1} из ${n}</span><button type="button" onclick="wpStepWall(1)" aria-label="Следующая стена">›</button></div>` : ''}
<div class="wpv-svg">${wpView.mode === 'elev' ? wpElevSvg(m, wpView.wall, wpHl) : wpPlanSvg(m, wpHl)}</div>
<div class="wpv-legend">${label ? `<span class="wpv-dot"></span>Подсвечено: <b>${escapeHtml(label)}</b>` : 'Выберите, что считаем, — место подсветится на чертеже'}</div>
</div>`;
}
function wpRefreshView() {
const box = document.getElementById('wpViewBox');
if (box) box.innerHTML = wpViewHtml(pickedRooms());
document.querySelectorAll('#wpBody .wp-surface[data-surf]').forEach(b => b.classList.toggle('hl', b.dataset.surf === wpHl));
}
function wpSetRoom(j) { wpView.room = j; wpView.wall = 0; wpJumpToHl(); wpRefreshView(); }
function wpSetMode(mode) { wpView.mode = mode; wpJumpToHl(); wpRefreshView(); }
function wpStepWall(d) {
const rooms = pickedRooms(), room = rooms[wpView.room];
const n = room ? (room.measure.walls || []).length : 0;
if (!n) return;
wpView.wall = (wpView.wall + d + n) % n;
wpRefreshView();
}
// На развёртке — перейти к стене, где есть подсвеченное (если на текущей нет)
function wpJumpToHl() {
if (wpView.mode !== 'elev' || !wpHl) return;
const room = pickedRooms()[wpView.room];
if (!room) return;
const m = room.measure, n = (m.walls || []).length;
if (wpWallHas(m, wpView.wall, wpHl)) return;
for (let j = 0; j < n; j++) if (wpWallHas(m, j, wpHl)) { wpView.wall = j; return; }
}
function wpSetHl(key) {
wpHl = key;
wpJumpToHl();
wpRefreshView();
}
