// Кабинет мастера — план квартиры целиком.
// Нейросеть отдаёт помещения углами в общей системе координат (мм, x вправо,
// y вниз). Здесь контур переводится в обычный замер комнаты (стены, повороты,
// углы, проёмы — как вводит мастер), а положение комнаты на плане квартиры
// хранится рядом: room.plan = { x, y } — где в метрах лежит первый угол замера.
// Дальше комната правится в своём замере, а план квартиры рисуется из замеров.
// Подключается из calc.html после calc-ruler.js и до calc-import.js.

const FLAT_FMT = v => String(Math.round(v * 1000) / 1000).replace('.', ',');

// Площадь со знаком (y вниз): больше нуля — обход по часовой на экране
function flatArea2(p) {
let a = 0;
for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; }
return a;
}

// Помещение от нейросети ({ name, height_m, pts в мм, openings }) → { measure, plan }
function flatPtsToMeasure(r, objectId) {
let pts = r.pts.map(([x, y]) => [x / 1000, y / 1000]);
// без замыкающей точки (повтор первого угла в конце) и без повторов подряд
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 0.001;
if (pts.length > 1 && near(pts[0], pts[pts.length - 1])) pts.pop();
pts = pts.filter((p, i) => i === 0 || !near(p, pts[i - 1]));
let n = pts.length;
let ops = (r.openings || []).map(o => ({ ...o }));
// обход по часовой: иначе разворачиваем, проёмы — на те же стены с конца
if (flatArea2(pts) < 0) {
pts = pts.slice().reverse();
ops = ops.map(o => {
if (o.wall_index == null) return o;
const i = o.wall_index, j = (n - 2 - i + 2 * n) % n;
const len = Math.hypot(pts[(j + 1) % n][0] - pts[j][0], pts[(j + 1) % n][1] - pts[j][1]);
const off = o.offset_m != null ? Math.max(0, len - o.offset_m - (o.width_m || 0)) : null;
return { ...o, wall_index: j, offset_m: off };
});
}
// начало — верхний левый угол (как обходит мастер)
let s = 0;
pts.forEach((p, i) => { const q = pts[s]; if (p[1] < q[1] - 1e-6 || (Math.abs(p[1] - q[1]) <= 1e-6 && p[0] < q[0])) s = i; });
pts = pts.slice(s).concat(pts.slice(0, s));
ops = ops.map(o => (o.wall_index == null ? o : { ...o, wall_index: (o.wall_index - s + n) % n }));
// Проём по координатам концов (at, мм): ближайшая стена, сдвиг — по проекции
ops = ops.map(o => {
if (!Array.isArray(o.at) || o.at.length !== 2) return o;
const [a, b] = o.at.map(([x, y]) => [x / 1000, y / 1000]);
let best = null;
for (let i = 0; i < n; i++) {
const p = pts[i], q = pts[(i + 1) % n];
const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
if (len < 1e-6) continue;
const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
const proj = c => (c[0] - p[0]) * ux + (c[1] - p[1]) * uy;
const dist = c => Math.abs((c[0] - p[0]) * uy - (c[1] - p[1]) * ux);
const ta = proj(a), tb = proj(b);
// расстояние от концов до стены + насколько проём вылезает за её края
const out = Math.max(0, -Math.min(ta, tb)) + Math.max(0, Math.max(ta, tb) - len);
const score = dist(a) + dist(b) + out;
if (!best || score < best.score) best = { score, i, len, t0: Math.max(0, Math.min(ta, tb)), t1: Math.min(len, Math.max(ta, tb)) };
}
if (!best) return o;
// часть за краями стены отрезаем
const w = best.t1 - best.t0 > 0.05 ? best.t1 - best.t0 : Math.min(o.width_m || 0, best.len);
return { ...o, wall_index: best.i, width_m: Math.round(w * 1000) / 1000, offset_m: Math.round(best.t0 * 1000) / 1000 };
});
// Проём не выходит за стену
ops = ops.map(o => {
if (o.wall_index == null || o.wall_index < 0 || o.wall_index >= n) return { ...o, wall_index: null };
const p = pts[o.wall_index], q = pts[(o.wall_index + 1) % n];
const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
const w = Math.min(o.width_m || 0, len);
const off = o.offset_m != null ? Math.round(Math.min(Math.max(0, o.offset_m), len - w) * 1000) / 1000 : null;
return { ...o, width_m: w, offset_m: off };
});

const m = newMeasure(objectId);
m.room = r.name;
m.height = r.height_m ? FLAT_FMT(r.height_m) : '';
m.shape = 'free';
m.walls = []; m.turns = []; m.angles = []; m.wallHeights = [];
const dir = i => { const a = pts[i], b = pts[(i + 1) % n]; return [b[0] - a[0], b[1] - a[1]]; };
for (let i = 0; i < n; i++) {
const [dx, dy] = dir(i), [ex, ey] = dir((i + 1) % n);
m.walls.push(FLAT_FMT(Math.hypot(dx, dy)));
m.wallHeights.push('');
// поворот к следующей стене: + — направо (по часовой), внутренний угол = 180 − |поворот|
const turn = Math.atan2(dx * ey - dy * ex, dx * ex + dy * ey) * 180 / Math.PI;
m.turns.push(turn >= 0 ? 'R' : 'L');
const interior = 180 - Math.abs(turn);
m.angles.push(Math.abs(interior - 90) < 0.3 ? '' : FLAT_FMT(Math.round(interior * 10) / 10));
}
const [fx, fy] = dir(0);
m.startHeading = Math.round(((Math.atan2(fy, fx) * 180 / Math.PI) + 360) % 360 * 100) / 100;
m.openings = ops.map(o => {
const base = { type: o.type, w: FLAT_FMT(o.width_m || 0), h: o.height_m ? FLAT_FMT(o.height_m) : '', n: '1', slopes: true };
if (o.type === 'balcony') Object.assign(base, { dw: o.door_width_m ? FLAT_FMT(o.door_width_m) : '', dh: o.door_height_m ? FLAT_FMT(o.door_height_m) : '', side: 'start' });
if (o.wall_index != null) Object.assign(base, { wall: o.wall_index, off: o.offset_m != null ? FLAT_FMT(o.offset_m) : '', from: 'start' });
return base;
});
return { measure: m, plan: { x: Math.round(pts[0][0] * 1000) / 1000, y: Math.round(pts[0][1] * 1000) / 1000 } };
}

// Контур комнаты на плане квартиры: геометрия её замера, сдвинутая в своё место
function flatRoomPoints(measure, plan) {
const g = rulerGeometry(measure);
const p = [[0, 0], ...g.segs.map(q => [q.x2, q.y2])];
if (g.closed) p.pop();
return { pts: p.map(([x, y]) => [x + plan.x, y + plan.y]), g };
}

function flatPolyArea(p) { return Math.abs(flatArea2(p)) / 2; }

// Точка для подписи — центр масс контура (для Г-образных — внутри большей части)
function flatLabelPoint(p) {
let a = 0, cx = 0, cy = 0;
for (let i = 0; i < p.length; i++) {
const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
const k = x1 * y2 - x2 * y1;
a += k; cx += (x1 + x2) * k; cy += (y1 + y2) * k;
}
if (Math.abs(a) < 1e-9) return p[0];
return [cx / (3 * a), cy / (3 * a)];
}

// Комната для рисунка: углы на плане квартиры, замкнута ли, проёмы
function flatItem(id, name, measure, plan) {
const { pts, g } = flatRoomPoints(measure, plan);
return { id, name, pts, closed: g.closed, openings: measure.openings || [] };
}

// Весь план: items — [{ id, name, pts, closed, openings }] (flatItem);
// opt.onTap — имя функции (id) по нажатию; opt.view — рамка { minX, minY, w, h };
// opt.sel — id выделенной комнаты (ручки углов и стен, длины стен)
function flatSvg(items, opt = {}) {
if (typeof opt === 'string') opt = { onTap: opt };
const all = items.flatMap(r => r.pts);
if (!all.length) return '';
let v = opt.view;
if (!v) {
const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
const pad = 0.4;
v = { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad };
v.w = Math.max(...xs) - v.minX + pad; v.h = Math.max(...ys) - v.minY + pad;
}
const fs = opt.fs || Math.max(0.16, Math.min(0.32, Math.max(v.w, v.h) / 45));
const bridges = flatBridges(items, fs);
const body = items.map(r => {
const n = r.pts.length;
const d = 'M' + r.pts.map(p => p.join(' ')).join('L') + (r.closed ? 'Z' : '');
// окна — голубые, двери — коричневые, балконные блоки — зелёные; поверх стены
const ops = r.openings.map(o => {
const sg = flatOpeningSeg(r, o);
if (!sg) return '';
const { x: x1, y: y1, ux, uy, w: ow } = sg;
const col = o.type === 'door' ? '#9a6b3c' : o.type === 'balcony' ? '#3a9a5c' : '#3d8bd9';
return `<line x1="${x1}" y1="${y1}" x2="${x1 + ux * ow}" y2="${y1 + uy * ow}" stroke="${col}" stroke-width="${fs * 0.5}"/>`;
}).join('');
const [lx, ly] = flatLabelPoint(r.pts);
const area = flatPolyArea(r.pts);
const sel = opt.sel === r.id;
// размер подписи — по комнате: длинное название в узкой комнате мельче,
// в совсем маленькой — только площадь (полное название — во всплывающей подсказке)
const name = r.name || '';
const xs = r.pts.map(p => p[0]), ys = r.pts.map(p => p[1]);
const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
const areaTxt = (Math.round(area * 10) / 10).toLocaleString('ru-RU') + ' м²' + (r.closed ? '' : ' · не сходится');
const fitW = (chars, k) => (bw * 0.9) / Math.max(1, chars * k);
let rf = Math.min(fs, fitW(name.length, 0.62), bh / 3);
const showName = name && rf >= fs * 0.6;
if (!showName) rf = Math.min(fs, fitW(areaTxt.length, 0.5) / 0.85, bh / 1.6);
const tap = opt.onTap ? ` onclick="${opt.onTap}('${r.id}')" style="cursor:pointer"` : '';
return `<g class="flat-room${sel ? ' sel' : ''}"${tap}>
<path d="${d}" data-room="${r.id}" fill="${sel ? '#ffe7a3' : r.closed ? '#fff4d1' : '#fde3dc'}" stroke="#14181f" stroke-width="${fs * 0.22}" stroke-linejoin="miter"/>
${ops}
<title>${escapeHtml(name)} — ${areaTxt}</title>
${showName ? `<text x="${lx}" y="${ly - rf * 0.15}" font-size="${rf}" text-anchor="middle" font-family="Arial, sans-serif" fill="#14181f" font-weight="700" pointer-events="none">${escapeHtml(name)}</text>` : ''}
<text x="${lx}" y="${showName ? ly + rf * 1.05 : ly + rf * 0.3}" font-size="${rf * 0.85}" text-anchor="middle" font-family="Arial, sans-serif" fill="#5a6470" pointer-events="none">${areaTxt}</text>
</g>`;
}).join('');
// Ручки выделенной комнаты: углы — кружки, середины стен — квадратики с длиной
let handles = '';
const s = opt.sel && items.find(r => r.id === opt.sel);
if (s) {
const n = s.pts.length, hr = fs * 0.55;
for (let i = 0; i < n; i++) {
const a = s.pts[i], b = s.pts[(i + 1) % n];
const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
// подпись длины — внутрь комнаты (обход по часовой: внутрь — направо от стены)
const nx = len ? -(b[1] - a[1]) / len : 0, ny = len ? (b[0] - a[0]) / len : 0;
handles += `<text x="${mx + nx * fs * 1.6}" y="${my + ny * fs * 1.6 + fs * 0.35}" font-size="${fs * 0.8}" text-anchor="middle" font-family="Arial, sans-serif" fill="#c2361f" font-weight="700" pointer-events="none">${FLAT_FMT(len)}</text>`
+ `<rect data-w="${i}" x="${mx - hr * 0.8}" y="${my - hr * 0.8}" width="${hr * 1.6}" height="${hr * 1.6}" fill="#ffffff" stroke="#c2361f" stroke-width="${fs * 0.12}"/>`;
}
s.pts.forEach((p, i) => { handles += `<circle data-v="${i}" cx="${p[0]}" cy="${p[1]}" r="${hr}" fill="#ffcf3d" stroke="#14181f" stroke-width="${fs * 0.12}"/>`; });
}
return `<svg class="flat-svg" viewBox="${v.minX} ${v.minY} ${v.w} ${v.h}" xmlns="http://www.w3.org/2000/svg">${bridges}${body}${handles}</svg>`;
}

// Проём на плане — отрезок на стене комнаты (в метрах) или null
function flatOpeningSeg(r, o) {
const n = r.pts.length, i = o.wall;
if (!(i >= 0 && i < n) || (!r.closed && i >= n - 1)) return null;
const a = r.pts[i], b = r.pts[(i + 1) % n];
const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
const ow = mNum(o.w), off = mNum(o.off);
if (!(len > 0) || !(ow > 0)) return null;
const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
const st = isFinite(off) ? off : (len - ow) / 2;
return { x: a[0] + ux * st, y: a[1] + uy * st, ux, uy, w: ow };
}

// Двери, записанные у обеих комнат: на плане это две полоски по разные
// стороны стены. Пара — параллельны, между ними не толще 0,7 м и хотя бы
// 20 см друг напротив друга. { a, b, d — толщина стены со знаком, t0..t1 — общая часть на a }
function flatDoorPairs(items) {
const segs = [];
items.forEach((r, ri) => r.openings.forEach(o => {
if (o.type !== 'door' && o.type !== 'balcony') return;
const sg = flatOpeningSeg(r, o);
if (sg) segs.push({ ...sg, ri, type: o.type });
}));
const pairs = [];
for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
const a = segs[i], b = segs[j];
if (a.ri === b.ri || (a.type === 'balcony' && b.type === 'balcony')) continue;
if (Math.abs(a.ux * b.uy - a.uy * b.ux) > 0.02) continue;          // не параллельны
const dx = b.x - a.x, dy = b.y - a.y;
const d = dx * -a.uy + dy * a.ux;
if (Math.abs(d) < 0.01 || Math.abs(d) > 0.7) continue;
const tb1 = dx * a.ux + dy * a.uy, tb2 = tb1 + b.w * (a.ux * b.ux + a.uy * b.uy);
const t0 = Math.max(0, Math.min(tb1, tb2)), t1 = Math.min(a.w, Math.max(tb1, tb2));
if (t1 - t0 < 0.2) continue;
pairs.push({ a, b, d, t0, t1, tb1, tb2 });
}
return pairs;
}

// Перемычка сквозь стену между парой дверей — проём читается одним
function flatBridges(items, fs) {
return flatDoorPairs(items).map(({ a, d, t0, t1 }) => {
const p = t => [a.x + a.ux * t, a.y + a.uy * t];
const q = ([x, y]) => [x - a.uy * d, y + a.ux * d];
const pts = [p(t0), p(t1), q(p(t1)), q(p(t0))];
return `<path d="M${pts.map(v => v.join(' ')).join('L')}Z" fill="#d9b48f" stroke="#9a6b3c" stroke-width="${fs * 0.06}"/>`;
}).join('');
}

// Подгонка плана: комнаты только сдвигаются (размеры и проёмы не меняются),
// чтобы двери у соседних комнат стояли друг напротив друга, а стены, которые
// почти продолжают друг друга (расхождение до 10 см), шли одной линией.
// Важнее всего — не сбить уже ровные стены, потом — двери. Что не выходит — остаётся как было.
// Возвращает сдвиги [dx, dy] по номерам комнат
function flatAutoFit(items, tol = 0.1) {
const n = items.length;
const solve = (eqs) => {                                   // наименьшие квадраты: Σ w·(x_i − x_j − b)²
const A = Array.from({ length: n }, () => new Array(n).fill(0)), B = new Array(n).fill(0);
for (let i = 0; i < n; i++) A[i][i] += 1e-4;               // точка отсчёта — где стояли
eqs.forEach(({ i, j, b, w }) => {
A[i][i] += w; A[j][j] += w; A[i][j] -= w; A[j][i] -= w;
B[i] += w * b; B[j] -= w * b;
});
for (let c = 0; c < n; c++) {                              // метод Гаусса
let m = c;
for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r;
[A[c], A[m]] = [A[m], A[c]]; [B[c], B[m]] = [B[m], B[c]];
for (let r = c + 1; r < n; r++) {
const f = A[r][c] / A[c][c];
for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
B[r] -= f * B[c];
}
}
const x = new Array(n).fill(0);
for (let r = n - 1; r >= 0; r--) {
let v = B[r];
for (let k = r + 1; k < n; k++) v -= A[r][k] * x[k];
x[r] = v / A[r][r];
}
return x;
};
const eqs = [[], []];                                      // по x и по y
// двери: середины друг напротив друга
flatDoorPairs(items).forEach(({ a, b }) => {
const ca = [a.x + a.ux * a.w / 2, a.y + a.uy * a.w / 2], cb = [b.x + b.ux * b.w / 2, b.y + b.uy * b.w / 2];
const ax = Math.abs(a.ux) > 0.99 ? 0 : Math.abs(a.uy) > 0.99 ? 1 : -1;  // стена вдоль x или y
if (ax < 0 || Math.abs(a.w - b.w) > 0.1 || Math.abs(cb[ax] - ca[ax]) > 0.3) return;   // разной ширины — не один проём
eqs[ax].push({ i: a.ri, j: b.ri, b: cb[ax] - ca[ax], w: 5 });
});
// стены одной линией: одинаково направлены, расхождение до tol, по длине рядом (до 1 м)
const edges = [];
items.forEach((r, ri) => {
const m = r.closed ? r.pts.length : r.pts.length - 1;
for (let i = 0; i < m; i++) {
const p = r.pts[i], q = r.pts[(i + 1) % r.pts.length];
const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
if (len < 0.3) continue;
const ux = (q[0] - p[0]) / len, uy = (q[1] - p[1]) / len;
if (Math.abs(ux) > 0.999) edges.push({ ri, ax: 1, at: p[1], s: Math.min(p[0], q[0]), e: Math.max(p[0], q[0]), dir: Math.sign(ux) });
else if (Math.abs(uy) > 0.999) edges.push({ ri, ax: 0, at: p[0], s: Math.min(p[1], q[1]), e: Math.max(p[1], q[1]), dir: Math.sign(uy) });
}
});
for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
const a = edges[i], b = edges[j];
if (a.ri === b.ri || a.ax !== b.ax || a.dir !== b.dir) continue;
if (Math.abs(b.at - a.at) > tol || Math.max(a.s, b.s) - Math.min(a.e, b.e) > 1) continue;
// сдвиг по оси, поперёк стены: для вертикальной стены — x
eqs[a.ax].push({ i: a.ri, j: b.ri, b: b.at - a.at, w: Math.abs(b.at - a.at) < 0.002 ? 20 : 1 });   // уже ровные — так и остаются
}
// что не выровнять, не сбив более важное, остаётся как было:
// убираем самое большое расхождение и считаем заново
const fit = (list) => {
let x = solve(list);
for (;;) {
let worst = null, wv = 0.003;
list.forEach(e => {
if (e.w === 20) return;                                     // уже ровные стены не трогаем
const r = Math.abs(x[e.i] - x[e.j] - e.b);
if (r > wv) { wv = r; worst = e; }
});
if (!worst) return x;
list = list.filter(e => e !== worst);
x = solve(list);
}
};
const sx = fit(eqs[0]), sy = fit(eqs[1]);
return items.map((_, i) => [Math.round(sx[i] * 1000) / 1000, Math.round(sy[i] * 1000) / 1000]);
}

/* ---------- экран «План квартиры» у объекта ---------- */

let flatObjectId = null;
let flatReturn = false;   // открыли замер комнаты с плана — после него вернуться на план
let flatZoom = 1;
// Правка на плане: draft — новые углы комнат { roomId: [[x,y]…] }, undo — прошлые draft,
// view — рамка рисунка (на время правки не меняется, чтобы план не «прыгал» под пальцем)
let flatEdit = null;      // { sel, draft, undo, view }

function objectHasFlat(obj) {
return objectRooms(obj).some(r => r.plan && r.measure);
}

function flatObj() {
return (cloudData.objects || []).find(o => o.id === flatObjectId);
}

function flatRooms() {
return objectRooms(flatObj()).filter(r => r.plan && r.measure);
}

function openFlatPlan(objectId) {
flatObjectId = objectId;
flatZoom = 1;
flatEdit = null;
document.getElementById('flatPanel').classList.add('open');
document.body.classList.add('measure-open');
renderFlatPlan();
}

function closeFlatPlan() {
if (flatEdit && Object.keys(flatEdit.draft).length && !confirm('Выйти без сохранения правок на плане?')) return;
flatObjectId = null;
flatEdit = null;
document.getElementById('flatPanel').classList.remove('open');
document.body.classList.remove('measure-open');
}

function flatItems() {
return flatRooms().map(r => {
const it = flatItem(r.id, roomName(r), r.measure, r.plan);
if (flatEdit && flatEdit.draft[r.id]) it.pts = flatEdit.draft[r.id];
return it;
});
}

function renderFlatPlan() {
const body = document.getElementById('flatBody');
if (!flatObj() || !body) return;
const items = flatItems();
const rest = objectRooms(flatObj()).length - items.length;
const total = items.reduce((a, r) => a + flatPolyArea(r.pts), 0);
const ed = flatEdit;
const top = ed
? `<div class="flat-tools">
<button type="button" class="mp-head-btn" onclick="flatUndo()" ${ed.undo.length ? '' : 'disabled'}>↶ Шаг назад</button>
<button type="button" class="mp-head-btn" onclick="flatFit()">Подогнать</button>
<button type="button" class="mp-head-btn" onclick="flatEditCancel()">Отмена</button>
<button type="button" class="mp-btn mp-btn-primary" onclick="flatEditSave()">Сохранить</button>
</div>
<div class="ai-hint">${ed.sel ? 'Тяните <b>угол</b> (кружок) или <b>стену</b> (квадратик), внутри комнаты — двигается вся комната. Нажмите на квадратик — введёте точную длину стены. Привязка — к углам и стенам соседних комнат.' : 'Нажмите на комнату, чтобы её править.'}</div>`
: `<div class="ai-hint">Нажмите на помещение — откроется его замер. После правки план обновится.${rest ? ` Помещений без места на плане: ${rest} (добавлены вручную).` : ''}</div>
${isCurrentClient() ? '' : '<button type="button" class="measure-open-btn" onclick="flatEditStart()">Править на плане</button><button type="button" class="measure-open-btn" onclick="flatEditStart(); flatFit()">Подогнать стены и двери</button>'}`;
body.innerHTML = `<div class="mp-body-inner">
${top}
<div class="flat-zoom"><button type="button" class="mp-head-btn" onclick="flatSetZoom(-1)" aria-label="Мельче">−</button><span>Площадь: <b>${(Math.round(total * 10) / 10).toLocaleString('ru-RU')} м²</b></span><button type="button" class="mp-head-btn" onclick="flatSetZoom(1)" aria-label="Крупнее">+</button></div>
<div class="flat-wrap${ed ? ' editing' : ''}" id="flatWrap"><div style="width:${flatZoom * 100}%">${flatSvg(items, ed ? { view: ed.view, sel: ed.sel } : { onTap: 'flatOpenRoom' })}</div></div>
</div>`;
if (ed) flatBindEdit();
}

function flatSetZoom(d) {
flatZoom = Math.max(1, Math.min(4, flatZoom * (d > 0 ? 1.5 : 1 / 1.5)));
renderFlatPlan();
}

function flatOpenRoom(roomId) {
const objectId = flatObjectId;
document.getElementById('flatPanel').classList.remove('open');
flatReturn = true;
openMeasure({ kind: 'room', objectId, roomId });
}

// Закрыли замер, открытый с плана, — возвращаемся на план (уже с правками)
function flatAfterMeasure() {
if (!flatReturn || !flatObjectId) return;
flatReturn = false;
document.getElementById('flatPanel').classList.add('open');
document.body.classList.add('measure-open');
renderFlatPlan();
}

/* ---------- правка на плане ---------- */

function flatEditStart() {
const items = flatItems();
const all = items.flatMap(r => r.pts);
if (!all.length) return;
const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
// запас по краям — чтобы было куда тянуть
const pad = Math.max(1, (Math.max(...xs) - Math.min(...xs)) * 0.15);
const view = { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad };
view.w = Math.max(...xs) - view.minX + pad; view.h = Math.max(...ys) - view.minY + pad;
flatEdit = { sel: null, draft: {}, undo: [], view };
renderFlatPlan();
}

function flatEditCancel() {
if (Object.keys(flatEdit.draft).length && !confirm('Отменить все правки на плане?')) return;
flatEdit = null;
renderFlatPlan();
}

function flatUndo() {
if (!flatEdit || !flatEdit.undo.length) return;
flatEdit.draft = flatEdit.undo.pop();
renderFlatPlan();
}

// Кнопка «Подогнать»: сдвигает комнаты (черновик правки — можно «Шаг назад» или «Отмена»)
function flatFit() {
if (!flatEdit) return;
const items = flatItems();
const sh = flatAutoFit(items);
const moved = items.filter((_, i) => Math.hypot(sh[i][0], sh[i][1]) >= 0.002);
if (!moved.length) { showAddToast('Уже ровно — подгонять нечего'); return; }
flatPushUndo();
items.forEach((r, i) => {
if (Math.hypot(sh[i][0], sh[i][1]) < 0.002) return;
flatEdit.draft[r.id] = r.pts.map(([x, y]) => [Math.round((x + sh[i][0]) * 1000) / 1000, Math.round((y + sh[i][1]) * 1000) / 1000]);
});
renderFlatPlan();
const max = Math.max(...sh.map(v => Math.hypot(v[0], v[1])));
showAddToast(`Подогнано помещений: ${moved.length} (сдвиг до ${Math.round(max * 100)} см). Проверьте и нажмите «Сохранить»`);
}

function flatPushUndo() {
flatEdit.undo.push(JSON.parse(JSON.stringify(flatEdit.draft)));
if (flatEdit.undo.length > 50) flatEdit.undo.shift();
}

function flatPts(id) {
const it = flatItems().find(r => r.id === id);
return it ? it.pts.map(p => p.slice()) : null;
}

// Новые углы → замер комнаты: длины стен, повороты, углы, начальное направление
// и место на плане; проёмы остаются на своих стенах (отступ — не дальше конца стены)
function flatApplyPolygon(room, pts) {
const m = room.measure, n = pts.length;
const dir = i => { const a = pts[i], b = pts[(i + 1) % n]; return [b[0] - a[0], b[1] - a[1]]; };
m.shape = 'free';
m.walls = []; m.turns = []; m.angles = [];
if (!Array.isArray(m.wallHeights)) m.wallHeights = [];
for (let i = 0; i < n; i++) {
const [dx, dy] = dir(i), [ex, ey] = dir((i + 1) % n);
m.walls.push(FLAT_FMT(Math.hypot(dx, dy)));
const turn = Math.atan2(dx * ey - dy * ex, dx * ex + dy * ey) * 180 / Math.PI;
m.turns.push(turn >= 0 ? 'R' : 'L');
const interior = 180 - Math.abs(turn);
m.angles.push(Math.abs(interior - 90) < 0.3 ? '' : FLAT_FMT(Math.round(interior * 10) / 10));
}
m.wallHeights.length = n;
for (let i = 0; i < n; i++) if (m.wallHeights[i] == null) m.wallHeights[i] = '';
const [fx, fy] = dir(0);
m.startHeading = Math.round(((Math.atan2(fy, fx) * 180 / Math.PI) + 360) % 360 * 100) / 100;
(m.openings || []).forEach(o => {
const len = mNum(m.walls[o.wall]), ow = mNum(o.w), off = mNum(o.off);
if (len > 0 && ow > 0 && isFinite(off) && off + ow > len) o.off = FLAT_FMT(Math.max(0, len - ow));
});
room.plan = { x: Math.round(pts[0][0] * 1000) / 1000, y: Math.round(pts[0][1] * 1000) / 1000 };
}

async function flatEditSave() {
const rooms = flatRooms();
const ids = Object.keys(flatEdit.draft);
ids.forEach(id => { const r = rooms.find(x => x.id === id); if (r) flatApplyPolygon(r, flatEdit.draft[id]); });
flatEdit = null;
renderFlatPlan();
if (!ids.length) return;
syncCartWithRooms();
renderInvoice();
if (typeof currentObjectId !== 'undefined' && currentObjectId === flatObjectId) renderObjectDetail();
if ((await saveCloudData()) !== false) showAddToast(`План сохранён: изменено помещений — ${ids.length}`);
renderFlatPlan();
}

// Привязка: ближайшее значение из списка, если оно ближе порога
function flatSnap(v, list, tol) {
let best = v, d = tol;
list.forEach(c => { const e = Math.abs(c - v); if (e < d) { d = e; best = c; } });
return best;
}

// Перетаскивание: угол, стена (вдоль своей нормали) или комната целиком
function flatBindEdit() {
const wrap = document.getElementById('flatWrap');
const svg = wrap && wrap.querySelector('svg');
if (!svg) return;
svg.onpointerdown = (e) => {
const t = e.target;
const roomId = t.dataset.room;
const ed = flatEdit;
// нажали на другую комнату — выделяем её
if (roomId && roomId !== ed.sel) { ed.sel = roomId; renderFlatPlan(); return; }
if (!ed.sel) return;
const kind = t.dataset.v != null ? 'v' : t.dataset.w != null ? 'w' : roomId === ed.sel ? 'room' : null;
if (!kind) { ed.sel = null; renderFlatPlan(); return; }
e.preventDefault();
const ctm = svg.getScreenCTM().inverse();
const toM = (ev) => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; const q = p.matrixTransform(ctm); return [q.x, q.y]; };
const start = toM(e);
const base = flatPts(ed.sel);
const idx = Number(kind === 'v' ? t.dataset.v : t.dataset.w);
const n = base.length;
// привязка — к углам других комнат и остальным углам этой; порог ~ 12 точек экрана
const tol = 12 * Math.abs(ctm.a);
const others = flatItems().filter(r => r.id !== ed.sel).flatMap(r => r.pts);
const moving = kind === 'v' ? [idx] : kind === 'w' ? [idx, (idx + 1) % n] : base.map((_, i) => i);
const own = base.filter((_, i) => !moving.includes(i));
const cx = others.concat(own).map(p => p[0]), cy = others.concat(own).map(p => p[1]);
let moved = false, pushed = false;
const move = (ev) => {
const [x, y] = toM(ev);
let dx = x - start[0], dy = y - start[1];
if (!moved && Math.hypot(dx, dy) < tol * 0.4) return;
moved = true;
if (!pushed) { flatPushUndo(); pushed = true; }
const pts = base.map(p => p.slice());
if (kind === 'v') {
pts[idx] = [flatSnap(base[idx][0] + dx, cx, tol), flatSnap(base[idx][1] + dy, cy, tol)];
} else if (kind === 'w') {
const a = base[idx], b = base[(idx + 1) % n];
const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
let k = dx * nx + dy * ny;
// стена по оси — привязываем её положение по этой оси
if (Math.abs(nx) < 1e-6) k = (flatSnap(a[1] + k * ny, cy, tol) - a[1]) / ny;
else if (Math.abs(ny) < 1e-6) k = (flatSnap(a[0] + k * nx, cx, tol) - a[0]) / nx;
[idx, (idx + 1) % n].forEach(i => { pts[i] = [base[i][0] + k * nx, base[i][1] + k * ny]; });
} else {
// вся комната: сдвиг, при котором любой её угол встаёт на линию соседей
let bx = dx, by = dy, ex = tol, ey = tol;
base.forEach(p => {
cx.filter((_, j) => j < others.length).forEach(c => { const e2 = Math.abs(p[0] + dx - c); if (e2 < ex) { ex = e2; bx = c - p[0]; } });
cy.filter((_, j) => j < others.length).forEach(c => { const e2 = Math.abs(p[1] + dy - c); if (e2 < ey) { ey = e2; by = c - p[1]; } });
});
pts.forEach((p, i) => { pts[i] = [base[i][0] + bx, base[i][1] + by]; });
}
// до миллиметра
ed.draft[ed.sel] = pts.map(p => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]);
flatRedrawSvg();
};
const up = () => {
window.removeEventListener('pointermove', move);
window.removeEventListener('pointerup', up);
if (!moved && kind === 'w') flatAskWall(idx);
else if (moved) renderFlatPlan();
};
window.addEventListener('pointermove', move);
window.addEventListener('pointerup', up);
};
}

// Во время перетаскивания — только рисунок (кнопки и подсказки не трогаем)
function flatRedrawSvg() {
const wrap = document.getElementById('flatWrap');
if (!wrap || !flatEdit) return;
const old = wrap.querySelector('svg');
const holder = document.createElement('div');
holder.innerHTML = flatSvg(flatItems(), { view: flatEdit.view, sel: flatEdit.sel });
const svg = holder.firstElementChild;
old.replaceWith(svg);
flatBindEdit();
}

// Точная длина стены: двигаем следующую стену вдоль этой — соседние углы остаются прямыми
function flatAskWall(i) {
const pts = flatPts(flatEdit.sel);
const n = pts.length, a = pts[i], b = pts[(i + 1) % n];
const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
const v = prompt('Длина стены, м', FLAT_FMT(len));
if (v == null) return;
const want = evalMeasureExpr(String(v));
if (!(want > 0) || !(len > 0)) return;
const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, k = want - len;
flatPushUndo();
[(i + 1) % n, (i + 2) % n].forEach(j => { pts[j] = [pts[j][0] + ux * k, pts[j][1] + uy * k]; });
flatEdit.draft[flatEdit.sel] = pts.map(p => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]);
renderFlatPlan();
}
