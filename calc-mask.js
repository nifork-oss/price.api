// Кабинет мастера — укрывка: периметр примыкания к готовым поверхностям
// (окна, двери, мебель, пол, потолок, стены), план и развёртки.
// Подключается из calc.html после calc-tile.js; порядок подключения важен.

/* ===================== УКРЫВКА ===================== */
// В замере: measure.mask = { windows, doors, covers, floor, ceiling: true/false, walls: [номера стен] }.
// Считается периметр примыкания — где укрываемая поверхность встречается с той,
// на которой работаем: рамка окна и двери, контур шкафа на стене, линия пол–стена,
// потолок–стена, контур готовой стены. Каждый периметр раскладывается на отрезки
// по стенам; там, где отрезки совпадают (пол под дверью, низ шкафа на полу, угол
// между двумя готовыми стенами), участок считается один раз.
// Площадь под плёнку — справочно: окна, двери, мебель спереди, пол, потолок, стены.

const MASK_KINDS = [
{ key: 'windows', label: 'Окна' },
{ key: 'doors', label: 'Двери' },
{ key: 'covers', label: 'Мебель' },
{ key: 'floor', label: 'Пол' },
{ key: 'ceiling', label: 'Потолок' }
];
const MASK_INK = '#e0662b';
let maskElevWall = 0;
let measureMaskPick = 'mask';

function maskGet(m) {
const d = m && m.mask && typeof m.mask === 'object' ? m.mask : {};
return { windows: !!d.windows, doors: !!d.doors, covers: !!d.covers, floor: !!d.floor, ceiling: !!d.ceiling, walls: Array.isArray(d.walls) ? d.walls : [] };
}
function maskEnsure() {
measure.mask = maskGet(measure);
return measure.mask;
}

// Отрезки укрывки: [{ kind, wall, x0, y0, x1, y1, key, a, b }] — на стене wall (x — вдоль стены
// от угла А, y — от пола). key и [a, b] — общая прямая и участок на ней: по ним совпадающие
// отрезки разных укрывок сливаются. Вертикаль в углу комнаты — одна на обе стены.
function maskSegments(m) {
const d = maskGet(m);
const lens = (m.walls || []).map(mNum);
const n = lens.length;
let g = null;
try { g = rulerGeometry(m); } catch (e) { g = null; }
const closed = !!(g && g.closed);
const out = [];
const r3 = v => Math.round(v * 1000);
const hor = (kind, wall, y, x0, x1) => {
if (!(x1 - x0 > 0.0005)) return;
out.push({ kind, wall, x0, y0: y, x1, y1: y, key: `h${wall}:${r3(y)}`, a: x0, b: x1 });
};
const ver = (kind, wall, x, y0, y1) => {
if (!(y1 - y0 > 0.0005)) return;
const L = lens[wall];
let key = `v${wall}:${r3(x)}`;
if (x < 0.0005) key = `c${wall}`;
else if (x > L - 0.0005 && (closed || wall < n - 1)) key = `c${(wall + 1) % n}`;
out.push({ kind, wall, x0: x, y0, x1: x, y1, key, a: y0, b: y1 });
};
const rect = (kind, wall, x0, x1, y0, y1, sides = { b: true, t: true, l: true, r: true }) => {
if (sides.b) hor(kind, wall, y0, x0, x1);
if (sides.t) hor(kind, wall, y1, x0, x1);
if (sides.l) ver(kind, wall, x0, y0, y1);
if (sides.r) ver(kind, wall, x1, y0, y1);
};
// проёмы: окно — рамка целиком, дверь — без порога, у балконного блока окно и дверь отдельно
(m.openings || []).forEach(o => {
if (!Number.isInteger(o.wall) || !(lens[o.wall] > 0) || !(openingWidth(o) > 0)) return;
const L = lens[o.wall], Hh = wallHeightOf(m, o.wall);
const [a0, a1] = openingSpan(o, L);
const v = openingVert(o, Hh);
if (o.type === 'balcony') {
const bp = balconyParts(o, a0, a1);
if (d.windows) rect('windows', o.wall, bp.win[0], bp.win[1], v.y0, v.y1);
if (d.doors) rect('doors', o.wall, bp.door[0], bp.door[1], 0, v.door[1], { b: false, t: true, l: true, r: true });
} else if (o.type === 'door') {
if (d.doors) rect('doors', o.wall, a0, a1, 0, v.y1, { b: false, t: true, l: true, r: true });
} else if (d.windows) rect('windows', o.wall, a0, a1, v.y0, v.y1);
});
// мебель: контур, которым шкаф прилегает к стене; у шкафа в углу (с боком на соседней
// стене) вертикаль в самом углу не нужна — там шкаф и стена за боком сходятся
if (d.covers && typeof coversCompute === 'function') {
const pcs = coversCompute(m).pieces;
pcs.forEach(p => {
const L = lens[p.wall];
const corner = pcs.some(q => q !== p && q.idx === p.idx);
rect('covers', p.wall, p.span[0], p.span[1], p.bottom, p.top, {
b: true, t: true,
l: !(corner && p.span[0] < 0.0005),
r: !(corner && p.span[1] > L - 0.0005)
});
});
}
lens.forEach((L, i) => {
if (!(L > 0)) return;
const Hh = wallHeightOf(m, i);
if (d.floor) hor('floor', i, 0, 0, L);
if (d.ceiling && Hh > 0) hor('ceiling', i, Hh, 0, L);
if (d.walls.includes(i) && Hh > 0) rect('walls', i, 0, L, 0, Hh);
});
return out;
}
// Длина объединения отрезков (совпадающие участки — один раз)
function maskUnionLen(segs) {
const byKey = new Map();
segs.forEach(s => { if (!byKey.has(s.key)) byKey.set(s.key, []); byKey.get(s.key).push([Math.min(s.a, s.b), Math.max(s.a, s.b)]); });
let len = 0;
byKey.forEach(list => {
list.sort((p, q) => p[0] - q[0]);
let [c0, c1] = list[0];
list.slice(1).forEach(([a, b]) => { if (a <= c1 + 1e-6) c1 = Math.max(c1, b); else { len += c1 - c0; c0 = a; c1 = b; } });
len += c1 - c0;
});
return len;
}
function maskCompute(m) {
const d = maskGet(m);
const segs = maskSegments(m);
const out = { len: 0, area: 0, segs, parts: [], lines: {} };
if (!segs.length && !(d.windows || d.doors || d.covers || d.floor || d.ceiling || d.walls.length)) return out;
// площадь под плёнку
const lens = (m.walls || []).map(mNum);
let floorA = 0;
try {
const g = rulerGeometry(m);
if (g && g.closed) floorA = typeof plFloorArea === 'function' ? plFloorArea(g) : Math.abs(g.segs.reduce((a, q) => a + q.x1 * q.y2 - q.x2 * q.y1, 0)) / 2;
} catch (e) { floorA = 0; }
const area = { windows: 0, doors: 0, covers: 0, floor: d.floor ? floorA : 0, ceiling: d.ceiling ? floorA : 0, walls: 0 };
(m.openings || []).forEach(o => {
if (!(openingWidth(o) > 0)) return;
const k = mCount(o.n) || 1;
if (o.type === 'balcony') {
if (d.windows) area.windows += mNum(o.w) * winH(o) * k;
if (d.doors) area.doors += mNum(o.dw) * mNum(o.dh) * k;
} else if (o.type === 'door') { if (d.doors) area.doors += mNum(o.w) * mNum(o.h) * k; }
else if (d.windows) area.windows += mNum(o.w) * mNum(o.h) * k;
});
if (d.covers && typeof coversCompute === 'function') area.covers = coversCompute(m).list.reduce((a, e) => a + e.w * e.h, 0);
d.walls.forEach(i => { if (lens[i] > 0) area.walls += lens[i] * (wallHeightOf(m, i) || 0); });
// проёмы без привязки к стене — периметр как есть, без слияния
const loose = { windows: 0, doors: 0 };
(m.openings || []).forEach(o => {
if (Number.isInteger(o.wall) && lens[o.wall] > 0) return;
if (!(openingWidth(o) > 0)) return;
const k = mCount(o.n) || 1, w = mNum(o.w), h = o.type === 'balcony' ? winH(o) : mNum(o.h);
if (o.type === 'door') { if (d.doors) loose.doors += (w + 2 * h) * k; }
else if (o.type === 'balcony') {
if (d.windows) loose.windows += 2 * (w + h) * k;
if (d.doors) loose.doors += (mNum(o.dw) + 2 * mNum(o.dh)) * k;
} else if (d.windows) loose.windows += 2 * (w + h) * k;
});
const labels = { windows: 'окна', doors: 'двери', covers: 'мебель', floor: 'пол', ceiling: 'потолок', walls: `стены ${d.walls.map(i => i + 1).join(', ')}` };
['windows', 'doors', 'covers', 'floor', 'ceiling', 'walls'].forEach(k => {
const own = maskUnionLen(segs.filter(s => s.kind === k)) + (loose[k] || 0);
if (own > 0.0005 || area[k] > 0.0005) out.parts.push({ key: k, label: labels[k], len: own, area: area[k] });
});
out.len = maskUnionLen(segs) + loose.windows + loose.doors;
out.area = Object.values(area).reduce((a, v) => a + v, 0);
const sum = out.parts.reduce((a, p) => a + p.len, 0);
const shared = sum - out.len;
const f = v => mFmt(Math.round(v * 1000) / 1000);
if (out.len > 0) {
out.lines.len = `Укрывка, периметр примыкания: ${out.parts.filter(p => p.len > 0.0005).map(p => `${p.label} ${f(p.len)}`).join(' + ')}${shared > 0.0005 ? ` − общие участки ${f(shared)}` : ''}${out.parts.length > 1 || shared > 0.0005 ? ` = ${f(out.len)}` : ''} пог. м`;
}
if (out.area > 0) out.lines.area = `Укрывка плёнкой: ${out.parts.filter(p => p.area > 0.0005).map(p => `${p.label} ${f(p.area)}`).join(' + ')}${out.parts.filter(p => p.area > 0.0005).length > 1 ? ` = ${f(out.area)}` : ''} м²`;
if (loose.windows + loose.doors > 0) out.lines.loose = 'Проёмы без стены считаются целиком, без слияния с другими участками';
return out;
}

/* ---------- рисунки ---------- */
// План: комната сверху; укрытое — оранжевым: линия пола или потолка вдоль стен, готовые стены,
// окна и двери в стенах, мебель у стен
function maskPlanSvg(m, W = 340, H = 240, vw = { z: 1, x: 0, y: 0 }) {
const g = typeof molGeom === 'function' ? molGeom(m) : null;
if (!g || !g.segs.length) return '<div class="mp-hint" style="padding:18px 8px;text-align:center;">План появится, когда стены введены на вкладке «Стены»</div>';
const d = maskGet(m);
const P = 30;
const xs = [0, ...g.segs.map(q => q.x2)], ys = [0, ...g.segs.map(q => q.y2)];
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
const k0 = Math.min((W - 2 * P) / Math.max(maxX - minX, 0.5), (H - 2 * P) / Math.max(maxY - minY, 0.5));
const ox0 = (W - (maxX - minX) * k0) / 2 - minX * k0, oy0 = (H - (maxY - minY) * k0) / 2 - minY * k0;
const z = vw.z, vx = (W - W / z) / 2 + vw.x, vy = (H - H / z) / 2 + vw.y;
const k = k0 * z, ox = (ox0 - vx) * z, oy = (oy0 - vy) * z;
const X = v => ox + v * k, Y = v => oy + v * k;
const pts = [[0, 0], ...g.segs.map(q => [q.x2, q.y2])];
const path = `M${pts.map(p => `${X(p[0])} ${Y(p[1])}`).join('L')}Z`;
const o = g.orient || 1;
let s = g.closed ? `<path d="${path}" fill="${d.floor || d.ceiling ? 'rgba(224,102,43,.12)' : '#f6f7f9'}"/>` : '';
// линия пол–стена или потолок–стена: полоса вдоль стен изнутри комнаты
if (g.closed && (d.floor || d.ceiling)) s += `<clipPath id="maskRoomClip"><path d="${path}"/></clipPath><path d="${path}" fill="none" stroke="${MASK_INK}" stroke-width="12" clip-path="url(#maskRoomClip)"/>`;
// мебель у стен
if (typeof coversCompute === 'function' && typeof blockPlanPoly === 'function') coversCompute(m).list.forEach(e => {
if (e.wall == null || !(e.d > 0)) return;
const pp = blockPlanPoly(g, { wall: e.wall, span: e.span, d: e.d });
if (!pp) return;
s += `<path d="M${pp.map(([x, y]) => `${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join('L')}Z" fill="${d.covers ? 'rgba(224,102,43,.25)' : '#e9ebef'}" stroke="${d.covers ? MASK_INK : '#8a93a3'}" stroke-width="1.2"/>`;
const cx = pp.reduce((a, p) => a + X(p[0]), 0) / 4, cy = pp.reduce((a, p) => a + Y(p[1]), 0) / 4;
s += `<text x="${cx}" y="${cy + 3.5}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${d.covers ? MASK_INK : '#5d6878'}">${e.code}</text>`;
});
g.segs.forEach(q => {
const on = d.walls.includes(q.i);
s += `<path d="M${X(q.x1)} ${Y(q.y1)}L${X(q.x2)} ${Y(q.y2)}" stroke="${on ? MASK_INK : '#14181f'}" stroke-width="${on ? 5 : 3.5}" stroke-linecap="square" ${q.empty ? 'stroke-dasharray="5 5" opacity=".35"' : ''}/>`;
// проёмы в стене
const L = mNum((m.walls || [])[q.i]);
(m.openings || []).filter(op => op.wall === q.i && openingWidth(op) > 0 && L > 0).forEach(op => {
const [a0, a1] = openingSpan(op, L);
const parts = op.type === 'balcony' ? (() => { const bp = balconyParts(op, a0, a1); return [[bp.win, 'windows'], [bp.door, 'doors']]; })() : [[[a0, a1], op.type === 'door' ? 'doors' : 'windows']];
parts.forEach(([sp, kind]) => {
const lit = d[kind];
s += `<path d="M${X(q.x1 + q.dx * sp[0])} ${Y(q.y1 + q.dy * sp[0])}L${X(q.x1 + q.dx * sp[1])} ${Y(q.y1 + q.dy * sp[1])}" stroke="${lit ? MASK_INK : '#ffffff'}" stroke-width="${lit ? 6 : 4}"/>`;
if (!lit) s += `<path d="M${X(q.x1 + q.dx * sp[0])} ${Y(q.y1 + q.dy * sp[0])}L${X(q.x1 + q.dx * sp[1])} ${Y(q.y1 + q.dy * sp[1])}" stroke="#14181f" stroke-width="1"/>`;
});
});
if (!(q.len > 0)) return;
const mx = (X(q.x1) + X(q.x2)) / 2 + q.dy * o * 13, my = (Y(q.y1) + Y(q.y2)) / 2 - q.dx * o * 13;
const cur = q.i === maskElevWall;
s += `<circle cx="${mx}" cy="${my}" r="8" fill="${cur ? '#14181f' : '#ffffff'}" stroke="${on ? MASK_INK : '#14181f'}" stroke-width="${on ? 2 : 1}"/><text x="${mx}" y="${my + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="${cur ? '#ffffff' : '#14181f'}">${q.i + 1}</text>`;
s += `<path d="M${X(q.x1)} ${Y(q.y1)}L${X(q.x2)} ${Y(q.y2)}" stroke="transparent" stroke-width="22" style="cursor:pointer" onclick="maskTapWall(${q.i})"><title>Развёртка стены ${q.i + 1}</title></path>`;
});
return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Укрывка: план" font-family="inherit">${s}</svg>`;
}

// Развёртка стены: проёмы, мебель и оранжевые линии укрывки
function maskElevSvg(m, wi, W = 340, H = 240, vw = { z: 1, x: 0, y: 0 }) {
const g = typeof molGeom === 'function' ? molGeom(m) : null;
const left = 34, right = 14, top = 16, bottom = 40;
const L = mNum((m.walls || [])[wi]), Hh = wallHeightOf(m, wi);
if (!(L > 0) || !(Hh > 0)) return `<div class="mp-hint" style="padding:18px 8px;text-align:center;">${!(L > 0) ? 'Введите длину стены на вкладке «Стены»' : 'Введите высоту стен на вкладке «Стены»'}</div>`;
const d = maskGet(m);
const k0 = Math.min((W - left - right) / L, (H - top - bottom) / Hh);
const z = vw.z, vx = (W - W / z) / 2 + vw.x, vy = (H - H / z) / 2 + vw.y;
const k = k0 * z;
const x0 = (left + ((W - left - right) - L * k0) / 2 - vx) * z, yF = (top + ((H - top - bottom) - Hh * k0) / 2 + Hh * k0 - vy) * z;
const flip = g && (g.orient || 1) < 0;
const XA = a => flip ? x0 + (L - a) * k : x0 + a * k;
const Yh = h => yF - h * k;
const wallOn = d.walls.includes(wi);
let s = `<rect x="${x0}" y="${Yh(Hh)}" width="${L * k}" height="${Hh * k}" fill="${wallOn ? 'rgba(224,102,43,.12)' : '#ffffff'}" stroke="#14181f" stroke-width="1.6"/>`;
// мебель
if (typeof coversCompute === 'function') coversCompute(m).pieces.filter(p => p.wall === wi).forEach(p => {
const xl = Math.min(XA(p.span[0]), XA(p.span[1])), xr = Math.max(XA(p.span[0]), XA(p.span[1]));
s += `<rect x="${xl}" y="${Yh(p.top)}" width="${xr - xl}" height="${(p.top - p.bottom) * k}" fill="${d.covers ? 'rgba(224,102,43,.18)' : '#e9ebef'}" stroke="#8a93a3" stroke-width="1"/>`;
if (xr - xl > 18) s += `<text x="${(xl + xr) / 2}" y="${Yh((p.top + p.bottom) / 2) + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="#5d6878">${p.code}${p.side ? ' бок' : ''}</text>`;
});
// проёмы
(m.openings || []).forEach((o, oi) => {
if (o.wall !== wi || !(openingWidth(o) > 0)) return;
const [a0, a1] = openingSpan(o, L);
const v = openingVert(o, Hh);
const parts = o.type === 'balcony' ? (() => { const bp = balconyParts(o, a0, a1); return [[bp.win, v.y0, v.y1, 'windows'], [bp.door, 0, v.door[1], 'doors']]; })() : [[[a0, a1], v.y0, v.y1, o.type === 'door' ? 'doors' : 'windows']];
parts.forEach(([sp, y0, y1, kind]) => {
const xl = Math.min(XA(sp[0]), XA(sp[1])), xr = Math.max(XA(sp[0]), XA(sp[1]));
s += `<rect x="${xl}" y="${Yh(y1)}" width="${xr - xl}" height="${(y1 - y0) * k}" fill="${d[kind] ? 'rgba(224,102,43,.18)' : kind === 'doors' ? '#ffffff' : '#eef4fb'}" stroke="#14181f" stroke-width="1.1"/>`;
});
const xl = Math.min(XA(a0), XA(a1)), xr = Math.max(XA(a0), XA(a1));
s += `<text x="${(xl + xr) / 2}" y="${Yh(v.y1) + 12}" text-anchor="middle" font-size="10" font-weight="700" fill="#14181f">${opCode(o, oi)}</text>`;
});
s += `<path d="M${x0 - 6} ${yF}H${x0 + L * k + 6}" stroke="#14181f" stroke-width="3"/>`;
// линии укрывки на этой стене — поверх пола
maskSegments(m).filter(sg => sg.wall === wi).forEach(sg => {
s += `<path d="M${XA(sg.x0).toFixed(1)} ${Yh(sg.y0).toFixed(1)}L${XA(sg.x1).toFixed(1)} ${Yh(sg.y1).toFixed(1)}" stroke="${MASK_INK}" stroke-width="3.2" stroke-linecap="round"/>`;
});
s += `<text x="${x0 + L * k / 2}" y="${yF + 17}" text-anchor="middle" font-size="12" font-weight="700" fill="#14181f">${mFmt(L)} м</text>`;
s += `<text x="${x0 - 10}" y="${(yF + Yh(Hh)) / 2}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#14181f" transform="rotate(-90 ${x0 - 10} ${(yF + Yh(Hh)) / 2})">${mFmt(Hh)}</text>`;
return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Укрывка: стена ${wi + 1}" font-family="inherit">${s}</svg>`;
}

/* ---------- приближение, перемещение и весь экран — как на «Плитке» ---------- */
const maskViews = { plan: { z: 1, x: 0, y: 0 }, elev: { z: 1, x: 0, y: 0 } };
let maskFull = null, maskDragged = false;
function maskSizeOf(box, which) {
if (maskFull === which && box && box.clientWidth > 0 && box.clientHeight > 0) return { W: 340, H: Math.round(340 * box.clientHeight / box.clientWidth) };
return { W: 340, H: 240 };
}
function renderMaskViews() {
if (!measure) return;
[['plan', 'mpMaskPlan'], ['elev', 'mpMaskElev']].forEach(([which, id]) => {
const box = document.getElementById(id);
if (!box) return;
const { W, H } = maskSizeOf(box, which);
const vw = maskViews[which];
const svg = which === 'plan' ? maskPlanSvg(measure, W, H, vw) : maskElevSvg(measure, maskElevWall, W, H, vw);
if (!svg.startsWith('<svg')) { box.innerHTML = svg; return; }
const moved = Math.abs(vw.z - 1) > 0.01 || Math.abs(vw.x) > 1 || Math.abs(vw.y) > 1;
const full = maskFull === which;
box.innerHTML = `${svg}<div class="rl-zoom cp-zoom">
<button type="button" onclick="maskZoom('${which}', 1.6)" aria-label="Приблизить">+</button>
<button type="button" onclick="maskZoom('${which}', 1 / 1.6)" aria-label="Отдалить">−</button>
${moved ? `<button type="button" onclick="maskReset('${which}')" aria-label="Весь чертёж">⤢</button>` : ''}
<button type="button" onclick="maskToggleFull('${which}')" aria-label="${full ? 'Закрыть' : 'Во весь экран'}">${full ? '✕' : '⛶'}</button>
</div>${full && which === 'elev' ? `<div class="cp-caption">Стена ${maskElevWall + 1} <button type="button" class="cn-cap-btn" onclick="maskStep(-1)">‹</button><button type="button" class="cn-cap-btn" onclick="maskStep(1)">›</button></div>` : ''}`;
bindPanZoom(box, () => maskViews[which], () => renderMaskViews(), v => { maskDragged = v; }, f => maskZoom(which, f));
});
}
function maskZoom(which, f) { const v = maskViews[which]; v.z = Math.min(8, Math.max(0.5, v.z * f)); renderMaskViews(); }
function maskReset(which) { maskViews[which] = { z: 1, x: 0, y: 0 }; renderMaskViews(); }
function maskToggleFull(which) {
maskFull = maskFull === which ? null : which;
document.body.classList.toggle('cp-full-open', !!maskFull);
['plan', 'elev'].forEach(w => { const b = document.getElementById(w === 'plan' ? 'mpMaskPlan' : 'mpMaskElev'); if (b) b.classList.toggle('full', maskFull === w); });
renderMaskViews();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && maskFull) maskToggleFull(maskFull); });
window.addEventListener('resize', () => { if (maskFull) renderMaskViews(); });
function maskTapWall(i) {
if (maskDragged) { maskDragged = false; return; }
if (maskFull === 'plan') maskToggleFull('plan');
maskElevWall = i;
maskViews.elev = { z: 1, x: 0, y: 0 };
renderMeasure();
const el = document.getElementById('mpMaskElev');
if (el) el.scrollIntoView({ block: 'center' });
}
function maskStep(dir) {
const n = (measure.walls || []).length;
if (!n) return;
maskElevWall = (maskElevWall + dir + n) % n;
maskViews.elev = { z: 1, x: 0, y: 0 };
renderMeasure();
}

/* ---------- вкладка «Укрывка» ---------- */
function maskTabHtml(m) {
const d = maskEnsure();
const lens = (m.walls || []).map(mNum);
const n = lens.length;
if (maskElevWall >= n) maskElevWall = 0;
const hasWalls = lens.some(v => v > 0);
const chip = (on, label, click) => `<button type="button" class="mp-ce-wall${on ? ' on' : ''}" onclick="${click}" aria-pressed="${on}">${label}</button>`;
return `<section class="mp-sec">
<div class="mp-sec-title">Укрывка</div>
<div class="mp-hint">Отметьте, что укрываем. Считается периметр примыкания: рамки окон и дверей, контур мебели на стене, линия пол–стена или потолок–стена, контур готовых стен. Где периметры совпадают, участок считается один раз. Площадь под плёнку — справочно.</div>
<div class="mp-ce-walls" style="margin-top:6px;"><span class="mp-ce-walls-label">Укрываем:</span>${MASK_KINDS.map(x => chip(d[x.key], x.label, `maskToggle('${x.key}')`)).join('')}</div>
${hasWalls ? `<div class="mp-ce-walls" style="margin-top:6px;"><span class="mp-ce-walls-label">Готовые стены:</span>${lens.map((v, i) => v > 0 ? chip(d.walls.includes(i), String(i + 1), `maskWallToggle(${i})`) : '').join('')}${chip(lens.filter(v => v > 0).length > 0 && lens.every((v, i) => !(v > 0) || d.walls.includes(i)), 'все', 'maskAllWalls()')}</div>` : ''}
<div class="mp-ce-plan rl-sketch${maskFull === 'plan' ? ' full' : ''}" id="mpMaskPlan"></div>
<div class="mp-hint">Касание стены на плане — её развёртка ниже. Оранжевым — что укрываем.</div>
${hasWalls ? `<div class="rl-elev-nav"><button type="button" onclick="maskStep(-1)" aria-label="Предыдущая стена">‹</button><span>Стена ${maskElevWall + 1} из ${n}</span><button type="button" onclick="maskStep(1)" aria-label="Следующая стена">›</button></div>
<div class="mp-ce-plan rl-sketch${maskFull === 'elev' ? ' full' : ''}" id="mpMaskElev"></div>` : ''}
<div class="mp-calc" id="mpCalcMask"></div>
</section>`;
}
function updateMaskOutputs(r) {
const t = r.maskInfo || maskCompute(measure);
renderMaskViews();
const el = document.getElementById('mpCalcMask');
if (el) el.innerHTML = [t.lines.len, t.lines.area, t.lines.loose].filter(Boolean).map(escapeHtml).join('<br>') || 'Отметьте, что укрываем';
}
function maskToggle(key) {
const d = maskEnsure();
d[key] = !d[key];
saveMeasureDraft();
renderMeasure();
}
function maskWallToggle(i) {
const d = maskEnsure();
const set = new Set(d.walls);
if (set.has(i)) set.delete(i); else set.add(i);
d.walls = [...set].sort((a, b) => a - b);
maskElevWall = i;
saveMeasureDraft();
renderMeasure();
}
function maskAllWalls() {
const d = maskEnsure();
const all = (measure.walls || []).map((w, i) => mNum(w) > 0 ? i : -1).filter(i => i >= 0);
d.walls = all.every(i => d.walls.includes(i)) ? [] : all;
saveMeasureDraft();
renderMeasure();
}
function setMaskPick(p) { measureMaskPick = p; updateMeasureOutputs(); }
// номера готовых стен после перестройки стен: map[старый] = новый (или -1)
function remapMaskWalls(m, map) {
if (!m || !m.mask || !Array.isArray(m.mask.walls)) return;
m.mask.walls = [...new Set(m.mask.walls.map(i => map[i]).filter(i => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b);
}
