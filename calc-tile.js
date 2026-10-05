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

/* ---------- подиумы, короба и экраны ---------- */
// measure.blocks = [{ type: 'podium' | 'box' | 'screen', name, wall, off, from, w, d, h, tile: 'floor' | 'walls' }]:
//   подиум — на полу (под ванну, душ, кухню): плитка на верх и открытые бока;
//   короб — под трубы, инсталляция: плитка на перед, открытые бока и верх (если не до потолка);
//   экран ванны — перед и открытый бок, сверху ванна.
//   wall — стена, к которой примыкает (пусто — стоит отдельно), w — длина вдоль стены
//   (пусто — вся стена), d — глубина от стены, h — высота (у короба пусто — до потолка),
//   off/from — отступ от угла А или Б (пусто — по центру).
// Бок у внутреннего угла прижат к соседней стене — его не облицовываем, а стену за ним,
// как и стену за самим элементом, вычитаем из плитки на стенах. Пол под элементом
// вычитается из плитки на полу, облицовка элемента прибавляется к плитке на стенах
// или на полу — как выбрано.
const BLOCK_TYPES = {
podium: { label: 'подиум', code: 'П', tile: 'floor', h: '0,15', add: 'Подиум' },
box: { label: 'короб', code: 'К', tile: 'walls', h: 'до потолка', add: 'Короб' },
screen: { label: 'экран ванны', code: 'Э', tile: 'walls', h: '0,6', add: 'Экран ванны' }
};
const blockType = el => el && BLOCK_TYPES[el.type] ? el.type : 'podium';
const blockCode = (list, idx) => {
const t = blockType(list[idx]);
return BLOCK_TYPES[t].code + '-' + list.slice(0, idx + 1).filter(x => blockType(x) === t).length;
};
const blockTile = el => el.tile === 'floor' || el.tile === 'walls' ? el.tile : BLOCK_TYPES[blockType(el)].tile;
function blockGeom(m, el) {
const type = blockType(el);
const wall = coverWall(m, el);
const Hh = (wall != null ? wallHeightOf(m, wall) : mNum(m.height)) || 0;
const d = mNum(el.d);
let h = mNum(el.h);
if (!(h > 0) && type === 'box') h = Hh;
if (Hh > 0) h = Math.min(h, Hh);
if (!(h > 0.005) || !(d > 0)) return null;
let w = mNum(el.w), span = null, off = null, L = 0;
if (wall != null) {
L = mNum(m.walls[wall]);
const ww = w > 0 ? Math.min(w, L) : L;
let a0 = (L - ww) / 2;
const o2 = radOpt(el.off);
if (isFinite(o2) && ww < L) { off = Math.min(o2, L - ww); a0 = el.from === 'end' ? L - off - ww : off; }
span = [Math.max(0, a0), Math.min(L, a0 + ww)];
w = span[1] - span[0];
}
if (!(w > 0)) return null;
return { type, wall, span, off, w, d, h, L, full: wall != null && w >= L - 0.005, toCeil: Hh > 0 && h >= Hh - 0.005 };
}
function blocksCompute(m) {
const list = Array.isArray(m.blocks) ? m.blocks : [];
const out = { list: [], walls: 0, floor: 0, hidden: [], foot: 0, edges: 0 };
list.forEach((el, idx) => {
const gm = blockGeom(m, el);
if (!gm) return;
const code = blockCode(list, idx), name = String(el.name || '').trim(), tile = blockTile(el);
// бока у внутренних углов прижаты к соседним стенам
const sides = gm.wall != null ? coverSideWalls(m, gm) : [];
const openSides = 2 - sides.length;
const island = gm.wall == null && gm.type !== 'screen';   // стоит отдельно — облицовка со всех сторон
const front = gm.w * gm.h * (island ? 2 : 1);
const side = gm.d * gm.h * openSides;
const topOn = gm.type !== 'screen' && !gm.toCeil;
const top = topOn ? gm.w * gm.d : 0;
const area = front + side + top;
// наружные углы (под уголок или запил): по высоте у открытых боков и по кромке верха
const edges = (island ? 4 : openSides) * gm.h + (topOn ? (island ? 2 * (gm.w + gm.d) : gm.w + gm.d * openSides) : 0);
if (gm.wall != null) out.hidden.push({ idx, code, wall: gm.wall, span: gm.span, h: gm.h });
sides.forEach(sd => out.hidden.push({ idx, code, wall: sd.wall, span: sd.span, h: gm.h, side: true }));
const foot = gm.w * gm.d;
out.foot += foot;
if (tile === 'floor') out.floor += area; else out.walls += area;
out.edges += edges;
const label = BLOCK_TYPES[gm.type].label;
const where = gm.wall != null ? `стена ${gm.wall + 1}${gm.full ? ', вся' : gm.off != null ? `, от угла ${el.from === 'end' ? 'Б' : 'А'} ${mFmt(gm.off)}` : ', по центру'}` : 'отдельно';
const parts = [`${island ? 'перед и зад' : gm.type === 'screen' ? 'экран' : 'перед'} ${mFmt(front)}`];
if (side > 0) parts.push(`${openSides > 1 || island ? 'бока' : 'бок'} ${mFmt(side)}`);
if (top > 0) parts.push(`верх ${mFmt(top)}`);
const shut = sides.map(s => `бок у угла ${s.c} прижат к стене ${s.wall + 1}`).join(', ');
const line = `${code} ${name || label} (${where}) ${mFmt(gm.w)}×${mFmt(gm.d)}×${mFmt(gm.h)}: ${parts.join(' + ')}${parts.length > 1 ? ` = ${mFmt(area)}` : ''} м²${shut ? `; ${shut}` : ''}; наружные углы ${mFmt(edges)} пог. м`;
out.list.push({ idx, code, name, label, ...gm, sides, openSides, island, front, side, top, area, edges, foot, tile, line });
});
return out;
}
// Сколько плитки на стене wi (до высоты Ht) спрятано за подиумами и коробами
function blocksHiddenOn(bl, wi, Ht) {
return bl.hidden.filter(p => p.wall === wi).reduce((a, p) => a + (p.span[1] - p.span[0]) * Math.min(p.h, Ht), 0);
}
// Прямоугольник элемента на плане: [[x, y] × 4] или null (стоит отдельно)
function blockPlanPoly(g, b) {
const s = g && b.wall != null ? g.segs[b.wall] : null;
if (!s) return null;
const o = g.orient || 1, nx = -s.dy * o, ny = s.dx * o;   // внутрь комнаты
const p0 = [s.x1 + s.dx * b.span[0], s.y1 + s.dy * b.span[0]];
const p1 = [s.x1 + s.dx * b.span[1], s.y1 + s.dy * b.span[1]];
return [p0, p1, [p1[0] + nx * b.d, p1[1] + ny * b.d], [p0[0] + nx * b.d, p0[1] + ny * b.d]];
}
const BLOCK_FILL = '#f4e3c3', BLOCK_INK = '#9a6a12';

/* ---------- подсчёт по раскладке: целые и подрезные плитки ---------- */
const tilePolyArea = pts => pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
// Пересечение многоугольника subject (любого) с выпуклым clip (плитка)
function tileClipPoly(subject, clip) {
const o = tilePolyArea(clip) < 0 ? -1 : 1;
let out = subject;
for (let i = 0; i < clip.length && out.length; i++) {
const a = clip[i], b = clip[(i + 1) % clip.length];
const side = p => o * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
const inp = out;
out = [];
for (let k = 0; k < inp.length; k++) {
const p = inp[k], q = inp[(k + 1) % inp.length];
const sp = side(p), sq = side(q);
if (sp >= 0) out.push(p);
if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
}
}
return out;
}
const tileClipArea = (subject, clip) => { const p = tileClipPoly(subject, clip); return p.length > 2 ? Math.abs(tilePolyArea(p)) : 0; };
// Ширина куска поперёк самой узкой стороны, в долях плитки: размах куска вдоль сторон плитки
// Размер куска вдоль сторон плитки, в долях плитки: [вдоль первой стороны, вдоль второй]
function tilePieceFracs(piece, t) {
const ax = [[t[0], t[1]], [t[0], t[3]]].map(([a, b]) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); return { ux: dx / L, uy: dy / L, L }; });
return ax.map(({ ux, uy, L }) => { const pr = piece.map(p => p[0] * ux + p[1] * uy); return Math.min(1, (Math.max(...pr) - Math.min(...pr)) / L); });
}
// Сколько плиток уйдёт на подрезные куски, если брать их из обрезков других плиток.
// Прямая раскладка и со смещением: кусок режется полосой вдоль одной стороны плитки,
// остаток той же полосы годится под следующий кусок (по узкой стороне куска).
// Диагональ и ёлочка — грубо, по площади кусков. На рез — запас 1% плитки.
function tileReuseCount(pieces, byAxes) {
const KERF = 0.01;
const items = pieces.map(p => byAxes ? (p.fu <= p.fv ? ['u', p.fu] : ['v', p.fv]) : ['a', p.f]).sort((a, b) => b[1] - a[1]);
const bins = { u: [], v: [], a: [] };
items.forEach(([k, x]) => {
const need = Math.min(1, x + KERF), b = bins[k];
const i = b.findIndex(rest => rest >= need - 1e-9);
if (i >= 0) b[i] -= need; else b.push(1 - need);
});
return bins.u.length + bins.v.length + bins.a.length;
}
function tileLayoutCount(s, region, holes, origin) {
const xs = region.map(p => p[0]), ys = region.map(p => p[1]);
const tiles = tilePolys(s, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), 40000, origin);
if (!tiles) return null;
const res = { whole: 0, cut: 0, narrow: 0, pieces: [] };
tiles.forEach(t => {
const full = Math.abs(tilePolyArea(t));
if (!(full > 0)) return;
const piece = tileClipPoly(region, t);
let a = piece.length > 2 ? Math.abs(tilePolyArea(piece)) : 0;
if (a > 0) holes.forEach(h => { a -= tileClipArea(h, t); });
const f = a / full;
if (f > 0.995) res.whole++;
else if (f > 0.01) {
const [fu, fv] = tilePieceFracs(piece, t);
res.cut++;
if (Math.min(fu, fv) < 0.34) res.narrow++;
res.pieces.push({ fu, fv, f });
}
});
res.pcs = res.whole + res.cut;
return res;
}
const tileRect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
// Строка «по раскладке» для стен или пола; extra — облицовка элементов по площади, м²
function tileLayoutLine(what, s, c, cnt, extra, codes) {
const { w, l } = tileSize(s);
const add = extra > 0 && w > 0 && l > 0 ? Math.ceil(extra / (w * l) - 1e-9) : 0;
let total = c.pcs + add;
let t = `Плитка ${what} по раскладке: ${c.whole} целых + ${c.cut} подрезных${add ? ` + облицовка ${codes} ${add}` : ''} = ${total} шт. без запаса на бой`;
if (s.reuse && c.cut) {
c.reuseTiles = tileReuseCount(c.pieces, ['straight', 'offset'].includes(tileLayout(s).key));
total = c.whole + c.reuseTiles + add;
t += `; с обрезками: ${c.whole} целых + ${c.reuseTiles} на ${c.cut} подрезных${add ? ` + ${add}` : ''} = ${total} шт.${['straight', 'offset'].includes(tileLayout(s).key) ? '' : ' (примерно, по площади кусков)'}`;
}
if (c.narrow) t += `; узких кусков (до трети плитки): ${c.narrow}`;
if (cnt && cnt.pcs && total > cnt.pcs) t += `. По раскладке плиток больше, чем с запасом ${mFmt(cnt.waste)}% (${cnt.pcs} шт.) — увеличьте запас или сдвиньте раскладку`;
return t;
}

/* ---------- расход материалов: клей, затирка, грунт, гидроизоляция ---------- */
// В настройках плитки: mat — считать материалы, glue — клей, кг/м² (пусто — по размеру плитки),
// bag — мешок клея, кг, th — толщина плитки, мм, gpack — упаковка затирки, кг,
// hydro (пол) — гидроизоляция с заходом на стены 20 см в два слоя.
// Затирка: (A + B) / (A × B) × толщина × шов × 1,6 кг/м² (A, B — стороны плитки, мм).
const TILE_PRIMER = 0.15, TILE_HYDRO = 1, TILE_HYDRO_UP = 0.2;
function tileGlueRate(s) {
const v = mNum(s.glue);
if (v > 0) return v;
const big = Math.max(mNum(s.w), mNum(s.l));
return big <= 100 ? 2.5 : big <= 300 ? 4 : big <= 600 ? 5.5 : 7;
}
function tileGroutRate(s, kind) {
const A = mNum(s.w), B = mNum(s.l), j = Math.max(0, evalMeasureExpr(s.joint) || 0);
const th = mNum(s.th) || (kind === 'floor' ? 9 : 8);
return A > 0 && B > 0 && j > 0 ? (A + B) / (A * B) * th * j * 1.6 : 0;
}
// area — площадь плитки, м²; per — периметр комнаты (для гидроизоляции пола), floorArea — пол по контуру
function tileMaterials(s, kind, area, per, floorArea) {
if (!s.mat || !(area > 0)) return null;
const out = { lines: [] };
const ceil = v => Math.ceil(v - 1e-9);
const glue = tileGlueRate(s), bag = mNum(s.bag) || 25;
out.glue = area * glue;
out.lines.push(`клей ${mFmt(glue)} кг/м²${mNum(s.glue) > 0 ? '' : ' (по размеру плитки)'} → ${mFmt(Math.round(out.glue * 10) / 10)} кг = ${ceil(out.glue / bag)} меш. по ${mFmt(bag)} кг`);
const gr = tileGroutRate(s, kind);
if (gr > 0) {
const gp = mNum(s.gpack) || 2;
out.grout = area * gr;
out.lines.push(`затирка ${mFmt(Math.round(gr * 1000) / 1000)} кг/м² (толщина плитки ${mFmt(mNum(s.th) || (kind === 'floor' ? 9 : 8))} мм) → ${mFmt(Math.round(out.grout * 10) / 10)} кг = ${ceil(out.grout / gp)} уп. по ${mFmt(gp)} кг`);
} else out.lines.push('затирка: укажите размер плитки и шов');
out.primer = area * TILE_PRIMER;
out.lines.push(`грунт ~${mFmt(TILE_PRIMER)} л/м² → ${mFmt(Math.round(out.primer * 10) / 10)} л`);
if (kind === 'floor' && s.hydro && floorArea > 0) {
const ha = floorArea + per * TILE_HYDRO_UP;
out.hydro = ha * TILE_HYDRO * 2;
out.tape = per;
out.lines.push(`гидроизоляция: пол ${mFmt(floorArea)} + заход на стены ${mFmt(per)} × ${mFmt(TILE_HYDRO_UP)} = ${mFmt(Math.round(ha * 1000) / 1000)} м², 2 слоя по ${mFmt(TILE_HYDRO)} кг/м² → ${mFmt(Math.round(out.hydro * 10) / 10)} кг, лента в угол пол–стена ${mFmt(per)} пог. м`);
}
return out;
}

// Раскладка на одной стене: плитки (целые и подрезные) с вырезанными проёмами
// и стеной за подиумами и коробами
function tileWallLayoutCount(m, s, wi, bl) {
const L = mNum((m.walls || [])[wi]), Ht = tileWallH(m, s, wi);
if (!(L > 0) || !(Ht > 0) || !(tileSize(s).w > 0) || !(tileSize(s).l > 0)) return null;
const holes = [...tileWallCuts(m, wi, L, Ht).filter(c => c.area > 0).map(c => tileRect(c.a0, Math.max(0, c.y0), c.a1, Math.min(Ht, c.y1))), ...(bl || blocksCompute(m)).hidden.filter(p => p.wall === wi).map(p => tileRect(p.span[0], 0, p.span[1], Math.min(p.h, Ht)))];
return tileLayoutCount(s, tileRect(0, 0, L, Ht), holes, tileWallLayout(m, s, wi, L, Ht).origin);
}
// «слева 150, справа 150 мм · снизу 600 (целая), сверху 200 мм» — крайние куски на стене
function tileWallPiecesTxt(m, s, wi) {
const L = mNum((m.walls || [])[wi]), Ht = tileWallH(m, s, wi);
if (!(L > 0) || !(Ht > 0) || !(tileSize(s).w > 0) || !(tileSize(s).l > 0)) return '';
const wl = tileWallLayout(m, s, wi, L, Ht);
return tilePiecesTxt(wl.hx ? { a: wl.hx.left, b: wl.hx.right, one: wl.hx.left >= L - 0.0005 } : null, tileSize(s).w, wl.ey, tileSize(s).l, ['слева', 'справа', 'снизу', 'сверху']);
}
// Наружные углы стен с плиткой (обе стены в плитке): [{ i, j, h }] — высота по меньшей укладке
function tileOuterWallCorners(m, s) {
let g = null;
try { g = molGeom(m); } catch (e) { g = null; }
if (!g) return [];
const ws = new Set(molWalls(s.walls, m)), n = g.segs.length, o = g.orient || 1, res = [];
g.segs.forEach((q, i) => {
const j = i + 1 < n ? i + 1 : (g.closed ? 0 : -1);
if (j < 0 || !ws.has(i) || !ws.has(j)) return;
const q2 = g.segs[j], c = q.dx * q2.dy - q.dy * q2.dx;
if (Math.abs(c) < 0.02 || c * o > 0) return;
res.push({ i, j, h: Math.min(tileWallH(m, s, i), tileWallH(m, s, j)) });
});
return res;
}

function tileCompute(m, r) {
const d = tileGet(m);
const out = { walls: 0, floor: 0, wallsCount: null, floorCount: null, lines: {} };
const bl = blocksCompute(m);
out.blocks = bl;
const codes = list => list.map(b => b.code).join(', ');
const blW = bl.list.filter(b => b.tile === 'walls'), blF = bl.list.filter(b => b.tile === 'floor');
if (d.walls.on && typeof openingSpan === 'function') {
const lens = (m.walls || []).map(mNum);
const ws = molWalls(d.walls.walls, m);
const parts = [];
let gross = 0, cut = 0, hid = 0;
let lay = { whole: 0, cut: 0, narrow: 0, pcs: 0, pieces: [] };
ws.forEach(wi => {
const L = lens[wi], Ht = tileWallH(m, d.walls, wi);
if (!(L > 0) || !(Ht > 0)) return;
gross += L * Ht;
cut += tileWallCuts(m, wi, L, Ht).reduce((a, c) => a + c.area, 0);
hid += blocksHiddenOn(bl, wi, Ht);
parts.push(`${mFmt(L)}×${mFmt(Ht)}`);
// по раскладке: проёмы и стена за подиумами и коробами — дыры
if (lay && tileSize(d.walls).w > 0 && tileSize(d.walls).l > 0) {
const c = tileWallLayoutCount(m, d.walls, wi, bl);
if (c) { lay.whole += c.whole; lay.cut += c.cut; lay.narrow += c.narrow; lay.pcs += c.pcs; lay.pieces.push(...c.pieces); } else lay = null;
}
});
const hidBy = [...new Set(bl.hidden.filter(p => ws.includes(p.wall)).map(p => p.code))].join(', ');
out.walls = Math.max(0, gross - cut - hid) + bl.walls;
if (out.walls > 0) {
const all = ws.length === lens.filter(v => v > 0).length;
out.wallsCount = tileCount(out.walls, d.walls);
out.lines.walls = `Плитка на стенах (${all ? 'все стены' : `${ws.length > 1 ? 'стены' : 'стена'} ${ws.map(i => i + 1).join(', ')}`}${mNum(d.walls.h) > 0 ? `, до ${mFmt(mNum(d.walls.h))} м` : ', до потолка'}): ${parts.join(' + ')}${cut > 0 ? ` − проёмы ${mFmt(cut)}` : ''}${hid > 0.0005 ? ` − за ${hidBy} ${mFmt(hid)}` : ''}${bl.walls > 0 ? ` + облицовка ${codes(blW)} ${mFmt(bl.walls)}` : ''} = ${mFmt(out.walls)} м²; ${tileCountTxt(d.walls, out.wallsCount)}`;
out.wallsLayout = lay && lay.pcs ? lay : null;
if (out.wallsLayout) out.lines.wallsLayout = tileLayoutLine('на стенах', d.walls, lay, out.wallsCount, bl.walls, codes(blW));
}
} else if (blW.length) out.lines.blocksBad = `${codes(blW)}: плитка как на стенах — включите «Плитка на стенах», чтобы посчитать`;
if (d.floor.on) {
const f = tileFloorArea(m, r);
if (f.area > 0) {
out.floor = Math.max(0, f.area - bl.foot) + bl.floor;
out.floorCount = tileCount(out.floor, d.floor);
const extra = bl.foot > 0.0005 || bl.floor > 0;
let g = null;
try { g = molGeom(m); } catch (e) { g = null; }
if (g && g.closed && tileSize(d.floor).w > 0 && tileSize(d.floor).l > 0) {
const pts = [[0, 0], ...g.segs.map(q => [q.x2, q.y2])];
const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
const fl = tileFloorLayout(d.floor, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
const c = tileLayoutCount(d.floor, pts, bl.list.map(b => blockPlanPoly(g, b)).filter(Boolean), fl.origin);
if (c && c.pcs) {
out.floorLayout = c;
}
}
out.lines.floor = `Плитка на полу (${f.how}): ${mFmt(f.area)}${bl.foot > 0.0005 ? ` − под ${codes(bl.list)} ${mFmt(bl.foot)}` : ''}${bl.floor > 0 ? ` + облицовка ${codes(blF)} ${mFmt(bl.floor)}` : ''}${extra ? ` = ${mFmt(out.floor)}` : ''} м²; ${tileCountTxt(d.floor, out.floorCount)}`;
if (out.floorLayout) out.lines.floorLayout = tileLayoutLine('на полу', d.floor, out.floorLayout, out.floorCount, bl.floor, codes(blF));
} else out.lines.floorBad = 'Плитка на полу: нужна площадь — замкните комнату на вкладке «Стены» или введите потолок участками';
} else if (blF.length) out.lines.blocksBad = [out.lines.blocksBad, `${codes(blF)}: плитка как на полу — включите «Плитка на полу», чтобы посчитать`].filter(Boolean).join('\n');
if (blW.length) out.lines.blocksWalls = blW.map(b => b.line).join('\n');
if (blF.length) out.lines.blocksFloor = blF.map(b => b.line).join('\n');
if (bl.list.length) out.lines.blocks = `Подиумы, короба, экраны — облицовка ${mFmt(bl.walls + bl.floor)} м², наружные углы ${mFmt(bl.edges)} пог. м`;
// наружные углы под плитку: углы стен (обе стены в плитке) и рёбра подиумов и коробов —
// под уголок (профиль по 2,5 м) или запил 45°
if (d.walls.on || d.floor.on) {
const oc = d.walls.on ? tileOuterWallCorners(m, d.walls) : [];
const wallLen = oc.reduce((a, c) => a + c.h, 0);
const total = wallLen + bl.edges;
if (total > 0.005) {
const parts = [];
if (oc.length) parts.push(`углы стен ${oc.map(c => `${c.i + 1}–${c.j + 1}`).join(', ')}: ${mFmt(Math.round(wallLen * 1000) / 1000)}`);
if (bl.edges > 0) parts.push(`подиумы, короба, экраны ${mFmt(Math.round(bl.edges * 1000) / 1000)}`);
const cut = (d.walls.on ? d.walls : d.floor).edge === 'cut45';
out.edges = { len: total, cut, profiles: cut ? 0 : Math.ceil(total / 2.5 - 1e-9) };
out.lines.edges = `Наружные углы под плитку: ${parts.join(' + ')}${parts.length > 1 ? ` = ${mFmt(Math.round(total * 1000) / 1000)}` : ''} пог. м — ${cut ? 'запил 45°' : `уголок: ${out.edges.profiles} шт. по 2,5 м`}`;
}
}
// материалы — на площадь плитки (с облицовкой подиумов и коробов), без запаса
{
const lens = (m.walls || []).map(mNum);
const per = lens.every(v => v > 0) ? lens.reduce((a, v) => a + v, 0) : 0;
const fa = d.floor.on ? tileFloorArea(m, r).area : 0;
const mw = d.walls.on ? tileMaterials(d.walls, 'walls', out.walls, per, fa) : null;
const mf = d.floor.on ? tileMaterials(d.floor, 'floor', out.floor, per, fa) : null;
out.matWalls = mw; out.matFloor = mf;
if (mw) out.lines.matWalls = `Материалы на стены (${mFmt(out.walls)} м²): ${mw.lines.join('; ')}`;
if (mf) out.lines.matFloor = `Материалы на пол (${mFmt(out.floor)} м²): ${mf.lines.join('; ')}`;
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
// подиумы, короба и экраны — поверх пола
blocksCompute(m).list.forEach(b => {
const pp = blockPlanPoly(g, b);
if (!pp) return;
const cx = pp.reduce((a, p) => a + X(p[0]), 0) / 4, cy = pp.reduce((a, p) => a + Y(p[1]), 0) / 4;
s += `<path d="M${pp.map(([x, y]) => `${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join('L')}Z" fill="${BLOCK_FILL}" stroke="${BLOCK_INK}" stroke-width="1.4"/>`;
s += `<text x="${cx}" y="${cy + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="${BLOCK_INK}">${b.code}</text>`;
});
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
// подиумы и короба у стены: сам элемент и (пунктиром) прижатый к стене бок
blocksCompute(m).hidden.filter(p => p.wall === wi).sort((a, b) => b.h - a.h).forEach(p => {   // низкие — поверх высоких
const xl = Math.min(XA(p.span[0]), XA(p.span[1])), xr = Math.max(XA(p.span[0]), XA(p.span[1]));
s += `<rect x="${xl}" y="${Yh(p.h)}" width="${xr - xl}" height="${p.h * k}" fill="${p.side ? '#fbf3e3' : BLOCK_FILL}" stroke="${BLOCK_INK}" stroke-width="1.2" ${p.side ? 'stroke-dasharray="4 3"' : ''}/>`;
if (p.h * k > 11 && xr - xl > 18) s += `<text x="${(xl + xr) / 2}" y="${Yh(p.h / 2) + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="${BLOCK_INK}">${p.code}${p.side ? ' бок' : ''}</text>`;
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
<div class="mp-add-row" style="margin-top:6px;"><button type="button" class="mp-add" onclick="tileAutoAlign('${kind}')">Подобрать раскладку: меньше узких кусков</button></div>
<label class="mp-check mp-ce-light" style="margin-top:6px;"><input type="checkbox" ${s.reuse ? 'checked' : ''} onchange="tileSetReuse('${kind}', this.checked)"><span>Учитывать обрезки: подрезные куски из остатков других плиток</span></label>
<div class="mp-ce-walls" style="margin-top:6px;"><span class="mp-ce-walls-label">Наружные углы:</span>${[['profile', 'уголок'], ['cut45', 'запил 45°']].map(([k, lbl]) => { const on = (s.edge === 'cut45' ? 'cut45' : 'profile') === k; return `<button type="button" class="mp-ce-wall${on ? ' on' : ''}" onclick="tileSetEdge('${kind}', '${k}')" aria-pressed="${on}">${lbl}</button>`; }).join('')}</div>
<div class="mp-dims mp-dims-2" style="margin-top:6px;">
<label>Запас, %${mIn(`tile.${kind}.waste`, s.waste, String(tileLayout(s).waste))}</label><span class="mp-x">·</span>
<label>В упаковке, м²${mIn(`tile.${kind}.pack`, s.pack, '1,44')}</label>
</div>
<label class="mp-check mp-ce-light" style="margin-top:6px;"><input type="checkbox" ${s.mat ? 'checked' : ''} onchange="tileSetFlag('${kind}', 'mat', this.checked)"><span>Считать материалы: клей, затирку, грунт</span></label>
${s.mat ? `<div class="mp-dims" style="margin-top:6px;">
<label>Клей, кг/м²${mIn(`tile.${kind}.glue`, s.glue, mFmt(tileGlueRate({ ...s, glue: '' })))}</label><span class="mp-x">·</span>
<label>Мешок, кг${mIn(`tile.${kind}.bag`, s.bag, '25')}</label><span class="mp-x">·</span>
<label>Толщина плитки, мм${mIn(`tile.${kind}.th`, s.th, kind === 'floor' ? '9' : '8')}</label>
</div>
<div class="mp-dims mp-dims-2" style="margin-top:6px;">
<label>Затирка в упаковке, кг${mIn(`tile.${kind}.gpack`, s.gpack, '2')}</label><span></span><span></span>
</div>
${kind === 'floor' ? `<label class="mp-check mp-ce-light" style="margin-top:6px;"><input type="checkbox" ${s.hydro ? 'checked' : ''} onchange="tileSetFlag('floor', 'hydro', this.checked)"><span>Гидроизоляция пола с заходом на стены 20 см</span></label>` : ''}
<div class="mp-calc" id="mpCalcTileMat_${kind}"></div>` : ''}`;
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
${d.walls.on && hasWalls ? `<button type="button" class="mp-link-btn" onclick="openElevPrintForMeasure(true)">Печать раскладки по стенам (PDF) →</button>` : ''}
</section>
<section class="mp-sec">
<div class="mp-sec-title">Плитка на полу</div>
${toggle('floor', d.floor.on, 'Плитка на полу')}
${d.floor.on ? params('floor', d.floor, ['Ширина', 'Длина']) : ''}
<div class="mp-ce-plan rl-sketch${tileFull === 'plan' ? ' full' : ''}" id="mpTilePlan"></div>
<div class="mp-hint" id="mpTileFloorCuts"></div>
<div class="mp-hint">Касание стены на плане — её развёртка выше. Обведены стены с плиткой.</div>
<div class="mp-calc" id="mpCalcTileFloor"></div>
<button type="button" class="mp-link-btn" onclick="openFlatPrintForMeasure('floor')">Печать плана пола (PDF) →</button>
</section>
${blocksSectionHtml(m)}`;
}

// Подиумы, короба и экраны: карточки ввода
function blocksSectionHtml(m) {
const list = Array.isArray(m.blocks) ? m.blocks : [];
const walls = Array.isArray(m.walls) ? m.walls : [];
const hasWalls = walls.some(w => mNum(w) > 0);
return `<section class="mp-sec">
<div class="mp-sec-title">Подиумы, короба, экраны</div>
<div class="mp-hint">Подиум под ванну или душ, короб под трубы или инсталляцию, экран ванны. Длина — вдоль стены (пусто — вся стена), глубина — от стены, высота у короба пусто — до потолка. Облицовка элемента прибавляется к плитке, стена за ним и пол под ним вычитаются. Бок, прижатый к стене в углу, не облицовывается.</div>
${list.map((el, i) => {
const t = blockType(el), T = BLOCK_TYPES[t];
const wi = coverWall(m, el);
const tile = blockTile(el);
return `<div class="mp-open" data-card="blocks.${i}">
<div class="mp-open-top">
<input class="mp-name-in" type="text" data-path="blocks.${i}.name" value="${escapeHtml(el.name || '')}" placeholder="${blockCode(list, i)}: ${T.label}" autocomplete="off">
<span class="mp-open-area" id="mpBlockRes${i}"></span>
<button type="button" class="mp-del" onclick="removeMeasureRow('blocks', ${i})" aria-label="Убрать">✕</button>
</div>
${hasWalls ? `<div class="mp-place"><label>У стены
<select onchange="setBlockWall(${i}, this.value)">
<option value="">отдельно</option>
${walls.map((w, k) => mNum(w) > 0 ? `<option value="${k}" ${wi === k ? 'selected' : ''}>стена ${k + 1} · ${mFmt(mNum(w))} м</option>` : '').join('')}
</select></label>
${wi != null ? `<label>От угла <button type="button" class="mp-ce-corner" onclick="toggleBlockFrom(${i})" aria-label="Сменить угол">${el.from === 'end' ? 'Б' : 'А'} ⇄</button>${mIn(`blocks.${i}.off`, el.off, 'по центру')}</label>` : ''}
</div>` : ''}
<div class="mp-dims" style="margin-top:6px;">
<label>Длина ↔${mIn(`blocks.${i}.w`, el.w, wi != null ? 'вся стена' : '1,7')}</label><span class="mp-x">×</span>
<label>Глубина${mIn(`blocks.${i}.d`, el.d, t === 'box' ? '0,25' : '0,7')}</label><span class="mp-x">×</span>
<label>Высота ↕${mIn(`blocks.${i}.h`, el.h, T.h)}</label>
</div>
<div class="mp-ce-walls" style="margin-top:6px;"><span class="mp-ce-walls-label">Плитка:</span>${[['floor', 'как на полу'], ['walls', 'как на стенах']].map(([k, lbl]) => `<button type="button" class="mp-ce-wall${tile === k ? ' on' : ''}" onclick="setBlockTile(${i}, '${k}')" aria-pressed="${tile === k}">${lbl}</button>`).join('')}</div>
</div>`;
}).join('')}
<div class="mp-add-row">${Object.keys(BLOCK_TYPES).map(k => `<button type="button" class="mp-add" onclick="addBlock('${k}')">+ ${BLOCK_TYPES[k].add}</button>`).join('')}</div>
<div class="mp-calc" id="mpCalcBlocks"></div>
</section>`;
}
// Новый элемент — у стены, которая сейчас на развёртке, с размерами предыдущего такого же
function addBlock(type) {
if (!Array.isArray(measure.blocks)) measure.blocks = [];
const lens = (measure.walls || []).map(mNum);
const cur = lens[tileElevWall] > 0 ? tileElevWall : lens.findIndex(v => v > 0);
const prev = [...measure.blocks].reverse().find(b => blockType(b) === type);
measure.blocks.push({ type, name: '', w: prev ? prev.w || '' : '', d: prev ? prev.d || '' : '', h: prev ? prev.h || '' : '', off: '', from: 'start', ...(cur >= 0 ? { wall: cur } : {}) });
saveMeasureDraft();
renderMeasure();
focusMeasurePath(`blocks.${measure.blocks.length - 1}.w`);
}
function setBlockWall(i, v) {
const el = (measure.blocks || [])[i];
if (!el) return;
if (v === '') delete el.wall; else { el.wall = Number(v); tileElevWall = el.wall; }
saveMeasureDraft();
renderMeasure();
}
function toggleBlockFrom(i) {
const el = (measure.blocks || [])[i];
if (!el) return;
el.from = el.from === 'end' ? 'start' : 'end';
saveMeasureDraft();
renderMeasure();
}
function setBlockTile(i, kind) {
const el = (measure.blocks || [])[i];
if (!el) return;
el.tile = kind;
saveMeasureDraft();
renderMeasure();
}

function updateTileOutputs(r) {
const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
const t = r.tile || tileCompute(measure, r);
renderTileViews();
set('mpCalcTileWalls', [t.lines.walls, t.lines.wallsLayout, t.lines.edges].filter(Boolean).map(escapeHtml).join('<br>'));
const d = tileGet(measure);
// крайние куски: на стене с развёртки и на полу
const wi = tileElevWall, L = mNum((measure.walls || [])[wi]);
if (d.walls.on && molWalls(d.walls.walls, measure).includes(wi) && L > 0 && tileSize(d.walls).w > 0 && tileSize(d.walls).l > 0) {
const txt = tileWallPiecesTxt(measure, d.walls, wi);
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
set('mpCalcTileMat_walls', t.lines.matWalls ? escapeHtml(t.lines.matWalls) : '');
set('mpCalcTileMat_floor', t.lines.matFloor ? escapeHtml(t.lines.matFloor) : '');
set('mpCalcTileFloor', [t.lines.floor, t.lines.floorLayout, t.lines.floorBad, t.lines.all].filter(Boolean).map(escapeHtml).join('<br>'));
(Array.isArray(measure.blocks) ? measure.blocks : []).forEach((el, i) => {
const b = t.blocks && t.blocks.list.find(x => x.idx === i);
set('mpBlockRes' + i, b ? `${mFmt(b.area)} м²` : '');
});
set('mpCalcBlocks', t.blocks && t.blocks.list.length ? [...t.blocks.list.map(b => b.line), t.lines.blocks, t.lines.blocksBad].filter(Boolean).map(escapeHtml).join('<br>').replace(/\n/g, '<br>') : '');
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
function tileSetEdge(kind, v) {
const d = tileEnsure();
d[kind] = { ...d[kind], edge: v };
saveMeasureDraft();
renderMeasure();
}
function tileSetFlag(kind, key, on) {
const d = tileEnsure();
d[kind] = { ...d[kind], [key]: !!on };
saveMeasureDraft();
renderMeasure();
}
// Подобрать, откуда идёт целая плитка (↔ и ↕), чтобы узких кусков было меньше всего,
// при равенстве — меньше плиток по раскладке
function tileAutoPick(m, kind) {
const d = tileGet(m);
const r = computeMeasure(m);
let best = null;
TILE_ALIGN.forEach(x => TILE_ALIGN.forEach(y => {
const s = { ...d[kind], ax: x.key, ay: y.key };
const t = tileCompute({ ...m, tile: { ...d, [kind]: s } }, r);
const c = kind === 'walls' ? t.wallsLayout : t.floorLayout;
if (!c) return;
const score = [c.narrow, c.pcs];
if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && score[1] < best.score[1])) best = { ax: x.key, ay: y.key, score };
}));
return best;
}
function tileAutoAlign(kind) {
const d = tileEnsure();
const before = kind === 'walls' ? (tileCompute(measure, computeMeasure(measure)).wallsLayout || {}) : (tileCompute(measure, computeMeasure(measure)).floorLayout || {});
const best = tileAutoPick(measure, kind);
if (!best) { showAddToast('Нужны стены, размер плитки и включённая плитка'); return; }
d[kind] = { ...d[kind], ax: best.ax, ay: best.ay };
saveMeasureDraft();
renderMeasure();
const lbl = TILE_ALIGN.find(x => x.key === best.ax).h, lblV = TILE_ALIGN.find(x => x.key === best.ay)[kind === 'walls' ? 'vWall' : 'vFloor'];
showAddToast(`Целая плитка ↔ ${lbl.toLowerCase()}, ↕ ${lblV.toLowerCase()}: узких кусков ${before.narrow != null ? `${before.narrow} → ` : ''}${best.score[0]}`);
}
function tileSetReuse(kind, on) {
const d = tileEnsure();
d[kind] = { ...d[kind], reuse: !!on };
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
