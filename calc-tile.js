// Кабинет мастера — плитка: на стенах и на полу, размер, шов, раскладка, запас, упаковки.
// Подключается из calc.html после calc-molding.js; порядок подключения важен.

/* ===================== ПЛИТКА ===================== */
// В замере: measure.tile = {
//   walls: { on, walls: [номера] | null (все), h: высота укладки (пусто — до потолка),
//            w, l: плитка, мм (ширина вдоль стены × высота), joint: шов, мм,
//            layout: 'straight' | 'offset' | 'diag' | 'herring', waste: запас, % (пусто — по раскладке),
//            pack: м² в упаковке,
//            ax, ay: откуда целая плитка — 'start' | 'end' | 'cjoint' (шов по центру) | 'ctile' (центр плитки) },
//   floor: { on, w, l, joint, layout, waste, pack }
// }
// Площадь стен — за вычетом части проёмов, попавшей в высоту укладки. Плиток —
// площадь с запасом, делённая на площадь плитки, вверх до целой.

const TILE_LAYOUTS = [
{ key: 'straight', label: 'Прямая', waste: 10 },
{ key: 'offset', label: 'Со смещением', waste: 12 },
{ key: 'diag', label: 'По диагонали', waste: 15 },
{ key: 'herring', label: 'Ёлочка', waste: 20 }
];
const TILE_INK = '#1f7a8c';
// Откуда идёт целая плитка (подрезка — с другой стороны) или по центру
const TILE_ALIGN = [
{ key: 'start', h: 'Слева', vWall: 'Снизу', vFloor: 'Сверху' },
{ key: 'end', h: 'Справа', vWall: 'Сверху', vFloor: 'Снизу' },
{ key: 'cjoint', h: 'По центру: шов', vWall: 'По центру: шов', vFloor: 'По центру: шов' },
{ key: 'ctile', h: 'По центру: плитка', vWall: 'По центру: плитка', vFloor: 'По центру: плитка' }
];
const tileAlign = v => TILE_ALIGN.some(x => x.key === v) ? v : 'start';
// Начало раскладки на отрезке [a, b] при модуле m: край целой плитки
function tileOriginOn(al, a, b, m) {
if (al === 'end') return b;
if (al === 'cjoint') return (a + b) / 2;
if (al === 'ctile') return (a + b) / 2 - m / 2;
return a;
}
// Крайние куски на отрезке [a, b] (прямая раскладка): у начала и у конца
function tileEdgePieces(o, a, b, m) {
if (!(m > 0) || !(b > a)) return null;
const first = o - Math.floor((o - a) / m + 1e-9) * m;          // первый край не левее a
const last = o + Math.floor((b - o) / m + 1e-9) * m;           // последний край не правее b
const p0 = first - a > 0.0005 ? first - a : m;
const p1 = b - last > 0.0005 ? b - last : m;
if (first > b - 0.0005) return { a: b - a, b: b - a, one: true };
return { a: Math.min(p0, b - a), b: Math.min(p1, b - a) };
}
let tileElevWall = 0;
let measureTilePick = 'tileWalls';

function tileGet(m) {
const d = m && m.tile && typeof m.tile === 'object' ? m.tile : {};
return {
walls: d.walls || { on: false, walls: null, h: '', w: '', l: '', joint: '', layout: 'straight', waste: '', pack: '' },
floor: d.floor || { on: false, w: '', l: '', joint: '', layout: 'straight', waste: '', pack: '' }
};
}
function tileEnsure() {
const d = tileGet(measure);
measure.tile = { walls: d.walls, floor: d.floor };
return measure.tile;
}
const tileLayout = s => TILE_LAYOUTS.find(x => x.key === s.layout) || TILE_LAYOUTS[0];
const tileWastePct = s => { const v = evalMeasureExpr(s.waste); return isFinite(v) && v >= 0 ? v : tileLayout(s).waste; };
// размер плитки в метрах (поля — в мм)
const tileSize = s => ({ w: mNum(s.w) / 1000, l: mNum(s.l) / 1000, j: Math.max(0, evalMeasureExpr(s.joint) || 0) / 1000 });

// Высота укладки на стене: заданная (не выше стены) или до потолка
function tileWallH(m, s, wi) {
const Hh = wallHeightOf(m, wi);
const h = mNum(s.h);
return h > 0 ? Math.min(h, Hh || h) : Hh;
}
// Проёмы стены, обрезанные высотой укладки: [{ a0, a1, y0, y1, area }]
function tileWallCuts(m, wi, L, Ht) {
const Hh = wallHeightOf(m, wi);
return (m.openings || []).filter(o => o.wall === wi && openingWidth(o) > 0).flatMap(o => {
const [a0, a1] = openingSpan(o, L);
const v = openingVert(o, Hh);
const parts = o.type === 'balcony'
? (() => { const bp = balconyParts(o, a0, a1); return [[bp.door[0], bp.door[1], 0, v.door[1]], [bp.win[0], bp.win[1], v.y0, v.y1]]; })()
: [[a0, a1, v.y0, v.y1]];
return parts.map(([x0, x1, y0, y1]) => {
const t0 = Math.max(0, y0), t1 = Math.min(Ht, y1);
return { a0: x0, a1: x1, y0, y1, area: t1 > t0 ? (x1 - x0) * (t1 - t0) : 0 };
});
});
}

// Площадь пола: по контуру комнаты, иначе — как потолок, введённый участками
function tileFloorArea(m, r) {
try {
const g = typeof rulerGeometry === 'function' && Array.isArray(m.walls) && m.walls.length ? rulerGeometry(m) : null;
if (g && g.closed) {
const pts = [[0, 0], ...g.segs.map(q => [q.x2, q.y2])];
let a = 0;
for (let i = 0; i < pts.length - 1; i++) a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
if (Math.abs(a) / 2 > 0.01) return { area: Math.abs(a) / 2, how: 'по контуру стен' };
}
} catch (e) { /* без чертежа */ }
return r && r.ceiling > 0 ? { area: r.ceiling, how: 'как потолок' } : { area: 0, how: '' };
}

// Плиток и упаковок на площадь
function tileCount(area, s) {
const { w, l } = tileSize(s);
const waste = tileWastePct(s);
const need = area * (1 + waste / 100);
const pcs = w > 0 && l > 0 ? Math.ceil(need / (w * l) - 1e-9) : 0;
const pack = mNum(s.pack);
return { need, pcs, waste, packs: pack > 0 ? Math.ceil(need / pack - 1e-9) : 0, pack };
}
function tileCountTxt(s, c) {
const { w, l } = tileSize(s);
const size = w > 0 && l > 0 ? `плитка ${Math.round(w * 1000)}×${Math.round(l * 1000)} мм` : 'размер плитки не указан';
return `${size}, ${tileLayout(s).label.toLowerCase()}, запас ${mFmt(c.waste)}% → ${mFmt(c.need)} м²${c.pcs ? ` = ${c.pcs} шт.` : ''}${c.packs ? `, упаковок по ${mFmt(c.pack)} м²: ${c.packs}` : ''}`;
}

function tileCompute(m, r) {
const d = tileGet(m);
const out = { walls: 0, floor: 0, wallsCount: null, floorCount: null, lines: {} };
if (d.walls.on && typeof openingSpan === 'function') {
const lens = (m.walls || []).map(mNum);
const ws = molWalls(d.walls.walls, m);
const parts = [];
let gross = 0, cut = 0;
ws.forEach(wi => {
const L = lens[wi], Ht = tileWallH(m, d.walls, wi);
if (!(L > 0) || !(Ht > 0)) return;
gross += L * Ht;
cut += tileWallCuts(m, wi, L, Ht).reduce((a, c) => a + c.area, 0);
parts.push(`${mFmt(L)}×${mFmt(Ht)}`);
});
out.walls = Math.max(0, gross - cut);
if (out.walls > 0) {
const all = ws.length === lens.filter(v => v > 0).length;
out.wallsCount = tileCount(out.walls, d.walls);
out.lines.walls = `Плитка на стенах (${all ? 'все стены' : `${ws.length > 1 ? 'стены' : 'стена'} ${ws.map(i => i + 1).join(', ')}`}${mNum(d.walls.h) > 0 ? `, до ${mFmt(mNum(d.walls.h))} м` : ', до потолка'}): ${parts.join(' + ')}${cut > 0 ? ` − проёмы ${mFmt(cut)}` : ''} = ${mFmt(out.walls)} м²; ${tileCountTxt(d.walls, out.wallsCount)}`;
}
}
if (d.floor.on) {
const f = tileFloorArea(m, r);
out.floor = f.area;
if (out.floor > 0) {
out.floorCount = tileCount(out.floor, d.floor);
out.lines.floor = `Плитка на полу (${f.how}): ${mFmt(out.floor)} м²; ${tileCountTxt(d.floor, out.floorCount)}`;
} else out.lines.floorBad = 'Плитка на полу: нужна площадь — замкните комнату на вкладке «Стены» или введите потолок участками';
}
if (out.walls > 0 && out.floor > 0) out.lines.all = `Плитка всего: ${mFmt(out.walls)} + ${mFmt(out.floor)} = ${mFmt(out.walls + out.floor)} м²`;
return out;
}

/* ---------- раскладка: плитки в метрах на плоскости ---------- */
// Плитки, покрывающие прямоугольник [x0, x1] × [y0, y1] (в метрах), как многоугольники.
// Начало раскладки — точка (0, 0). Больше max плиток — null (слишком мелко рисовать).
function tilePolys(s, x0, y0, x1, y1, max = 2500, origin = [0, 0]) {
const [gx, gy] = origin;
x0 -= gx; x1 -= gx; y0 -= gy; y1 -= gy;
const { w, l, j } = tileSize(s);
if (!(w > 0) || !(l > 0)) return null;
const lay = tileLayout(s).key;
const rot = lay === 'diag' || lay === 'herring' ? Math.PI / 4 : 0;
const c = Math.cos(rot), sn = Math.sin(rot);
const fwd = (u, v) => [u * c - v * sn + gx, u * sn + v * c + gy];  // местные → общие
const back = (x, y) => [x * c + y * sn, -x * sn + y * c];          // общие → местные
const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => back(x, y));
const u0 = Math.min(...corners.map(p => p[0])), u1 = Math.max(...corners.map(p => p[0]));
const v0 = Math.min(...corners.map(p => p[1])), v1 = Math.max(...corners.map(p => p[1]));
const out = [];
const add = (u, v, a, b) => {
if (u + a < u0 || u > u1 || v + b < v0 || v > v1) return;
out.push([[u, v], [u + a - j, v], [u + a - j, v + b - j], [u, v + b - j]].map(([p, q]) => fwd(p, q)));
};
const est = ((u1 - u0) * (v1 - v0)) / (w * l);
if (est > max) return null;
if (lay === 'herring') {
// ёлочка: пары «вдоль + поперёк» ступенькой по W, соседние ряды сдвинуты на (L, −L)
const L = Math.max(w, l), W = Math.min(w, l);
const ks = [], ss = [];
[[u0 - L, v0 - L], [u1 + L, v0 - L], [u1 + L, v1 + L], [u0 - L, v1 + L]].forEach(([u, v]) => { ks.push((u + v) / (2 * W)); ss.push((u - v) / (2 * L)); });
for (let s2 = Math.floor(Math.min(...ss)) - 1; s2 <= Math.ceil(Math.max(...ss)) + 1; s2++) {
for (let k = Math.floor(Math.min(...ks)) - 1; k <= Math.ceil(Math.max(...ks)) + 1; k++) {
const u = k * W + s2 * L, v = k * W - s2 * L;
add(u, v, L, W);
add(u, v + W, W, L);
}
}
} else {
const mw = w, ml = l;
for (let row = Math.floor(v0 / ml) - 1; row * ml <= v1; row++) {
const shift = lay === 'offset' && row % 2 ? mw / 2 : 0;
for (let col = Math.floor((u0 - shift) / mw) - 1; col * mw + shift <= u1; col++) add(col * mw + shift, row * ml, mw, ml);
}
}
return out;
}

// Начало раскладки на стене (a — вдоль стены от угла А, h — от пола) и крайние куски.
// «Слева» — как видно на развёртке: при обходе против часовой слева угол Б.
function tileWallLayout(m, s, wi, L, Ht) {
let flip = false;
try { const g = molGeom(m); flip = !!g && (g.orient || 1) < 0; } catch (e) { flip = false; }
const { w, l } = tileSize(s);
let ax = tileAlign(s.ax);
if (flip && (ax === 'start' || ax === 'end')) ax = ax === 'start' ? 'end' : 'start';
const ox = tileOriginOn(ax, 0, L, w), oy = tileOriginOn(tileAlign(s.ay), 0, Ht, l);
const straight = ['straight', 'offset'].includes(tileLayout(s).key);
const ex = straight && tileLayout(s).key === 'straight' ? tileEdgePieces(ox, 0, L, w) : null;
const ey = straight ? tileEdgePieces(oy, 0, Ht, l) : null;
// по ширине — слева и справа на экране
const hx = ex ? (flip ? { left: ex.b, right: ex.a } : { left: ex.a, right: ex.b }) : null;
return { origin: [ox, oy], hx, ey };
}
function tileFloorLayout(s, minX, minY, maxX, maxY) {
const { w, l } = tileSize(s);
const ox = tileOriginOn(tileAlign(s.ax), minX, maxX, w), oy = tileOriginOn(tileAlign(s.ay), minY, maxY, l);
const straight = tileLayout(s).key === 'straight';
return { origin: [ox, oy], ex: straight ? tileEdgePieces(ox, minX, maxX, w) : null, ey: ['straight', 'offset'].includes(tileLayout(s).key) ? tileEdgePieces(oy, minY, maxY, l) : null };
}
const tileMm = v => `${Math.round(v * 1000)}`;
// «слева 150, справа 150 мм · снизу 600 (целая), сверху 200 мм»
function tilePiecesTxt(h, hFull, v, vFull, names) {
const one = (p, full) => `${tileMm(p)}${Math.abs(p - full) < 0.0006 ? ' (целая)' : ''}`;
const part = (p, full, n0, n1) => !p ? '' : p.one ? `${n0}–${n1}: одна полоса ${tileMm(p.a)} мм` : `${n0} ${one(p.a, full)}, ${n1} ${one(p.b, full)} мм`;
return [part(h, hFull, names[0], names[1]), part(v, vFull, names[2], names[3])].filter(Boolean).join(' · ');
}

/* ---------- рисунки ---------- */
// План: пол с раскладкой плитки по контуру комнаты
function tilePlanSvg(m, W = 340, H = 240, vw = { z: 1, x: 0, y: 0 }) {
const g = typeof molGeom === 'function' ? molGeom(m) : null;
if (!g || !g.segs.length) return '<div class="mp-hint" style="padding:18px 8px;text-align:center;">Чертёж пола появится, когда стены введены на вкладке «Стены»</div>';
const P = 30;
const xs = [0, ...g.segs.map(q => q.x2)], ys = [0, ...g.segs.map(q => q.y2)];
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
const k0 = Math.min((W - 2 * P) / Math.max(maxX - minX, 0.5), (H - 2 * P) / Math.max(maxY - minY, 0.5));
const ox0 = (W - (maxX - minX) * k0) / 2 - minX * k0, oy0 = (H - (maxY - minY) * k0) / 2 - minY * k0;
const z = vw.z, vx = (W - W / z) / 2 + vw.x, vy = (H - H / z) / 2 + vw.y;
const k = k0 * z, ox = (ox0 - vx) * z, oy = (oy0 - vy) * z;
const X = v => ox + v * k, Y = v => oy + v * k;
const d = tileGet(m);
const pts = [[0, 0], ...g.segs.map(q => [q.x2, q.y2])];
const path = `M${pts.map(p => `${X(p[0])} ${Y(p[1])}`).join('L')}Z`;
let s = g.closed ? `<path d="${path}" fill="#f6f7f9"/>` : '';
if (d.floor.on && g.closed) {
const fl = tileFloorLayout(d.floor, minX, minY, maxX, maxY);
const tiles = tilePolys(d.floor, minX, minY, maxX, maxY, 2500, fl.origin);
if (tiles) {
s += `<clipPath id="tlFloorClip"><path d="${path}"/></clipPath><g clip-path="url(#tlFloorClip)">`;
s += tiles.map(t => `<path d="M${t.map(([x, y]) => `${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join('L')}Z" fill="#e3f1f4" stroke="${TILE_INK}" stroke-width=".6"/>`).join('');
s += '</g>';
} else if (tileSize(d.floor).w > 0) s += `<text x="${W / 2}" y="${H - 8}" text-anchor="middle" font-size="10" fill="#5d6878">плитка мелкая — сетка не рисуется</text>`;
}
g.segs.forEach(q => {
s += `<path d="M${X(q.x1)} ${Y(q.y1)}L${X(q.x2)} ${Y(q.y2)}" stroke="#14181f" stroke-width="3.5" stroke-linecap="square" ${q.empty ? 'stroke-dasharray="5 5" opacity=".35"' : ''}/>`;
if (!(q.len > 0)) return;
const o = g.orient || 1;
const mx = (X(q.x1) + X(q.x2)) / 2 + q.dy * o * 13, my = (Y(q.y1) + Y(q.y2)) / 2 - q.dx * o * 13;
const on = d.walls.on && molWalls(d.walls.walls, m).includes(q.i);
s += `<circle cx="${mx}" cy="${my}" r="8" fill="${q.i === tileElevWall ? '#14181f' : '#ffffff'}" stroke="${on ? TILE_INK : '#14181f'}" stroke-width="${on ? 2 : 1}"/><text x="${mx}" y="${my + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="${q.i === tileElevWall ? '#ffffff' : '#14181f'}">${q.i + 1}</text>`;
s += `<path d="M${X(q.x1)} ${Y(q.y1)}L${X(q.x2)} ${Y(q.y2)}" stroke="transparent" stroke-width="22" style="cursor:pointer" onclick="tileTapWall(${q.i})"><title>Развёртка стены ${q.i + 1}</title></path>`;
});
return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Плитка на полу" font-family="inherit">${s}</svg>`;
}

// Развёртка стены: плитка до высоты укладки, проёмы вырезаны
function tileElevSvg(m, wi, W = 340, H = 240, vw = { z: 1, x: 0, y: 0 }) {
const g = typeof molGeom === 'function' ? molGeom(m) : null;
const left = 34, right = 14, top = 16, bottom = 40;
const L = mNum((m.walls || [])[wi]), Hh = wallHeightOf(m, wi);
if (!(L > 0) || !(Hh > 0)) return `<div class="mp-hint" style="padding:18px 8px;text-align:center;">${!(L > 0) ? 'Введите длину стены на вкладке «Стены»' : 'Введите высоту стен на вкладке «Стены»'}</div>`;
const k0 = Math.min((W - left - right) / L, (H - top - bottom) / Hh);
const z = vw.z, vx = (W - W / z) / 2 + vw.x, vy = (H - H / z) / 2 + vw.y;
const k = k0 * z;
const x0 = (left + ((W - left - right) - L * k0) / 2 - vx) * z, yF = (top + ((H - top - bottom) - Hh * k0) / 2 + Hh * k0 - vy) * z;
const flip = g && (g.orient || 1) < 0;
const XA = a => flip ? x0 + (L - a) * k : x0 + a * k;
const Yh = h => yF - h * k;
const d = tileGet(m);
const on = d.walls.on && molWalls(d.walls.walls, m).includes(wi);
const Ht = on ? tileWallH(m, d.walls, wi) : 0;
let s = `<rect x="${x0}" y="${Yh(Hh)}" width="${L * k}" height="${Hh * k}" fill="#ffffff" stroke="#14181f" stroke-width="1.6"/>`;
if (on && Ht > 0) {
const wl = tileWallLayout(m, d.walls, wi, L, Ht);
const tiles = tilePolys(d.walls, 0, 0, L, Ht, 2500, wl.origin);
const xl = Math.min(XA(0), XA(L));
s += `<clipPath id="tlWallClip"><rect x="${xl}" y="${Yh(Ht)}" width="${L * k}" height="${Ht * k}"/></clipPath>`;
if (tiles) s += `<g clip-path="url(#tlWallClip)">${tiles.map(t => `<path d="M${t.map(([a, h]) => `${XA(a).toFixed(1)} ${Yh(h).toFixed(1)}`).join('L')}Z" fill="#e3f1f4" stroke="${TILE_INK}" stroke-width=".6"/>`).join('')}</g>`;
else s += `<rect x="${xl}" y="${Yh(Ht)}" width="${L * k}" height="${Ht * k}" fill="#e3f1f4"/>`;
if (Ht < Hh - 0.005) s += `<path d="M${x0} ${Yh(Ht)}H${x0 + L * k}" stroke="${TILE_INK}" stroke-width="1.6"/><text x="${x0 + L * k + 3}" y="${Yh(Ht) + 4}" font-size="10" fill="${TILE_INK}">${mFmt(Ht)}</text>`;
}
// проёмы — поверх плитки
tileWallCuts(m, wi, L, Hh).forEach(c => {
const xl = Math.min(XA(c.a0), XA(c.a1)), xr = Math.max(XA(c.a0), XA(c.a1));
s += `<rect x="${xl}" y="${Yh(c.y1)}" width="${xr - xl}" height="${(c.y1 - c.y0) * k}" fill="#ffffff" stroke="#14181f" stroke-width="1.2"/>`;
});
s += `<path d="M${x0 - 6} ${yF}H${x0 + L * k + 6}" stroke="#14181f" stroke-width="3"/>`;
s += `<text x="${x0 + L * k / 2}" y="${yF + 17}" text-anchor="middle" font-size="12" font-weight="700" fill="#14181f">${mFmt(L)} м</text>`;
s += `<text x="${x0 - 10}" y="${(yF + Yh(Hh)) / 2}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#14181f" transform="rotate(-90 ${x0 - 10} ${(yF + Yh(Hh)) / 2})">${mFmt(Hh)}</text>`;
if (!on) s += `<text x="${x0 + L * k / 2}" y="${(yF + Yh(Hh)) / 2}" text-anchor="middle" font-size="11" fill="#5d6878">${d.walls.on ? 'на этой стене плитки нет' : 'плитка на стенах не включена'}</text>`;
return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Плитка на стене ${wi + 1}" font-family="inherit">${s}</svg>`;
}

/* ---------- приближение, перемещение и весь экран — как на «Углах» и «Лепнине» ---------- */
const tileViews = { plan: { z: 1, x: 0, y: 0 }, elev: { z: 1, x: 0, y: 0 } };
let tileFull = null, tileDragged = false;
function tileSizeOf(box, which) {
if (tileFull === which && box && box.clientWidth > 0 && box.clientHeight > 0) return { W: 340, H: Math.round(340 * box.clientHeight / box.clientWidth) };
return { W: 340, H: 240 };
}
function renderTileViews() {
if (!measure) return;
[['plan', 'mpTilePlan'], ['elev', 'mpTileElev']].forEach(([which, id]) => {
const box = document.getElementById(id);
if (!box) return;
const { W, H } = tileSizeOf(box, which);
const vw = tileViews[which];
const svg = which === 'plan' ? tilePlanSvg(measure, W, H, vw) : tileElevSvg(measure, tileElevWall, W, H, vw);
if (!svg.startsWith('<svg')) { box.innerHTML = svg; return; }
const moved = Math.abs(vw.z - 1) > 0.01 || Math.abs(vw.x) > 1 || Math.abs(vw.y) > 1;
const full = tileFull === which;
box.innerHTML = `${svg}<div class="rl-zoom cp-zoom">
<button type="button" onclick="tileZoom('${which}', 1.6)" aria-label="Приблизить">+</button>
<button type="button" onclick="tileZoom('${which}', 1 / 1.6)" aria-label="Отдалить">−</button>
${moved ? `<button type="button" onclick="tileReset('${which}')" aria-label="Весь чертёж">⤢</button>` : ''}
<button type="button" onclick="tileToggleFull('${which}')" aria-label="${full ? 'Закрыть' : 'Во весь экран'}">${full ? '✕' : '⛶'}</button>
</div>${full && which === 'elev' ? `<div class="cp-caption">Стена ${tileElevWall + 1} <button type="button" class="cn-cap-btn" onclick="tileStep(-1)">‹</button><button type="button" class="cn-cap-btn" onclick="tileStep(1)">›</button></div>` : ''}`;
bindPanZoom(box, () => tileViews[which], () => renderTileViews(), v => { tileDragged = v; }, f => tileZoom(which, f));
});
}
function tileZoom(which, f) { const v = tileViews[which]; v.z = Math.min(8, Math.max(0.5, v.z * f)); renderTileViews(); }
function tileReset(which) { tileViews[which] = { z: 1, x: 0, y: 0 }; renderTileViews(); }
function tileToggleFull(which) {
tileFull = tileFull === which ? null : which;
document.body.classList.toggle('cp-full-open', !!tileFull);
['plan', 'elev'].forEach(w => { const b = document.getElementById(w === 'plan' ? 'mpTilePlan' : 'mpTileElev'); if (b) b.classList.toggle('full', tileFull === w); });
renderTileViews();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tileFull) tileToggleFull(tileFull); });
window.addEventListener('resize', () => { if (tileFull) renderTileViews(); });
function tileTapWall(i) {
if (tileDragged) { tileDragged = false; return; }
if (tileFull === 'plan') tileToggleFull('plan');
tileElevWall = i;
tileViews.elev = { z: 1, x: 0, y: 0 };
renderMeasure();
const el = document.getElementById('mpTileElev');
if (el) el.scrollIntoView({ block: 'center' });
}
function tileStep(dir) {
const n = (measure.walls || []).length;
if (!n) return;
tileElevWall = (tileElevWall + dir + n) % n;
tileViews.elev = { z: 1, x: 0, y: 0 };
renderMeasure();
}

/* ---------- вкладка «Плитка» ---------- */
function tileTabHtml(m) {
const d = tileEnsure();
const lens = (m.walls || []).map(mNum);
const n = lens.length;
if (tileElevWall >= n) tileElevWall = 0;
const hasWalls = lens.some(v => v > 0);
// размер, шов, раскладка, запас, упаковка — у стен и у пола свои
const params = (kind, s, sizeLabels) => `<div class="mp-dims" style="margin-top:6px;">
<label>${sizeLabels[0]}, мм${mIn(`tile.${kind}.w`, s.w, kind === 'walls' ? '300' : '600')}</label><span class="mp-x">×</span>
<label>${sizeLabels[1]}, мм${mIn(`tile.${kind}.l`, s.l, kind === 'walls' ? '600' : '600')}</label><span class="mp-x">·</span>
<label>Шов, мм${mIn(`tile.${kind}.joint`, s.joint, '2')}</label>
</div>
<div class="mp-ce-walls" style="margin-top:6px;"><span class="mp-ce-walls-label">Раскладка:</span>${TILE_LAYOUTS.map(x => `<button type="button" class="mp-ce-wall${tileLayout(s).key === x.key ? ' on' : ''}" onclick="tileSetLayout('${kind}', '${x.key}')" aria-pressed="${tileLayout(s).key === x.key}">${x.label}</button>`).join('')}</div>
${['ax', 'ay'].map(axis => `<div class="mp-ce-walls" style="margin-top:6px;"><span class="mp-ce-walls-label">${axis === 'ax' ? 'Целая плитка ↔' : 'Целая плитка ↕'}:</span>${TILE_ALIGN.map(x => {
const label = axis === 'ax' ? x.h : (kind === 'walls' ? x.vWall : x.vFloor);
const on = tileAlign(s[axis]) === x.key;
return `<button type="button" class="mp-ce-wall${on ? ' on' : ''}" onclick="tileSetAlign('${kind}', '${axis}', '${x.key}')" aria-pressed="${on}">${label}</button>`;
}).join('')}</div>`).join('')}
<div class="mp-dims mp-dims-2" style="margin-top:6px;">
<label>Запас, %${mIn(`tile.${kind}.waste`, s.waste, String(tileLayout(s).waste))}</label><span class="mp-x">·</span>
<label>В упаковке, м²${mIn(`tile.${kind}.pack`, s.pack, '1,44')}</label>
</div>`;
const toggle = (kind, on, label) => `<label class="mp-check mp-ce-light"><input type="checkbox" ${on ? 'checked' : ''} onchange="tileSet('${kind}', this.checked)"><span>${label}</span></label>`;
const chips = () => {
const ws = molWalls(d.walls.walls, m);
const all = ws.length === lens.filter(v => v > 0).length;
return `<div class="mp-ce-walls"><span class="mp-ce-walls-label">Стены:</span>${lens.map((v, i) => v > 0 ? `<button type="button" class="mp-ce-wall${ws.includes(i) ? ' on' : ''}" onclick="tileWallToggle(${i})">${i + 1}</button>` : '').join('')}<button type="button" class="mp-ce-wall mp-ce-all${all ? ' on' : ''}" onclick="tileAllWalls()">все</button></div>`;
};
return `<section class="mp-sec">
<div class="mp-sec-title">Плитка на стенах</div>
${toggle('walls', d.walls.on, 'Плитка на стенах — проёмы вычитаются')}
${d.walls.on ? `${hasWalls ? chips() : '<div class="mp-hint">Сначала введите стены на вкладке «Стены».</div>'}
<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Высота укладки ↕${mIn('tile.walls.h', d.walls.h, 'до потолка')}</label><span></span><span class="mp-hint" style="margin:0;align-self:center;">пусто — на всю стену</span></div>
${params('walls', d.walls, ['Ширина ↔', 'Высота ↕'])}` : ''}
${hasWalls ? `<div class="rl-elev-nav"><button type="button" onclick="tileStep(-1)" aria-label="Предыдущая стена">‹</button><span>Стена ${tileElevWall + 1} из ${n}</span><button type="button" onclick="tileStep(1)" aria-label="Следующая стена">›</button></div>
<div class="mp-ce-plan rl-sketch${tileFull === 'elev' ? ' full' : ''}" id="mpTileElev"></div>
<div class="mp-hint" id="mpTileWallCuts"></div>` : ''}
<div class="mp-calc" id="mpCalcTileWalls"></div>
</section>
<section class="mp-sec">
<div class="mp-sec-title">Плитка на полу</div>
${toggle('floor', d.floor.on, 'Плитка на полу')}
${d.floor.on ? params('floor', d.floor, ['Ширина', 'Длина']) : ''}
<div class="mp-ce-plan rl-sketch${tileFull === 'plan' ? ' full' : ''}" id="mpTilePlan"></div>
<div class="mp-hint" id="mpTileFloorCuts"></div>
<div class="mp-hint">Касание стены на плане — её развёртка выше. Обведены стены с плиткой.</div>
<div class="mp-calc" id="mpCalcTileFloor"></div>
</section>`;
}

function updateTileOutputs(r) {
const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
const t = r.tile || tileCompute(measure, r);
renderTileViews();
set('mpCalcTileWalls', t.lines.walls ? escapeHtml(t.lines.walls) : '');
const d = tileGet(measure);
// крайние куски: на стене с развёртки и на полу
const wi = tileElevWall, L = mNum((measure.walls || [])[wi]);
if (d.walls.on && molWalls(d.walls.walls, measure).includes(wi) && L > 0 && tileSize(d.walls).w > 0 && tileSize(d.walls).l > 0) {
const Ht = tileWallH(measure, d.walls, wi);
const wl = tileWallLayout(measure, d.walls, wi, L, Ht);
const txt = tilePiecesTxt(wl.hx ? { a: wl.hx.left, b: wl.hx.right, one: wl.hx.left >= L - 0.0005 } : null, tileSize(d.walls).w, wl.ey, tileSize(d.walls).l, ['слева', 'справа', 'снизу', 'сверху']);
set('mpTileWallCuts', txt ? `Крайние куски на стене ${wi + 1}: ${escapeHtml(txt)}` : (tileLayout(d.walls).key !== 'straight' ? 'Крайние куски по ширине считаются для прямой раскладки' : ''));
} else set('mpTileWallCuts', '');
let g = null;
try { g = molGeom(measure); } catch (e) { g = null; }
if (d.floor.on && g && g.closed && tileSize(d.floor).w > 0 && tileSize(d.floor).l > 0) {
const xs = [0, ...g.segs.map(q => q.x2)], ys = [0, ...g.segs.map(q => q.y2)];
const fl = tileFloorLayout(d.floor, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
const txt = tilePiecesTxt(fl.ex, tileSize(d.floor).w, fl.ey, tileSize(d.floor).l, ['слева', 'справа', 'сверху', 'снизу']);
set('mpTileFloorCuts', txt ? `Крайние куски на плане: ${escapeHtml(txt)}` : '');
} else set('mpTileFloorCuts', '');
set('mpCalcTileFloor', [t.lines.floor, t.lines.floorBad, t.lines.all].filter(Boolean).map(escapeHtml).join('<br>'));
}

function tileSet(kind, on) {
const d = tileEnsure();
d[kind] = { ...d[kind], on: !!on };
saveMeasureDraft();
renderMeasure();
}
function tileSetAlign(kind, axis, key) {
const d = tileEnsure();
d[kind] = { ...d[kind], [axis]: key };
saveMeasureDraft();
renderMeasure();
}
function tileSetLayout(kind, key) {
const d = tileEnsure();
d[kind] = { ...d[kind], layout: key };
saveMeasureDraft();
renderMeasure();
}
function tileWallToggle(wi) {
const d = tileEnsure();
const set = new Set(molWalls(d.walls.walls, measure));
if (set.has(wi)) set.delete(wi); else set.add(wi);
d.walls = { ...d.walls, walls: [...set].sort((a, b) => a - b) };
tileElevWall = wi;
saveMeasureDraft();
renderMeasure();
}
function tileAllWalls() {
const d = tileEnsure();
const all = molWalls(null, measure);
d.walls = { ...d.walls, walls: molWalls(d.walls.walls, measure).length === all.length ? [] : null };
saveMeasureDraft();
renderMeasure();
}
function setTilePick(p) { measureTilePick = p; updateMeasureOutputs(); }

// номера стен в плитке после перестройки стен: map[старый] = новый (или -1)
function remapTileWalls(m, map) {
if (!m || !m.tile || !m.tile.walls || !Array.isArray(m.tile.walls.walls)) return;
m.tile.walls.walls = [...new Set(m.tile.walls.walls.map(i => map[i]).filter(i => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b);
}
