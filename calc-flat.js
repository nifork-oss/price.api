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
const base = { type: o.type, w: FLAT_FMT(o.width_m || 0), h: o.height_m ? FLAT_FMT(o.height_m) : '', n: '1', slopes: true, ...(o.pass ? { pass: true } : {}) };
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
return { id, name, pts, closed: g.closed, openings: measure.openings || [], h: measure.height || '', wh: measure.wallHeights || [] };
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
// подложка — чертёж под планом (opt.underlay: { href, x, y, w, ar, rot, op, adjust })
let under = '';
const ul = opt.underlay;
if (ul) {
const uh = ul.w * ul.ar, tr = `rotate(${ul.rot || 0} ${ul.x + ul.w / 2} ${ul.y + uh / 2})`;
under = `<image id="flatUlImg" href="${ul.href}" x="${ul.x}" y="${ul.y}" width="${ul.w}" height="${uh}" preserveAspectRatio="none" opacity="${ul.op || 0.45}" transform="${tr}" pointer-events="none"/>`
+ (ul.adjust ? `<rect id="flatUlFrame" x="${ul.x}" y="${ul.y}" width="${ul.w}" height="${uh}" fill="none" stroke="#e8a900" stroke-width="${fs * 0.12}" stroke-dasharray="${fs * 0.5} ${fs * 0.3}" transform="${tr}" pointer-events="none"/>` : '');
}
const body = items.map(r => {
const n = r.pts.length;
const d = 'M' + r.pts.map(p => p.join(' ')).join('L') + (r.closed ? 'Z' : '');
// окна — голубые, двери — коричневые, балконные блоки — зелёные; поверх стены
const ops = r.openings.map(o => {
const sg = flatOpeningSeg(r, o);
if (!sg) return '';
const { x: x1, y: y1, ux, uy, w: ow } = sg;
const col = o.type === 'door' ? '#9a6b3c' : o.type === 'balcony' ? '#3a9a5c' : '#3d8bd9';
if (o.pass) {
const x2 = x1 + ux * ow, y2 = y1 + uy * ow, jx = -uy * fs * 0.35, jy = ux * fs * 0.35;
return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${opt.sel === r.id ? '#ffe7a3' : '#fff4d1'}" stroke-width="${fs * 0.34}"/>`
+ `<path d="M${x1 - jx} ${y1 - jy}L${x1 + jx} ${y1 + jy}M${x2 - jx} ${y2 - jy}L${x2 + jx} ${y2 + jy}" stroke="#14181f" stroke-width="${fs * 0.12}"/>`;
}
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
<path d="${d}" data-room="${r.id}" fill="${sel ? '#ffe7a3' : r.closed ? '#fff4d1' : '#fde3dc'}"${ul ? ' fill-opacity="0.35"' : ''} stroke="#14181f" stroke-width="${fs * 0.22}" stroke-linejoin="miter"/>
${ops}
${opt.pickWalls ? r.pts.map((p, i) => (!r.closed && i === n - 1) ? '' : `<line x1="${p[0]}" y1="${p[1]}" x2="${r.pts[(i + 1) % n][0]}" y2="${r.pts[(i + 1) % n][1]}" stroke="#e8a900" stroke-opacity=".55" stroke-width="${fs * 0.5}" stroke-linecap="round" onclick="${opt.pickWalls === true ? 'flatScaleWall' : opt.pickWalls}('${r.id}', ${i}, event)" style="cursor:pointer"/>`).join('') : ''}
${opt.pickOps ? r.openings.map((o, oi) => { const sg = flatOpeningSeg(r, o); return sg ? `<line x1="${sg.x}" y1="${sg.y}" x2="${sg.x + sg.ux * sg.w}" y2="${sg.y + sg.uy * sg.w}" stroke="#c2361f" stroke-opacity=".01" stroke-width="${fs * 0.9}" data-op-room="${r.id}" data-op="${oi}" style="cursor:grab"/>` : ''; }).join('') : ''}
<title>${escapeHtml(name)} — ${areaTxt}</title>
${showName ? `<text x="${lx}" y="${ly - rf * 0.15}" font-size="${rf}" text-anchor="middle" font-family="Arial, sans-serif" fill="#14181f" font-weight="700" pointer-events="none">${escapeHtml(name)}</text>` : ''}
<text x="${lx}" y="${showName ? ly + rf * 1.05 : ly + rf * 0.3}" font-size="${rf * 0.85}" text-anchor="middle" font-family="Arial, sans-serif" fill="#5a6470" pointer-events="none">${areaTxt}</text>
${opt.heights ? flatHeightLabels(r, lx, (showName ? ly + rf * 1.05 : ly + rf * 0.3) + Math.max(rf, fs * 0.7) * 1.05, Math.max(rf * 0.85, fs * 0.7), fs) : ''}
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
return `<svg class="flat-svg" viewBox="${v.minX} ${v.minY} ${v.w} ${v.h}" xmlns="http://www.w3.org/2000/svg">${under}${bridges}${body}${handles}</svg>`;
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
if (sg) segs.push({ ...sg, ri, type: o.type, pass: !!o.pass });
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
return flatDoorPairs(items).map(({ a, b, d, t0, t1 }) => {
const p = t => [a.x + a.ux * t, a.y + a.uy * t];
const q = ([x, y]) => [x - a.uy * d, y + a.ux * d];
const pts = [p(t0), p(t1), q(p(t1)), q(p(t0))];
// проход без двери — стена открыта: перемычка цветом пола
if (a.pass && b.pass) return `<path d="M${pts.map(v => v.join(' ')).join('L')}Z" fill="#fff4d1" stroke="none"/>`;
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
let flatScaleMode = false; // выбираем стену, чтобы задать масштаб всего плана
let flatOpsMode = false;   // ставим и убираем двери и проёмы нажатием на стену
let flatOpsDraft = null;   // { orig, undo } — проёмы до правки и шаги назад; в облако — только по «Сохранить»
let flatMergeFrom = null;  // id комнаты, к которой присоединяем соседнюю
let flatHMode = false;     // высоты стен, окон и дверей: всем сразу или по одной нажатием

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
flatOpsDraft = null;
flatScaleMode = false; flatOpsMode = false; flatMergeFrom = null; flatHMode = false;
flatUlAdjust = null;
flatZoom = 1;
flatEdit = null;
document.getElementById('flatPanel').classList.add('open');
document.body.classList.add('measure-open');
renderFlatPlan();
}

function closeFlatPlan() {
if (flatEdit && Object.keys(flatEdit.draft).length && !confirm('Выйти без сохранения правок на плане?')) return;
if (flatOpsDraft && flatOpsDraft.undo.length && !confirm('Выйти без сохранения дверей и проёмов?')) return;
if (flatOpsDraft) { flatOpsRestore(flatOpsDraft.orig); flatOpsDraft = null; flatOpsMode = false; }
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
const top = flatHMode
? flatHTopHtml()
: flatOpsMode
? `<div class="flat-tools">
<button type="button" class="mp-head-btn" onclick="flatOpsUndo()" ${flatOpsDraft && flatOpsDraft.undo.length ? '' : 'disabled'}>↶ Шаг назад</button>
<button type="button" class="mp-head-btn" onclick="flatOpsCancel()">Отмена</button>
<button type="button" class="mp-btn mp-btn-primary" onclick="flatOpsSave()">Сохранить</button>
</div>
<div class="ai-hint"><b>Двери и проёмы.</b> Нажмите на стену (выделены жёлтым) — добавите дверь, проход, окно или балконный блок в это место. Проём можно <b>тянуть пальцем вдоль стены</b>, а нажатием — поменять ширину, сделать из двери проход без двери (и обратно) или убрать. В облако — только по «Сохранить». Дверь между комнатами — сразу у обеих.</div>`
: flatMergeFrom
? `<div class="flat-tools"><button type="button" class="mp-head-btn" onclick="flatMergeFrom = null; renderFlatPlan()">Отмена</button></div>
<div class="ai-hint"><b>Объединить.</b> Нажмите на соседнюю комнату — она станет частью «${escapeHtml(roomName(objectRooms(flatObj()).find(r => r.id === flatMergeFrom) || {}))}» вместе со стеной между ними.</div>`
: flatScaleMode
? `<div class="flat-tools"><button type="button" class="mp-head-btn" onclick="flatScaleMode = false; renderFlatPlan()">Отмена</button></div>
<div class="ai-hint"><b>Масштаб по стене.</b> Нажмите на стену (выделены жёлтым), длину которой знаете точно, и введите её. Весь план — все помещения, проёмы и подложка — пересчитается в том же соотношении.</div>`
: ed
? `<div class="flat-tools">
<button type="button" class="mp-head-btn" onclick="flatUndo()" ${ed.undo.length ? '' : 'disabled'}>↶ Шаг назад</button>
<button type="button" class="mp-head-btn" onclick="flatFit()">Подогнать</button>
<button type="button" class="mp-head-btn" onclick="flatEditCancel()">Отмена</button>
<button type="button" class="mp-btn mp-btn-primary" onclick="flatEditSave()">Сохранить</button>
</div>
<div class="ai-hint">${ed.sel ? 'Тяните <b>угол</b> (кружок) или <b>стену</b> (квадратик), внутри комнаты — двигается вся комната. Нажмите на квадратик — введёте точную длину стены. Привязка — к углам и стенам соседних комнат.' : 'Нажмите на комнату, чтобы её править.'}</div>`
: `<div class="ai-hint">Нажмите на помещение — откроется его замер. После правки план обновится.${rest ? ` Помещений без места на плане: ${rest} (добавлены вручную).` : ''}</div>
${isCurrentClient() || flatUlAdjust ? '' : '<button type="button" class="measure-open-btn" onclick="flatEditStart()">Править на плане</button><button type="button" class="measure-open-btn" onclick="flatEditStart(); flatFit()">Подогнать стены и двери</button><button type="button" class="measure-open-btn" onclick="flatScaleStart()">Масштаб по стене</button><button type="button" class="measure-open-btn" onclick="flatOpsStart()">Двери и проёмы</button><button type="button" class="measure-open-btn" onclick="flatHStart()">Высоты стен, окон и дверей</button>'}`;
const oldWrap = document.getElementById('flatWrap');
const scroll = oldWrap ? [oldWrap.scrollLeft, oldWrap.scrollTop] : null;
body.innerHTML = `<div class="mp-body-inner">
${top}
<div class="flat-zoom"><button type="button" class="mp-head-btn" onclick="flatSetZoom(-1)" aria-label="Мельче">−</button><span>Площадь: <b>${(Math.round(total * 10) / 10).toLocaleString('ru-RU')} м²</b></span><button type="button" class="mp-head-btn" onclick="flatSetZoom(1)" aria-label="Крупнее">+</button></div>
<div class="flat-viewbox"><div class="flat-wrap flat-view${ed || flatUlAdjust ? ' editing' : ''}" id="flatWrap"><div>${flatSvg(items, ed ? { view: ed.view, sel: ed.sel, underlay: flatUlOpt() } : flatUlAdjust ? { view: flatUlAdjust.view, underlay: flatUlOpt() } : flatScaleMode ? { pickWalls: true, underlay: flatUlOpt(), view: flatViewOf(items) }
: flatHMode ? { pickWalls: 'flatHWall', pickOps: true, onTap: 'flatHRoom', heights: true, underlay: flatUlOpt(), view: flatViewOf(items) }
: flatOpsMode ? { pickWalls: 'flatOpsWall', pickOps: 'flatOpsRemove', underlay: flatUlOpt(), view: flatViewOf(items) }
: { onTap: flatMergeFrom ? 'flatMergeTap' : 'flatOpenRoom', sel: flatMergeFrom || undefined, underlay: flatUlOpt(), view: flatViewOf(items) })}</div></div>
<div class="flat-bar flat-bar-x" id="flatBarX"><div></div></div><div class="flat-bar flat-bar-y" id="flatBarY"><div></div></div></div>
${ed || flatScaleMode || flatOpsMode || flatHMode || flatMergeFrom ? '' : flatUlBarHtml()}
</div>`;
flatSizeInner();
const wrap = document.getElementById('flatWrap');
if (scroll && wrap) { wrap.scrollLeft = scroll[0]; wrap.scrollTop = scroll[1]; }
flatBindBars();
if (ed) flatBindEdit();
else if (flatUlAdjust) flatBindUnderlay();
else if (flatOpsMode) flatBindOps();
else if (flatHMode) flatBindHeights();
if (!flatUlAdjust) flatBindPanZoom();
}

// Рамка рисунка: план и (если видна) подложка целиком — чтобы были видны все подписи чертежа
function flatViewOf(items, pad = 0.4) {
const all = items.flatMap(r => r.pts);
const u = flatUlOpt();
if (u) {
const h = u.w * u.ar, cx = u.x + u.w / 2, cy = u.y + h / 2;
const [bw, bh] = (u.rot || 0) % 180 ? [h, u.w] : [u.w, h];
// подложка — не дальше 1,5 м от плана: там надписи чертежа, дальше — пустые поля листа
const m = 1.5, px = all.map(p => p[0]), py = all.map(p => p[1]);
const lim = all.length ? [Math.min(...px) - m, Math.min(...py) - m, Math.max(...px) + m, Math.max(...py) + m] : [-Infinity, -Infinity, Infinity, Infinity];
all.push([Math.max(cx - bw / 2, lim[0]), Math.max(cy - bh / 2, lim[1])], [Math.min(cx + bw / 2, lim[2]), Math.min(cy + bh / 2, lim[3])]);
}
if (!all.length) return undefined;
const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
const v = { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad };
v.w = Math.max(...xs) - v.minX + pad; v.h = Math.max(...ys) - v.minY + pad;
return v;
}

// Рисунок в окне: при масштабе 1 — весь целиком, дальше — крупнее (до 8 раз)
function flatSizeInner() {
const wrap = document.getElementById('flatWrap');
const inner = wrap && wrap.firstElementChild;
const svg = inner && inner.querySelector('svg');
if (!svg) return;
const vb = svg.viewBox.baseVal;
// окно не выше рисунка: широкий план на телефоне — без пустого места снизу
const maxH = Math.round((window.visualViewport ? window.visualViewport.height : window.innerHeight) * 0.68);
wrap.style.height = Math.max(200, Math.min(maxH, Math.ceil((wrap.clientWidth - 12) * vb.height / vb.width) + 14)) + 'px';
const W = wrap.clientWidth - 12, H = wrap.clientHeight - 12;
const base = Math.max(100, Math.min(W, H * vb.width / vb.height));
inner.style.width = Math.round(base * flatZoom) + 'px';
inner.style.margin = '0 auto';
flatBarsUpdate();
}

// Полосы прокрутки снизу и справа: тянуть план целиком, когда он приближен
// (пальцем по плану в правке двигаются комнаты, а не план)
function flatBarsUpdate() {
const wrap = document.getElementById('flatWrap');
if (!wrap) return;
[['flatBarX', wrap.scrollWidth, wrap.clientWidth, wrap.scrollLeft, 'width', 'left', 'offsetWidth'],
['flatBarY', wrap.scrollHeight, wrap.clientHeight, wrap.scrollTop, 'height', 'top', 'offsetHeight']].forEach(([id, sw, cw, sp, size, pos, off]) => {
const bar = document.getElementById(id);
if (!bar) return;
const on = sw > cw + 2;
bar.style.display = on ? '' : 'none';
if (!on) return;
const track = bar[off], th = Math.max(40, track * cw / sw);
const thumb = bar.firstElementChild;
thumb.style[size] = th + 'px';
thumb.style[pos] = ((track - th) * sp / (sw - cw)) + 'px';
});
}

function flatBindBars() {
const wrap = document.getElementById('flatWrap');
if (!wrap) return;
wrap.addEventListener('scroll', flatBarsUpdate, { passive: true });
[['flatBarX', 'scrollLeft', 'scrollWidth', 'clientWidth', 'clientX', 'offsetWidth', 'left'],
['flatBarY', 'scrollTop', 'scrollHeight', 'clientHeight', 'clientY', 'offsetHeight', 'top']].forEach(([id, sp, sw, cw, cx, off, side]) => {
const bar = document.getElementById(id);
if (!bar) return;
bar.addEventListener('pointerdown', (e) => {
e.preventDefault(); e.stopPropagation();
const thumb = bar.firstElementChild;
const k = () => (wrap[sw] - wrap[cw]) / Math.max(1, bar[off] - thumb[off]);   // пикселей плана на пиксель полосы
// нажали мимо ползунка — он встаёт под палец
if (e.target !== thumb) wrap[sp] = (e[cx] - bar.getBoundingClientRect()[side] - thumb[off] / 2) * k();
const p0 = e[cx], s0 = wrap[sp];
try { bar.setPointerCapture(e.pointerId); } catch (err) { /* пусто */ }
bar.classList.add('on');
const move = (ev) => { wrap[sp] = s0 + (ev[cx] - p0) * k(); };
const up = () => { bar.classList.remove('on'); bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); bar.removeEventListener('pointercancel', up); };
bar.addEventListener('pointermove', move);
bar.addEventListener('pointerup', up);
bar.addEventListener('pointercancel', up);
});
});
flatBarsUpdate();
}

// Масштаб с сохранением точки под (cx, cy) — координаты внутри окна
function flatZoomAt(z, cx, cy) {
const wrap = document.getElementById('flatWrap');
const inner = wrap && wrap.firstElementChild;
if (!inner) return;
z = Math.max(1, Math.min(8, z));
const ow = inner.offsetWidth || 1, ol = inner.offsetLeft, ot = inner.offsetTop;
const fx = (wrap.scrollLeft + cx - ol) / ow, fy = (wrap.scrollTop + cy - ot) / (inner.offsetHeight || 1);
flatZoom = z;
flatSizeInner();
wrap.scrollLeft = fx * inner.offsetWidth + inner.offsetLeft - cx;
wrap.scrollTop = fy * inner.offsetHeight + inner.offsetTop - cy;
}

function flatSetZoom(d) {
const wrap = document.getElementById('flatWrap');
if (!wrap) return;
flatZoomAt(flatZoom * (d > 0 ? 1.5 : 1 / 1.5), wrap.clientWidth / 2, wrap.clientHeight / 2);
}

// Окно плана как карта: одним пальцем — двигать (в правке — по пустому месту),
// двумя — приближать; колесо с Ctrl — тоже масштаб. Нажатие после движения не открывает комнату
function flatBindPanZoom() {
const wrap = document.getElementById('flatWrap');
if (!wrap) return;
const pts = new Map();
let start = null, moved = false;
const snap = () => ({ pts: new Map([...pts].map(([k, v]) => [k, { ...v }])), sl: wrap.scrollLeft, st: wrap.scrollTop, z: flatZoom });
wrap._pz = pts;
wrap.addEventListener('pointerdown', e => {
if (wrap._drag) return;                                   // тянут угол или стену
pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
if (pts.size === 1) moved = false;
start = snap();
});
wrap.addEventListener('pointermove', e => {
if (!pts.has(e.pointerId) || !start || wrap._drag) return;
pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
if (pts.size === 1 && start.pts.size === 1) {
const p0 = start.pts.get(e.pointerId);
const dx = e.clientX - p0.x, dy = e.clientY - p0.y;
if (!moved && Math.hypot(dx, dy) < 6) return;
if (!moved) { moved = true; try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* пусто */ } }
wrap.scrollLeft = start.sl - dx; wrap.scrollTop = start.st - dy;
} else if (pts.size === 2 && start.pts.size === 2) {
moved = true;
const a = [...pts.values()], b = [...start.pts.values()];
const d1 = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), d0 = Math.hypot(b[0].x - b[1].x, b[0].y - b[1].y) || 1;
const r = wrap.getBoundingClientRect();
const c1 = [(a[0].x + a[1].x) / 2 - r.left, (a[0].y + a[1].y) / 2 - r.top];
const c0 = [(b[0].x + b[1].x) / 2 - r.left, (b[0].y + b[1].y) / 2 - r.top];
// масштаб от точки между пальцами в начале, потом — сдвиг за пальцами
wrap.scrollLeft = start.sl; wrap.scrollTop = start.st; flatZoom = start.z; flatSizeInner();
flatZoomAt(start.z * d1 / d0, c0[0], c0[1]);
wrap.scrollLeft -= c1[0] - c0[0]; wrap.scrollTop -= c1[1] - c0[1];
}
});
const end = e => {
if (!pts.has(e.pointerId)) return;
pts.delete(e.pointerId);
start = pts.size ? snap() : null;
// нажатие мимо комнат в правке — снять выделение
if (!pts.size && !moved && flatEdit && flatEdit.sel && !(e.target.dataset && (e.target.dataset.room || e.target.dataset.v != null || e.target.dataset.w != null))) {
flatEdit.sel = null; renderFlatPlan();
}
};
wrap.addEventListener('pointerup', end);
wrap.addEventListener('pointercancel', end);
// после движения нажатие не открывает замер комнаты
wrap.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
wrap.addEventListener('wheel', e => {
if (!e.ctrlKey) return;
e.preventDefault();
const r = wrap.getBoundingClientRect();
flatZoomAt(flatZoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
}

// Нажатие на комнату — что с ней сделать (без нейросети и бесплатно)
function flatOpenRoom(roomId) {
const room = objectRooms(flatObj()).find(r => r.id === roomId);
if (!room) return;
if (isCurrentClient()) { flatOpenMeasure(roomId); return; }
openSheet(roomName(room), [
{ icon: '📏', label: 'Открыть замер', onClick: () => flatOpenMeasure(roomId) },
{ icon: '✏️', label: 'Переименовать', onClick: () => flatRoomRename(roomId) },
{ icon: '➕', label: 'Объединить с соседней', onClick: () => { flatMergeFrom = roomId; renderFlatPlan(); } },
null,
{ icon: '🗑️', label: 'Удалить помещение', danger: true, onClick: () => flatRoomDelete(roomId) },
]);
}

function flatOpenMeasure(roomId) {
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

/* ---------- подложка под планом квартиры: страница PDF или фото чертежа ---------- */
// Хранится в этом браузере, как подложка комнаты (calc-import.js), — по объекту

let flatUlAdjust = null;   // { view } — подстраиваем подложку (рамка рисунка на это время не меняется)

function flatUlId() { return 'flat_' + flatObjectId; }

function flatUlOpt() {
const u = typeof getUnderlay === 'function' ? getUnderlay(flatUlId()) : null;
if (!u || (u.hidden && !flatUlAdjust)) return null;
return { ...u, href: underlayHref(flatUlId(), u.src), adjust: !!flatUlAdjust };
}

function flatUlBarHtml() {
if (isCurrentClient()) return '';
const u = getUnderlay(flatUlId());
if (!u) return `<div class="ai-hint">Подложка — страница проекта под планом: сразу видно, где план расходится с чертежом.</div>
<div class="rl-ul-row"><button type="button" class="rl-ul-add" onclick="flatUlPick('pdf')">Подложка: PDF</button><button type="button" class="rl-ul-add" onclick="flatUlPick('photo')">Подложка: фото</button></div>`;
if (!flatUlAdjust) return `<div class="rl-ul-row">
${u.locked ? '<span class="flat-ul-lock">🔒 Подложка закреплена</span>' : ''}
<button type="button" class="rl-tool" onclick="flatUlAction('adjust')">${u.locked ? 'Подстроить заново' : 'Подложка: подстроить'}</button>
<button type="button" class="rl-tool" onclick="flatUlAction('toggle')">${u.hidden ? 'Показать подложку' : 'Скрыть подложку'}</button>
</div>`;
return `<div class="rl-ul-panel">
<div class="rl-ul-hint">Двигайте чертёж пальцем, двумя пальцами — размер. Совместите его стены с планом, точно — кнопками. Потом — «Закрепить»: план можно будет двигать и приближать вместе с подложкой.</div>
<div class="rl-ul-row">
<button type="button" class="rl-tool" onclick="flatUlAction('smaller5')">−5%</button>
<button type="button" class="rl-tool" onclick="flatUlAction('smaller')">−1%</button>
<button type="button" class="rl-tool" onclick="flatUlAction('bigger')">+1%</button>
<button type="button" class="rl-tool" onclick="flatUlAction('bigger5')">+5%</button>
<button type="button" class="rl-tool" onclick="flatUlAction('rotate')">↻ 90°</button>
<button type="button" class="rl-tool" onclick="flatUlAction('lighter')">Светлее</button>
<button type="button" class="rl-tool" onclick="flatUlAction('darker')">Темнее</button>
<button type="button" class="rl-tool" onclick="flatUlPick('pdf')">Другая страница</button>
<button type="button" class="rl-tool rl-tool-del" onclick="flatUlAction('remove')">Убрать</button>
<button type="button" class="rl-tool rl-tool-close" onclick="flatUlAction('done')">🔒 Закрепить</button>
</div>
</div>`;
}

function flatUlPick(kind) {
const inp = document.createElement('input');
inp.type = 'file';
inp.accept = kind === 'pdf' ? 'application/pdf,.pdf' : 'image/*,application/pdf';
inp.onchange = () => { if (inp.files && inp.files[0]) flatUlFile(inp.files[0]); };
inp.click();
}

async function flatUlFile(file) {
try {
const pick = isPdfFile(file) ? await pickPdfPage(file) : { page: 1 };
if (!pick) return;
showAddToast('Готовлю подложку…');
const img = await fileToJpeg(file, 2000, pick.page);
const id = flatUlId();
try { localStorage.setItem(ulImgKey(id), img.dataUrl); }
catch (e) { alert('Не хватает места на телефоне для подложки. Уберите подложки у комнат.'); return; }
ulCache[id] = img.dataUrl;
// по умолчанию — по центру плана; лист проекта обычно вдвое шире самого плана
const all = flatItems().flatMap(r => r.pts);
const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
const bw = Math.max(...xs) - Math.min(...xs) || 8, cx = (Math.max(...xs) + Math.min(...xs)) / 2 || 0, cy = (Math.max(...ys) + Math.min(...ys)) / 2 || 0;
const ar = img.h / img.w, w = bw * 2;
saveUnderlayView(id, { x: cx - w / 2, y: cy - w * ar / 2, w, ar, rot: 0, op: 0.5, hidden: false });
flatUlStartAdjust();
showAddToast('Подложка добавлена — совместите её с планом');
} catch (err) {
alert('Не удалось открыть файл: ' + (err && err.message ? err.message : err));
}
}

// рамка рисунка на время подстройки: план и подложка целиком
function flatUlStartAdjust() {
const u = getUnderlay(flatUlId());
const all = flatItems().flatMap(r => r.pts);
if (u) { const h = u.w * u.ar; all.push([u.x, u.y], [u.x + u.w, u.y + h]); }
const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
const pad = 0.4;
const view = { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad };
view.w = Math.max(...xs) - view.minX + pad; view.h = Math.max(...ys) - view.minY + pad;
flatUlAdjust = { view };
if (u && (u.hidden || u.locked)) { u.hidden = false; u.locked = false; saveUnderlayView(flatUlId(), u); }
renderFlatPlan();
}

function flatUlAction(act) {
const id = flatUlId(), u = getUnderlay(id);
if (!u) return;
if (act === 'adjust') { flatUlStartAdjust(); return; }
if (act === 'done') { u.locked = true; saveUnderlayView(id, u); flatUlAdjust = null; renderFlatPlan(); return; }
if (act === 'remove') {
if (!confirm('Убрать подложку с плана?')) return;
removeUnderlay(id); flatUlAdjust = null; renderFlatPlan(); return;
}
const k = { smaller5: 0.95, smaller: 0.99, bigger: 1.01, bigger5: 1.05 }[act];
if (k) { const cx = u.x + u.w / 2, cy = u.y + u.w * u.ar / 2; u.w *= k; u.x = cx - u.w / 2; u.y = cy - u.w * u.ar / 2; }
if (act === 'rotate') u.rot = ((u.rot || 0) + 90) % 360;
if (act === 'lighter') u.op = Math.max(0.12, (u.op || 0.5) - 0.12);
if (act === 'darker') u.op = Math.min(0.9, (u.op || 0.5) + 0.12);
if (act === 'toggle') u.hidden = !u.hidden;
saveUnderlayView(id, u);
renderFlatPlan();
}

// Пальцем — двигаем подложку, двумя — меняем размер (центр на месте).
// Рисунок не перерисовываем — меняем только картинку и рамку, чтобы не дёргалось
function flatBindUnderlay() {
const svg = document.querySelector('#flatWrap svg');
if (!svg) return;
const pts = new Map();
let start = null;
const place = (u) => {
const h = u.w * u.ar, tr = `rotate(${u.rot || 0} ${u.x + u.w / 2} ${u.y + h / 2})`;
['flatUlImg', 'flatUlFrame'].forEach(idn => {
const el = document.getElementById(idn);
if (!el) return;
el.setAttribute('x', u.x); el.setAttribute('y', u.y); el.setAttribute('width', u.w); el.setAttribute('height', h); el.setAttribute('transform', tr);
});
};
const snap = () => ({ u: getUnderlay(flatUlId()), pts: new Map([...pts].map(([k, v]) => [k, { ...v }])) });
svg.addEventListener('pointerdown', e => {
pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
try { svg.setPointerCapture(e.pointerId); } catch (err) { /* пусто */ }
start = snap();
e.preventDefault();
});
svg.addEventListener('pointermove', e => {
if (!pts.has(e.pointerId) || !start || !start.u) return;
pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
const mpp = 1 / (svg.getScreenCTM().a || 1);          // метров на точку экрана
const u = { ...start.u };
if (pts.size === 1 && start.pts.size === 1) {
const p0 = start.pts.get(e.pointerId);
if (!p0) return;
u.x += (e.clientX - p0.x) * mpp; u.y += (e.clientY - p0.y) * mpp;
} else if (pts.size === 2 && start.pts.size === 2) {
const a = [...pts.values()], b = [...start.pts.values()];
const d1 = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), d0 = Math.hypot(b[0].x - b[1].x, b[0].y - b[1].y) || 1;
const cx = u.x + u.w / 2, cy = u.y + u.w * u.ar / 2;
u.w = Math.max(0.5, Math.min(300, start.u.w * d1 / d0));
u.x = cx - u.w / 2; u.y = cy - u.w * u.ar / 2;
} else return;
saveUnderlayView(flatUlId(), u);
place(u);
});
const end = e => { pts.delete(e.pointerId); start = pts.size ? snap() : null; };
svg.addEventListener('pointerup', end);
svg.addEventListener('pointercancel', end);
}

/* ---------- правка плана без нейросети: имя, удаление, двери и проёмы, объединение ---------- */

async function flatRoomRename(roomId) {
const room = objectRooms(flatObj()).find(r => r.id === roomId);
if (!room) return;
const name = prompt('Название помещения:', roomName(room));
if (name == null || !name.trim()) return;
room.measure.room = name.trim().slice(0, 80);
await saveCloudData();
renderFlatPlan();
if (typeof renderInvoice === 'function') renderInvoice();
}

async function flatRoomDelete(roomId) {
await deleteRoom(flatObjectId, roomId);   // спросит подтверждение, уберёт и из счёта
renderFlatPlan();
}

function flatOpsStart() {
flatEdit = null; flatUlAdjust = null; flatScaleMode = false; flatMergeFrom = null;
flatHMode = false;
flatOpsMode = true;
flatOpsDraft = { orig: flatOpsSnap(), undo: [] };
renderFlatPlan();
}

// Точка нажатия — в метрах плана
function flatEventPoint(ev) {
const svg = document.querySelector('#flatWrap svg');
if (!svg || !ev) return null;
const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
const q = p.matrixTransform(svg.getScreenCTM().inverse());
return [q.x, q.y];
}

const FLAT_OP_KINDS = {
door: { label: 'Дверь', type: 'door', w: 800, h: 2000 },
pass: { label: 'Проход без двери', type: 'door', w: 1000, h: 2000, pass: true },
window: { label: 'Окно', type: 'window', w: 1500, h: 1500 },
balcony: { label: 'Балконный блок (окно + дверь)', type: 'balcony', w: 1500, h: 1500 },
};

function flatOpsWall(roomId, i, ev) {
const it = flatItems().find(r => r.id === roomId);
if (!it) return;
const a = it.pts[i], b = it.pts[(i + 1) % it.pts.length];
const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
if (!(len > 0.1)) return;
const pt = flatEventPoint(ev);
const t = pt ? ((pt[0] - a[0]) * (b[0] - a[0]) + (pt[1] - a[1]) * (b[1] - a[1])) / len : len / 2;
openSheet('Что поставить на эту стену?', Object.keys(FLAT_OP_KINDS).map(k => ({ icon: '➕', label: FLAT_OP_KINDS[k].label, onClick: () => flatOpsAdd(roomId, i, t, k) })));
}

// Новый проём на стене i комнаты: по центру — там, куда нажали; дверь — и у соседней комнаты за стеной
async function flatOpsAdd(roomId, i, t, kind) {
const k = FLAT_OP_KINDS[kind];
const raw = prompt(`${k.label}: ширина, мм`, String(k.w));
if (raw == null) return;
let w = mNum(String(raw).replace(/\s/g, ''));
if (!(w > 0)) return;
if (w < 20) w *= 1000;                                     // ввели в метрах
w /= 1000;
const items = flatItems();
const it = items.find(r => r.id === roomId);
const room = flatRooms().find(r => r.id === roomId);
if (!it || !room) return;
const a = it.pts[i], b = it.pts[(i + 1) % it.pts.length];
const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
w = Math.min(w, len);
const off = Math.max(0, Math.min(len - w, t - w / 2));
const make = (wall, o) => ({ type: k.type, w: FLAT_FMT(w), h: FLAT_FMT(k.h / 1000), n: '1', slopes: true, wall, off: FLAT_FMT(o), from: 'start',
...(k.type === 'balcony' ? { dw: '0,7', dh: '2,2', side: 'start' } : {}), ...(k.pass ? { pass: true } : {}) });
flatOpsPush();
room.measure.openings = (room.measure.openings || []).concat(make(i, off));
let both = '';
if (k.type === 'door') {
// та же дверь у соседней комнаты: параллельная стена не дальше 0,7 м, напротив
const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
const s0 = [a[0] + ux * off, a[1] + uy * off], s1 = [a[0] + ux * (off + w), a[1] + uy * (off + w)];
items.forEach(other => {
if (other.id === roomId) return;
const n = other.pts.length;
for (let j = 0; j < n; j++) {
if (!other.closed && j === n - 1) continue;
const p = other.pts[j], q = other.pts[(j + 1) % n];
const l2 = Math.hypot(q[0] - p[0], q[1] - p[1]);
if (l2 < 0.2) continue;
const vx = (q[0] - p[0]) / l2, vy = (q[1] - p[1]) / l2;
if (Math.abs(ux * vy - uy * vx) > 0.02) continue;
const dist = Math.abs((s0[0] - p[0]) * vy - (s0[1] - p[1]) * vx);
if (dist < 0.01 || dist > 0.7) continue;
const t0 = (s0[0] - p[0]) * vx + (s0[1] - p[1]) * vy, t1 = (s1[0] - p[0]) * vx + (s1[1] - p[1]) * vy;
const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(l2, Math.max(t0, t1));
if (hi - lo < 0.2) continue;
const r2 = flatRooms().find(r => r.id === other.id);
if (!r2) continue;
r2.measure.openings = (r2.measure.openings || []).concat({ ...make(j, lo), w: FLAT_FMT(hi - lo) });
both = ` и в «${other.name}»`;
break;
}
});
}
renderFlatPlan();
showAddToast(`${k.label} добавлен${kind === 'window' ? 'о' : kind === 'door' ? 'а' : ''} в «${it.name}»${both}. Не забудьте «Сохранить».`);
}

// Тот же проём у соседней комнаты за стеной (вторая половина двери): [{ room, oi }]
function flatOpPartners(roomId, oi) {
const items = flatItems();
const it = items.find(r => r.id === roomId);
const sg = it && flatOpeningSeg(it, it.openings[oi]);
if (!sg) return [];
const out = [];
items.forEach(other => {
if (other.id === roomId) return;
other.openings.forEach((o, j) => {
if (o.type === 'window') return;
const sb = flatOpeningSeg(other, o);
if (!sb || Math.abs(sg.ux * sb.uy - sg.uy * sb.ux) > 0.02) return;
const dx = sb.x - sg.x, dy = sb.y - sg.y;
const dist = Math.abs(dx * -sg.uy + dy * sg.ux);
if (dist < 0.01 || dist > 0.7) return;
const t1 = dx * sg.ux + dy * sg.uy, t2 = t1 + sb.w * (sg.ux * sb.ux + sg.uy * sb.uy);
if (Math.min(sg.w, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2)) < 0.2) return;
const room = flatRooms().find(r => r.id === other.id);
if (room) out.push({ room, oi: j });
});
});
return out;
}

// Нажали на проём: проход ↔ дверь или убрать — сразу у обеих комнат
function flatOpsRemove(roomId, oi) {
const room = flatRooms().find(r => r.id === roomId);
const o = room && room.measure.openings && room.measure.openings[oi];
if (!o) return;
const what = o.type === 'window' ? 'Окно' : o.type === 'balcony' ? 'Балконный блок' : o.pass ? 'Проход без двери' : 'Дверь';
const both = [{ room, oi }].concat(o.type === 'window' ? [] : flatOpPartners(roomId, oi));
const items = [];
if (o.type === 'door') items.push(o.pass
? { icon: '✏️', label: 'Поставить дверь', onClick: () => flatOpsSetPass(both, false) }
: { icon: '✏️', label: 'Сделать проходом без двери', onClick: () => flatOpsSetPass(both, true) });
items.push({ icon: '↔️', label: 'Изменить ширину', onClick: () => flatOpsWidth(both) });
items.push({ icon: '🗑️', label: both.length > 1 ? 'Убрать (у обеих комнат)' : 'Убрать', danger: true, onClick: () => flatOpsDelete(both) });
openSheet(`${what} ${mFmt(mNum(o.w))} м`, items);
}

// Проём тянем пальцем вдоль его стены; вторая половина двери у соседней комнаты — вместе с ним.
// Короткое нажатие без движения — меню проёма
function flatBindOps() {
const wrap = document.getElementById('flatWrap');
const svg = wrap && wrap.querySelector('svg');
if (!svg) return;
svg.addEventListener('pointerdown', (e) => {
const t = e.target;
if (!t.dataset || t.dataset.op == null) return;
const roomId = t.dataset.opRoom, oi = Number(t.dataset.op);
const it = flatItems().find(r => r.id === roomId);
const room = flatRooms().find(r => r.id === roomId);
const o = room && room.measure.openings[oi];
const sg = it && o && flatOpeningSeg(it, o);
if (!sg) return;
e.preventDefault(); e.stopPropagation();
wrap._drag = true;
const wallLen = flatOpWallLen, startOf = flatOpStart, setStart = flatOpSetStart;
const items = flatItems();
const moving = [{ room, o, len: wallLen(it, o), st0: startOf(o, wallLen(it, o)), k: 1 }];
flatOpPartners(roomId, oi).forEach(({ room: r2, oi: j }) => {
const it2 = items.find(x => x.id === r2.id), o2 = r2.measure.openings[j], s2 = it2 && flatOpeningSeg(it2, o2);
if (!s2) return;
const l2 = wallLen(it2, o2);
moving.push({ room: r2, o: o2, len: l2, st0: startOf(o2, l2), k: sg.ux * s2.ux + sg.uy * s2.uy });   // ±1 — стена в ту же сторону или навстречу
});
const ctm = svg.getScreenCTM().inverse();
const toM = (ev) => { const p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; const q = p.matrixTransform(ctm); return [q.x, q.y]; };
const p0 = toM(e), sx = e.clientX, sy = e.clientY;
let moved = false;
const move = (ev) => {
if (ev.pointerId !== e.pointerId) return;
if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
if (!moved) flatOpsPush();
moved = true;
const p1 = toM(ev);
let d = (p1[0] - p0[0]) * sg.ux + (p1[1] - p0[1]) * sg.uy;     // сдвиг вдоль стены, м
// упёрлась в конец стены любая из половинок — стоят обе, чтобы не разойтись
moving.forEach(m => {
const lo = -m.st0, hi = m.len - mNum(m.o.w) - m.st0;          // допустимый сдвиг этой половинки
const [a1, b1] = m.k > 0 ? [lo / m.k, hi / m.k] : [hi / m.k, lo / m.k];
d = Math.max(Math.min(a1, 0), Math.min(Math.max(b1, 0), d));
});
moving.forEach(m => setStart(m.o, m.len, m.st0 + d * m.k));
renderFlatPlan();
};
const up = async (ev) => {
if (ev.pointerId !== e.pointerId) return;
window.removeEventListener('pointermove', move);
window.removeEventListener('pointerup', up);
wrap._drag = false;
if (!moved) { flatOpsRemove(roomId, oi); return; }
renderFlatPlan();
showAddToast(`Отступ от начала стены: ${mFmt(startOf(o, moving[0].len))} м`);
};
window.addEventListener('pointermove', move);
window.addEventListener('pointerup', up);
});
}

function flatOpsSetPass(list, on) {
flatOpsPush();
list.forEach(({ room, oi }) => { const o = room.measure.openings[oi]; if (on) o.pass = true; else delete o.pass; });
renderFlatPlan();
}

function flatOpsDelete(list) {
flatOpsPush();
// с конца — чтобы номера проёмов в одной комнате не сдвигались
list.slice().sort((x, y) => y.oi - x.oi).forEach(({ room, oi }) => room.measure.openings.splice(oi, 1));
renderFlatPlan();
}

// Длина стены проёма и где он начинается (отступ записан от начала или от конца стены)
function flatOpWallLen(item, op) { const n = item.pts.length, a = item.pts[op.wall], b = item.pts[(op.wall + 1) % n]; return Math.hypot(b[0] - a[0], b[1] - a[1]); }
function flatOpStart(op, len) { const off = mNum(op.off); const w = mNum(op.w); return op.from === 'end' ? len - (isFinite(off) ? off : 0) - w : (isFinite(off) ? off : (len - w) / 2); }
function flatOpSetStart(op, len, st) { const w = mNum(op.w); const v = Math.max(0, Math.min(len - w, st)); op.off = FLAT_FMT(Math.round((op.from === 'end' ? len - v - w : v) * 100) / 100); }

// Новая ширина проёма — середина остаётся на месте; дверь — сразу у обеих комнат
function flatOpsWidth(list) {
const first = list[0].room.measure.openings[list[0].oi];
const raw = prompt('Ширина, мм', String(Math.round(mNum(first.w) * 1000)));
if (raw == null) return;
let w = mNum(String(raw).replace(/\s/g, ''));
if (!(w > 0)) return;
if (w >= 20) w /= 1000;                                    // ввели в миллиметрах
const items = flatItems();
flatOpsPush();
list.forEach(({ room, oi }) => {
const o = room.measure.openings[oi], it = items.find(x => x.id === room.id);
if (!o || !it) return;
const len = flatOpWallLen(it, o), mid = flatOpStart(o, len) + mNum(o.w) / 2;
const nw = Math.min(w, len);
o.w = FLAT_FMT(Math.round(nw * 1000) / 1000);
flatOpSetStart(o, len, mid - nw / 2);
});
renderFlatPlan();
}

// Черновик дверей и проёмов: снимок всех проёмов, шаг назад, отмена, сохранение
function flatOpsSnap() {
return JSON.stringify(flatRooms().map(r => [r.id, r.measure.openings || []]));
}

function flatOpsRestore(snap) {
const rooms = flatRooms();
JSON.parse(snap).forEach(([id, ops]) => { const r = rooms.find(x => x.id === id); if (r) r.measure.openings = ops; });
}

function flatOpsPush() {
if (flatOpsDraft) flatOpsDraft.undo.push(flatOpsSnap());
}

function flatOpsUndo() {
if (!flatOpsDraft || !flatOpsDraft.undo.length) return;
flatOpsRestore(flatOpsDraft.undo.pop());
renderFlatPlan();
}

function flatOpsCancel() {
if (flatOpsDraft && flatOpsDraft.undo.length && !confirm('Отменить все изменения дверей и проёмов?')) return;
if (flatOpsDraft) flatOpsRestore(flatOpsDraft.orig);
flatOpsDraft = null; flatOpsMode = false;
renderFlatPlan();
}

async function flatOpsSave() {
const changed = flatOpsDraft && flatOpsDraft.undo.length;
flatOpsDraft = null; flatOpsMode = false;
if (changed && (await saveCloudData()) !== false) showAddToast('Двери и проёмы сохранены.');
renderFlatPlan();
if (changed && typeof renderInvoice === 'function') renderInvoice();
}

/* ---------- высоты: стены (потолок), окна, двери — всем сразу или по одной ---------- */

function flatHStart() {
flatEdit = null; flatUlAdjust = null; flatScaleMode = false; flatOpsMode = false; flatMergeFrom = null;
flatHMode = true;
renderFlatPlan();
}

// «2,7», «2700» (мм) → «2,7»; пусто → ''; ошибка → null
function flatHParse(raw) {
const t = String(raw == null ? '' : raw).replace(/\s/g, '');
if (!t) return '';
let v = mNum(t);
if (!(v > 0)) return null;
if (v > 20) v /= 1000;                                     // ввели в миллиметрах
return v > 0.1 && v < 20 ? FLAT_FMT(Math.round(v * 1000) / 1000) : null;
}

// Что чаще всего стоит сейчас — подсказка в поле «для всех»
function flatHCommon(list) {
const c = {};
list.filter(v => mNum(v) > 0).forEach(v => { const k = FLAT_FMT(mNum(v)); c[k] = (c[k] || 0) + 1; });
return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || '';
}

function flatHOps(type) {
return flatRooms().flatMap(r => (r.measure.openings || []).filter(o => o.type === type));
}

function flatHTopHtml() {
const rooms = flatRooms();
const f = (id, label, val) => `<label class="flat-h-row"><span>${label}</span><input id="${id}" type="text" inputmode="decimal" value="${escapeHtml(val)}" placeholder="—"></label>`;
const balc = flatHOps('balcony');
return `<div class="flat-tools"><button type="button" class="mp-btn mp-btn-primary" onclick="flatHMode = false; renderFlatPlan()">Готово</button></div>
<div class="flat-h-all">
<div class="flat-h-title">Сразу для всей квартиры, м</div>
${f('flatHWalls', 'Стены (до потолка)', flatHCommon(rooms.map(r => r.measure.height)))}
${f('flatHWin', 'Окна', flatHCommon(flatHOps('window').concat(balc).map(o => o.h)))}
${f('flatHDoor', 'Двери и проходы', flatHCommon(flatHOps('door').map(o => o.h)))}
${balc.length ? f('flatHBalc', 'Дверь балконного блока', flatHCommon(balc.map(o => o.dh))) : ''}
<button type="button" class="measure-open-btn" onclick="flatHApplyAll()">Выставить всем</button>
</div>
<div class="ai-hint"><b>По отдельности</b> — нажмите на плане: на <b>комнату</b> — высота её стен, на <b>стену</b> (жёлтая) — только этой стены, на <b>окно или дверь</b> — их высота. Пустое поле «для всех» не меняет ничего. Красный «?» — высота не задана.</div>`;
}

async function flatHApplyAll() {
const val = id => { const el = document.getElementById(id); return el ? flatHParse(el.value) : ''; };
const v = { walls: val('flatHWalls'), win: val('flatHWin'), door: val('flatHDoor'), balc: val('flatHBalc') };
if (Object.values(v).some(x => x === null)) { alert('Высота — число в метрах (2,7) или в миллиметрах (2700).'); return; }
if (!Object.values(v).some(Boolean)) { alert('Заполните хотя бы одно поле.'); return; }
let n = 0;
flatRooms().forEach(r => {
const m = r.measure;
if (v.walls) { m.height = v.walls; if (Array.isArray(m.wallHeights)) m.wallHeights = m.wallHeights.map(() => ''); n++; }
(m.openings || []).forEach(o => {
if (v.win && (o.type === 'window' || o.type === 'balcony')) { o.h = v.win; n++; }
if (v.door && o.type === 'door') { o.h = v.door; n++; }
if (v.balc && o.type === 'balcony') { o.dh = v.balc; n++; }
});
});
await saveCloudData();
renderFlatPlan();
if (typeof renderInvoice === 'function') renderInvoice();
showAddToast(n ? 'Высоты выставлены всем.' : 'Менять нечего.');
}

function flatHAsk(title, cur) {
const raw = prompt(`${title}, м`, cur || '');
if (raw == null) return undefined;
const v = flatHParse(raw);
if (v === null) { alert('Высота — число в метрах (2,7) или в миллиметрах (2700).'); return undefined; }
return v;
}

async function flatHSave() {
await saveCloudData();
renderFlatPlan();
if (typeof renderInvoice === 'function') renderInvoice();
}

async function flatHRoom(roomId) {
const room = flatRooms().find(r => r.id === roomId);
if (!room) return;
const m = room.measure;
const own = (m.wallHeights || []).some(v => mNum(v) > 0);
const v = flatHAsk(`Высота стен — «${roomName(room)}»${own ? ' (отдельные высоты стен сбросятся)' : ''}`, m.height);
if (v === undefined) return;
m.height = v;
if (Array.isArray(m.wallHeights)) m.wallHeights = m.wallHeights.map(() => '');
await flatHSave();
}

async function flatHWall(roomId, i, ev) {
if (ev) ev.stopPropagation();                              // не открывать заодно всю комнату
const room = flatRooms().find(r => r.id === roomId);
if (!room) return;
const m = room.measure;
const v = flatHAsk(`Высота стены ${i + 1} — «${roomName(room)}» (пусто — как у комнаты${m.height ? ', ' + m.height : ''})`, (m.wallHeights || [])[i] || '');
if (v === undefined) return;
if (!Array.isArray(m.wallHeights)) m.wallHeights = [];
while (m.wallHeights.length < m.walls.length) m.wallHeights.push('');
m.wallHeights[i] = v && v !== FLAT_FMT(mNum(m.height)) ? v : '';
await flatHSave();
}

// Окно или дверь: у двери — и её вторая половина у соседней комнаты
async function flatHOp(roomId, oi) {
const room = flatRooms().find(r => r.id === roomId);
const o = room && (room.measure.openings || [])[oi];
if (!o) return;
const list = [o].concat(o.type === 'window' ? [] : flatOpPartners(roomId, oi).map(p => p.room.measure.openings[p.oi]).filter(x => x.type === o.type));
if (o.type === 'balcony') {
const h = flatHAsk('Балконный блок: высота окна', o.h);
if (h === undefined) return;
const dh = flatHAsk('Балконный блок: высота двери', o.dh);
if (dh === undefined) return;
list.forEach(x => { x.h = h; x.dh = dh; });
} else {
const h = flatHAsk(o.type === 'window' ? 'Высота окна' : o.pass ? 'Высота прохода' : 'Высота двери', o.h);
if (h === undefined) return;
list.forEach(x => { x.h = h; });
}
await flatHSave();
}

// Нажатие на окно или дверь — раньше, чем на комнату под ним
function flatBindHeights() {
const svg = document.querySelector('#flatWrap svg');
if (!svg) return;
svg.addEventListener('click', (e) => {
const t = e.target;
if (!t.dataset || t.dataset.op == null) return;
e.stopPropagation();
flatHOp(t.dataset.opRoom, Number(t.dataset.op));
}, true);
}

// Подписи высот на плане: под площадью — стены комнаты, у проёмов и отдельных стен — их высота
function flatHeightLabels(r, lx, y, size, fs) {
const q = v => (mNum(v) > 0 ? FLAT_FMT(mNum(v)) : '?');
const col = v => (v === '?' ? '#c2361f' : '#1f5fa8');
const hv = q(r.h);
let out = `<text x="${lx}" y="${y}" font-size="${size}" text-anchor="middle" font-family="Arial, sans-serif" fill="${col(hv)}" font-weight="700" pointer-events="none">↕ ${hv}${hv === '?' ? '' : ' м'}</text>`;
const n = r.pts.length, t = fs * 0.62;
const at = (x, y2, txt, c) => `<text x="${x}" y="${y2 + t * 0.35}" font-size="${t}" text-anchor="middle" font-family="Arial, sans-serif" fill="${c}" font-weight="700" pointer-events="none">${txt}</text>`;
r.pts.forEach((a, i) => {
const own = mNum(r.wh[i]);
if (!(own > 0) || (!r.closed && i === n - 1)) return;
const b = r.pts[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
if (!len) return;
const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
out += at((a[0] + b[0]) / 2 + nx * fs * 1.1 + (b[0] - a[0]) / len * fs * 1.5, (a[1] + b[1]) / 2 + ny * fs * 1.1 + (b[1] - a[1]) / len * fs * 1.5, '↕' + FLAT_FMT(own), '#7a4fb0');
});
r.openings.forEach(o => {
const sg = flatOpeningSeg(r, o);
if (!sg) return;
const txt = o.type === 'balcony' ? `${q(o.h)}/${q(o.dh)}` : q(o.h);
out += at(sg.x + sg.ux * sg.w / 2 - sg.uy * fs * 0.95, sg.y + sg.uy * sg.w / 2 + sg.ux * fs * 0.95, txt, txt.includes('?') ? '#c2361f' : o.type === 'door' ? '#7a4f22' : o.type === 'balcony' ? '#2a7a48' : '#2a6db0');
});
return out;
}

function flatMergeTap(roomId) {
const a = flatMergeFrom;
if (!a || roomId === a) return;
flatMergeRooms(a, roomId);
}

// Объединение двух помещений со стенами вдоль осей: клетки по всем координатам углов,
// клетки любой из комнат + стена между ними (до 0,7 м) → общий контур по часовой.
// Нельзя (косые стены, не соседи, получится с дыркой) — null
function flatUnion(A, B, gap = 0.7) {
const mm = p => [Math.round(p[0] * 1000), Math.round(p[1] * 1000)];
const a = A.map(mm), b = B.map(mm);
const axisOnly = (p) => p.every((q, i) => { const r = p[(i + 1) % p.length]; return q[0] === r[0] || q[1] === r[1]; });
if (!axisOnly(a) || !axisOnly(b)) return null;
const xs = [...new Set(a.concat(b).map(p => p[0]))].sort((u, v) => u - v);
const ys = [...new Set(a.concat(b).map(p => p[1]))].sort((u, v) => u - v);
const inside = (poly, x, y) => {
let c = false;
for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
const [xi, yi] = poly[i], [xj, yj] = poly[j];
if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
}
return c;
};
const nx = xs.length - 1, ny = ys.length - 1;
const cell = [];
for (let j = 0; j < ny; j++) {
cell.push([]);
for (let i = 0; i < nx; i++) {
const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
cell[j].push(inside(a, cx, cy) ? 1 : inside(b, cx, cy) ? 2 : 0);
}
}
const G = gap * 1000;
// стена между комнатами: пустые клетки между клеткой одной комнаты и клеткой другой
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
if (cell[j][i] !== 1 && cell[j][i] !== 2) continue;
const other = 3 - cell[j][i];
for (let k = i + 1; k < nx && xs[k] - xs[i + 1] <= G; k++) {
if (cell[j][k] === other) { for (let m = i + 1; m < k; m++) if (!cell[j][m]) cell[j][m] = 3; break; }
if (cell[j][k]) break;
}
for (let k = j + 1; k < ny && ys[k] - ys[j + 1] <= G; k++) {
if (cell[k][i] === other) { for (let m = j + 1; m < k; m++) if (!cell[m][i]) cell[m][i] = 3; break; }
if (cell[k][i]) break;
}
}
if (!cell.some(row => row.includes(3))) return null;              // не соседи
const on = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && cell[j][i] > 0;
// края области — по часовой (y вниз: внутри справа от направления)
const edges = new Map();
let total = 0;
const add = (p, q) => { edges.set(p.join(','), q); total++; };
for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
if (!on(i, j)) continue;
if (!on(i, j - 1)) add([xs[i], ys[j]], [xs[i + 1], ys[j]]);
if (!on(i + 1, j)) add([xs[i + 1], ys[j]], [xs[i + 1], ys[j + 1]]);
if (!on(i, j + 1)) add([xs[i + 1], ys[j + 1]], [xs[i], ys[j + 1]]);
if (!on(i - 1, j)) add([xs[i], ys[j + 1]], [xs[i], ys[j]]);
}
if (edges.size !== total) return null;                            // касание углами — не одна область
const start = edges.keys().next().value.split(',').map(Number);
const pts = [start];
let cur = edges.get(start.join(',')), steps = 1;
while (cur && cur.join(',') !== start.join(',') && steps <= total) { pts.push(cur); cur = edges.get(cur.join(',')); steps++; }
if (steps !== total) return null;                                 // дырка или несколько кусков
// углы без изломов убираем
const out = pts.filter((p, i) => {
const q = pts[(i - 1 + pts.length) % pts.length], r = pts[(i + 1) % pts.length];
return !((q[0] === p[0] && p[0] === r[0]) || (q[1] === p[1] && p[1] === r[1]));
});
return out.length >= 4 ? out : null;
}

async function flatMergeRooms(aId, bId) {
const obj = flatObj();
const ra = flatRooms().find(r => r.id === aId), rb = flatRooms().find(r => r.id === bId);
const items = flatItems();
const ia = items.find(r => r.id === aId), ib = items.find(r => r.id === bId);
if (!ra || !rb || !ia || !ib) return;
if (!ia.closed || !ib.closed) { alert('Сначала замкните контуры обеих комнат.'); return; }
const pts = flatUnion(ia.pts, ib.pts);
if (!pts) { alert('Не получилось объединить: комнаты должны быть соседними (через одну стену) и со стенами только вдоль осей.'); return; }
if (!confirm(`Объединить «${ia.name}» и «${ib.name}» в одно помещение «${ia.name}»? Замер «${ib.name}» удалится, двери между ними — тоже.`)) return;
// проёмы обеих комнат, которые остаются на краях нового контура
const edgeDist = (p) => Math.min(...pts.map((q, i) => {
const r = pts[(i + 1) % pts.length], qx = q[0] / 1000, qy = q[1] / 1000, rx = r[0] / 1000, ry = r[1] / 1000;
const l = Math.hypot(rx - qx, ry - qy) || 1, t = Math.max(0, Math.min(l, ((p[0] - qx) * (rx - qx) + (p[1] - qy) * (ry - qy)) / l));
return Math.hypot(p[0] - (qx + (rx - qx) * t / l), p[1] - (qy + (ry - qy) * t / l));
}));
const ops = [];
[ia, ib].forEach(it => it.openings.forEach(o => {
const sg = flatOpeningSeg(it, o);
if (!sg) return;
const end = [sg.x + sg.ux * sg.w, sg.y + sg.uy * sg.w];
if (edgeDist([(sg.x + end[0]) / 2, (sg.y + end[1]) / 2]) > 0.05) return;   // была в стене между ними
ops.push({ type: o.type, at: [[sg.x, sg.y], end].map(p => p.map(v => Math.round(v * 1000))), width_m: sg.w,
height_m: mNum(o.h) || null, door_width_m: mNum(o.dw) || null, door_height_m: mNum(o.dh) || null, ...(o.pass ? { pass: true } : {}) });
}));
const conv = flatPtsToMeasure({ name: ia.name, height_m: mNum(ra.measure.height) || null, pts, openings: ops }, obj.id);
ra.measure = { ...conv.measure, id: ra.measure.id, objectId: ra.measure.objectId };
ra.plan = conv.plan;
flatMergeFrom = null;
await removeObjectRooms(obj, [bId]);                              // сохранит и уберёт из счёта
renderFlatPlan();
showAddToast(`Объединено: «${ia.name}»`);
}

/* ---------- масштаб всего плана по одной стене ---------- */
// Распознали план без подписанных размеров (масштаб примерный) или масштаб чертежа
// не тот: мастер вводит настоящую длину одной стены — весь план пересчитывается в том же
// соотношении: стены, проёмы, места помещений и подложка. Дальше правится по одной стене

function flatScaleStart() {
flatEdit = null; flatUlAdjust = null; flatOpsMode = false; flatMergeFrom = null; flatHMode = false;
flatScaleMode = true;
renderFlatPlan();
}

function flatScaleWall(roomId, i) {
const it = flatItems().find(r => r.id === roomId);
if (!it) return;
const a = it.pts[i], b = it.pts[(i + 1) % it.pts.length];
const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
if (!(len > 0.01)) return;
const raw = prompt(`«${it.name}»: длина этой стены по плану — ${Math.round(len * 1000)} мм.\nСколько она на самом деле (мм)?`, String(Math.round(len * 1000)));
if (raw == null) return;
let v = mNum(String(raw).replace(/\s/g, ''));
if (!(v > 0)) { alert('Введите длину числом, например 3200.'); return; }
if (v < 100) v *= 1000;                                   // ввели в метрах
const k = v / 1000 / len;
if (Math.abs(k - 1) < 0.0005) { flatScaleMode = false; renderFlatPlan(); return; }
if (!confirm(`Пересчитать весь план в ${String(Math.round(k * 1000) / 1000).replace('.', ',')} раза? Изменятся длины стен, проёмы и места всех помещений на плане, высоты — нет.`)) return;
flatScaleAll(k);
}

async function flatScaleAll(k) {
const sc = v => { const n = mNum(v); return isFinite(n) && n > 0 ? FLAT_FMT(n * k) : v; };
flatRooms().forEach(room => {
const m = room.measure;
m.walls = (m.walls || []).map(sc);
(m.openings || []).forEach(o => ['w', 'off', 'dw'].forEach(f => { if (o[f] !== undefined && o[f] !== '') o[f] = sc(o[f]); }));
room.plan = { x: Math.round(room.plan.x * k * 1000) / 1000, y: Math.round(room.plan.y * k * 1000) / 1000 };
});
const u = getUnderlay(flatUlId());
if (u) { u.x *= k; u.y *= k; u.w *= k; saveUnderlayView(flatUlId(), u); }
flatScaleMode = false;
await saveCloudData();
renderFlatPlan();
if (typeof renderInvoice === 'function') renderInvoice();
showAddToast('Масштаб плана изменён — проверьте размеры');
}

function flatEditStart() {
flatScaleMode = false; flatOpsMode = false; flatMergeFrom = null; flatHMode = false;
flatUlAdjust = null;
const items = flatItems();
const all = items.flatMap(r => r.pts);
if (!all.length) return;
const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
// запас по краям — чтобы было куда тянуть
const pad = Math.max(1, (Math.max(...xs) - Math.min(...xs)) * 0.15);
const view = flatViewOf(items, pad);                        // вместе с подложкой
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
if (!kind || (wrap._pz && wrap._pz.size)) return;          // пустое место или второй палец — двигаем/приближаем план
e.preventDefault();
wrap._drag = true;
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
if (ev.pointerId !== e.pointerId) return;
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
const up = (ev) => {
if (ev.pointerId !== e.pointerId) return;
wrap._drag = false;
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
holder.innerHTML = flatSvg(flatItems(), { view: flatEdit.view, sel: flatEdit.sel, underlay: flatUlOpt() });
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
