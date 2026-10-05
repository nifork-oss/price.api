// Кабинет мастера — лепнина: карнизы, плинтус, молдинги на потолке и на стенах.
// Подключается из calc.html после calc-ruler.js; порядок подключения важен.

/* ===================== ЛЕПНИНА ===================== */
// В замере: measure.molding = {
//   cornice: { on, walls: [номера] | null (все), plank },   — потолочный карниз
//   plinth:  { on, walls, plank },                           — плинтус, без дверей
//   ceil:    [{ d, dbl, ind }],                              — рамки на потолке с отступом d от стен
//   wall:    [{ type: 'frames', walls, yb, yt, gap, fw,      — ряд рамок на развёртках
//              dbl, ind } |                                  — двойные: внутренняя рамка с отступом ind

//             { type: 'line', walls, y }]                    — горизонтальная линия
// }
// Всё считается в погонных метрах по фактической длине.

let molElevWall = 0;          // какая стена на развёртке вкладки
let measureMolPick = 'molCornice';

function molGet(m) {
const d = m && m.molding && typeof m.molding === 'object' ? m.molding : {};
return {
cornice: d.cornice || { on: false, walls: null, plank: '' },
plinth: d.plinth || { on: false, walls: null, plank: '' },
ceil: Array.isArray(d.ceil) ? d.ceil : [],
wall: Array.isArray(d.wall) ? d.wall : []
};
}
// для правки: структура в замере создаётся при первом обращении
function molEnsure() {
const d = molGet(measure);
measure.molding = { cornice: d.cornice, plinth: d.plinth, ceil: d.ceil, wall: d.wall };
return measure.molding;
}

function molGeom(m) {
try { return typeof rulerGeometry === 'function' && Array.isArray(m.walls) && m.walls.length ? rulerGeometry(m) : null; } catch (e) { return null; }
}
const molWallLens = m => (Array.isArray(m.walls) ? m.walls : []).map(mNum);
// выбранные стены: null — все, у которых есть длина
function molWalls(sel, m) {
const lens = molWallLens(m);
const all = lens.map((v, i) => (v > 0 ? i : -1)).filter(i => i >= 0);
if (!sel || !Array.isArray(sel)) return all;
return [...new Set(sel)].filter(i => all.includes(i)).sort((a, b) => a - b);
}

// углы между соседними выбранными стенами: внутренние и наружные
// at(i, j) — есть ли карниз/плинтус у самого угла (не спрятан за мебелью)
function molCorners(g, walls, at) {
const res = { in: 0, out: 0 };
if (!g) return res;
const set = new Set(walls), n = g.segs.length, o = g.orient || 1;
g.segs.forEach((q, i) => {
const j = i + 1 < n ? i + 1 : (g.closed ? 0 : -1);
if (j < 0 || !set.has(i) || !set.has(j)) return;
if (at && !at(i, j)) return;
const q2 = g.segs[j];
const c = q.dx * q2.dy - q.dy * q2.dx;
if (Math.abs(c) < 0.02) return;
if (c * o > 0) res.in++; else res.out++;
});
return res;
}

// двери на стене: [начало, конец] вдоль стены (у балконного блока — дверная часть)
function molDoorSpans(m, wi, L) {
return (m.openings || []).filter(o => o.wall === wi && (o.type === 'door' || o.type === 'balcony') && openingWidth(o) > 0).map(o => {
const [a0, a1] = openingSpan(o, L);
return o.type === 'balcony' ? balconyParts(o, a0, a1).door : [a0, a1];
});
}

// Мебель на стене: куски, которые стоят на полу (там нет плинтуса)
// или доходят до потолка (там нет карниза)
function molCoverSpans(m, wi, kind) {
if (typeof coversCompute !== 'function') return [];
return coversCompute(m).pieces.filter(p => p.wall === wi && (kind === 'floor' ? p.bottom < 0.005 : p.toCeil)).map(p => p.span);
}
// где плинтуса нет: двери и мебель на полу
function molPlinthGaps(m, wi, L) { return [...molDoorSpans(m, wi, L), ...molCoverSpans(m, wi, 'floor')]; }
// свободные куски стены [0, L] за вычетом промежутков
function molFreeSpans(L, gaps) {
const out = []; let x = 0;
[...gaps].sort((a, b) => a[0] - b[0]).forEach(([a, b]) => { if (a - x > 0.005) out.push([x, a]); x = Math.max(x, b); });
if (L - x > 0.005) out.push([x, L]);
return out;
}
// угол между стенами i и j открыт: у конца стены i и у начала стены j нет мебели
function molCoverCornerOpen(m, lens, kind) {
return (i, j) => !molCoverSpans(m, i, kind).some(sp => sp[1] >= lens[i] - 0.005) && !molCoverSpans(m, j, kind).some(sp => sp[0] <= 0.005);
}
// карниз: стена без мебели до потолка
function molCorniceSpans(m, wi, L) { return molFreeSpans(L, molCoverSpans(m, wi, 'ceil')); }

// Рамка на потолке: контур комнаты, сдвинутый внутрь на d (углы — «на ус»)
function molOffsetPoly(g, d) {
if (!g || !g.closed || !(d > 0)) return null;
const n = g.segs.length, o = g.orient || 1;
const cross = (q1, q2) => {
const ax = q1.x1 - q1.dy * o * d, ay = q1.y1 + q1.dx * o * d;
const bx = q2.x1 - q2.dy * o * d, by = q2.y1 + q2.dx * o * d;
const det = q1.dx * q2.dy - q1.dy * q2.dx;
if (Math.abs(det) < 0.02) return [q2.x1 - q2.dy * o * d, q2.y1 + q2.dx * o * d];
const t = ((bx - ax) * q2.dy - (by - ay) * q2.dx) / det;
return [ax + q1.dx * t, ay + q1.dy * t];
};
const pts = g.segs.map((q, k) => cross(g.segs[(k - 1 + n) % n], q));
let len = 0;
const edges = [];
for (let k = 0; k < n; k++) {
const a = pts[k], b = pts[(k + 1) % n], q = g.segs[k];
const ex = b[0] - a[0], ey = b[1] - a[1];
if (ex * q.dx + ey * q.dy <= 0.001) return null;   // отступ больше, чем позволяет стена
const e = Math.hypot(ex, ey);
// стена на одной прямой со следующей — сторона рамки продолжается, не отдельный кусок
if (edges.length && Math.abs(g.segs[(k - 1 + n) % n].dx * q.dy - g.segs[(k - 1 + n) % n].dy * q.dx) < 0.02 && k > 0) edges[edges.length - 1] += e;
else edges.push(e);
len += e;
}
return { pts, len, edges };
}

// Двойная рамка: отступ внутренней рамки (0 — рамка одинарная)
const MOL_IND_DEF = '0,05';
const molInd = f => (f && f.dbl ? mNum(f.ind) : 0);
// стороны рамки на стене — каждая отдельный кусок; у двойной ещё четыре внутренние
const molFrameSides = f => [f, f.inner].filter(Boolean).flatMap(r => [r.x1 - r.x0, r.x1 - r.x0, r.y1 - r.y0, r.y1 - r.y0]);
const molFrameLen = f => molFrameSides(f).reduce((a, v) => a + minLen(v), 0);

// Раскладка молдингов на стене: рамки обходят проёмы и ниши, линии разрываются на них
function molWallLayout(m, wi) {
const L = mNum((m.walls || [])[wi]);
const Hh = wallHeightOf(m, wi);
const res = { L, Hh, frames: [], lines: [] };
if (!(L > 0) || !(Hh > 0)) return res;
const ops = (m.openings || []).filter(o => o.wall === wi && openingWidth(o) > 0).map(o => {
const [a0, a1] = openingSpan(o, L);
const v = openingVert(o, Hh);
return { a0, a1, y0: o.type === 'balcony' ? 0 : v.y0, y1: v.y1 };
});
// ниши в стенах — тоже препятствие: рамки обходят, линии разрываются
if (typeof radNichesCompute === 'function') radNichesCompute(m).list.filter(e => e.wall === wi && e.span).forEach(e => ops.push({ a0: e.span[0], a1: e.span[1], y0: e.bottom, y1: e.top }));
molGet(m).wall.forEach((row, ri) => {
if (!molWalls(row.walls, m).includes(wi)) return;
if (row.type === 'line') {
const y = mNum(row.y);
if (!(y > 0) || y >= Hh) return;
const cuts = ops.filter(o => o.y0 < y && o.y1 > y).map(o => [o.a0, o.a1]).sort((a, b) => a[0] - b[0]);
let x = 0;
cuts.forEach(([c0, c1]) => { if (c0 > x + 0.01) res.lines.push({ ri, x0: x, x1: c0, y }); x = Math.max(x, c1); });
if (L > x + 0.01) res.lines.push({ ri, x0: x, x1: L, y });
return;
}
const yb = mNum(row.yb), yt = Math.min(Hh, mNum(row.yt));
const gap = Math.max(0, evalMeasureExpr(row.gap) || 0);
const fw = mNum(row.fw);
const ind = molInd(row);
if (!(yt > yb)) return;
// свободные участки стены: от угла до угла за вычетом проёмов в этой полосе (с промежутком)
const blocks = ops.filter(o => o.y0 < yt && o.y1 > yb).map(o => [o.a0 - gap, o.a1 + gap]).sort((a, b) => a[0] - b[0]);
const free = [];
let x = gap;
blocks.forEach(([b0, b1]) => { if (b0 > x) free.push([x, b0]); x = Math.max(x, b1); });
if (L - gap > x) free.push([x, L - gap]);
free.forEach(([f0, f1]) => {
const s = f1 - f0;
if (s < 0.15) return;
let n = fw > 0 ? Math.max(1, Math.round((s + gap) / (fw + gap))) : 1;
let w = (s - gap * (n - 1)) / n;
while (n > 1 && w < 0.15) { n--; w = (s - gap * (n - 1)) / n; }
for (let k = 0; k < n; k++) {
const x0 = f0 + k * (w + gap);
const fr = { ri, x0, x1: x0 + w, y0: yb, y1: yt, gap };
// внутренняя рамка — если после отступа остаётся хотя бы 10 см
if (ind > 0) {
if (w - 2 * ind >= 0.1 && yt - yb - 2 * ind >= 0.1) fr.inner = { x0: x0 + ind, x1: x0 + w - ind, y0: yb + ind, y1: yt - ind };
else fr.innerBad = true;
}
res.frames.push(fr);
}
});
});
return res;
}

// Плинтус по стенам: куски между дверями и углами, обрывы (края дверей и концы
// у стен, где плинтус не продолжается) — заглушка или конверт.
// plinth.env = { on, skip: [ключи обрывов без конверта] }; ключ: 'd<проём>a|b' или 'w<стена>a|b'.
function molPlinthPlan(m, g, pl) {
const lens = molWallLens(m);
const walls = molWalls(pl.walls, m);
const set = new Set(walls);
const n = lens.length;
const res = { walls, pieces: [], ends: [], caps: [], env: [], looseW: 0 };
const nb = (i, step) => { const j = i + step; if (g && g.closed) return (j + n) % n; return j >= 0 && j < n ? j : -1; };
walls.forEach(i => {
const L = lens[i];
const doors = typeof openingSpan === 'function'
? (m.openings || []).map((o, oi) => ({ o, oi })).filter(({ o }) => o.wall === i && (o.type === 'door' || o.type === 'balcony') && openingWidth(o) > 0)
.map(({ o, oi }) => { const [a0, a1] = openingSpan(o, L); const sp = o.type === 'balcony' ? balconyParts(o, a0, a1).door : [a0, a1]; return { oi, code: opCode(o, oi), a0: sp[0], a1: sp[1] }; }).sort((a, b) => a.a0 - b.a0)
: [];
// за мебелью на полу плинтуса нет — он упирается в шкаф
molFreeSpans(L, [...doors.map(dr => [dr.a0, dr.a1]), ...molCoverSpans(m, i, 'floor')]).forEach(([a, b]) => res.pieces.push(b - a));
doors.forEach(dr => {
if (dr.a0 > 0.005) res.ends.push({ key: `d${dr.oi}a`, label: `${dr.code} к углу А`, door: dr.oi });
if (dr.a1 < L - 0.005) res.ends.push({ key: `d${dr.oi}b`, label: `${dr.code} к углу Б`, door: dr.oi });
});
// концы у стен: соседняя стена без плинтуса — обрыв
const pv = nb(i, -1), nx = nb(i, 1);
if (pv < 0 || !set.has(pv)) res.ends.push({ key: `w${i}a`, label: `стена ${i + 1}, угол А` });
if (nx < 0 || !set.has(nx)) res.ends.push({ key: `w${i}b`, label: `стена ${i + 1}, угол Б` });
});
// двери, не поставленные на стену, — вычитаем из общей длины, по две заглушки
const loose = (m.openings || []).filter(o => (o.type === 'door' || o.type === 'balcony') && typeof o.wall !== 'number');
res.looseW = walls.length ? loose.reduce((a, o) => a + (o.type === 'balcony' ? mNum(o.dw) : mNum(o.w)) * mCount(o.n), 0) : 0;
if (res.looseW > 0) { let left = res.looseW; for (let k = res.pieces.length - 1; k >= 0 && left > 0; k--) { const cut = Math.min(res.pieces[k], left); res.pieces[k] -= cut; left -= cut; } res.pieces = res.pieces.filter(v => v > 0.005); }
const looseEnds = walls.length ? loose.reduce((a, o) => a + 2 * Math.max(1, Math.round(mCount(o.n))), 0) : 0;
const env = pl.env && pl.env.on;
const skip = new Set(env && Array.isArray(pl.env.skip) ? pl.env.skip : []);
res.ends.forEach(e => { e.env = !!env && !skip.has(e.key); (e.env ? res.env : res.caps).push(e); });
for (let k = 0; k < looseEnds; k++) (env ? res.env : res.caps).push({ key: 'loose' + k, label: 'дверь без места' });
return res;
}

function moldingCompute(m) {
const d = molGet(m);
const g = molGeom(m);
const lens = molWallLens(m);
const out = { cornice: null, plinth: null, ceil: [], ceilLen: 0, wallLen: 0, wallParts: [], lines: {}, min: false };
const planks = (len, plank) => { const p = mNum(plank); return p > 0 && len > 0 ? Math.ceil(len * 1.1 / p) : 0; };
// куски: каждый короче метра — за 1 пог. м (как откосы и узкие)
const sumMin = list => list.reduce((a, v) => a + minLen(v), 0);
const txtMin = list => list.map(fmtMin).join(' + ');
const hasMin = list => list.some(v => v > 0 && v < 1);
if (d.cornice.on) {
const walls = molWalls(d.cornice.walls, m);
// за мебелью до потолка карниза нет
const pieces = [];
walls.forEach(i => molCorniceSpans(m, i, lens[i]).forEach(([a, b]) => pieces.push(b - a)));
const len = sumMin(pieces);
// угол за мебелью до потолка — без карниза
const c = molCorners(g, walls, molCoverCornerOpen(m, lens, 'ceil'));
if (hasMin(pieces)) out.min = true;
out.cornice = { walls, len, corners: c, planks: planks(pieces.reduce((a, v) => a + v, 0), d.cornice.plank) };
if (len > 0) out.lines.cornice = `Карниз: ${walls.length === lens.filter(v => v > 0).length ? 'по периметру' : 'стены ' + walls.map(i => i + 1).join(', ')} ${txtMin(pieces)} = ${mFmt(len)} пог. м${c.in || c.out ? ` · углы: внутр. ${c.in}, наруж. ${c.out}` : ''}${out.cornice.planks ? ` · планок по ${mFmt(mNum(d.cornice.plank))} м: ${out.cornice.planks} (+10%)` : ''}`;
}
if (d.plinth.on) {
const pl = molPlinthPlan(m, g, d.plinth);
const len = sumMin(pl.pieces) + pl.env.length;     // конверт — 1 пог. м
if (hasMin(pl.pieces)) out.min = true;
const c = molCorners(g, pl.walls, molCoverCornerOpen(m, lens, 'floor'));
out.plinth = { walls: pl.walls, len, caps: pl.caps.length, env: pl.env.length, ends: pl.ends, corners: c, planks: planks(pl.pieces.reduce((a, v) => a + v, 0), d.plinth.plank) };
if (len > 0) out.lines.plinth = `Плинтус: ${txtMin(pl.pieces)}${pl.looseW ? ` − ${mFmt(pl.looseW)} (двери без места на стене)` : ''}${pl.env.length ? ` + конверты ${pl.env.length} × 1` : ''} = ${mFmt(len)} пог. м${pl.caps.length ? ` · заглушек: ${pl.caps.length}` : ''}${c.in || c.out ? ` · углы: внутр. ${c.in}, наруж. ${c.out}` : ''}${out.plinth.planks ? ` · планок по ${mFmt(mNum(d.plinth.plank))} м: ${out.plinth.planks} (+10%)` : ''}`;
}
d.ceil.forEach((f, fi) => {
const dd = mNum(f.d);
const poly = molOffsetPoly(g, dd);
const ind = molInd(f);
const inner = poly && ind > 0 ? molOffsetPoly(g, dd + ind) : null;
const len = poly ? sumMin(poly.edges) + (inner ? sumMin(inner.edges) : 0) : 0;
if (poly && (hasMin(poly.edges) || (inner && hasMin(inner.edges)))) out.min = true;
out.ceil.push({ fi, d: dd, poly, inner, ind, innerBad: !!poly && ind > 0 && !inner, len });
out.ceilLen += len;
});
const okCeil = out.ceil.filter(f => f.poly);
if (okCeil.length) out.lines.ceil = `Молдинг на потолке: ${okCeil.map(f => `рамка в ${mFmt(f.d)} от стен (${txtMin(f.poly.edges)})${f.inner ? ` + внутренняя через ${mFmt(f.ind)} (${txtMin(f.inner.edges)})` : ''}`).join(' + ')} = ${mFmt(out.ceilLen)} пог. м`;
if (d.ceil.length && out.ceil.some(f => f.d > 0 && !f.poly)) out.lines.ceilBad = g && g.closed ? 'Рамка на потолке не помещается — уменьшите отступ' : 'Рамки на потолке считаются, когда комната сошлась на чертеже';
else if (out.ceil.some(f => f.innerBad)) out.lines.ceilBad = 'Внутренняя рамка на потолке не помещается — уменьшите её отступ';
if (d.wall.length && typeof openingSpan === 'function') {
lens.forEach((L, wi) => {
if (!(L > 0)) return;
const lay = molWallLayout(m, wi);
const sides = lay.frames.flatMap(molFrameSides);
const segs = lay.lines.map(l => l.x1 - l.x0);
const fr = sumMin(sides), ln = sumMin(segs);
if (hasMin(sides) || hasMin(segs)) out.min = true;
if (fr + ln > 0) {
out.wallLen += fr + ln;
const dbl = lay.frames.filter(f => f.inner).length;
out.wallParts.push(`стена ${wi + 1}: ${[lay.frames.length ? `${lay.frames.length} рам.${dbl ? ` (двойных ${dbl})` : ''} ${mFmt(fr)}` : '', ln ? `линия ${segs.length > 1 ? `(${txtMin(segs)}) ` : ''}${mFmt(ln)}` : ''].filter(Boolean).join(' + ')}`);
}
});
if (out.wallParts.length) out.lines.wall = `Молдинг на стенах: ${out.wallParts.join('; ')} = ${mFmt(out.wallLen)} пог. м`;
if (lens.some((L, wi) => L > 0 && molWallLayout(m, wi).frames.some(f => f.innerBad))) out.lines.wallBad = 'Внутренняя рамка не помещается в узкие рамки — там рамка одинарная';
}
if (out.min) Object.keys(out.lines).forEach(k => { if (k !== 'ceilBad' && /\*/.test(out.lines[k])) out.lines[k] += MIN_NOTE; });
return out;
}

/* ---------- рисунки ---------- */
const MOL_INK = '#7a3fb0';
// Молдинги, карниз и плинтус на развёртке стены (координаты — функции развёртки)
function molElevShapes(m, wi, XA, Yh, L, Hh) {
const d = molGet(m);
let s = '';
const lay = molWallLayout(m, wi);
const k = Math.abs(Yh(0) - Yh(1));
if (d.cornice.on && molWalls(d.cornice.walls, m).includes(wi)) {
const ch = Math.min(6, 0.1 * k + 2);
molCorniceSpans(m, wi, L).forEach(([a, b]) => { s += `<rect x="${Math.min(XA(a), XA(b))}" y="${Yh(Hh)}" width="${Math.abs(XA(b) - XA(a))}" height="${ch}" fill="#e9dcf5" stroke="${MOL_INK}" stroke-width="1"/>`; });
}
if (d.plinth.on && molWalls(d.plinth.walls, m).includes(wi)) {
const ph = Math.min(6, 0.08 * k + 2);
const doors = molPlinthGaps(m, wi, L).sort((a, b) => a[0] - b[0]);
let x = 0;
const seg = (a, b) => { if (b - a > 0.005) s += `<rect x="${Math.min(XA(a), XA(b))}" y="${Yh(0) - ph}" width="${Math.abs(XA(b) - XA(a))}" height="${ph}" fill="#e3d5c3" stroke="#7a5230" stroke-width="1"/>`; };
doors.forEach(([a0, a1]) => { seg(x, a0); x = Math.max(x, a1); });
seg(x, L);
}
lay.frames.forEach(f => {
const xL = Math.min(XA(f.x0), XA(f.x1)), xR = Math.max(XA(f.x0), XA(f.x1));
s += `<rect x="${xL}" y="${Yh(f.y1)}" width="${xR - xL}" height="${Yh(f.y0) - Yh(f.y1)}" fill="none" stroke="${MOL_INK}" stroke-width="1.6"/>`;
if (f.inner) {
const iL = Math.min(XA(f.inner.x0), XA(f.inner.x1)), iR = Math.max(XA(f.inner.x0), XA(f.inner.x1));
s += `<rect x="${iL}" y="${Yh(f.inner.y1)}" width="${iR - iL}" height="${Yh(f.inner.y0) - Yh(f.inner.y1)}" fill="none" stroke="${MOL_INK}" stroke-width="1.2"/>`;
}
});
lay.lines.forEach(l => {
s += `<path d="M${XA(l.x0)} ${Yh(l.y)}H${XA(l.x1)}" stroke="${MOL_INK}" stroke-width="2"/>`;
});
return s;
}

// Развёртка стены на вкладке «Лепнина»: стена, проёмы, лепнина и размеры рамок
function molElevSvg(m, wi, W = 340, H = 240, vw = { z: 1, x: 0, y: 0 }) {
const g = molGeom(m);
const left = 34, right = 14, top = 16, bottom = 46;
const L = mNum((m.walls || [])[wi]), Hh = wallHeightOf(m, wi);
if (!(L > 0) || !(Hh > 0)) return `<div class="mp-hint" style="padding:18px 8px;text-align:center;">${!(L > 0) ? 'Введите длину стены на вкладке «Стены»' : 'Введите высоту стен на вкладке «Стены»'}</div>`;
// приближение растягивает чертёж; подписи — прежнего размера
const k0 = Math.min((W - left - right) / L, (H - top - bottom) / Hh);
const z = vw.z, vx = (W - W / z) / 2 + vw.x, vy = (H - H / z) / 2 + vw.y;
const k = k0 * z;
// по центру окна — и по ширине, и по высоте (во весь экран окно высокое)
const x0 = (left + ((W - left - right) - L * k0) / 2 - vx) * z, yF = (top + ((H - top - bottom) - Hh * k0) / 2 + Hh * k0 - vy) * z;
const flip = g && (g.orient || 1) < 0;
const XA = a => flip ? x0 + (L - a) * k : x0 + a * k;
const Yh = h => yF - h * k;
let s = `<rect x="${x0}" y="${Yh(Hh)}" width="${L * k}" height="${Hh * k}" fill="#ffffff" stroke="#14181f" stroke-width="1.6"/>`;
s += `<path d="M${x0 - 6} ${yF}H${x0 + L * k + 6}" stroke="#14181f" stroke-width="3"/>`;
// проёмы
(m.openings || []).forEach(o => {
if (o.wall !== wi || !(openingWidth(o) > 0)) return;
const [a0, a1] = openingSpan(o, L);
const v = openingVert(o, Hh);
const xL = Math.min(XA(a0), XA(a1)), xR = Math.max(XA(a0), XA(a1));
const y0 = o.type === 'balcony' ? 0 : v.y0;
s += `<rect x="${xL}" y="${Yh(v.y1)}" width="${xR - xL}" height="${(v.y1 - y0) * k}" fill="${o.type === 'door' ? '#fff7dc' : '#eef4ff'}" stroke="#14181f" stroke-width="1.2" ${v.guess ? 'stroke-dasharray="4 3"' : ''}/>`;
});
s += molElevShapes(m, wi, XA, Yh, L, Hh);
// размеры первой рамки каждого ряда и отступы: от пола, до потолка, промежуток, внутренняя рамка
const lay = molWallLayout(m, wi);
s += molElevDims(lay, XA, Yh, Hh);
// длина и высота стены
s += `<text x="${x0 + L * k / 2}" y="${yF + 18}" text-anchor="middle" font-size="12" font-weight="700" fill="#14181f">${mFmt(L)} м</text>`;
s += `<text x="${x0 - 10}" y="${(yF + Yh(Hh)) / 2}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#14181f" transform="rotate(-90 ${x0 - 10} ${(yF + Yh(Hh)) / 2})">${mFmt(Hh)}</text>`;
if (lay.frames.length || lay.lines.length) {
const fr = lay.frames.reduce((a, f) => a + molFrameLen(f), 0), ln = lay.lines.reduce((a, l) => a + minLen(l.x1 - l.x0), 0);
s += `<text x="${x0 + L * k / 2}" y="${yF + 36}" text-anchor="middle" font-size="11" fill="${MOL_INK}">${lay.frames.length ? `${lay.frames.length} рам. ${mFmt(fr)} пог. м` : ''}${lay.frames.length && ln ? ' · ' : ''}${ln ? `линия ${mFmt(ln)} пог. м` : ''}</text>`;
}
return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Развёртка стены ${wi + 1}" font-family="inherit">${s}</svg>`;
}

// Размерные отметки рамок на развёртке (синим) у первой рамки каждого ряда:
// от пола (или от рамки ниже), до потолка (или до рамки выше), промежуток, отступ внутренней рамки.
function molElevDims(lay, XA, Yh, Hh) {
const DIM = '#1f6fd1';
let s = '';
const num = (x, y, t, anchor) => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="9" font-weight="700" fill="${DIM}" paint-order="stroke" stroke="#ffffff" stroke-width="3">${t}</text>`;
const vDim = (x, a, b) => {
if (!(b - a > 0.005)) return '';
const y0 = Yh(a), y1 = Yh(b);
return `<path d="M${x} ${y0}V${y1}M${x - 3} ${y0}H${x + 3}M${x - 3} ${y1}H${x + 3}" stroke="${DIM}" stroke-width="1"/>` + num(x + 4, (y0 + y1) / 2 + 3, mFmt(b - a), 'start');
};
const hDim = (a, b, h, side) => {
if (!(Math.abs(b - a) > 0.005)) return '';
const x0 = Math.min(XA(a), XA(b)), x1 = Math.max(XA(a), XA(b)), y = Yh(h);
return `<path d="M${x0} ${y}H${x1}M${x0} ${y - 3}V${y + 3}M${x1} ${y - 3}V${y + 3}" stroke="${DIM}" stroke-width="1"/>` + (side ? num(x1 + 3, y + 3, mFmt(Math.abs(b - a)), 'start') : num((x0 + x1) / 2, y - 4, mFmt(Math.abs(b - a)), 'middle'));
};
const overlap = (f, g) => Math.min(f.x1, g.x1) - Math.max(f.x0, g.x0) > 0.01;
const seen = new Set();
lay.frames.forEach(f => {
if (seen.has(f.ri)) return;
seen.add(f.ri);
const xL = Math.min(XA(f.x0), XA(f.x1)), xR = Math.max(XA(f.x0), XA(f.x1));
s += `<text x="${(xL + xR) / 2}" y="${(Yh(f.y0) + Yh(f.y1)) / 2 + 4}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${MOL_INK}" paint-order="stroke" stroke="#ffffff" stroke-width="3">${mFmt(f.x1 - f.x0)}×${mFmt(f.y1 - f.y0)}</text>`;
// по вертикали — цепочкой: до ближайшей рамки другого ряда снизу и сверху, иначе до пола и потолка
const others = lay.frames.filter(g => g.ri !== f.ri && overlap(f, g));
const below = Math.max(0, ...others.filter(g => g.y1 <= f.y0 + 0.001).map(g => g.y1));
const above = Math.min(Hh, ...others.filter(g => g.y0 >= f.y1 - 0.001).map(g => g.y0));
const xv = xL + (xR - xL) * 0.7;
s += vDim(xv, below, f.y0);
if (!others.some(g => g.y0 >= f.y1 - 0.001)) s += vDim(xv, f.y1, above);   // между рядами — уже подписано у верхнего
// промежуток — у первой пары соседних рамок ряда (не через окно или дверь)
const row = lay.frames.filter(g => g.ri === f.ri);
const k = row.findIndex((g, j) => row[j + 1] && Math.abs(row[j + 1].x0 - g.x1 - g.gap) < 0.005);
if (k >= 0 && row[k].gap > 0) s += hDim(row[k].x1, row[k + 1].x0, row[k].y0 + (row[k].y1 - row[k].y0) * 0.15);
// отступ внутренней рамки — у левой стороны, ближе к верху
if (f.inner) {
const a = XA(f.x0) < XA(f.x1) ? [f.x0, f.inner.x0] : [f.inner.x1, f.x1];
s += hDim(a[0], a[1], f.inner.y1 - (f.inner.y1 - f.inner.y0) * 0.2, true);
}
});
return s;
}

// План: карниз и плинтус вдоль стен, рамки на потолке
function molPlanSvg(m, res, W = 340, H = 230, vw = { z: 1, x: 0, y: 0 }) {
const g = molGeom(m);
if (!g || !g.segs.length) return '';
const P = 34;
const xs = [0, ...g.segs.map(q => q.x2)], ys = [0, ...g.segs.map(q => q.y2)];
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
const k0 = Math.min((W - 2 * P) / Math.max(maxX - minX, 0.5), (H - 2 * P) / Math.max(maxY - minY, 0.5));
const ox0 = (W - (maxX - minX) * k0) / 2 - minX * k0, oy0 = (H - (maxY - minY) * k0) / 2 - minY * k0;
const z = vw.z, vx = (W - W / z) / 2 + vw.x, vy = (H - H / z) / 2 + vw.y;
const k = k0 * z, ox = (ox0 - vx) * z, oy = (oy0 - vy) * z;
const X = v => ox + v * k, Y = v => oy + v * k;
const o = g.orient || 1;
const d = molGet(m);
let s = '';
const pts = [[0, 0], ...g.segs.map(q => [q.x2, q.y2])];
if (g.closed) s += `<path d="M${pts.map(p => `${X(p[0])} ${Y(p[1])}`).join('L')}Z" fill="#f6f7f9"/>`;
// рамки на потолке
res.ceil.forEach(f => [f.poly, f.inner].forEach(p => { if (p) s += `<path d="M${p.pts.map(([x, y]) => `${X(x)} ${Y(y)}`).join('L')}Z" fill="none" stroke="${MOL_INK}" stroke-width="${p === f.inner ? 1.2 : 1.6}" stroke-dasharray="6 3"/>`; }));
const along = (q, off, a, b, col, w) => {
const nx = -q.dy * o, ny = q.dx * o;
const p0 = [q.x1 + q.dx * a, q.y1 + q.dy * a], p1 = [q.x1 + q.dx * b, q.y1 + q.dy * b];
return `<path d="M${X(p0[0]) + nx * off} ${Y(p0[1]) + ny * off}L${X(p1[0]) + nx * off} ${Y(p1[1]) + ny * off}" stroke="${col}" stroke-width="${w}"/>`;
};
if (d.cornice.on) molWalls(d.cornice.walls, m).forEach(i => { const q = g.segs[i]; if (q && q.len > 0) molCorniceSpans(m, i, q.len).forEach(([a, b]) => { s += along(q, 5, a, b, MOL_INK, 2.5); }); });
if (d.plinth.on) molWalls(d.plinth.walls, m).forEach(i => {
const q = g.segs[i]; if (!q || !(q.len > 0)) return;
const doors = molPlinthGaps(m, i, q.len).sort((a, b) => a[0] - b[0]);
let x = 0;
doors.forEach(([a0, a1]) => { if (a0 > x) s += along(q, 9, x, a0, '#7a5230', 3); x = Math.max(x, a1); });
if (q.len > x) s += along(q, 9, x, q.len, '#7a5230', 3);
});
g.segs.forEach(q => {
s += `<path d="M${X(q.x1)} ${Y(q.y1)}L${X(q.x2)} ${Y(q.y2)}" stroke="#14181f" stroke-width="3.5" stroke-linecap="square" ${q.empty ? 'stroke-dasharray="5 5" opacity=".35"' : ''}/>`;
if (!(q.len > 0)) return;
const mx = (X(q.x1) + X(q.x2)) / 2 + q.dy * o * 14, my = (Y(q.y1) + Y(q.y2)) / 2 - q.dx * o * 14;
const on = q.i === molElevWall;
s += `<circle cx="${mx}" cy="${my}" r="8" fill="${on ? '#14181f' : '#ffffff'}" stroke="#14181f" stroke-width="1"/><text x="${mx}" y="${my + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="${on ? '#ffffff' : '#14181f'}">${q.i + 1}</text>`;
s += `<path d="M${X(q.x1)} ${Y(q.y1)}L${X(q.x2)} ${Y(q.y2)}" stroke="transparent" stroke-width="22" style="cursor:pointer" onclick="molTapWall(${q.i})"><title>Развёртка стены ${q.i + 1}</title></path>`;
});
return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Лепнина на плане" font-family="inherit">${s}</svg>`;
}

/* ---------- вкладка «Лепнина» ---------- */
function moldingTabHtml(m) {
const d = molEnsure();
const lens = molWallLens(m);
const hasWalls = lens.some(v => v > 0);
const n = lens.length;
if (molElevWall >= n) molElevWall = 0;
const chips = (sel, onclick, allClick) => {
const ws = molWalls(sel, m);
const all = ws.length === lens.filter(v => v > 0).length;
return `<div class="mp-ce-walls"><span class="mp-ce-walls-label">Стены:</span>${lens.map((v, i) => v > 0 ? `<button type="button" class="mp-ce-wall${ws.includes(i) ? ' on' : ''}" onclick="${onclick(i)}">${i + 1}</button>` : '').join('')}<button type="button" class="mp-ce-wall mp-ce-all${all ? ' on' : ''}" onclick="${allClick}">все</button></div>`;
};
const toggle = (kind, on, label) => `<label class="mp-check mp-ce-light"><input type="checkbox" ${on ? 'checked' : ''} onchange="molSet('${kind}', this.checked)"><span>${label}</span></label>`;
if (!hasWalls) return `<section class="mp-sec"><div class="mp-empty">Лепнина считается по стенам.<br>Сначала введите стены на вкладке «Стены».</div></section>`;
return `<section class="mp-sec">
<div class="mp-sec-title">План</div>
<div class="mp-ce-plan rl-sketch${molFull === 'plan' ? ' full' : ''}" id="mpMolPlan"></div>
<div class="mp-hint">Фиолетовая линия — карниз, коричневая — плинтус, пунктир — рамки на потолке. Касание стены — её развёртка ниже.</div>
</section>
<section class="mp-sec">
<div class="mp-sec-title">Карниз (потолочный плинтус)</div>
${toggle('cornice', d.cornice.on, 'Карниз по стенам')}
${d.cornice.on ? `${chips(d.cornice.walls, i => `molWallToggle('cornice', ${i})`, "molAllWalls('cornice')")}
<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Длина планки, м${mIn('molding.cornice.plank', d.cornice.plank, '2')}</label><span></span><span class="mp-hint" style="margin:0;align-self:center;">для подсчёта планок</span></div>` : ''}
<div class="mp-calc" id="mpCalcMolCornice"></div>
</section>
<section class="mp-sec">
<div class="mp-sec-title">Плинтус</div>
${toggle('plinth', d.plinth.on, 'Плинтус по стенам, без дверных проёмов')}
${d.plinth.on ? `${chips(d.plinth.walls, i => `molWallToggle('plinth', ${i})`, "molAllWalls('plinth')")}
<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Длина планки, м${mIn('molding.plinth.plank', d.plinth.plank, '2,5')}</label><span></span><span class="mp-hint" style="margin:0;align-self:center;">для подсчёта планок</span></div>
${molEnvHtml(m, d)}` : ''}
<div class="mp-calc" id="mpCalcMolPlinth"></div>
</section>
<section class="mp-sec">
<div class="mp-sec-title">Молдинги на потолке</div>
<div class="mp-hint">Рамка по контуру комнаты с отступом от стен. Несколько рамок — вложенные. Двойная — вторая рамка внутри первой с отступом.</div>
${d.ceil.map((f, i) => `<div class="mp-row"><span class="mp-row-label">${i + 1}.</span><span class="mp-unit" style="margin-right:4px;">отступ</span>${mIn(`molding.ceil.${i}.d`, f.d, '0,3')}<span class="mp-unit">м</span><span class="mp-row-res" id="mpMolCeilRes${i}"></span><button type="button" class="mp-del" onclick="molRemove('ceil', ${i})" aria-label="Убрать рамку">✕</button></div>
${molDblHtml(`molDbl('ceil', ${i}, this.checked)`, f, `molding.ceil.${i}.ind`)}`).join('')}
<div class="mp-add-row"><button type="button" class="mp-add" onclick="molAddCeil()">+ Рамка на потолке</button></div>
<div class="mp-calc" id="mpCalcMolCeil"></div>
</section>
<section class="mp-sec">
<div class="mp-sec-title">Молдинги на стенах</div>
<div class="rl-elev-nav"><button type="button" onclick="molStep(-1)" aria-label="Предыдущая стена">‹</button><span>Стена ${molElevWall + 1} из ${n}</span><button type="button" onclick="molStep(1)" aria-label="Следующая стена">›</button></div>
<div class="mp-ce-plan rl-sketch${molFull === 'elev' ? ' full' : ''}" id="mpMolElev"></div>
<div class="mp-hint">Ряд рамок раскладывается по стене сам: рамки обходят окна, двери и ниши с тем же промежутком. Линия — горизонтальный молдинг на высоте, разрывается на проёмах и нишах. Синим на развёртке — отступы: от пола, до потолка, между рамками и до внутренней рамки.</div>
${d.wall.map((row, i) => `<div class="mp-open">
<div class="mp-open-top">
<button type="button" class="mp-type" onclick="molRowType(${i})">${row.type === 'line' ? 'Линия' : 'Ряд рамок'} ▾</button>
<span class="mp-open-area" id="mpMolRowRes${i}"></span>
<button type="button" class="mp-del" onclick="molRemove('wall', ${i})" aria-label="Убрать">✕</button>
</div>
${chips(row.walls, wi => `molRowWall(${i}, ${wi})`, `molRowAll(${i})`)}
${row.type === 'line'
? `<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Высота от пола ↕${mIn(`molding.wall.${i}.y`, row.y, '0,9')}</label><span></span><span></span></div>`
: `<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Низ рамок от пола ↕${mIn(`molding.wall.${i}.yb`, row.yb, '0,15')}</label><span class="mp-x">·</span><label>Верх рамок от пола ↕${mIn(`molding.wall.${i}.yt`, row.yt, '0,85')}</label></div>
<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Промежуток ↔${mIn(`molding.wall.${i}.gap`, row.gap, '0,1')}</label><span class="mp-x">·</span><label>Ширина рамки ↔${mIn(`molding.wall.${i}.fw`, row.fw, 'на весь участок')}</label></div>
${molDblHtml(`molDbl('wall', ${i}, this.checked)`, row, `molding.wall.${i}.ind`)}`}
</div>`).join('')}
<div class="mp-add-row">
<button type="button" class="mp-add" onclick="molAddRow('frames')">+ Ряд рамок</button>
<button type="button" class="mp-add" onclick="molAddRow('line')">+ Линия</button>
</div>
<div class="mp-calc" id="mpCalcMolWall"></div>
</section>`;
}

// Переключатель «двойная рамка» и отступ внутренней рамки
function molDblHtml(onchange, f, path) {
return `<label class="mp-check mp-ce-light"><input type="checkbox" ${f.dbl ? 'checked' : ''} onchange="${onchange}"><span>Двойная рамка — внутри вторая рамка с отступом</span></label>
${f.dbl ? `<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Отступ внутренней рамки, м${mIn(path, f.ind, MOL_IND_DEF)}</label><span></span><span></span></div>` : ''}`;
}
function molDbl(kind, i, on) {
const d = molEnsure();
const f = d[kind][i];
if (!f) return;
f.dbl = !!on;
if (on && !mNum(f.ind)) f.ind = MOL_IND_DEF;
saveMeasureDraft();
renderMeasure();
if (on) focusMeasurePath(`molding.${kind}.${i}.ind`);
}

// Конверты на обрывах плинтуса: плинтус зарезан на 45° и уходит в пол
function molEnvHtml(m, d) {
const env = d.plinth.env || {};
const plan = molPlinthPlan(m, molGeom(m), d.plinth);
return `<label class="mp-check mp-ce-light"><input type="checkbox" ${env.on ? 'checked' : ''} onchange="molEnvSet(this.checked)"><span>Конверты на обрывах — плинтус зарезан на 45° и уходит в пол, каждый по 1 пог. м</span></label>
${env.on && plan.ends.length ? `<div class="mp-ce-walls mp-cn-row"><span class="mp-ce-walls-label">Где конверт (остальные — заглушки):</span>${plan.ends.map(e => `<button type="button" class="mp-ce-wall${e.env ? ' on' : ''}" onclick="molEnvToggle('${e.key}')" aria-pressed="${e.env}">${escapeHtml(e.label)}</button>`).join('')}</div>` : ''}
${env.on && !plan.ends.length ? '<div class="mp-hint">Обрывов нет: плинтус идёт по всем стенам без дверей.</div>' : ''}`;
}
function molEnvSet(on) {
const d = molEnsure();
d.plinth = { ...d.plinth, env: { ...(d.plinth.env || {}), on: !!on } };
saveMeasureDraft();
renderMeasure();
}
function molEnvToggle(key) {
const d = molEnsure();
const env = { ...(d.plinth.env || {}), on: true };
const skip = new Set(Array.isArray(env.skip) ? env.skip : []);
if (skip.has(key)) skip.delete(key); else skip.add(key);
env.skip = [...skip];
d.plinth = { ...d.plinth, env };
saveMeasureDraft();
renderMeasure();
}

// обновление цифр и рисунков без перерисовки полей
function updateMoldingOutputs(r) {
const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
const mo = r.mol || moldingCompute(measure);
renderMolViews(mo);
set('mpCalcMolCornice', mo.lines.cornice ? escapeHtml(mo.lines.cornice) : '');
set('mpCalcMolPlinth', mo.lines.plinth ? escapeHtml(mo.lines.plinth) : '');
set('mpCalcMolCeil', [mo.lines.ceil, mo.lines.ceilBad].filter(Boolean).map(escapeHtml).join('<br>'));
set('mpCalcMolWall', [mo.lines.wall, mo.lines.wallBad].filter(Boolean).map(escapeHtml).join('<br>'));
mo.ceil.forEach(f => set('mpMolCeilRes' + f.fi, f.poly ? `= ${mFmt(f.len)}` : ''));
molGet(measure).wall.forEach((row, ri) => {
let len = 0;
molWallLens(measure).forEach((L, wi) => {
if (!(L > 0)) return;
const lay = molWallLayout(measure, wi);
lay.frames.filter(f => f.ri === ri).forEach(f => { len += molFrameLen(f); });
lay.lines.filter(l => l.ri === ri).forEach(l => { len += minLen(l.x1 - l.x0); });
});
set('mpMolRowRes' + ri, len > 0 ? `${mFmt(len)} пог. м` : '');
});
}

function molSet(kind, on) {
const d = molEnsure();
d[kind] = { ...d[kind], on: !!on };
saveMeasureDraft();
renderMeasure();
}
function molWallToggle(kind, wi) {
const d = molEnsure();
const ws = molWalls(d[kind].walls, measure);
const set = new Set(ws);
if (set.has(wi)) set.delete(wi); else set.add(wi);
d[kind] = { ...d[kind], walls: [...set].sort((a, b) => a - b) };
saveMeasureDraft();
renderMeasure();
}
function molAllWalls(kind) {
const d = molEnsure();
const all = molWalls(null, measure);
const cur = molWalls(d[kind].walls, measure);
d[kind] = { ...d[kind], walls: cur.length === all.length ? [] : null };
saveMeasureDraft();
renderMeasure();
}
function molAddCeil() {
const d = molEnsure();
const prev = d.ceil[d.ceil.length - 1];
// следующая рамка — на 0,2 м дальше от стен
const pd = prev ? mNum(prev.d) : 0;
d.ceil.push({ d: pd > 0 ? String(Math.round((pd + 0.2) * 100) / 100).replace('.', ',') : '' });
saveMeasureDraft();
renderMeasure();
focusMeasurePath(`molding.ceil.${d.ceil.length - 1}.d`);
}
function molAddRow(type) {
const d = molEnsure();
const prev = [...d.wall].reverse().find(r => r.type === type);
d.wall.push(type === 'line'
? { type, walls: prev ? prev.walls : [molElevWall], y: prev ? prev.y : '' }
: { type, walls: prev ? prev.walls : [molElevWall], yb: prev ? prev.yb : '', yt: prev ? prev.yt : '', gap: prev ? prev.gap : '', fw: prev ? prev.fw : '', dbl: prev ? !!prev.dbl : false, ind: prev ? prev.ind || '' : '' });
saveMeasureDraft();
renderMeasure();
focusMeasurePath(`molding.wall.${d.wall.length - 1}.${type === 'line' ? 'y' : 'yb'}`);
}
function molRowType(i) {
const d = molEnsure();
const row = d.wall[i];
if (!row) return;
row.type = row.type === 'line' ? 'frames' : 'line';
saveMeasureDraft();
renderMeasure();
}
function molRowWall(i, wi) {
const d = molEnsure();
const row = d.wall[i];
if (!row) return;
const set = new Set(molWalls(row.walls, measure));
if (set.has(wi)) set.delete(wi); else set.add(wi);
row.walls = [...set].sort((a, b) => a - b);
molElevWall = wi;
saveMeasureDraft();
renderMeasure();
}
function molRowAll(i) {
const d = molEnsure();
const row = d.wall[i];
if (!row) return;
const all = molWalls(null, measure);
row.walls = molWalls(row.walls, measure).length === all.length ? [] : null;
saveMeasureDraft();
renderMeasure();
}
function molRemove(kind, i) {
const d = molEnsure();
d[kind].splice(i, 1);
saveMeasureDraft();
renderMeasure();
}
function molStep(dir) {
const n = (measure.walls || []).length;
if (!n) return;
molElevWall = (molElevWall + dir + n) % n;
molViews.elev = { z: 1, x: 0, y: 0 };
renderMeasure();
}
function molShowWall(wi) {
molElevWall = wi;
molViews.elev = { z: 1, x: 0, y: 0 };
renderMeasure();
const el = document.getElementById('mpMolElev');
if (el) el.scrollIntoView({ block: 'center' });
}
/* приближение, перемещение и весь экран для плана и развёртки — как на «Углах» */
const molViews = { plan: { z: 1, x: 0, y: 0 }, elev: { z: 1, x: 0, y: 0 } };
let molFull = null, molDragged = false;
function molSize(box, which) {
const base = which === 'plan' ? 230 : 240;
if (molFull === which && box && box.clientWidth > 0 && box.clientHeight > 0) return { W: 340, H: Math.round(340 * box.clientHeight / box.clientWidth) };
return { W: 340, H: base };
}
function renderMolViews(mo) {
if (!measure) return;
mo = mo || moldingCompute(measure);
[['plan', 'mpMolPlan'], ['elev', 'mpMolElev']].forEach(([which, id]) => {
const box = document.getElementById(id);
if (!box) return;
const { W, H } = molSize(box, which);
const vw = molViews[which];
const svg = which === 'plan' ? molPlanSvg(measure, mo, W, H, vw) : molElevSvg(measure, molElevWall, W, H, vw);
// без чертежа (нет стен или высоты) — только подсказка, без кнопок
if (!svg.startsWith('<svg')) { box.innerHTML = svg; return; }
const moved = Math.abs(vw.z - 1) > 0.01 || Math.abs(vw.x) > 1 || Math.abs(vw.y) > 1;
const full = molFull === which;
box.innerHTML = `${svg}<div class="rl-zoom cp-zoom">
<button type="button" onclick="molZoom('${which}', 1.6)" aria-label="Приблизить">+</button>
<button type="button" onclick="molZoom('${which}', 1 / 1.6)" aria-label="Отдалить">−</button>
${moved ? `<button type="button" onclick="molReset('${which}')" aria-label="Весь чертёж">⤢</button>` : ''}
<button type="button" onclick="molToggleFull('${which}')" aria-label="${full ? 'Закрыть' : 'Во весь экран'}">${full ? '✕' : '⛶'}</button>
</div>${full && which === 'elev' ? `<div class="cp-caption">Стена ${molElevWall + 1} <button type="button" class="cn-cap-btn" onclick="molStep(-1)">‹</button><button type="button" class="cn-cap-btn" onclick="molStep(1)">›</button></div>` : ''}`;
bindPanZoom(box, () => molViews[which], () => renderMolViews(), v => { molDragged = v; }, f => molZoom(which, f));
});
}
function molZoom(which, f) { const v = molViews[which]; v.z = Math.min(8, Math.max(0.5, v.z * f)); renderMolViews(); }
function molReset(which) { molViews[which] = { z: 1, x: 0, y: 0 }; renderMolViews(); }
function molToggleFull(which) {
molFull = molFull === which ? null : which;
document.body.classList.toggle('cp-full-open', !!molFull);
['plan', 'elev'].forEach(w => { const b = document.getElementById(w === 'plan' ? 'mpMolPlan' : 'mpMolElev'); if (b) b.classList.toggle('full', molFull === w); });
renderMolViews();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && molFull) molToggleFull(molFull); });
window.addEventListener('resize', () => { if (molFull) renderMolViews(); });
// касание стены на плане — её развёртка; после перетаскивания не срабатывает
function molTapWall(i) {
if (molDragged) { molDragged = false; return; }
if (molFull === 'plan') molToggleFull('plan');
molShowWall(i);
}

function setMolPick(p) { measureMolPick = p; updateMeasureOutputs(); }

// номера стен в лепнине после перестройки стен: map[старый] = новый (или -1)
function remapMoldingWalls(m, map) {
if (!m || !m.molding) return;
const fix = ws => Array.isArray(ws) ? [...new Set(ws.map(i => map[i]).filter(i => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b) : ws;
['cornice', 'plinth'].forEach(k => { if (m.molding[k]) m.molding[k].walls = fix(m.molding[k].walls); });
(m.molding.wall || []).forEach(row => { row.walls = fix(row.walls); });
}
