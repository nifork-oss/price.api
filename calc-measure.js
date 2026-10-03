// Кабинет мастера — окно замера: расчёты стен, проёмов, откосов, потолка, история замеров.
// Подключается из calc.html; порядок подключения важен.

/* ===================== ЗАМЕР ПОМЕЩЕНИЯ ===================== */
// Окно «Замер»: стены (минус окна и двери), потолок, откосы, узкие
// поверхности и история. Результат вставляется в количество услуги или
// позиции счёта, а к позиции прикрепляется, как именно считали.
// Замер сохраняется в объект (в облако), без объекта — на этом телефоне.

let measure = null;          // текущий замер
let measureTab = 'walls';
let measureTarget = { kind: 'none' };
let measureDirty = false;

function newMeasure(objectId) {
return {
id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
room: '', objectId: objectId || '',
height: '', walls: [''], wallHeights: [''],
openings: [],
parts: [],
ceiling: [{ l: '', w: '' }],
ceilEls: [],
narrow: ['']
};
}

/* ---------- числа и выражения ---------- */
// Понимает «3,2», «3.2», «3+0,4», «2×1,5», «(3+4)*2», «10/4».
function evalMeasureExpr(raw) {
let s = String(raw == null ? '' : raw).trim();
if (!s) return NaN;
s = s.replace(/,/g, '.').replace(/[×xхХX]/g, '*').replace(/[÷:]/g, '/').replace(/[−–]/g, '-').replace(/\s+/g, '');
if (!/^[0-9.+\-*/()]+$/.test(s)) return NaN;
let pos = 0;
const peek = () => s[pos];
function number() {
const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(pos));
if (!m) throw new Error('num');
pos += m[0].length;
return parseFloat(m[0]);
}
function factor() {
if (peek() === '-') { pos++; return -factor(); }
if (peek() === '+') { pos++; return factor(); }
if (peek() === '(') { pos++; const v = expr(); if (peek() !== ')') throw new Error('paren'); pos++; return v; }
return number();
}
function term() {
let v = factor();
while (peek() === '*' || peek() === '/') {
const op = s[pos++];
const r = factor();
v = op === '*' ? v * r : v / r;
}
return v;
}
function expr() {
let v = term();
while (peek() === '+' || peek() === '-') {
const op = s[pos++];
const r = term();
v = op === '+' ? v + r : v - r;
}
return v;
}
try {
const v = expr();
return pos === s.length && isFinite(v) ? v : NaN;
} catch (e) {
return NaN;
}
}
const mNum = raw => { const v = evalMeasureExpr(raw); return isFinite(v) && v > 0 ? v : 0; };
// До миллиметра: 1,001 м — это 1,001, а не 1
const mFmt = n => Number((Math.round(n * 1000) / 1000).toFixed(3)).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
const mCount = raw => { const s = String(raw == null ? '' : raw).trim(); if (!s) return 1; const v = evalMeasureExpr(s); return isFinite(v) && v > 0 ? v : 0; };
const typeLabel = t => t === 'door' ? 'дверь' : t === 'balcony' ? 'балк. блок' : 'окно';
// Ширина проёма целиком (у балконного блока — окно + дверь)
const openingWidth = o => o.type === 'balcony' ? mNum(o.w) + mNum(o.dw) : mNum(o.w);
// Высота окна балконного блока: верх окна вровень с верхом двери, поэтому
// если задан подоконник (от пола до низа окна) — высота окна = дверь − подоконник.
// Иначе — высота окна, введённая напрямую (так было раньше).
const hasSill = o => o && o.sill !== undefined && o.sill !== null && String(o.sill).trim() !== '';
const winH = o => {
if (o && o.type === 'balcony' && hasSill(o)) return Math.max(0, mNum(o.dh) - Math.max(0, evalMeasureExpr(o.sill) || 0));
return mNum(o && o.h);
};
// Погонный метр: кусок короче метра считается за 1 пог. м, длиннее — как есть
const minLen = v => (v > 0 && v < 1 ? 1 : v);
const fmtMin = v => (v > 0 && v < 1 ? `1*` : mFmt(v));
const MIN_NOTE = '\n* меньше 1 м — считается как 1 пог. м';
// «левый 1,5 + правый 1,5 + верх 1,4», куски короче метра — со звёздочкой
const slopeSidesText = (h, w) => `левый ${fmtMin(h)} + правый ${fmtMin(h)} + верх ${fmtMin(w)}`;

/* ---------- ниши и короба на потолке ---------- */
// Закарнизная ниша или короб — полоса потолка вдоль выбранных стен:
// { type: 'niche' | 'box', walls: [номера стен], w: ширина от стены, h: высота,
//   len: длина — только если стены не выбраны (комната без чертежа) }.
// На стыке двух выбранных стен полоса идёт «на ус», у невыбранной соседней
// стены — упирается в неё.
const ceilElLabel = t => t === 'box' ? 'короб' : 'закарнизная ниша';
const ceilElCode = (els, idx) => {
const e = els[idx];
const n = els.slice(0, idx + 1).filter(x => (x.type === 'box') === (e.type === 'box')).length;
return (e.type === 'box' ? 'К-' : 'Н-') + n;
};

// Ниша над проёмом: el.overOp — номер окна или балконного блока, el.ext — вынос
// за проём с каждой стороны. Стена и длина берутся от проёма: сдвинули окно — ниша следом.
function ceilElOp(m, el) {
if (!el || !Number.isInteger(el.overOp)) return null;
const o = (Array.isArray(m.openings) ? m.openings : [])[el.overOp];
return o && typeof o.wall === 'number' && openingWidth(o) > 0 ? o : null;
}
const opCode = (o, i) => (o.type === 'balcony' ? 'Б' : o.type === 'door' ? 'Д' : 'О') + '-' + (i + 1);

// Элемент на одной стене может идти не от угла до угла: отступ от угла А или Б
// (el.off, el.from) и длина по стене (el.span). Возвращает [начало, конец] вдоль стены
// или null — если элемент на всю стену.
const ceilElPartial = el => Array.isArray(el.walls) && el.walls.length === 1 &&
(String(el.off == null ? '' : el.off).trim() !== '' || mNum(el.span) > 0);
function ceilElSpan(m, el, L) {
if (!(L > 0)) return null;
const op = ceilElOp(m, el);
if (op) {
const [a0, a1] = openingSpan(op, L);
const ext = Math.max(0, evalMeasureExpr(el.ext) || 0);
const sp = [Math.max(0, a0 - ext), Math.min(L, a1 + ext)];
return sp[0] < 0.0005 && sp[1] > L - 0.0005 ? null : sp;
}
if (!ceilElPartial(el)) return null;
const offRaw = String(el.off == null ? '' : el.off).trim();
const off = Math.min(L, Math.max(0, offRaw === '' ? 0 : (evalMeasureExpr(offRaw) || 0)));
const span = mNum(el.span);
if (el.from === 'end') { const e = L - off; return [span > 0 ? Math.max(0, e - span) : 0, e]; }
return [off, span > 0 ? Math.min(L, off + span) : L];
}

function ceilElWalls(m, el, g) {
const n = g.segs.length;
const op = ceilElOp(m, el);
const list = op ? [op.wall] : (Array.isArray(el.walls) ? el.walls : []);
return [...new Set(list.filter(i => Number.isInteger(i) && i >= 0 && i < n && g.segs[i].len > 0))].sort((a, b) => a - b);
}

// Полосы элемента по стенам: внешний край — стена, внутренний — на w внутрь комнаты.
// Длина элемента — по стене (у короба, упёртого в нишу, — до кромки ниши).
function ceilElStrips(m, el, g) {
const w = mNum(el.w);
if (!g || !(w > 0)) return [];
const walls = ceilElWalls(m, el, g);
if (!walls.length) return [];
const sel = new Set(walls);
const n = g.segs.length, o = g.orient || 1;
// короб упирается в кромку закарнизной ниши на соседней стене (ниша идёт от угла до угла)
// (ниша на части стены, например над окном, короб не останавливает)
const nicheW = j => el.type !== 'box' ? 0 : Math.max(0, ...(Array.isArray(m.ceilEls) ? m.ceilEls : [])
.filter(e => e !== el && e.type !== 'box' && ceilElWalls(m, e, g).includes(j) && !ceilElSpan(m, e, g.segs[j].len)).map(e => mNum(e.w)));
// пересечение стены q1, сдвинутой внутрь на d1, со стеной q2, сдвинутой на d2
const cross = (q1, d1, q2, d2) => {
const ax = q1.x1 - q1.dy * o * d1, ay = q1.y1 + q1.dx * o * d1;
const bx = q2.x1 - q2.dy * o * d2, by = q2.y1 + q2.dx * o * d2;
const det = q1.dx * q2.dy - q1.dy * q2.dx;
if (Math.abs(det) < 0.02) return null;               // почти на одной прямой
const t = ((bx - ax) * q2.dy - (by - ay) * q2.dx) / det;
return [ax + q1.dx * t, ay + q1.dy * t];
};
const near = (i, step) => {
const j = i + step;
if (g.closed) return g.segs[(j + n) % n];
return j >= 0 && j < n && !g.segs[j].empty ? g.segs[j] : null;
};
return walls.map(i => {
const q = g.segs[i];
const nx = -q.dy * o, ny = q.dx * o;
const prev = near(i, -1), next = near(i, 1);
// на часть стены: конец, не дошедший до угла, обрезан поперёк
const sp = ceilElSpan(m, el, q.len);
const cutA = !!sp && sp[0] > 0.0005, cutB = !!sp && sp[1] < q.len - 0.0005;
const at = t => [q.x1 + q.dx * t, q.y1 + q.dy * t];
let a = prev && !cutA ? cross(q, w, prev, sel.has(prev.i) ? w : nicheW(prev.i)) : null;
let b = next && !cutB ? cross(q, w, next, sel.has(next.i) ? w : nicheW(next.i)) : null;
let s0 = cutA ? at(sp[0]) : [q.x1, q.y1], s1 = cutB ? at(sp[1]) : [q.x2, q.y2];
// точка ушла дальше разумного (очень острый угол) — обрываем полосу поперёк
const far = (p, x, y) => !p || Math.hypot(p[0] - x, p[1] - y) > w * 4 + 0.05;
if (far(a, s0[0], s0[1])) a = [s0[0] + nx * w, s0[1] + ny * w];
if (far(b, s1[0], s1[1])) b = [s1[0] + nx * w, s1[1] + ny * w];
if (!cutA && prev && !sel.has(prev.i) && nicheW(prev.i) > 0) s0 = cross(q, 0, prev, nicheW(prev.i)) || s0;
if (!cutB && next && !sel.has(next.i) && nicheW(next.i) > 0) s1 = cross(q, 0, next, nicheW(next.i)) || s1;
const poly = [s0, s1, b, a];
let a2 = 0;
for (let k = 0; k < 4; k++) { const [x1, y1] = poly[k], [x2, y2] = poly[(k + 1) % 4]; a2 += x1 * y2 - x2 * y1; }
return { i, q, poly, n: [nx, ny], span: sp, cutA, cutB, outerLen: Math.hypot(s1[0] - s0[0], s1[1] - s0[1]), inner: [a, b], innerLen: Math.hypot(b[0] - a[0], b[1] - a[1]), area: Math.abs(a2) / 2 };
});
}

// Кромка полосы для чертежа: внутренняя кромка, а где элемент обрывается
// посреди стены — ещё и торец (на стыках «на ус» и у соседней стены торец не нужен)
function ceilStripEdgePts(p) {
const [s0, s1, b, a] = p.poly;
return [...(p.cutA ? [s0] : []), a, b, ...(p.cutB ? [s1] : [])];
}
// Линия подсветки: вдоль полосы, ближе к внутренней кромке
function ceilLightPts(p) {
const [s0, s1, b, a] = p.poly;
const t = 0.35;
return [[a[0] + (s0[0] - a[0]) * t, a[1] + (s0[1] - a[1]) * t], [b[0] + (s1[0] - b[0]) * t, b[1] + (s1[1] - b[1]) * t]];
}
function ceilStripEdge(p, X, Y) {
return 'M' + ceilStripEdgePts(p).map(([x, y]) => `${X(x)} ${Y(y)}`).join('L');
}

// Стороны ниши и короба под обработку (шпаклёвка, покраска…) и что включено по умолчанию.
// Торцы — у короба, который обрывается посреди стены.
const CEIL_FACES = {
niche: [{ key: 'top', label: 'Потолок ниши', on: true }, { key: 'face', label: 'Стенка ниши', on: true }, { key: 'wall', label: 'Стена в нише', on: false }],
box: [{ key: 'bottom', label: 'Низ', on: true }, { key: 'side', label: 'Борт', on: true }, { key: 'ends', label: 'Торцы', on: true }]
};
const ceilFaceOn = (el, f) => el.sides && typeof el.sides[f.key] === 'boolean' ? el.sides[f.key] : f.on;

// Подсчёт стороны: если хотя бы одна её сторона меньше метра — погонные метры
// по длинной стороне, кусок короче метра — за 1 пог. м; иначе — квадратные метры.
function ceilFacePiece(a, b, area) {
if (!(a > 0) || !(b > 0)) return null;
if (a < 1 || b < 1) {
const L = Math.max(a, b);
return { lin: minLen(L), min: L < 1, txt: fmtMin(L) };
}
return { area: area || a * b, txt: `${mFmt(a)}×${mFmt(b)}` };
}

function ceilElsCompute(m) {
const out = { list: [], niche: 0, box: 0, strips: 0, light: 0, finLin: 0, finArea: 0, finMin: false };
const els = Array.isArray(m.ceilEls) ? m.ceilEls : [];
if (!els.length) return out;
let g = null;
try { if (typeof rulerGeometry === 'function' && Array.isArray(m.walls) && m.walls.length) g = rulerGeometry(m); } catch (e) { g = null; }
els.forEach((el, idx) => {
const w = mNum(el.w), h = mNum(el.h);
const strips = g ? ceilElStrips(m, el, g) : [];
let len, innerLen, area, where, wallsTxt = '', partial = null, overOp = null;
if (strips.length) {
len = strips.reduce((a, p) => a + p.outerLen, 0);
innerLen = strips.reduce((a, p) => a + p.innerLen, 0);
area = strips.reduce((a, p) => a + p.area, 0);
const all = g.closed && strips.length === g.segs.length;
wallsTxt = all ? 'по периметру' : `${strips.length > 1 ? 'стены' : 'стена'} ${strips.map(p => p.i + 1).join(', ')}`;
const sp = strips.length === 1 ? strips[0].span : null;
const op = ceilElOp(m, el);
if (op) {
overOp = { code: opCode(op, el.overOp), ext: Math.max(0, evalMeasureExpr(el.ext) || 0) };
wallsTxt += `, над ${overOp.code}`;
} else if (sp) partial = { corner: el.from === 'end' ? 'Б' : 'А', off: el.from === 'end' ? strips[0].q.len - sp[1] : sp[0] };
where = all ? wallsTxt : `(${wallsTxt}${overOp ? `, вынос ${mFmt(overOp.ext)}` : ''}${partial ? `, от угла ${partial.corner} ${mFmt(partial.off)}` : ''})`;
} else {
len = mNum(el.len);
innerLen = len;
area = len * w;
where = '';
}
if (!(len > 0) || !(w > 0)) return;
const code = ceilElCode(els, idx);
const size = `${mFmt(w)}${h ? '×' + mFmt(h) : ''}`;
const e = { idx, code, type: el.type === 'box' ? 'box' : 'niche', w, h, len, innerLen, area, strips, where, wallsTxt, partial, overOp, side: 0, total: 0 };
// подсветка: у ниши — по её длине, у короба — по внутренней кромке
e.light = !!el.light;
e.lightLen = e.light ? (e.type === 'box' ? innerLen : len) : 0;
out.light += e.lightLen;
const lightTxt = e.light ? `, подсветка ${mFmt(e.lightLen)} пог. м` : '';
// обработка: только отмеченные стороны, каждая — по правилу «уже метра — пог. м»
const cuts = strips.reduce((a, p) => a + (p.cutA ? 1 : 0) + (p.cutB ? 1 : 0), 0);
const dims = e.type === 'box'
? { bottom: [[len, w, area]], side: [[innerLen, h]], ends: Array.from({ length: cuts }, () => [w, h]) }
: { top: [[len, w, area]], face: [[innerLen, h]], wall: [[len, h]] };
e.fin = []; e.finLin = 0; e.finArea = 0;
CEIL_FACES[e.type].forEach(f => {
if (!ceilFaceOn(el, f)) return;
const pieces = (dims[f.key] || []).map(([a, b, ar]) => ceilFacePiece(a, b, ar)).filter(Boolean);
if (!pieces.length) return;
const lin = pieces.reduce((a, p) => a + (p.lin || 0), 0), ar = pieces.reduce((a, p) => a + (p.area || 0), 0);
if (pieces.some(p => p.min)) out.finMin = true;
e.finLin += lin; e.finArea += ar;
const n = pieces.length;
e.fin.push(`${f.label.toLowerCase()} ${n > 1 ? `${n} × ${pieces[0].txt}` : pieces[0].txt}${ar ? ' м²' : ''}`);
});
out.finLin += e.finLin; out.finArea += e.finArea;
const finTxt = e.fin.length
? `; обработка: ${e.fin.join(' + ')} = ${[e.finLin ? `${mFmt(e.finLin)} пог. м` : '', e.finArea ? `${mFmt(e.finArea)} м²` : ''].filter(Boolean).join(' + ')}`
: '';
if (e.type === 'box') {
out.box += len;
e.line = `${code} короб${where ? ' ' + where : ''} ${size}: длина ${mFmt(len)} пог. м${finTxt}${lightTxt}`;
} else {
out.niche += len;
e.line = `${code} закарнизная ниша${where ? ' ' + where : ''} ${size}: ${mFmt(len)} пог. м${finTxt}${lightTxt}`;
}
out.strips += area;
out.list.push(e);
});
return out;
}

/* ---------- узкие места у проёмов (режим «без вычета проёмов») ---------- */
// У каждого проёма на стене смотрим, сколько до угла, потолка, пола и соседнего
// проёма. Меньше метра (но не вплотную) — добавляем погонные метры вдоль проёма:
// сбоку — высота проёма с той стороны, сверху и под окном — ширина.
// Простенок между двумя проёмами считается один раз.
function openStripsCompute(m) {
const out = { total: 0, pieces: [], loose: [], min: false };
const ops = (Array.isArray(m.openings) ? m.openings : []).map((o, oi) => ({ o, oi }))
.filter(({ o }) => openingWidth(o) > 0 && (o.type === 'balcony' ? winH(o) > 0 && mNum(o.dh) > 0 : mNum(o.h) > 0));
if (!ops.length || typeof openingSpan !== 'function') return out;
const add = (label, len) => {
if (!(len > 0)) return;
out.pieces.push({ label, len });
out.total += minLen(len);
if (len < 1) out.min = true;
};
const near = d => d > 0.0005 && d < 1;
ops.filter(({ o }) => typeof o.wall !== 'number').forEach(({ o, oi }) => out.loose.push(opCode(o, oi)));
const byWall = new Map();
ops.filter(({ o }) => typeof o.wall === 'number').forEach(x => {
const L = mNum((m.walls || [])[x.o.wall]);
if (!(L > 0)) { out.loose.push(opCode(x.o, x.oi)); return; }
if (!byWall.has(x.o.wall)) byWall.set(x.o.wall, []);
byWall.get(x.o.wall).push(x);
});
byWall.forEach((list, wi) => {
const L = mNum(m.walls[wi]);
const Hw = wallHeightOf(m, wi);
const items = list.map(({ o, oi }) => {
const [a0, a1] = openingSpan(o, L);
const v = openingVert(o, Hw);
// высота края проёма слева и справа (у балконного блока — дверь или окно)
let hl = v.y1 - v.y0, hr = hl;
if (o.type === 'balcony') {
const doorLeft = o.side !== 'end';
hl = doorLeft ? mNum(o.dh) : winH(o);
hr = doorLeft ? winH(o) : mNum(o.dh);
}
return { o, oi, a0, a1, v, hl, hr, code: opCode(o, oi) };
}).sort((a, b) => a.a0 - b.a0);
// боковые простенки: от угла до проёма, между проёмами, от проёма до угла
let prevEnd = 0, prev = null;
items.forEach(it => {
const gap = it.a0 - prevEnd;
if (near(gap)) {
if (prev) add(`${prev.code}/${it.code} простенок`, Math.max(prev.hr, it.hl));
else add(`${it.code} слева`, it.hl);
}
if (it.a1 >= prevEnd) { prevEnd = it.a1; prev = it; }
});
if (prev && near(L - prevEnd)) add(`${prev.code} справа`, prev.hr);
// над проёмом — до потолка, под окном — до пола
items.forEach(it => {
if (Hw > 0 && near(Hw - it.v.y1)) add(`${it.code} сверху`, it.a1 - it.a0);
if (it.o.type !== 'door' && near(it.v.y0)) {
const w = it.o.type === 'balcony' ? mNum(it.o.w) : it.a1 - it.a0;
add(`${it.code} снизу${it.v.guess ? ' (подоконник условно 0,8)' : ''}`, w);
}
});
});
return out;
}

/* ---------- углы ---------- */
// Что можно отметить на вкладке «Углы». Длины — с других вкладок:
// углы стен — по высоте, углы откосов — по контуру проёма, стыки — по периметру,
// ниши и короба — по их рёбрам. Каждый кусок короче метра — за 1 пог. м.
function cornerItemsList(m, r) {
const items = [];
const H = mNum(m.height);
let g = null;
try { if (typeof rulerGeometry === 'function' && Array.isArray(m.walls) && m.walls.length >= 2) g = rulerGeometry(m); } catch (e) { g = null; }
// углы стен: внутренние и наружные — по направлению поворота
if (g) {
const n = g.segs.length, o = g.orient || 1;
g.segs.forEach((q, i) => {
const j = i + 1 < n ? i + 1 : (g.closed ? 0 : -1);
if (j < 0) return;
const q2 = g.segs[j];
if (!(q.len > 0) || !(q2.len > 0)) return;
const c = q.dx * q2.dy - q.dy * q2.dx;
if (Math.abs(c) < 0.02) return;                    // на одной прямой — угла нет
const hh = Math.min(wallHeightOf(m, i) || H, wallHeightOf(m, j) || H);
items.push({ key: 'wc' + i, group: 'walls', kind: c * o > 0 ? 'in' : 'out', label: `${i + 1}–${j + 1}`, pieces: hh > 0 ? [hh] : [], def: true, noLen: !(hh > 0) });
});
}
// углы откосов: наружные (откос — стена) и примыкание к раме
(Array.isArray(m.openings) ? m.openings : []).forEach((o, oi) => {
const w = mNum(o.w), h = winH(o), dw = mNum(o.dw), dh = mNum(o.dh), cnt = Math.max(1, Math.round(mCount(o.n)));
const ok = o.type === 'balcony' ? w > 0 && h > 0 && dw > 0 && dh > 0 : w > 0 && mNum(o.h) > 0;
if (!ok) return;
const one = o.type === 'balcony' ? [dh, h, Math.max(0, dh - h), w + dw].filter(v => v > 0.0005) : [mNum(o.h), mNum(o.h), w];
const pieces = [];
for (let k = 0; k < cnt; k++) pieces.push(...one);
const code = opCode(o, oi) + (cnt > 1 ? ` ×${cnt}` : '');
items.push({ key: 'so' + oi, group: 'slopes', kind: 'out', label: code, pieces, def: o.slopes !== false });
items.push({ key: 'si' + oi, group: 'slopes', kind: 'in', label: code, pieces, def: false });
});
// стыки по периметру: стена — потолок, стена — пол (без дверных проёмов)
const lens = (Array.isArray(m.walls) ? m.walls : []).map(mNum);
if (lens.some(v => v > 0)) {
items.push({ key: 'jc', group: 'joints', kind: 'in', label: 'Стена — потолок', pieces: lens.filter(v => v > 0), def: false });
const doorsOn = wi => (m.openings || []).filter(o => o.wall === wi && (o.type === 'door' || o.type === 'balcony'))
.reduce((a, o) => a + (o.type === 'balcony' ? mNum(o.dw) : mNum(o.w)), 0);
items.push({ key: 'jf', group: 'joints', kind: 'in', label: 'Стена — пол', pieces: lens.map((v, wi) => v - doorsOn(wi)).filter(v => v > 0.0005), def: false });
}
// ниши и короба: наружные рёбра и внутренние углы
(r.ceilEls || []).forEach(e => {
const cuts = e.strips.reduce((a, p) => a + (p.cutA ? 1 : 0) + (p.cutB ? 1 : 0), 0);
const ends = [];
for (let k = 0; k < cuts; k++) { if (e.w > 0) ends.push(e.w); if (e.h > 0) ends.push(e.h); }
if (e.type === 'box') {
items.push({ key: 'eo' + e.idx, group: 'els', kind: 'out', label: e.code, pieces: [e.innerLen, ...ends], def: true });
items.push({ key: 'ei' + e.idx, group: 'els', kind: 'in', label: e.code, pieces: e.h > 0 ? [e.innerLen, e.len] : [e.len], def: false });
} else {
items.push({ key: 'eo' + e.idx, group: 'els', kind: 'out', label: e.code, pieces: [e.innerLen], def: true });
items.push({ key: 'ei' + e.idx, group: 'els', kind: 'in', label: e.code, pieces: e.h > 0 ? [e.len, e.innerLen] : [e.len], def: false });
}
});
const sel = m.corners && typeof m.corners === 'object' ? m.corners : {};
items.forEach(it => { it.on = typeof sel[it.key] === 'boolean' ? sel[it.key] : it.def; });
return items;
}

const CORNER_GROUPS = { walls: 'углы стен', slopes: 'откосы', joints: 'стыки', els: 'ниши и короба' };
function cornersCompute(m, r) {
const items = cornerItemsList(m, r);
const res = { items, out: 0, in: 0, min: false, linesOut: [], linesIn: [] };
['out', 'in'].forEach(kind => {
Object.keys(CORNER_GROUPS).forEach(gk => {
const list = items.filter(it => it.on && it.kind === kind && it.group === gk && it.pieces.length);
if (!list.length) return;
let sum = 0;
const txt = list.map(it => {
it.pieces.forEach(v => { sum += minLen(v); if (v < 1) res.min = true; });
const one = it.pieces.map(fmtMin).join(' + ');
return gk === 'joints' ? `${it.label.toLowerCase()} ${one}` : `${it.label}: ${one}`;
}).join('; ');
res[kind] += sum;
(kind === 'out' ? res.linesOut : res.linesIn).push(`${CORNER_GROUPS[gk]} (${txt})`);
});
});
return res;
}

/* ---------- расчёт ---------- */
function computeMeasure(m) {
const r = { lines: {} };
const H = mNum(m.height);
// У стены может быть своя высота (мансарда, перегородка не до потолка);
// не указана — берётся общая высота помещения.
const wh = Array.isArray(m.wallHeights) ? m.wallHeights : [];
const allWalls = m.walls.map((w, i) => ({ l: mNum(w), h: mNum(wh[i]) })).filter(w => w.l > 0);
const perim = allWalls.reduce((a, w) => a + w.l, 0);
r.perimeter = perim;
// Стенка уже метра — узкая полоса от пола до потолка: считается погонными
// метрами по высоте (в «Узкие»), а не квадратными в площадь стен.
// Одна стена, введённая суммой («3,2+4,1+…»), под правило не попадает — её длина больше метра.
const narrowWalls = allWalls.filter(w => w.l < 1);
const wallList = allWalls.filter(w => w.l >= 1);
r.narrowWalls = 0;
r.narrowWallsCount = narrowWalls.length;
if (narrowWalls.length) {
const byH = new Map();
let noH = 0;
narrowWalls.forEach(w => {
const hh = w.h || H;
if (!(hh > 0)) { noH++; return; }
r.narrowWalls += minLen(hh);
const key = mFmt(hh);
const e = byH.get(key) || { hh, widths: [] };
e.widths.push(w.l); byH.set(key, e);
});
const parts = [...byH.values()].map(e => `${e.widths.length > 1 ? `${e.widths.length} × ` : ''}${e.hh < 1 ? '1*' : mFmt(e.hh)}`);
r.lines.narrowWalls = `Узкие стены (уже 1 м: ${narrowWalls.map(w => mFmt(w.l)).join('; ')}) — по высоте: ${parts.join(' + ')} = ${mFmt(r.narrowWalls)} пог. м${noH ? ' · укажите высоту стен' : ''}`;
}
const common = wallList.filter(w => !w.h);
const own = wallList.filter(w => w.h);
r.wallsGross = (H > 0 ? common.reduce((a, w) => a + w.l, 0) * H : 0) + own.reduce((a, w) => a + w.l * w.h, 0);
const partsText = [];
if (common.length && H > 0) partsText.push(common.length > 1 ? `(${common.map(w => mFmt(w.l)).join(' + ')}) × ${mFmt(H)}` : `${mFmt(common[0].l)} × ${mFmt(H)}`);
own.forEach(w => partsText.push(`${mFmt(w.l)} × ${mFmt(w.h)}`));
if (partsText.length && (!common.length || H > 0)) {
r.lines.walls = `Стены: ${partsText.join(' + ')} = ${mFmt(r.wallsGross)} м²`;
} else if (allWalls.length) {
r.lines.walls = `Периметр: ${allWalls.map(w => mFmt(w.l)).join(' + ')} = ${mFmt(perim)} м · укажите высоту стен`;
}

const ops = m.openings.map(o => ({ type: o.type, w: mNum(o.w), h: winH(o), dw: mNum(o.dw), dh: mNum(o.dh), n: mCount(o.n), slopes: o.slopes !== false }))
.filter(o => o.w > 0 && o.h > 0 && o.n > 0 && (o.type !== 'balcony' || (o.dw > 0 && o.dh > 0)));
// Балконный блок: площадь окна + площадь двери
const opArea = o => o.type === 'balcony' ? o.w * o.h + o.dw * o.dh : o.w * o.h;
r.openingsArea = ops.reduce((a, o) => a + opArea(o) * o.n, 0);
if (ops.length) {
r.lines.openings = `Окна и двери: ${ops.map(o => (o.type === 'balcony'
? `балк. блок (окно ${mFmt(o.w)}×${mFmt(o.h)} + дверь ${mFmt(o.dw)}×${mFmt(o.dh)})`
: `${typeLabel(o.type)} ${mFmt(o.w)}×${mFmt(o.h)}`) + (o.n !== 1 ? `×${mFmt(o.n)}` : '')).join(' + ')} = ${mFmt(r.openingsArea)} м²`;
}
r.wallsNet = Math.max(0, r.wallsGross - r.openingsArea);
// Режим стен: «минус проёмы» (по умолчанию) или «без вычета проёмов» —
// тогда у проёмов, где до угла, потолка, пола или соседнего проёма меньше
// метра, добавляются погонные метры вдоль проёма (в «Узкие»).
r.wallsGrossMode = m.wallMode === 'gross';
r.wallsCalc = r.wallsGrossMode || !(r.openingsArea > 0) ? r.wallsGross : r.wallsNet;
if (r.wallsGross > 0 && r.openingsArea > 0) {
r.lines.net = r.wallsGrossMode
? `Проёмы не вычитаются: стены ${mFmt(r.wallsGross)} м²`
: `Стены без проёмов: ${mFmt(r.wallsGross)} − ${mFmt(r.openingsArea)} = ${mFmt(r.wallsNet)} м²`;
}
r.openStrips = 0;
if (r.wallsGrossMode) {
const st = openStripsCompute(m);
r.openStrips = st.total;
if (st.pieces.length) r.lines.openStrips = `У проёмов (меньше 1 м до сопряжения): ${st.pieces.map(p => `${p.label} ${fmtMin(p.len)}`).join(' + ')} = ${mFmt(st.total)} пог. м${st.min ? MIN_NOTE : ''}`;
if (st.loose.length) r.lines.openStripsLoose = `Не учтены (не стоят на стене): ${st.loose.join(', ')}`;
}

// Откосы — в погонных метрах: две боковины и верх,
// (2 × высота + ширина) × количество. Глубина не нужна: всё, что у́же
// метра, считается погонным метром по цене квадратного. Кусок короче
// метра всё равно считается за 1 пог. м — отмечаем такие звёздочкой.
const slopeParts = [];
r.slopesLen = 0;
r.slopesHasMin = false;
ops.filter(o => o.slopes).forEach(o => {
// Каждый откос — отдельный кусок. У окна и двери: левый + правый + верх.
// У балконного блока откосы общие: стойка у двери, стойка у окна,
// кусок под окном до пола (дверь выше окна) и общий верх.
const pieces = o.type === 'balcony'
? [o.dh, o.h, Math.max(0, o.dh - o.h), o.w + o.dw].filter(v => v > 0.0005)
: [o.h, o.h, o.w];
if (pieces.some(v => v < 1)) r.slopesHasMin = true;
r.slopesLen += pieces.reduce((a, v) => a + minLen(v), 0) * o.n;
slopeParts.push(`${typeLabel(o.type)} (${pieces.map(fmtMin).join(' + ')})${o.n !== 1 ? ` × ${mFmt(o.n)} шт.` : ''}`);
});
if (slopeParts.length) {
r.lines.slopesLen = `Откосы: ${slopeParts.join(' + ')} = ${mFmt(r.slopesLen)} пог. м${r.slopesHasMin ? MIN_NOTE : ''}`;
}

// Участки стен: часть стены под отдельную работу (плитка до 1,5 м, фартук…)
const parts = (Array.isArray(m.parts) ? m.parts : []).map(p => ({ name: String(p.name || '').trim(), l: mNum(p.l), h: mNum(p.h) }))
.filter(p => p.l > 0 && p.h > 0);
r.parts = parts.reduce((a, p) => a + p.l * p.h, 0);
if (parts.length) {
r.lines.parts = `Участки стен: ${parts.map(p => `${p.name ? p.name + ' ' : ''}${mFmt(p.l)}×${mFmt(p.h)}`).join(' + ')} = ${mFmt(r.parts)} м²`;
}
const wallsBase = r.wallsCalc;
r.wallsMinusParts = Math.max(0, wallsBase - r.parts);
if (parts.length && wallsBase > 0) {
r.lines.wallsMinusParts = `Стены без участков: ${mFmt(wallsBase)} − ${mFmt(r.parts)} = ${mFmt(r.wallsMinusParts)} м²`;
}

const ceil = m.ceiling.map(c => ({ l: mNum(c.l), w: mNum(c.w) })).filter(c => c.l > 0 && c.w > 0);
r.ceiling = ceil.reduce((a, c) => a + c.l * c.w, 0);
r.ceilingAuto = false;
if (ceil.length) r.lines.ceiling = `Потолок: ${ceil.map(c => `${mFmt(c.l)}×${mFmt(c.w)}`).join(' + ')} = ${mFmt(r.ceiling)} м²`;
// Участки потолка не введены, а комната сошлась — потолок по контуру стен
// (равен площади пола). Введённые вручную участки всегда главнее.
if (!ceil.length && typeof rulerGeometry === 'function' && Array.isArray(m.walls) && m.walls.length >= 3) {
try {
const g = rulerGeometry(m);
if (g.closed) {
const pts = [[0, 0], ...g.segs.map(q => [q.x2, q.y2])];
let a2 = 0;
for (let i = 0; i < pts.length - 1; i++) a2 += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
const area = Math.abs(a2) / 2;
if (area > 0.01) {
r.ceiling = area;
r.ceilingAuto = true;
r.lines.ceiling = `Потолок по контуру стен = ${mFmt(area)} м²`;
}
}
} catch (e) { /* без чертежа — только ручной ввод */ }
}

// Закарнизные ниши и короба на потолке
const ce = ceilElsCompute(m);
r.ceilEls = ce.list;
r.ceilNiche = ce.niche;
r.ceilBox = ce.box;
r.ceilFin = ce.finLin;
r.ceilFinArea = ce.finArea;
r.ceilFinMin = ce.finMin;
r.ceilStrips = ce.strips;
r.ceilLight = ce.light;
if (ce.list.length) {
r.lines.ceilEls = ce.list.map(e => e.line).join('\n');
if (r.ceiling > 0 && ce.strips > 0) {
r.ceilingNet = Math.max(0, r.ceiling - ce.strips);
r.lines.ceilingNet = `Потолок без ниш и коробов: ${mFmt(r.ceiling)} − ${mFmt(ce.strips)} = ${mFmt(r.ceilingNet)} м²`;
}
}
if (!(r.ceilingNet >= 0)) r.ceilingNet = 0;

const nar = m.narrow.map(mNum).filter(v => v > 0);
r.narrowManual = nar.reduce((a, v) => a + minLen(v), 0);
// узкие стены из замера стен — туда же
// и узкие места у проёмов (режим «без вычета проёмов»)
r.narrow = r.narrowManual + (r.narrowWalls || 0) + (r.openStrips || 0);
const narHasMin = nar.some(v => v < 1);
if (nar.length) r.lines.narrow = `Узкие поверхности: ${nar.map(fmtMin).join(' + ')} = ${mFmt(r.narrowManual)} пог. м${narHasMin ? MIN_NOTE : ''}`;
const narParts = [r.narrowManual, r.narrowWalls || 0, r.openStrips || 0].filter(v => v > 0);
if (narParts.length > 1) r.lines.narrowTotal = `Узкие всего: ${narParts.map(mFmt).join(' + ')} = ${mFmt(r.narrow)} пог. м`;

// Углы: наружные и внутренние, по отмеченным
const cr = cornersCompute(m, r);
r.cornerItems = cr.items;
r.cornersOut = cr.out;
r.cornersIn = cr.in;
r.corners = cr.out + cr.in;
r.cornersMin = cr.min;
if (cr.linesOut.length) r.lines.cornersOut = `Наружные углы: ${cr.linesOut.join(' + ')} = ${mFmt(cr.out)} пог. м`;
if (cr.linesIn.length) r.lines.cornersIn = `Внутренние углы: ${cr.linesIn.join(' + ')} = ${mFmt(cr.in)} пог. м`;
if (cr.out > 0 && cr.in > 0) r.lines.cornersTotal = `Углы всего: ${mFmt(cr.out)} + ${mFmt(cr.in)} = ${mFmt(r.corners)} пог. м`;

// Лепнина: карниз, плинтус, молдинги
if (typeof moldingCompute === 'function') {
const mo = moldingCompute(m);
r.mol = mo;
r.molCornice = mo.cornice ? mo.cornice.len : 0;
r.molPlinth = mo.plinth ? mo.plinth.len : 0;
r.molCeil = mo.ceilLen;
r.molWall = mo.wallLen;
Object.keys(mo.lines).forEach(k => { r.lines['mol_' + k] = mo.lines[k]; });
}
return r;
}

// Что вставлять из текущей вкладки
function measureValueForTab(r, tab) {
if (tab === 'walls') {
return { value: r.wallsCalc, unit: 'м²', label: r.wallsGrossMode && r.openingsArea > 0 ? 'Стены без вычета проёмов' : r.openingsArea > 0 ? 'Стены без проёмов' : 'Площадь стен',
text: [r.lines.walls, r.lines.openings, r.lines.net].filter(Boolean).join('\n') };
}
if (tab === 'molCornice') return { value: r.molCornice || 0, unit: 'пог. м', label: 'Карниз', text: r.lines.mol_cornice || '' };
if (tab === 'molPlinth') return { value: r.molPlinth || 0, unit: 'пог. м', label: 'Плинтус', text: r.lines.mol_plinth || '' };
if (tab === 'molCeil') return { value: r.molCeil || 0, unit: 'пог. м', label: 'Молдинг на потолке', text: r.lines.mol_ceil || '' };
if (tab === 'molWall') return { value: r.molWall || 0, unit: 'пог. м', label: 'Молдинг на стенах', text: r.lines.mol_wall || '' };
if (tab === 'corners' || tab === 'cornersOut' || tab === 'cornersIn') {
const cmin = r.cornersMin ? MIN_NOTE : '';
if (tab === 'cornersOut') return { value: r.cornersOut, unit: 'пог. м', label: 'Углы наружные', text: (r.lines.cornersOut || '') + cmin };
if (tab === 'cornersIn') return { value: r.cornersIn, unit: 'пог. м', label: 'Углы внутренние', text: (r.lines.cornersIn || '') + cmin };
return { value: r.corners, unit: 'пог. м', label: 'Углы', text: [r.lines.cornersOut, r.lines.cornersIn, r.lines.cornersTotal].filter(Boolean).join('\n') + cmin };
}
if (tab === 'parts') return { value: r.parts, unit: 'м²', label: 'Участки стен', text: r.lines.parts || '' };
if (tab === 'wallsMinus') {
return { value: r.parts > 0 ? r.wallsMinusParts : 0, unit: 'м²', label: 'Стены без участков',
text: [r.lines.walls, r.lines.openings, r.lines.net, r.lines.parts, r.lines.wallsMinusParts].filter(Boolean).join('\n') };
}
if (tab === 'ceiling') return { value: r.ceiling, unit: 'м²', label: 'Потолок', text: r.lines.ceiling || '' };
if (tab === 'ceilingNet') return { value: r.ceilingNet, unit: 'м²', label: 'Потолок без ниш и коробов', text: [r.lines.ceiling, r.lines.ceilEls, r.lines.ceilingNet].filter(Boolean).join('\n') };
if (tab === 'ceilNiche') return { value: r.ceilNiche, unit: 'пог. м', label: 'Закарнизные ниши', text: (r.ceilEls || []).filter(e => e.type === 'niche').map(e => e.line).join('\n') };
if (tab === 'ceilBox') return { value: r.ceilBox, unit: 'пог. м', label: 'Короба, длина', text: (r.ceilEls || []).filter(e => e.type === 'box').map(e => e.line).join('\n') };
if (tab === 'ceilLight') return { value: r.ceilLight, unit: 'пог. м', label: 'Подсветка', text: (r.ceilEls || []).filter(e => e.light).map(e => e.line).join('\n') };
if (tab === 'ceilFin') return { value: r.ceilFin, unit: 'пог. м', label: 'Ниши и короба: обработка', text: (r.ceilEls || []).filter(e => e.finLin > 0).map(e => e.line).join('\n') + (r.ceilFinMin ? MIN_NOTE : '') };
if (tab === 'ceilFinArea') return { value: r.ceilFinArea, unit: 'м²', label: 'Ниши и короба: обработка, м²', text: (r.ceilEls || []).filter(e => e.finArea > 0).map(e => e.line).join('\n') };
if (tab === 'slopes') return { value: r.slopesLen, unit: 'пог. м', label: 'Откосы', text: r.lines.slopesLen || '' };
if (tab === 'narrow') return { value: r.narrow, unit: 'пог. м', label: 'Узкие поверхности', text: [r.lines.narrowWalls, r.lines.narrow, r.lines.openStrips, r.lines.narrowTotal].filter(Boolean).join('\n') };
return { value: 0, unit: '', label: '', text: '' };
}

/* ---------- черновик замера ---------- */
function measureDraftKey() { return 'measureDraft:' + (currentUser || ''); }
function saveMeasureDraft() {
measureDirty = true;
if (measureTarget.kind === 'room') { if (typeof updateRoomSaveBtn === 'function') updateRoomSaveBtn(); return; }
try { localStorage.setItem(measureDraftKey(), JSON.stringify({ measure, measureTab, measureDirty })); } catch (e) { /* пусто */ }
}
function loadMeasureDraft() {
try {
const d = JSON.parse(localStorage.getItem(measureDraftKey()) || 'null');
if (d && d.measure && Array.isArray(d.measure.walls)) {
measure = d.measure; measureTab = d.measureTab || 'walls'; measureDirty = !!d.measureDirty;
return true;
}
} catch (e) { /* пусто */ }
return false;
}
function isMeasureEmpty(m) {
const r = computeMeasure(m);
return !(r.perimeter || r.openingsArea || r.ceiling || r.narrow || r.parts || mNum(m.height));
}

/* ---------- открыть / закрыть ---------- */
function openMeasure(target = { kind: 'none' }) {
measureTarget = target || { kind: 'none' };
const roomMode = measureTarget.kind === 'room';
document.getElementById('mpNewBtn').style.display = roomMode ? 'none' : '';
document.getElementById('mpSaveBtn').style.display = roomMode ? 'none' : '';
document.getElementById('mpRoomSaveBtn').style.display = roomMode ? '' : 'none';
// у помещения объект берётся из счёта — отдельный выбор не нужен
document.getElementById('mpObject').style.display = roomMode ? 'none' : '';
if (roomMode) {
// Замер помещения правится отдельно от обычного черновика замера
const room = measureTarget.roomId ? findObjectRoom(measureTarget.objectId, measureTarget.roomId) : null;
measure = room ? JSON.parse(JSON.stringify(room.measure)) : newMeasure(measureTarget.objectId);
measureTab = 'walls';
measureDirty = false;
document.getElementById('measurePanel').classList.add('open');
document.body.classList.add('measure-open');
fillMeasureObjectSelect();
document.getElementById('mpRoom').value = measure.room || '';
// у существующего помещения стартовое состояние — «сохранено»
roomSavedJson = room ? roomStateJson() : null;
updateRoomSaveBtn();
renderMeasure();
if (!room) setTimeout(() => document.getElementById('mpRoom').focus(), 50);
return;
}
if (!measure && !loadMeasureDraft()) measure = newMeasure();
const calcSelect = document.getElementById('invoiceObjectSelect');
const calcObj = calcSelect && calcSelect.value && calcSelect.value !== '__new__' ? calcSelect.value : '';
const wantObj = target.objectId || calcObj || '';
if (target.fresh && (!isMeasureEmpty(measure) && measureDirty) &&
!confirm('Начать новый замер? Текущий несохранённый замер пропадёт.')) {
// оставляем текущий
} else if (target.fresh) {
measure = newMeasure(wantObj); measureTab = 'walls'; measureDirty = false;
}
if (!measure.objectId && wantObj) measure.objectId = wantObj;
document.getElementById('measurePanel').classList.add('open');
document.body.classList.add('measure-open');
fillMeasureObjectSelect();
document.getElementById('mpRoom').value = measure.room || '';
renderMeasure();
}

function closeMeasure() {
if (cpFull) { cpFull = false; document.body.classList.remove('cp-full-open'); }
if (typeof rlFull !== 'undefined' && rlFull) { rlFull = false; document.body.classList.remove('rl-full-open'); }
cpZoom = 1; cpPan = { x: 0, y: 0 }; cpRot = 0;
if (typeof rulerTarget !== 'undefined') { rulerTarget = null; rulerUndo = []; rulerPick = null; if (typeof rlEditBase !== "undefined") rlEditBase = null; rlZoom = 1; rlPan = { x: 0, y: 0 }; rlUnderlayAdjust = false; rlLastFit = null; }
document.getElementById('measurePanel').classList.remove('ruler-open');
document.getElementById('measurePanel').classList.remove('open');
document.body.classList.remove('measure-open');
if (measureTarget.kind === 'room') {
// следующий обычный замер подхватит свой черновик
measure = null;
measureTarget = { kind: 'none' };
}
}

function startNewMeasure() {
if (!isMeasureEmpty(measure) && measureDirty && !confirm('Начать новый замер? Текущий несохранённый замер пропадёт.')) return;
measure = newMeasure(measure.objectId);
measureTab = 'walls';
measureDirty = false;
try { localStorage.removeItem(measureDraftKey()); } catch (e) { /* пусто */ }
document.getElementById('mpRoom').value = '';
fillMeasureObjectSelect();
renderMeasure();
}

function fillMeasureObjectSelect() {
const sel = document.getElementById('mpObject');
const objs = typeof getVisibleObjects === 'function' ? getVisibleObjects() : [];
sel.innerHTML = `<option value="">Без объекта (на этом телефоне)</option>` +
objs.map(o => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`).join('');
sel.value = objs.some(o => o.id === measure.objectId) ? measure.objectId : '';
}

function measureTargetUnit() {
const t = measureTarget;
if (t.kind === 'service') { const s = document.getElementById(`select_unit_${t.idx}`); return s ? s.value : ''; }
if (t.kind === 'custom') { const s = document.getElementById('customItemUnit'); return s ? s.value : ''; }
if (t.kind === 'cart') { const it = invoiceCart[t.idx]; return it ? it.unit : ''; }
return '';
}

function measureTargetName() {
const t = measureTarget;
if (t.kind === 'service') { const s = (cloudData.services || [])[t.idx]; return s ? s.name : ''; }
if (t.kind === 'cart') { const it = invoiceCart[t.idx]; return it ? it.name : ''; }
if (t.kind === 'custom') { const n = document.getElementById('customItemName'); return (n && n.value.trim()) || 'своя позиция'; }
return '';
}

/* ---------- отрисовка ---------- */
function mIn(path, value, placeholder, extra = '') {
const m = /class-extra="([^"]*)"/.exec(extra);
const cls = m ? ' ' + m[1] : '';
extra = extra.replace(/class-extra="[^"]*"/, '');
return `<input class="mp-in${cls}" type="text" inputmode="decimal" autocomplete="off" data-path="${path}" value="${escapeHtml(value || '')}" placeholder="${escapeHtml(placeholder)}" ${extra}>`;
}

function renderMeasure() {
document.querySelectorAll('#measurePanel .mp-tabs .chip').forEach(c => c.classList.toggle('active', c.dataset.tab === measureTab));
const body = document.getElementById('mpBody');
const m = measure;
let html = '';
if (measureTab === 'walls') {
html += rulerSectionHtml() + `<section class="mp-sec">
<div class="mp-sec-title">Окна и двери</div>
<div class="mp-mode" role="group" aria-label="Как считать стены">
<button type="button" class="${m.wallMode !== 'gross' ? 'on' : ''}" onclick="setWallMode('net')">Минус проёмы<small>+ откосы отдельно</small></button>
<button type="button" class="${m.wallMode === 'gross' ? 'on' : ''}" onclick="setWallMode('gross')">Без вычета проёмов<small>+ пог. м у проёмов</small></button>
</div>
${m.wallMode === 'gross' ? '<div class="mp-hint">Площадь стен — целиком. Где от проёма до угла, потолка, пола или соседнего проёма меньше 1 м, добавляются пог. м вдоль проёма (в «Узкие»). Нужна привязка проёмов к стенам.</div>' : ''}
<div class="mp-hint">«+» добавляет проём с размерами предыдущего — поправьте, если отличается.</div>
${m.openings.map((o, i) => `<div class="mp-open">
<div class="mp-open-top">
<button type="button" class="mp-type" onclick="toggleOpeningType(${i})" aria-label="Сменить тип проёма">${o.type === 'door' ? 'Дверь' : o.type === 'balcony' ? 'Балк. блок' : 'Окно'} ▾</button>
<span class="mp-open-area" id="mpOpenArea${i}"></span>
<button type="button" class="mp-del" onclick="removeMeasureRow('openings', ${i})" aria-label="Убрать проём">✕</button>
</div>
<div class="mp-dims">
<label>${o.type === 'balcony' ? 'Окно, ширина ↔' : 'Ширина ↔'}${mIn(`openings.${i}.w`, o.w, '1,4')}</label><span class="mp-x">×</span>
${o.type === 'balcony' && (hasSill(o) || !String(o.h || '').trim())
? `<label>Окно от пола ↕${mIn(`openings.${i}.sill`, o.sill, '0,9')}</label><span class="mp-x">·</span>`
: `<label>Высота ↕${mIn(`openings.${i}.h`, o.h, o.type === 'door' ? '2,1' : '1,5')}</label><span class="mp-x">×</span>`}
<label>Шт.${mIn(`openings.${i}.n`, o.n, '1', 'inputmode="numeric"')}</label>
</div>
${o.type === 'balcony' ? `<div class="mp-dims mp-dims-2" style="margin-top:6px;">
<label>Дверь, ширина ↔${mIn(`openings.${i}.dw`, o.dw, '0,8')}</label><span class="mp-x">×</span>
<label>Дверь, высота до верха ↕${mIn(`openings.${i}.dh`, o.dh, '2,1')}</label>
</div>
${hasSill(o) ? `<div class="mp-hint" style="margin:6px 0 0;">Окно по высоте: <b>${mFmt(winH(o))} м</b> — до верха двери</div>` : ''}` : ''}
${m.walls.length ? `<div class="mp-place">
<label>На плане
<select onchange="setOpeningWall(${i}, this.value)">
<option value="">не показывать</option>
${m.walls.map((w, wi) => `<option value="${wi}" ${o.wall === wi ? 'selected' : ''}>стена ${wi + 1}${mNum(w) ? ' · ' + mFmt(mNum(w)) + ' м' : ''}</option>`).join('')}
</select></label>
${typeof o.wall === 'number' ? `<label>От угла ${o.from === 'end' ? 'Б' : 'А'}, м${mIn(`openings.${i}.off`, o.off, 'по центру')}</label>` : ''}
</div>` : ''}
</div>`).join('')}
${rlShape(m)
? `<div class="mp-add-loose-row">${m.openings.length ? '' : 'Окна и двери ставятся кнопками под чертежом. '}Без привязки к стене:
<button type="button" class="mp-add-loose" onclick="addOpening('window')">+ окно</button>
<button type="button" class="mp-add-loose" onclick="addOpening('door')">+ дверь</button></div>`
: `<div class="mp-add-row">
<button type="button" class="mp-add" onclick="addOpening('window')">+ Окно</button>
<button type="button" class="mp-add" onclick="addOpening('door')">+ Дверь</button>
</div>`}
<div class="mp-calc" id="mpCalcOpenings"></div>
${m.openings.length ? `<button type="button" class="mp-link-btn" onclick="setMeasureTab('slopes')">Посчитать откосы этих проёмов →</button>` : ''}
</section>
<section class="mp-sec">
<div class="mp-sec-title">Участки стен</div>
<div class="mp-hint">Часть стены под отдельную работу: плитка до 1,5 м, фартук, акцентная стена. Стены при этом не меняются — при выборе работы будут и «Участки», и «Стены без участков».</div>
${(m.parts || []).map((pt, i) => `<div class="mp-open">
<div class="mp-open-top">
<input class="mp-name-in" type="text" data-path="parts.${i}.name" value="${escapeHtml(pt.name || '')}" placeholder="Название: плитка, фартук…" autocomplete="off">
<span class="mp-open-area" id="mpPartArea${i}"></span>
<button type="button" class="mp-del" onclick="removeMeasureRow('parts', ${i})" aria-label="Убрать участок">✕</button>
</div>
<div class="mp-dims mp-dims-2">
<label>Длина ↔${mIn(`parts.${i}.l`, pt.l, '3,2+4,1')}</label><span class="mp-x">×</span>
<label>Высота ↕${mIn(`parts.${i}.h`, pt.h, '1,5')}</label>
</div>
</div>`).join('')}
<div class="mp-add-row"><button type="button" class="mp-add" onclick="addMeasureRow('parts')">+ Участок стены</button></div>
<div class="mp-calc" id="mpCalcParts"></div>
</section>`;
} else if (measureTab === 'ceiling') {
html += `<section class="mp-sec">
<div class="mp-sec-title">Потолок</div>
<div class="mp-ceil-auto" id="mpCeilAuto"></div>
<div class="mp-hint">Сложный потолок — каждый прямоугольный участок отдельной строкой.</div>
${m.ceiling.map((c, i) => `<div class="mp-row">${mIn(`ceiling.${i}.l`, c.l, 'длина')}<span class="mp-x">×</span>${mIn(`ceiling.${i}.w`, c.w, 'ширина')}<span class="mp-row-res" id="mpCeilRes${i}"></span>${m.ceiling.length > 1 ? `<button type="button" class="mp-del" onclick="removeMeasureRow('ceiling', ${i})" aria-label="Убрать участок">✕</button>` : ''}</div>`).join('')}
<div class="mp-add-row"><button type="button" class="mp-add" onclick="addMeasureRow('ceiling')">+ Участок</button></div>
<div class="mp-calc" id="mpCalcCeiling"></div>
</section>
${ceilElsSectionHtml(m)}`;
} else if (measureTab === 'slopes') {
// проём годится, если у него есть размеры; у балконного блока высота окна может считаться из подоконника
const valid = m.openings.map((o, i) => ({ o, i })).filter(({ o }) => o.type === 'balcony'
? mNum(o.w) > 0 && winH(o) > 0 && mNum(o.dw) > 0 && mNum(o.dh) > 0
: mNum(o.w) > 0 && mNum(o.h) > 0);
if (!valid.length) {
html += `<section class="mp-sec"><div class="mp-empty">Откосы считаются по окнам и дверям.<br>Сначала добавьте их на вкладке «Стены».</div>
<button type="button" class="mp-link-btn" onclick="setMeasureTab('walls')">← К окнам и дверям</button></section>`;
} else {
html += `<section class="mp-sec">
<div class="mp-sec-title">Какие проёмы с откосами</div>
<div class="mp-hint">Каждый откос отдельно: левый + правый + верх. Откос короче метра считается за 1 пог. м.</div>
${valid.map(({ o, i }) => {
const n = mCount(o.n);
let title, pieces;
if (o.type === 'balcony') {
const h = winH(o), dw = mNum(o.dw), dh = mNum(o.dh), w = mNum(o.w);
title = `Балконный блок: окно ${mFmt(w)}×${mFmt(h)} + дверь ${mFmt(dw)}×${mFmt(dh)}`;
// откосы общие: стойка у двери, стойка у окна, кусок под окном до пола, общий верх
pieces = [dh, h, Math.max(0, dh - h), w + dw].filter(v => v > 0.0005);
} else {
title = `${o.type === 'door' ? 'Дверь' : 'Окно'} ширина ${mFmt(mNum(o.w))}, высота ${mFmt(mNum(o.h))}`;
pieces = [mNum(o.h), mNum(o.h), mNum(o.w)];
}
const text = pieces.map(v => v < 1 ? '1*' : mFmt(v)).join(' + ');
const sum = pieces.reduce((a, v) => a + minLen(v), 0) * n;
return `<label class="mp-check"><input type="checkbox" ${o.slopes !== false ? 'checked' : ''} onchange="setOpeningSlopes(${i}, this.checked)">
<span>${title}${n !== 1 ? `, ${mFmt(n)} шт.` : ''}<br>
откосы: ${text}${n !== 1 ? ` × ${mFmt(n)}` : ''} = <b>${mFmt(sum)} пог. м</b></span></label>`;
}).join('')}
<div class="mp-calc" id="mpCalcSlopes"></div>
</section>`;
}
} else if (measureTab === 'narrow') {
html += `<section class="mp-sec">
<div class="mp-sec-title">Узкие поверхности</div>
<div class="mp-hint">Всё, что у́же метра хотя бы по одной стороне, — погонные метры. Длины складываются, кусок короче метра — за 1 пог. м.</div>
${m.narrow.map((v, i) => `<div class="mp-row"><span class="mp-row-label">${i + 1}.</span>${mIn('narrow.' + i, v, '0,00')}<span class="mp-unit">м</span>${m.narrow.length > 1 ? `<button type="button" class="mp-del" onclick="removeMeasureRow('narrow', ${i})" aria-label="Убрать">✕</button>` : ''}</div>`).join('')}
<div class="mp-add-row"><button type="button" class="mp-add" onclick="addMeasureRow('narrow')">+ Добавить</button></div>
<div class="mp-calc" id="mpCalcNarrow"></div>
</section>`;
} else if (measureTab === 'corners') {
html += cornersTabHtml(m);
} else if (measureTab === 'molding') {
html += typeof moldingTabHtml === 'function' ? moldingTabHtml(m) : '';
} else if (measureTab === 'history') {
html += renderMeasureHistoryHtml();
}
body.innerHTML = `<div class="mp-body-inner">${html}</div>`;
updateMeasureOutputs();
}

function updateMeasureOutputs() {
if (typeof renderRulerSketch === 'function' && measureTab === 'walls') renderRulerSketch();
const r = computeMeasure(measure);
const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
set('mpCalcWalls', [r.lines.walls, r.lines.narrowWalls].filter(Boolean).map(escapeHtml).join('<br>'));
set('mpCalcOpenings', [r.lines.openings, r.lines.net, r.lines.openStrips, r.lines.openStripsLoose].filter(Boolean).map(escapeHtml).join('<br>').replace(/\n/g, '<br>'));
set('mpCalcCorners', [r.lines.cornersOut, r.lines.cornersIn, r.lines.cornersTotal].filter(Boolean).map(escapeHtml).join('<br>') + (r.cornersMin ? '<br>* меньше 1 м — считается как 1 пог. м' : ''));
set('mpCalcCeiling', r.lines.ceiling ? escapeHtml(r.lines.ceiling) : '');
set('mpCeilAuto', r.ceilingAuto
? `Комната сошлась — площадь потолка посчитана по контуру стен: <b>${mFmt(r.ceiling)} м²</b>. Если потолок сложный (короба, уровни), введите участки ниже — тогда посчитается по ним.`
: '');
set('mpCalcParts', [r.lines.parts, r.lines.wallsMinusParts].filter(Boolean).map(escapeHtml).join('<br>'));
set('mpCalcCeilEls', [r.lines.ceilEls, r.lines.ceilingNet].filter(Boolean).map(escapeHtml).join('<br>').replace(/\n/g, '<br>'));
(measure.ceilEls || []).forEach((el, i) => {
const e = (r.ceilEls || []).find(x => x.idx === i);
set('mpCeilElRes' + i, e ? `${mFmt(e.len)} пог. м` : '');
set('mpCeilElFin' + i, e && e.fin.length ? `Обработка: ${escapeHtml(e.fin.join(' + '))} = <b>${[e.finLin ? `${mFmt(e.finLin)} пог. м` : '', e.finArea ? `${mFmt(e.finArea)} м²` : ''].filter(Boolean).join(' + ')}</b>` : (e ? 'Обработка не считается — стороны не отмечены' : ''));
const op = ceilElOp(measure, el);
if (op) {
const ext = Math.max(0, evalMeasureExpr(el.ext) || 0);
set('mpCeilElOver' + i, `Стена ${op.wall + 1}: проём ${mFmt(openingWidth(op))} + вынос 2 × ${mFmt(ext)}${e ? ` = <b>${mFmt(e.len)} м</b>` : ''}${e && Math.abs(e.len - (openingWidth(op) + 2 * ext)) > 0.001 ? ' (упирается в угол)' : ''}`);
}
});
if (measureTab === 'ceiling') renderCeilPlan();
if (measureTab === 'molding' && typeof updateMoldingOutputs === 'function') updateMoldingOutputs(r);
(measure.parts || []).forEach((pt, i) => {
const l = mNum(pt.l), h = mNum(pt.h);
set('mpPartArea' + i, l && h ? `${mFmt(l * h)} м²` : '');
});
set('mpCalcSlopes', r.lines.slopesLen ? escapeHtml(r.lines.slopesLen) : '');
set('mpCalcNarrow', [r.lines.narrowWalls, r.lines.narrow, r.lines.openStrips, r.lines.narrowTotal].filter(Boolean).map(escapeHtml).join('<br>').replace(/\n/g, '<br>'));
measure.openings.forEach((o, i) => {
const w = mNum(o.w), n = mCount(o.n);
// у балконного блока площадь — окно + дверь
const area = o.type === 'balcony' ? w * winH(o) + mNum(o.dw) * mNum(o.dh) : w * mNum(o.h);
set('mpOpenArea' + i, area > 0 && n ? `${mFmt(area * n)} м²` : '');
});
measure.ceiling.forEach((c, i) => {
const l = mNum(c.l), w = mNum(c.w);
set('mpCeilRes' + i, l && w ? `= ${mFmt(l * w)}` : '');
});
// подсветка нераспознанных значений
document.querySelectorAll('#mpBody .mp-in').forEach(el => {
el.classList.toggle('mp-bad', el.value.trim() !== '' && !isFinite(evalMeasureExpr(el.value)));
});
renderMeasureFooter(r);
}

function renderMeasureFooter(r) {
const foot = document.getElementById('mpFoot');
if (measureTab === 'history') { foot.classList.add('hidden'); return; }
foot.classList.remove('hidden');
if (measureTab === 'walls' && !(r.parts > 0)) measureWallsPick = 'walls';
const ceilHasEls = r.ceilNiche > 0 || r.ceilBox > 0;
if (measureTab === 'ceiling' && !ceilHasEls) measureCeilPick = 'ceiling';
const effTab = measureEffTab(r);
const v = measureValueForTab(r, effTab);
let main = '', sub = '', pick = '';
if (measureTab === 'walls' && r.parts > 0 && measureTarget.kind !== 'room') {
const opt = (key, label, val) => `<button type="button" class="${measureWallsPick === key ? 'active' : ''}" onclick="setWallsPick('${key}')">${label}<br><b>${mFmt(val)}</b></button>`;
pick = `<div class="mp-pick">${opt('walls', 'Стены', r.wallsCalc)}${opt('parts', 'Участки', r.parts)}${opt('wallsMinus', 'Стены − участки', r.wallsMinusParts)}</div>`;
} else if (measureTab === 'ceiling' && ceilHasEls && measureTarget.kind !== 'room') {
const opt = (key, label, val, unit) => `<button type="button" class="${measureCeilPick === key ? 'active' : ''}" onclick="setCeilPick('${key}')">${label}<br><b>${mFmt(val)}</b> ${unit}</button>`;
pick = `<div class="mp-pick">${opt('ceiling', 'Потолок', r.ceiling, 'м²')}${r.ceilingNet > 0 ? opt('ceilingNet', 'Без ниш/коробов', r.ceilingNet, 'м²') : ''}${r.ceilNiche > 0 ? opt('ceilNiche', 'Ниши', r.ceilNiche, 'пог. м') : ''}${r.ceilBox > 0 ? opt('ceilBox', 'Короба', r.ceilBox, 'пог. м') : ''}${r.ceilFin > 0 ? opt('ceilFin', 'Обработка', r.ceilFin, 'пог. м') : ''}${r.ceilFinArea > 0 ? opt('ceilFinArea', 'Обработка', r.ceilFinArea, 'м²') : ''}${r.ceilLight > 0 ? opt('ceilLight', 'Подсветка', r.ceilLight, 'пог. м') : ''}</div>`;
} else if (measureTab === 'corners' && r.cornersOut > 0 && r.cornersIn > 0 && measureTarget.kind !== 'room') {
const opt = (key, label, val) => `<button type="button" class="${measureCornersPick === key ? 'active' : ''}" onclick="setCornersPick('${key}')">${label}<br><b>${mFmt(val)}</b> пог. м</button>`;
pick = `<div class="mp-pick">${opt('cornersOut', 'Наружные', r.cornersOut)}${opt('cornersIn', 'Внутренние', r.cornersIn)}${opt('corners', 'Все', r.corners)}</div>`;
} else if (measureTab === 'molding' && ['molCornice', 'molPlinth', 'molCeil', 'molWall'].filter(k => r[k] > 0).length > 1 && measureTarget.kind !== 'room') {
const opt = (key, label) => r[key] > 0 ? `<button type="button" class="${effTab === key ? 'active' : ''}" onclick="setMolPick('${key}')">${label}<br><b>${mFmt(r[key])}</b> пог. м</button>` : '';
pick = `<div class="mp-pick">${opt('molCornice', 'Карниз')}${opt('molPlinth', 'Плинтус')}${opt('molCeil', 'Потолок')}${opt('molWall', 'Стены')}</div>`;
} else if (measureTab === 'walls') {
sub = r.wallsGrossMode && r.openingsArea > 0
? `Проёмы не вычитаются${r.openStrips > 0 ? ` · у проёмов ${mFmt(r.openStrips)} пог. м (в «Узких»)` : ''}`
: r.openingsArea > 0 ? `Стены ${mFmt(r.wallsGross)} − проёмы ${mFmt(r.openingsArea)} м²` : (r.perimeter ? `Периметр ${mFmt(r.perimeter)} м` : 'Введите высоту и длину стен');
if (r.parts > 0) sub += ` · участки ${mFmt(r.parts)} м²`;
}
main = `${mFmt(v.value)}${v.unit ? ' ' + v.unit : ''}`;
const target = measureTarget.kind !== 'none' ? measureTargetName() : '';
document.getElementById('mpResult').innerHTML = `
<div class="mp-result-label">${escapeHtml(v.label || 'Результат')}</div>
${pick || `<div class="mp-result-main">${main}</div>`}
${sub ? `<div class="mp-result-sub">${escapeHtml(sub)}</div>` : ''}
${target ? `<div class="mp-target">→ в «${escapeHtml(target)}»</div>` : ''}`;
const btn = document.getElementById('mpPrimaryBtn');
btn.disabled = !(v.value > 0);
btn.textContent = target ? 'Вставить' : 'Скопировать';
if (measureTarget.kind === 'room') {
btn.disabled = false;
btn.textContent = measureTarget.roomId ? 'Сохранить замер' : 'Добавить помещение';
}
}

let measureWallsPick = 'walls';
function setWallsPick(p) { measureWallsPick = p; updateMeasureOutputs(); }
let measureCeilPick = 'ceiling';
function setCeilPick(p) { measureCeilPick = p; updateMeasureOutputs(); }
let measureCornersPick = 'corners';
function setCornersPick(p) { measureCornersPick = p; updateMeasureOutputs(); }
// Что вставляется с текущей вкладки, если внизу есть выбор
function measureEffTab(r) {
if (measureTab === 'walls') return r.parts > 0 ? measureWallsPick : 'walls';
if (measureTab === 'ceiling') return r.ceilNiche > 0 || r.ceilBox > 0 ? measureCeilPick : 'ceiling';
if (measureTab === 'corners') return r.cornersOut > 0 && r.cornersIn > 0 ? measureCornersPick : (r.cornersOut > 0 ? 'cornersOut' : r.cornersIn > 0 ? 'cornersIn' : 'corners');
if (measureTab === 'molding') {
const have = ['molCornice', 'molPlinth', 'molCeil', 'molWall'].filter(k => r[k] > 0);
return have.includes(measureMolPick) ? measureMolPick : (have[0] || 'molCornice');
}
return measureTab;
}

function setMeasureTab(tab) {
if (cpFull) cpToggleFull(false);
if (typeof rlFull !== 'undefined' && rlFull) { rlFull = false; document.body.classList.remove('rl-full-open'); }
if (typeof rulerTarget !== 'undefined' && rulerTarget) { rulerTarget = null; document.getElementById('measurePanel').classList.remove('ruler-open'); }
measureTab = tab;
saveMeasureDraft();
renderMeasure();
document.getElementById('mpBody').scrollTop = 0;
}


/* ---------- ввод ---------- */
function setMeasurePath(path, value) {
const parts = path.split('.');
let obj = measure;
for (let i = 0; i < parts.length - 1; i++) {
const k = isNaN(parts[i]) ? parts[i] : Number(parts[i]);
if (obj[k] === undefined) obj[k] = isNaN(parts[i + 1]) ? {} : [];
obj = obj[k];
}
const last = parts[parts.length - 1];
obj[isNaN(last) ? last : Number(last)] = value;
}

document.addEventListener('input', (e) => {
const el = e.target;
if (!el.closest || !el.closest('#mpBody') || !el.dataset.path) return;
setMeasurePath(el.dataset.path, el.value);
saveMeasureDraft();
updateMeasureOutputs();
});
// При касании поле выделяется целиком — можно сразу печатать новое значение
document.addEventListener('focusin', (e) => {
const el = e.target;
if (!el.classList || !el.classList.contains('mp-in')) return;
const valueOnFocus = el.value;
try { el.select(); } catch (err) { /* пусто */ }
// На телефоне выделение иногда сбрасывается касанием — повторяем, но
// только если человек ещё ничего не начал печатать.
setTimeout(() => {
if (document.activeElement === el && el.value === valueOnFocus) { try { el.select(); } catch (err) { /* пусто */ } }
}, 0);
});
// «Ввод» на клавиатуре — к следующему полю
document.addEventListener('keydown', (e) => {
const el = e.target;
if (e.key !== 'Enter' || !el.classList || !el.classList.contains('mp-in')) return;
e.preventDefault();
const all = [...document.querySelectorAll('#mpBody .mp-in')];
const next = all[all.indexOf(el) + 1];
if (next) next.focus(); else el.blur();
});

function focusMeasurePath(path) {
const el = document.querySelector(`#mpBody [data-path="${path}"]`);
if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
}

function addMeasureRow(kind) {
if (kind === 'walls') {
measure.walls.push('');
if (!Array.isArray(measure.wallHeights)) measure.wallHeights = [];
measure.wallHeights[measure.walls.length - 1] = '';
}
if (kind === 'parts') {
if (!Array.isArray(measure.parts)) measure.parts = [];
const prev = measure.parts[measure.parts.length - 1];
// высота — как у предыдущего участка (обычно одинаковая)
measure.parts.push({ name: '', l: '', h: prev ? prev.h : '' });
}
if (kind === 'ceiling') measure.ceiling.push({ l: '', w: '' });
if (kind === 'narrow') measure.narrow.push('');
saveMeasureDraft();
renderMeasure();
const last = measure[kind].length - 1;
// курсор — в первое поле новой строки (у потолка это длина)
focusMeasurePath(kind === 'ceiling' ? `ceiling.${last}.l` : kind === 'parts' ? `parts.${last}.name` : `${kind}.${last}`);
}

function removeMeasureRow(kind, i) {
measure[kind].splice(i, 1);
if (kind === 'openings') remapCeilElOpsAfterRemove(measure, i);
if (kind === 'walls' && Array.isArray(measure.wallHeights)) measure.wallHeights.splice(i, 1);
if (kind !== 'openings' && kind !== 'parts' && kind !== 'ceilEls' && measure[kind].length === 0) measure[kind].push(kind === 'ceiling' ? { l: '', w: '' } : '');
saveMeasureDraft();
renderMeasure();
}

// Новый проём — с размерами предыдущего проёма того же типа
function addOpening(type) {
const prev = [...measure.openings].reverse().find(o => o.type === type);
measure.openings.push(prev ? { ...prev } : { type, w: '', h: '', n: '1', slopes: true });
saveMeasureDraft();
renderMeasure();
const i = measure.openings.length - 1;
const el = document.querySelector(`#mpBody .mp-in[data-path="openings.${i}.w"]`);
if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
}

function setOpeningWall(i, v) {
const o = measure.openings[i];
if (!o) return;
if (v === '') { delete o.wall; delete o.off; } else o.wall = Number(v);
saveMeasureDraft();
renderMeasure();
}

function toggleOpeningType(i) {
const o = measure.openings[i];
o.type = o.type === 'window' || !o.type ? 'door' : o.type === 'door' ? 'balcony' : 'window';
if (o.type === 'balcony') { if (o.dw === undefined) o.dw = ''; if (o.dh === undefined) o.dh = ''; }
saveMeasureDraft();
renderMeasure();
}

function setOpeningSlopes(i, on) {
measure.openings[i].slopes = on;
saveMeasureDraft();
updateMeasureOutputs();
}

/* ---------- ниши и короба: ввод и мини-чертёж ---------- */
let ceilElActive = -1;   // ниша/короб, который правится касанием чертежа
function ceilElsSectionHtml(m) {
const els = Array.isArray(m.ceilEls) ? m.ceilEls : [];
const walls = Array.isArray(m.walls) ? m.walls : [];
const hasWalls = walls.some(w => mNum(w) > 0);
if (!(ceilElActive >= 0 && ceilElActive < els.length)) ceilElActive = els.length - 1;
return `<section class="mp-sec">
<div class="mp-sec-title">Ниши и короба</div>
<div class="mp-hint">Закарнизная ниша или короб из ГКЛ вдоль стен: отметьте стены, укажите ширину от стены и высоту. Попадут на чертёж и в обмерный план.</div>
${hasWalls && els.length ? `<div class="mp-ce-plan rl-sketch${cpFull ? ' full' : ''}" id="mpCeilPlan"></div>
<div class="mp-hint mp-ce-plan-hint">Касание стены на чертеже добавляет её к выделенному элементу или убирает; касание полосы — выделяет элемент.</div>` : ''}
${els.map((el, i) => {
const isBox = el.type === 'box';
const sel = new Set(Array.isArray(el.walls) ? el.walls : []);
const all = hasWalls && walls.every((w, wi) => !(mNum(w) > 0) || sel.has(wi));
const op = ceilElOp(m, el);
const one = !op && sel.size === 1 ? [...sel][0] : -1;
// проёмы, над которыми можно поставить нишу: окна и балконные блоки на стенах
const ops = (m.openings || []).map((o, oi) => ({ o, oi })).filter(({ o }) => o.type !== 'door' && typeof o.wall === 'number' && openingWidth(o) > 0);
return `<div class="mp-open mp-ce-card${i === ceilElActive ? ' active' : ''}" data-ce="${i}">
<div class="mp-open-top">
<button type="button" class="mp-type" onclick="toggleCeilElType(${i})" aria-label="Сменить: ниша или короб">${escapeHtml(ceilElCode(els, i))} ${isBox ? 'Короб' : 'Ниша'} ▾</button>
<span class="mp-open-area" id="mpCeilElRes${i}"></span>
<button type="button" class="mp-del" onclick="removeMeasureRow('ceilEls', ${i})" aria-label="Убрать">✕</button>
</div>
${!isBox && ops.length ? `<div class="mp-place mp-ce-over"><label>Над проёмом
<select onchange="setCeilElOver(${i}, this.value)">
<option value="">нет — по стенам</option>
${ops.map(({ o, oi }) => `<option value="${oi}" ${el.overOp === oi ? 'selected' : ''}>${opCode(o, oi)} ${o.type === 'balcony' ? 'балк. блок' : 'окно'} ${mFmt(openingWidth(o))} · стена ${o.wall + 1}</option>`).join('')}
</select></label></div>` : ''}
${hasWalls && !op ? `<div class="mp-ce-walls"><span class="mp-ce-walls-label">Стены:</span>
${walls.map((w, wi) => mNum(w) > 0 ? `<button type="button" class="mp-ce-wall${sel.has(wi) ? ' on' : ''}" onclick="toggleCeilElWall(${i}, ${wi})" aria-pressed="${sel.has(wi)}">${wi + 1}</button>` : '').join('')}
<button type="button" class="mp-ce-wall mp-ce-all${all ? ' on' : ''}" onclick="setCeilElAllWalls(${i})">все</button>
</div>` : ''}
<div class="mp-dims mp-dims-2" style="margin-top:6px;">
<label>Ширина от стены ↔${mIn(`ceilEls.${i}.w`, el.w, isBox ? '0,3' : '0,2')}</label><span class="mp-x">×</span>
<label>${isBox ? 'Высота короба ↕' : 'Глубина ниши ↕'}${mIn(`ceilEls.${i}.h`, el.h, isBox ? '0,15' : '0,1')}</label>
</div>
${one >= 0 ? `<div class="mp-dims mp-dims-2" style="margin-top:6px;">
<label>От угла <button type="button" class="mp-ce-corner" onclick="toggleCeilElFrom(${i})" aria-label="Сменить угол">${el.from === 'end' ? 'Б' : 'А'} ⇄</button>${mIn(`ceilEls.${i}.off`, el.off, '0')}</label><span class="mp-x"></span>
<label>Длина по стене ↔${mIn(`ceilEls.${i}.span`, el.span, 'до угла')}</label>
</div>
<div class="mp-hint" style="margin:4px 0 0;">Не на всю стену — укажите отступ от угла и длину. Углы А и Б отмечены на чертеже. Пусто — от угла до угла.</div>` : ''}
${op ? `<div class="mp-dims mp-dims-2" style="margin-top:6px;">
<label>Вынос за проём ↔${mIn(`ceilEls.${i}.ext`, el.ext, '0,2')}</label><span></span>
<span class="mp-hint" style="margin:0;align-self:center;">с каждой стороны</span>
</div>
<div class="mp-hint" style="margin:4px 0 0;" id="mpCeilElOver${i}"></div>` : ''}
${!op && !sel.size ? `<div class="mp-dims mp-dims-2" style="margin-top:6px;">
<label>Длина, м${mIn(`ceilEls.${i}.len`, el.len, '3,2+4,1')}</label><span></span><span class="mp-hint" style="margin:0;align-self:center;">${hasWalls ? 'или отметьте стены' : 'без чертежа — длиной'}</span>
</div>` : ''}
<div class="mp-ce-walls mp-ce-faces"><span class="mp-ce-walls-label">Обрабатываем:</span>
${CEIL_FACES[isBox ? 'box' : 'niche'].filter(f => f.key !== 'ends' || ceilElPartial(el)).map(f => `<button type="button" class="mp-ce-wall${ceilFaceOn(el, f) ? ' on' : ''}" onclick="toggleCeilElFace(${i}, '${f.key}')" aria-pressed="${ceilFaceOn(el, f)}">${f.label}</button>`).join('')}
</div>
<div class="mp-hint" style="margin:4px 0 0;" id="mpCeilElFin${i}"></div>
<label class="mp-check mp-ce-light"><input type="checkbox" ${el.light ? 'checked' : ''} onchange="setCeilElLight(${i}, this.checked)"><span>С подсветкой${isBox ? ' (по внутренней кромке)' : ''}</span></label>
</div>`;
}).join('')}
<div class="mp-add-row">
<button type="button" class="mp-add" onclick="addCeilEl('niche')">+ Закарнизная ниша</button>
<button type="button" class="mp-add" onclick="addCeilEl('box')">+ Короб</button>
</div>
${(m.openings || []).some(o => o.type !== 'door' && typeof o.wall === 'number' && openingWidth(o) > 0) ? `<div class="mp-add-row"><button type="button" class="mp-add" onclick="addNichesOverWindows()">+ Ниши над окнами</button></div>` : ''}
<div class="mp-calc" id="mpCalcCeilEls"></div>
</section>`;
}

function addCeilEl(type) {
if (!Array.isArray(measure.ceilEls)) measure.ceilEls = [];
const prev = [...measure.ceilEls].reverse().find(e => e.type === type);
let walls = [];
let g = null;
try { g = rulerGeometry(measure); } catch (e) { g = null; }
if (g && g.segs.some(q => q.len > 0)) {
if (type === 'box') {
// короб — обычно по всему периметру
walls = g.segs.filter(q => q.len > 0).map(q => q.i);
} else {
// ниша — у стены с окном (если окна расставлены), иначе у самой длинной
const win = (measure.openings || []).find(o => o.type !== 'door' && typeof o.wall === 'number' && g.segs[o.wall] && g.segs[o.wall].len > 0);
const longest = g.segs.filter(q => q.len > 0).sort((a, b) => b.len - a.len)[0];
walls = [win ? win.wall : longest.i];
}
}
measure.ceilEls.push({ type, walls, w: prev ? prev.w : '', h: prev ? prev.h : '', len: '' });
ceilElActive = measure.ceilEls.length - 1;
saveMeasureDraft();
renderMeasure();
const i = measure.ceilEls.length - 1;
focusMeasurePath(`ceilEls.${i}.w`);
}

function toggleCeilElType(i) {
const el = measure.ceilEls[i];
if (!el) return;
el.type = el.type === 'box' ? 'niche' : 'box';
saveMeasureDraft();
renderMeasure();
}

function toggleCeilElWall(i, wi) {
const el = measure.ceilEls[i];
if (!el) return;
ceilElActive = i;
if (Number.isInteger(el.overOp)) { const op = ceilElOp(measure, el); delete el.overOp; el.walls = op ? [op.wall] : (el.walls || []); }
const set = new Set(Array.isArray(el.walls) ? el.walls : []);
if (set.has(wi)) set.delete(wi); else set.add(wi);
el.walls = [...set].sort((a, b) => a - b);
saveMeasureDraft();
renderMeasure();
}

function setCeilElAllWalls(i) {
const el = measure.ceilEls[i];
if (!el) return;
const idx = measure.walls.map((w, wi) => mNum(w) > 0 ? wi : -1).filter(wi => wi >= 0);
const all = idx.every(wi => (el.walls || []).includes(wi));
el.walls = all ? [] : idx;
saveMeasureDraft();
renderMeasure();
}

// Номера стен в нишах и коробах после перестройки стен: map[старый] = новый (или -1)
function remapCeilElWalls(m, map) {
if (typeof remapMoldingWalls === 'function') remapMoldingWalls(m, map);
(Array.isArray(m.ceilEls) ? m.ceilEls : []).forEach(el => {
if (!Array.isArray(el.walls)) return;
el.walls = [...new Set(el.walls.map(i => map[i]).filter(i => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b);
});
}

function toggleCeilElFrom(i) {
const el = measure.ceilEls[i];
if (!el) return;
el.from = el.from === 'end' ? 'start' : 'end';
ceilElActive = i;
saveMeasureDraft();
renderMeasure();
}

// Ниша над проёмом: стена и длина — от проёма, вводится только вынос
function setCeilElOver(i, v) {
const el = measure.ceilEls[i];
if (!el) return;
if (v === '') {
// отвязали — остаётся на той же стене, на всю стену
const op = ceilElOp(measure, el);
delete el.overOp;
if (op) el.walls = [op.wall];
} else {
el.overOp = Number(v);
const op = ceilElOp(measure, el);
if (op) el.walls = [op.wall];
}
ceilElActive = i;
saveMeasureDraft();
renderMeasure();
if (v !== '') focusMeasurePath(`ceilEls.${i}.ext`);
}

// По нише над каждым окном и балконным блоком, у которых её ещё нет
function addNichesOverWindows() {
if (!Array.isArray(measure.ceilEls)) measure.ceilEls = [];
const prev = [...measure.ceilEls].reverse().find(e => e.type !== 'box');
const taken = new Set(measure.ceilEls.filter(e => Number.isInteger(e.overOp)).map(e => e.overOp));
let added = 0;
(measure.openings || []).forEach((o, oi) => {
if (o.type === 'door' || typeof o.wall !== 'number' || !(openingWidth(o) > 0) || taken.has(oi)) return;
measure.ceilEls.push({ type: 'niche', walls: [o.wall], overOp: oi, w: prev ? prev.w : '', h: prev ? prev.h : '', ext: prev && prev.ext != null ? prev.ext : '', light: prev ? !!prev.light : false });
added++;
});
if (!added) { showAddToast('Над всеми окнами ниши уже есть'); return; }
ceilElActive = measure.ceilEls.length - added;
saveMeasureDraft();
renderMeasure();
showAddToast(added === 1 ? 'Ниша над окном добавлена — укажите вынос' : `Добавлено ниш над окнами: ${added} — укажите вынос`);
focusMeasurePath(`ceilEls.${ceilElActive}.${prev && prev.w ? 'ext' : 'w'}`);
}

function toggleCeilElFace(i, key) {
const el = measure.ceilEls[i];
if (!el) return;
const f = CEIL_FACES[el.type === 'box' ? 'box' : 'niche'].find(x => x.key === key);
if (!f) return;
el.sides = { ...(el.sides || {}), [key]: !ceilFaceOn(el, f) };
ceilElActive = i;
saveMeasureDraft();
renderMeasure();
}

function setCeilElLight(i, on) {
const el = measure.ceilEls[i];
if (!el) return;
el.light = !!on;
saveMeasureDraft();
updateMeasureOutputs();
}

// Проём убрали: ниши над ним остаются на стене, номера других проёмов сдвигаются
function remapCeilElOpsAfterRemove(m, removed) {
(Array.isArray(m.ceilEls) ? m.ceilEls : []).forEach(el => {
if (!Number.isInteger(el.overOp)) return;
if (el.overOp === removed) delete el.overOp;
else if (el.overOp > removed) el.overOp -= 1;
});
}

// Выделить элемент без перерисовки полей (чтобы не сбивать ввод)
function setCeilElActive(i) {
if (i === ceilElActive || !measure || !(measure.ceilEls || [])[i]) return;
ceilElActive = i;
document.querySelectorAll('#mpBody .mp-ce-card').forEach(c => c.classList.toggle('active', Number(c.dataset.ce) === i));
updateMeasureOutputs();
}
document.addEventListener('focusin', (e) => {
const card = e.target && e.target.closest ? e.target.closest('#mpBody .mp-ce-card') : null;
if (card) setCeilElActive(Number(card.dataset.ce));
});

// Касание стены на чертеже — добавить её к выделенному элементу или убрать
function ceilPlanWallTap(wi) {
if (cpDragged) { cpDragged = false; return; }
const els = measure.ceilEls || [];
if (!els[ceilElActive]) return;
toggleCeilElWall(ceilElActive, wi);
}
// Касание полосы: чужая — выделить элемент, своя — убрать эту стену из элемента
function ceilPlanStripTap(idx, wi) {
if (cpDragged) { cpDragged = false; return; }
if (idx !== ceilElActive) {
ceilElActive = idx;
renderMeasure();
const card = document.querySelector(`#mpBody .mp-ce-card[data-ce="${idx}"]`);
if (card) card.scrollIntoView({ block: 'nearest' });
return;
}
toggleCeilElWall(idx, wi);
}

/* ---------- чертёж потолка: приближение, перемещение, поворот, весь экран ---------- */
let cpZoom = 1, cpPan = { x: 0, y: 0 }, cpRot = 0, cpFull = false, cpDragged = false, cpLastHtml = '';
const CP_W = 340;
function cpSize(box) {
// во весь экран — по пропорциям экрана, иначе обычная рамка
if (cpFull && box && box.clientWidth > 0 && box.clientHeight > 0) return { W: CP_W, H: Math.round(CP_W * box.clientHeight / box.clientWidth) };
return { W: CP_W, H: 270 };
}
function renderCeilPlan() {
const box = document.getElementById('mpCeilPlan');
if (!box || !measure) { if (cpFull) { cpFull = false; document.body.classList.remove('cp-full-open'); } return; }
const r = computeMeasure(measure);
const { W, H } = cpSize(box);
const svg = ceilPlanSvg(measure, r, W, H);
const moved = Math.abs(cpZoom - 1) > 0.01 || Math.abs(cpPan.x) > 1 || Math.abs(cpPan.y) > 1;
const els = measure.ceilEls || [];
const act = (r.ceilEls || []).find(e => e.idx === ceilElActive);
const cap = cpFull ? `<div class="cp-caption">${act ? `Выделено: <b>${escapeHtml(act.code)}</b> ${act.type === 'box' ? 'короб' : 'ниша'} · касание стены добавляет или убирает её` : (els.length ? 'Коснитесь полосы, чтобы выделить нишу или короб' : '')}</div>` : '';
box.innerHTML = `${svg}<div class="rl-zoom cp-zoom">
<button type="button" onclick="cpZoomBy(1.6)" aria-label="Приблизить">+</button>
<button type="button" onclick="cpZoomBy(1 / 1.6)" aria-label="Отдалить">−</button>
<button type="button" onclick="cpRotate()" aria-label="Повернуть на 90°">⟳</button>
${moved ? '<button type="button" onclick="cpReset()" aria-label="Весь чертёж">⤢</button>' : ''}
<button type="button" onclick="cpToggleFull()" aria-label="${cpFull ? 'Закрыть' : 'Во весь экран'}">${cpFull ? '✕' : '⛶'}</button>
</div>${cap}`;
cpBindPanZoom(box);
}
function cpZoomBy(f) { cpZoom = Math.min(6, Math.max(0.5, cpZoom * f)); renderCeilPlan(); }
function cpReset() { cpZoom = 1; cpPan = { x: 0, y: 0 }; renderCeilPlan(); }
function cpRotate() { cpRot = (cpRot + 90) % 360; cpPan = { x: 0, y: 0 }; renderCeilPlan(); }
function cpToggleFull(on) {
cpFull = typeof on === 'boolean' ? on : !cpFull;
const box = document.getElementById('mpCeilPlan');
if (box) box.classList.toggle('full', cpFull);
document.body.classList.toggle('cp-full-open', cpFull);
renderCeilPlan();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cpFull) cpToggleFull(false); });
window.addEventListener('resize', () => { if (cpFull) renderCeilPlan(); });

// Палец — двигаем, два пальца — масштаб, колесо мыши — масштаб.
// Касания стен и полос после перетаскивания не срабатывают.
function cpBindPanZoom(box) {
if (box.dataset.pz) return;
box.dataset.pz = '1';
const pts = new Map();
let start = null;
const unit = () => (CP_W / cpZoom) / (box.clientWidth || CP_W);
box.addEventListener('pointerdown', (e) => {
if (e.target.closest('.cp-zoom')) return;
if (e.isPrimary) pts.clear();
pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
start = { pan: { ...cpPan }, zoom: cpZoom, pts: new Map(pts), moved: false };
cpDragged = false;
});
box.addEventListener('pointermove', (e) => {
if (!pts.has(e.pointerId) || !start) return;
pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
if (pts.size === 1 && start.pts.size === 1) {
const p0 = start.pts.get(e.pointerId); if (!p0) return;
const dx = e.clientX - p0.x, dy = e.clientY - p0.y;
if (!start.moved && Math.hypot(dx, dy) < 6) return;
if (!start.moved) { try { box.setPointerCapture(e.pointerId); } catch (err) { /* пусто */ } }
start.moved = true; cpDragged = true;
cpPan = { x: start.pan.x - dx * unit(), y: start.pan.y - dy * unit() };
renderCeilPlan();
} else if (pts.size === 2) {
if (start.pts.size !== 2) { start = { pan: { ...cpPan }, zoom: cpZoom, pts: new Map(pts), moved: true }; return; }
const a = [...pts.values()], b = [...start.pts.values()];
const d1 = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), d0 = Math.hypot(b[0].x - b[1].x, b[0].y - b[1].y) || 1;
cpZoom = Math.min(6, Math.max(0.5, start.zoom * d1 / d0));
start.moved = true; cpDragged = true;
renderCeilPlan();
}
});
const end = (e) => {
pts.delete(e.pointerId);
if (!pts.size) start = null;
else start = { pan: { ...cpPan }, zoom: cpZoom, pts: new Map(pts), moved: true };
};
box.addEventListener('pointerup', end);
box.addEventListener('pointercancel', end);
box.addEventListener('wheel', (e) => {
e.preventDefault();
cpZoom = Math.min(6, Math.max(0.5, cpZoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
renderCeilPlan();
}, { passive: false });
}

// Чертёж на вкладке «Потолок»: стены с длинами, ниши и короба с размерами,
// у выделенного элемента — углы А/Б и отступ от угла.
// Поворот — на 90°, подписи остаются читаемыми; масштаб не меняет размер подписей.
function ceilPlanSvg(m, r, W = CP_W, H = 270) {
let g;
try { g = rulerGeometry(m); } catch (e) { return ''; }
if (!g || !g.segs.length) return '';
const P0 = 44;
const R = cpRot;
const rot = ([x, y]) => R === 90 ? [-y, x] : R === 180 ? [-x, -y] : R === 270 ? [y, -x] : [x, y];
const raw = [[0, 0], ...g.segs.map(q => [q.x2, q.y2])].map(rot);
const xs = raw.map(p => p[0]), ys = raw.map(p => p[1]);
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
const k = Math.min((W - 2 * P0) / Math.max(maxX - minX, 0.5), (H - 2 * P0) / Math.max(maxY - minY, 0.5));
const ox = (W - (maxX - minX) * k) / 2 - minX * k, oy = (H - (maxY - minY) * k) / 2 - minY * k;
const z = cpZoom, vx = (W - W / z) / 2 + cpPan.x, vy = (H - H / z) / 2 + cpPan.y;
// точка комнаты (м) → экран; направление стены → экран
const P = (x, y) => { const [rx, ry] = rot([x, y]); return [(ox + rx * k - vx) * z, (oy + ry * k - vy) * z]; };
const D = q => rot([q.dx, q.dy]);
const kz = k * z;                                  // пикселей на метр
const o = g.orient || 1;
const path = list => 'M' + list.map(([x, y]) => P(x, y).join(' ')).join('L');
const angOf = d => { let a = Math.atan2(d[1], d[0]) * 180 / Math.PI; if (a > 90) a -= 180; if (a <= -90) a += 180; return a; };
const els = Array.isArray(m.ceilEls) ? m.ceilEls : [];
const act = els[ceilElActive] ? ceilElActive : -1;
let out = '', top = '', hits = '';
if (g.closed) out += `<path d="${path([[0, 0], ...g.segs.map(q => [q.x2, q.y2])])}Z" fill="#f6f7f9"/>`;
g.segs.forEach(q => {
if (q.len > 0) hits += `<path d="${path([[q.x1, q.y1], [q.x2, q.y2]])}" stroke="transparent" stroke-width="24" style="cursor:pointer" onclick="ceilPlanWallTap(${q.i})"><title>Стена ${q.i + 1}</title></path>`;
});
const list = (r.ceilEls || []).slice().sort((a, b) => (a.idx === act) - (b.idx === act)); // выделенный — сверху
list.forEach(e => {
const box = e.type === 'box', on = e.idx === act;
const fill = box ? (on ? '#ffd166' : '#ffe7a3') : (on ? '#9cc3f5' : '#cfe3ff');
const ink = box ? '#7a5a00' : '#1f4f8f';
e.strips.forEach(p => {
out += `<path d="${path(p.poly)}Z" fill="${fill}" ${on ? `stroke="${ink}" stroke-width="1"` : 'stroke="none"'}/>`;
out += `<path d="${path(ceilStripEdgePts(p))}" fill="none" stroke="${ink}" stroke-width="1.4" stroke-dasharray="5 3"/>`;
if (e.light) out += `<path d="${path(ceilLightPts(p))}" fill="none" stroke="#ff8c00" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="0.1 5"/>`;
hits += `<path d="${path(p.poly)}Z" fill="transparent" stroke="transparent" stroke-width="8" style="cursor:pointer" onclick="ceilPlanStripTap(${e.idx}, ${p.i})"><title>${escapeHtml(e.code)}</title></path>`;
});
// подпись: код, ширина, длина — у самой длинной полосы, внутри комнаты
const p = e.strips.slice().sort((a, b) => b.innerLen - a.innerLen)[0];
if (!p) return;
const d = D(p.q), nx = -d[1] * o, ny = d[0] * o;
const [mx, my] = P((p.inner[0][0] + p.inner[1][0]) / 2, (p.inner[0][1] + p.inner[1][1]) / 2);
const tx = mx + nx * 11, ty = my + ny * 11, ang = angOf(d);
const txt = `${e.code} · ${mFmt(e.w)}${p.span ? ` · L ${mFmt(e.len)}` : ''}${e.light ? ' · свет' : ''}`;
top += `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="${ink}" transform="rotate(${ang} ${tx} ${ty})" paint-order="stroke" stroke="#ffffff" stroke-width="3">${escapeHtml(txt)}</text>`;
});
// стены, их номера и длины — снаружи
g.segs.forEach(q => {
out += `<path d="${path([[q.x1, q.y1], [q.x2, q.y2]])}" stroke="#14181f" stroke-width="3.5" stroke-linecap="square" ${q.empty ? 'stroke-dasharray="5 5" opacity=".35"' : ''}/>`;
if (!(q.len > 0)) return;
const d = D(q), [ax, ay] = P(q.x1, q.y1), [bx, by] = P(q.x2, q.y2);
const mx = (ax + bx) / 2 + d[1] * o * 16, my = (ay + by) / 2 - d[0] * o * 16;
const t = `${q.i + 1}: ${mFmt(q.len)}`, wpx = t.length * 6.2 + 8;
const used = act >= 0 && (els[act].walls || []).includes(q.i);
top += `<rect x="${mx - wpx / 2}" y="${my - 8}" width="${wpx}" height="16" rx="3" fill="${used ? '#14181f' : '#ffffff'}" stroke="#14181f" stroke-width="1"/>`;
top += `<text x="${mx}" y="${my + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${used ? '#ffffff' : '#14181f'}">${escapeHtml(t)}</text>`;
});
// у выделенного элемента на одной стене — углы А/Б и отступ от угла
const ae = (r.ceilEls || []).find(e => e.idx === act);
const one = act >= 0 && !ceilElOp(m, els[act]) && Array.isArray(els[act].walls) && els[act].walls.length === 1 ? g.segs[els[act].walls[0]] : null;
if (one && one.len > 0) {
const q = one, d = D(q), nx = -d[1] * o, ny = d[0] * o;
const fromEnd = els[act].from === 'end';
[[q.x1, q.y1, 'А', !fromEnd], [q.x2, q.y2, 'Б', fromEnd]].forEach(([px, py, letter, on]) => {
const [sx, sy] = P(px, py), cx = sx + nx * 14, cy = sy + ny * 14;
top += `<circle cx="${cx}" cy="${cy}" r="9" fill="${on ? '#ffc83d' : '#ffffff'}" stroke="#14181f" stroke-width="1.3"/>`;
top += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#14181f">${letter}</text>`;
});
const p = ae && ae.strips[0];
if (p && p.span) {
const off = fromEnd ? q.len - p.span[1] : p.span[0];
if (off > 0.0005) {
const c0 = fromEnd ? q.len : 0, c1 = fromEnd ? p.span[1] : p.span[0];
const wn = mNum(els[act].w) + 16 / kz;      // за кромкой полосы
const wnx = -q.dy * o, wny = q.dx * o;
const [sx, sy] = P(q.x1 + q.dx * c0 + wnx * wn, q.y1 + q.dy * c0 + wny * wn);
const [ex, ey] = P(q.x1 + q.dx * c1 + wnx * wn, q.y1 + q.dy * c1 + wny * wn);
top += `<path d="M${sx} ${sy}L${ex} ${ey}" stroke="#e8a900" stroke-width="2.5"/>`;
top += `<text x="${(sx + ex) / 2 + nx * 11}" y="${(sy + ey) / 2 + ny * 11 + 4}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#14181f" paint-order="stroke" stroke="#ffffff" stroke-width="3">${mFmt(off)}</text>`;
}
}
}
return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Потолок: ниши и короба" font-family="inherit">${out}${top}${hits}</svg>`;
}

/* ---------- режим стен и вкладка «Углы» ---------- */
function setWallMode(mode) {
measure.wallMode = mode === 'gross' ? 'gross' : 'net';
saveMeasureDraft();
renderMeasure();
}

function toggleCorner(key) {
const it = (computeMeasure(measure).cornerItems || []).find(x => x.key === key);
if (!it) return;
if (!measure.corners || typeof measure.corners !== 'object') measure.corners = {};
measure.corners[key] = !it.on;
saveMeasureDraft();
renderMeasure();
}

function cornersTabHtml(m) {
const r = computeMeasure(m);
const items = r.cornerItems || [];
const sumOf = it => it.pieces.reduce((a, v) => a + minLen(v), 0);
const chip = it => `<button type="button" class="mp-ce-wall${it.on ? ' on' : ''}" onclick="toggleCorner('${it.key}')" aria-pressed="${it.on}" ${it.noLen ? 'title="нет высоты стен"' : ''}>${escapeHtml(it.label)}<small>${it.pieces.length ? mFmt(sumOf(it)) : '—'}</small></button>`;
const row = (label, list) => list.length ? `<div class="mp-ce-walls mp-cn-row"><span class="mp-ce-walls-label">${label}</span>${list.map(chip).join('')}</div>` : '';
const of = (group, kind) => items.filter(it => it.group === group && it.kind === kind);
const sec = (title, hint, body, empty) => `<section class="mp-sec"><div class="mp-sec-title">${title}</div>${hint ? `<div class="mp-hint">${hint}</div>` : ''}${body || `<div class="mp-hint">${empty}</div>`}</section>`;
return `<div class="mp-hint" style="margin-bottom:8px;">Отметьте углы, которые обрабатываются, — длины берутся с других вкладок. Наружные и внутренние считаются отдельно; кусок короче метра — за 1 пог. м.</div>
${sec('Углы стен', 'По высоте стен; номера — стены, между которыми угол.',
row('Внутренние:', of('walls', 'in')) + row('Наружные:', of('walls', 'out')),
'Нужен чертёж комнаты на вкладке «Стены».')}
${sec('Углы откосов', 'По контуру проёма: сбоку и сверху (у балконного блока — по всему контуру).',
row('Наружные (откос — стена):', of('slopes', 'out')) + row('Примыкание к раме:', of('slopes', 'in')),
'Окон и дверей пока нет — добавьте их на вкладке «Стены».')}
${sec('Стыки', 'По периметру комнаты; стык с полом — без дверных проёмов.',
row('Внутренние:', of('joints', 'in')),
'Нужны длины стен на вкладке «Стены».')}
${of('els', 'out').length ? sec('Ниши и короба', 'Наружное ребро — по кромке; внутренние углы — где ниша или короб примыкают к потолку и стене.',
row('Наружные рёбра:', of('els', 'out')) + row('Внутренние углы:', of('els', 'in')), '') : ''}
<div class="mp-calc" id="mpCalcCorners"></div>`;
}

/* ---------- история замеров ---------- */
function localMeasuresKey() { return 'measureHistory:' + (currentUser || ''); }
function getLocalMeasures() {
try { const a = JSON.parse(localStorage.getItem(localMeasuresKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function setLocalMeasures(list) {
try { localStorage.setItem(localMeasuresKey(), JSON.stringify(list.slice(0, 50))); } catch (e) { /* пусто */ }
}

function allSavedMeasures() {
const list = getLocalMeasures().map(m => ({ ...m, _where: 'local' }));
(typeof getVisibleObjects === 'function' ? getVisibleObjects() : []).forEach(o => {
(o.measurements || []).forEach(m => list.push({ ...m, _where: 'object', _objectName: o.name }));
});
return list.sort((a, b) => String(b.savedAt || '').localeCompare(String(a.savedAt || '')));
}

function measureSummaryLines(m) {
const r = computeMeasure(m);
return [r.lines.walls, r.lines.narrowWalls, r.lines.openings, r.lines.net, r.lines.parts, r.lines.wallsMinusParts, r.lines.ceiling, r.lines.ceilEls, r.lines.ceilingNet, r.lines.slopesLen, r.lines.narrow, r.lines.openStrips, r.lines.cornersOut, r.lines.cornersIn, r.lines.mol_cornice, r.lines.mol_plinth, r.lines.mol_ceil, r.lines.mol_wall].filter(Boolean);
}

function measurePills(m) {
const r = computeMeasure(m);
const p = [];
if (r.wallsGross > 0) p.push(`Стены ${mFmt(r.wallsCalc)} м²`);
if (r.parts > 0) p.push(`Участки ${mFmt(r.parts)} м²`);
if (r.ceiling > 0) p.push(`Потолок ${mFmt(r.ceiling)} м²`);
if (r.ceilNiche > 0) p.push(`Ниши ${mFmt(r.ceilNiche)} пог. м`);
if (r.ceilBox > 0) p.push(`Короба ${mFmt(r.ceilBox)} пог. м`);
if (r.ceilFin > 0) p.push(`Обработка ниш/коробов ${mFmt(r.ceilFin)} пог. м`);
if (r.ceilLight > 0) p.push(`Подсветка ${mFmt(r.ceilLight)} пог. м`);
if (r.slopesLen > 0) p.push(`Откосы ${mFmt(r.slopesLen)} пог. м`);
if (r.narrow > 0) p.push(`Узкие ${mFmt(r.narrow)} пог. м`);
if (r.corners > 0) p.push(`Углы ${mFmt(r.corners)} пог. м`);
if (r.molCornice > 0) p.push(`Карниз ${mFmt(r.molCornice)} пог. м`);
if (r.molPlinth > 0) p.push(`Плинтус ${mFmt(r.molPlinth)} пог. м`);
if (r.molCeil + r.molWall > 0) p.push(`Молдинги ${mFmt(r.molCeil + r.molWall)} пог. м`);
return p;
}

function formatMeasureDate(iso) {
const d = iso ? new Date(iso) : null;
return d && !isNaN(d) ? d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}

function renderMeasureHistoryHtml(filterObjectId) {
let list = allSavedMeasures();
if (filterObjectId) list = list.filter(m => m.objectId === filterObjectId && m._where === 'object');
if (!list.length) return `<div class="mp-empty">Сохранённых замеров пока нет.<br>Они появятся здесь после «Сохранить» или «Вставить».</div>`;
return list.map(m => `<details class="mp-hist">
<summary>
<div class="mp-hist-title">${escapeHtml(m.room || 'Без названия')}</div>
<div class="mp-hist-meta">${escapeHtml(formatMeasureDate(m.savedAt))}${m._objectName ? ' · ' + escapeHtml(m._objectName) : ' · на этом телефоне'}${m.author ? ' · ' + escapeHtml(m.author) : ''}</div>
<div class="mp-hist-pills">${measurePills(m).map(p => `<span class="mp-pill">${escapeHtml(p)}</span>`).join('')}</div>
</summary>
<div class="mp-hist-body">${measureSummaryLines(m).map(escapeHtml).join('\n')}
${!isCurrentClient() ? `<div class="mp-hist-actions">
<button type="button" onclick="openSavedMeasure('${escapeHtml(m.id)}')">Открыть</button>
<button type="button" class="danger" onclick="deleteSavedMeasure('${escapeHtml(m.id)}')">Удалить</button>
</div>` : ''}</div>
</details>`).join('');
}

function findSavedMeasure(id) {
return allSavedMeasures().find(m => m.id === id) || null;
}

function openSavedMeasure(id) {
const m = findSavedMeasure(id);
if (!m) return;
if (measureDirty && !isMeasureEmpty(measure) && measure.id !== id &&
!confirm('Открыть сохранённый замер? Текущий несохранённый замер пропадёт.')) return;
const copy = JSON.parse(JSON.stringify(m));
delete copy._where; delete copy._objectName;
measure = copy;
measureDirty = false;
measureTab = 'walls';
if (!document.getElementById('measurePanel').classList.contains('open')) openMeasure({ kind: 'none' });
document.getElementById('mpRoom').value = measure.room || '';
fillMeasureObjectSelect();
renderMeasure();
}

// Убирает замер отовсюду (из объектов и с телефона). Возвращает true, если менялись объекты.
function removeMeasureEverywhere(id) {
setLocalMeasures(getLocalMeasures().filter(m => m.id !== id));
let changed = false;
(cloudData.objects || []).forEach(o => {
if (Array.isArray(o.measurements) && o.measurements.some(m => m.id === id)) {
o.measurements = o.measurements.filter(m => m.id !== id);
changed = true;
}
});
return changed;
}

async function deleteSavedMeasure(id) {
if (!confirm('Удалить этот замер из истории?')) return;
const objectsChanged = removeMeasureEverywhere(id);
if (objectsChanged) await saveCloudData();
if (document.getElementById('measurePanel').classList.contains('open')) renderMeasure();
if (typeof currentObjectId !== 'undefined' && currentObjectId) renderObjectDetail();
}

async function saveMeasurement(opts = {}) {
if (isMeasureEmpty(measure)) {
if (!opts.silent) alert('Замер пустой — введите размеры.');
return false;
}
measure.room = document.getElementById('mpRoom').value.trim();
const entry = JSON.parse(JSON.stringify(measure));
entry.savedAt = new Date().toISOString();
entry.author = currentUser || '';
const objectsChangedByRemove = removeMeasureEverywhere(entry.id);
const obj = entry.objectId ? (cloudData.objects || []).find(o => o.id === entry.objectId) : null;
let ok = true;
if (obj) {
obj.measurements = [entry, ...(obj.measurements || [])].slice(0, 100);
ok = (await saveCloudData()) !== false;
} else {
entry.objectId = '';
setLocalMeasures([entry, ...getLocalMeasures()]);
if (objectsChangedByRemove) ok = (await saveCloudData()) !== false;
}
if (ok) {
measureDirty = false;
try { localStorage.setItem(measureDraftKey(), JSON.stringify({ measure, measureTab, measureDirty })); } catch (e) { /* пусто */ }
if (!opts.silent) showAddToast(obj ? `Замер сохранён в «${obj.name}»` : 'Замер сохранён на телефоне');
if (typeof currentObjectId !== 'undefined' && currentObjectId) renderObjectDetail();
}
return ok;
}

function saveMeasurementClick() { saveMeasurement(); }

/* ---------- вставить / скопировать ---------- */
function unitForKind(unit) {
if (unit === 'м²') return 'м²';
if (unit === 'пог. м') return 'пог. м';
return '';
}

async function measurePrimaryAction() {
if (measureTarget.kind === 'room') { finishRoomMeasure(); return; }
const r = computeMeasure(measure);
// на вкладке «Стены» — то, что выбрано внизу: стены, участки или стены − участки
const effTab = measureEffTab(r);
const v = measureValueForTab(r, effTab);
if (!(v.value > 0)) return;
const value = Math.round(v.value * 1000) / 1000;
measure.room = document.getElementById('mpRoom').value.trim();
const note = { room: measure.room, text: v.text, value, unit: v.unit, measureId: measure.id };
const t = measureTarget;
if (t.kind === 'none') {
const text = (measure.room ? measure.room + '\n' : '') + v.text;
try { await navigator.clipboard.writeText(String(value).replace('.', ',')); showAddToast(`Скопировано: ${mFmt(value)}`); }
catch (e) { prompt('Результат и расчёт:', text); }
return;
}
if (t.kind === 'cart') {
const item = invoiceCart[t.idx];
if (item) {
item.qty = value;
if (v.unit) item.unit = v.unit;
if (!item.location && measure.room) item.location = measure.room;
item.measure = note;
renderInvoice();
}
} else {
const qty = document.getElementById(t.kind === 'service' ? `input_qty_${t.idx}` : 'customItemQty');
const unitSel = document.getElementById(t.kind === 'service' ? `select_unit_${t.idx}` : 'customItemUnit');
const loc = t.kind === 'service' ? document.getElementById(`input_loc_${t.idx}`) : null;
if (qty) { qty.value = value; qty.dataset.measure = JSON.stringify(note); }
if (unitSel && unitForKind(v.unit) && [...unitSel.options].some(o => o.value === v.unit)) unitSel.value = v.unit;
if (loc && !loc.value.trim() && measure.room) loc.value = measure.room;
}
closeMeasure();
showAddToast(`Вставлено: ${mFmt(value)}${v.unit ? ' ' + v.unit : ''}`);
// Замер, по которому что-то посчитали, сохраняем в историю автоматически
saveMeasurement({ silent: true });
}

/* ---------- как считали — в позиции счёта ---------- */
function measureNoteHtml(item) {
if (!item || !item.measure || !item.measure.text) return '';
const m = item.measure;
return `<details class="measure-note"><summary>Как считали${m.room ? ': ' + escapeHtml(m.room) : ''}</summary><div>${escapeHtml(m.text)}</div></details>`;
}
