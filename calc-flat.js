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
// приближено больше чем в 2 раза — ручки и подписи не растут дальше, иначе закрывают чертёж
const zk = Math.min(1, 2 / (opt.zoom || 1));
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
return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${opt.sel === r.id ? '#ffe7a3' : '#fff4d1'}" stroke-width="${fs * 0.34 * zk}"/>`
+ `<path d="M${x1 - jx} ${y1 - jy}L${x1 + jx} ${y1 + jy}M${x2 - jx} ${y2 - jy}L${x2 + jx} ${y2 + jy}" stroke="#14181f" stroke-width="${fs * 0.12}"/>`;
}
return `<line x1="${x1}" y1="${y1}" x2="${x1 + ux * ow}" y2="${y1 + uy * ow}" stroke="${col}" stroke-width="${fs * 0.5 * zk}"/>`;
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
rf *= zk;
const tap = opt.onTap ? ` onclick="${opt.onTap}('${r.id}')" style="cursor:pointer"` : '';
return `<g class="flat-room${sel ? ' sel' : ''}"${tap}>
<path d="${d}" data-room="${r.id}" fill="${sel ? '#ffe7a3' : r.closed ? '#fff4d1' : '#fde3dc'}"${ul ? ' fill-opacity="0.35"' : ''} stroke="#14181f" stroke-width="${fs * 0.22 * zk}" stroke-linejoin="miter"/>
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
const n = s.pts.length, hr = fs * 0.55 * zk, hf = fs * zk;
for (let i = 0; i < n; i++) {
const a = s.pts[i], b = s.pts[(i + 1) % n];
const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
// подпись длины — внутрь комнаты (обход по часовой: внутрь — направо от стены)
const nx = len ? -(b[1] - a[1]) / len : 0, ny = len ? (b[0] - a[0]) / len : 0;
// длина — только если подпись помещается вдоль стены (у коротких стенок ниш и колонн — нет)
if (len >= hf * 2.6) handles += `<text x="${mx + nx * hf * 1.6}" y="${my + ny * hf * 1.6 + hf * 0.35}" font-size="${hf * 0.8}" text-anchor="middle" font-family="Arial, sans-serif" fill="#c2361f" font-weight="700" pointer-events="none">${FLAT_FMT(len)}</text>`;
handles += `<rect data-w="${i}" x="${mx - hr * 0.8}" y="${my - hr * 0.8}" width="${hr * 1.6}" height="${hr * 1.6}" fill="#ffffff" stroke="#c2361f" stroke-width="${hf * 0.12}"/>`;
}
s.pts.forEach((p, i) => { handles += `<circle data-v="${i}" cx="${p[0]}" cy="${p[1]}" r="${hr}" fill="#ffcf3d" stroke="#14181f" stroke-width="${hf * 0.12}"/>`; });
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
if (flatEdit && flatEdit.extra[r.id]) it.openings = flatEdit.extra[r.id].openings;   // углов стало больше — проёмы на новых номерах стен
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
${getUnderlay(flatUlId()) ? '<button type="button" class="mp-head-btn" onclick="flatOpsFitUnderlay()">По подложке</button>' : ''}
<button type="button" class="mp-head-btn" onclick="flatOpsCancel()">Отмена</button>
<button type="button" class="mp-btn mp-btn-primary" onclick="flatOpsSave()">Сохранить</button>
</div>
<div class="ai-hint"><b>Двери и проёмы.</b> Нажмите на стену (выделены жёлтым) — добавите дверь, проход, окно или балконный блок в это место. Проём можно <b>тянуть пальцем вдоль стены</b>${getUnderlay(flatUlId()) ? ' («По подложке» — все сразу встанут на разрывы в стенах чертежа)' : ''}, а нажатием — поменять ширину, сделать из двери проход без двери (и обратно) или убрать. В облако — только по «Сохранить». Дверь между комнатами — сразу у обеих.</div>`
: flatMergeFrom
? `<div class="flat-tools"><button type="button" class="mp-head-btn" onclick="flatMergeFrom = null; renderFlatPlan()">Отмена</button></div>
<div class="ai-hint"><b>Объединить.</b> Нажмите на соседнюю комнату — она станет частью «${escapeHtml(roomName(objectRooms(flatObj()).find(r => r.id === flatMergeFrom) || {}))}» вместе со стеной между ними.</div>`
: flatScaleMode
? `<div class="flat-tools"><button type="button" class="mp-head-btn" onclick="flatScaleMode = false; renderFlatPlan()">Отмена</button></div>
<div class="ai-hint"><b>Масштаб по стене.</b> Нажмите на стену (выделены жёлтым), длину которой знаете точно, и введите её. Весь план — все помещения, проёмы и подложка — пересчитается в том же соотношении.</div>`
: ed
? `<div class="flat-tools">
<button type="button" class="mp-head-btn" onclick="flatUndo()" ${ed.undo.length ? '' : 'disabled'}>↶ Шаг назад</button>
${ed.pick ? '<button type="button" class="mp-head-btn on" onclick="flatWallPickStart()">Нажмите на стену… ✕</button>' : '<button type="button" class="mp-head-btn" onclick="flatEditMore()">Подгонка ▾</button>'}
<button type="button" class="mp-head-btn" onclick="flatEditCancel()">Отмена</button>
<button type="button" class="mp-btn mp-btn-primary" onclick="flatEditSave()">Сохранить</button>
</div>
<div class="ai-hint">${ed.pick ? '<b>Нажмите на перегородку на чертеже</b> (на её линию или штриховку) — сайт запомнит, как стены нарисованы в этом проекте.' : ed.sel ? 'Тяните <b>угол</b> (кружок) или <b>стену</b> (квадратик), внутри комнаты — двигается вся комната. Нажмите на квадратик — длина, сдвиг, колонна или ниша; на кружок — колонна в углу. «Подгонка» — по соседям и по чертежу.' : 'Нажмите на комнату, чтобы её править. «Подгонка» — по соседям и по чертежу.'}</div>`
: `<div class="ai-hint">Нажмите на помещение — откроется его замер. После правки план обновится.${rest ? ` Помещений без места на плане: ${rest} (добавлены вручную).` : ''}</div>
${isCurrentClient() || flatUlAdjust ? '' : '<div class="flat-main-btns"><button type="button" class="measure-open-btn" onclick="flatEditStart()">Править на плане</button><button type="button" class="measure-open-btn" onclick="flatOpsStart()">Двери и проёмы</button><button type="button" class="measure-open-btn" onclick="flatMainMore()">Ещё ▾</button></div>' + flatHistBtnHtml()}`;
const oldWrap = document.getElementById('flatWrap');
const scroll = oldWrap ? [oldWrap.scrollLeft, oldWrap.scrollTop] : null;
body.innerHTML = `<div class="mp-body-inner">
${top}
<div class="flat-zoom"><button type="button" class="mp-head-btn" onclick="flatSetZoom(-1)" aria-label="Мельче">−</button><span>Площадь: <b>${(Math.round(total * 10) / 10).toLocaleString('ru-RU')} м²</b></span><button type="button" class="mp-head-btn" onclick="flatSetZoom(1)" aria-label="Крупнее">+</button></div>
<div class="flat-viewbox"><div class="flat-wrap flat-view${ed || flatUlAdjust ? ' editing' : ''}" id="flatWrap"><div>${flatSvg(items, { zoom: flatZoom, ...(ed ? { view: ed.view, sel: ed.sel, underlay: flatUlOpt() } : flatUlAdjust ? { view: flatUlAdjust.view, underlay: flatUlOpt() } : flatScaleMode ? { pickWalls: true, underlay: flatUlOpt(), view: flatViewOf(items) }
: flatHMode ? { pickWalls: 'flatHWall', pickOps: true, onTap: 'flatHRoom', heights: true, underlay: flatUlOpt(), view: flatViewOf(items) }
: flatOpsMode ? { pickWalls: 'flatOpsWall', pickOps: 'flatOpsRemove', underlay: flatUlOpt(), view: flatViewOf(items) }
: { onTap: flatMergeFrom ? 'flatMergeTap' : 'flatOpenRoom', sel: flatMergeFrom || undefined, underlay: flatUlOpt(), view: flatViewOf(items) }) })}</div></div>
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

// Рисунок в окне: при масштабе 1 — весь целиком, дальше — крупнее (до 30 раз — подгонять по чертежу до сантиметра)
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

// После приближения — перерисовать (ручки и подписи — под новый масштаб), когда пальцы отпущены
let flatZoomTimer = null;
function flatZoomRedraw() {
clearTimeout(flatZoomTimer);
flatZoomTimer = setTimeout(() => {
const wrap = document.getElementById('flatWrap');
if (!wrap) return;
if ((wrap._pz && wrap._pz.size) || wrap._drag) { flatZoomRedraw(); return; }
if (flatEdit) flatRedrawSvg(); else if (!flatUlAdjust) renderFlatPlan();
}, 250);
}

// Масштаб с сохранением точки под (cx, cy) — координаты внутри окна
function flatZoomAt(z, cx, cy) {
const wrap = document.getElementById('flatWrap');
const inner = wrap && wrap.firstElementChild;
if (!inner) return;
z = Math.max(1, Math.min(30, z));
const ow = inner.offsetWidth || 1, ol = inner.offsetLeft, ot = inner.offsetTop;
const fx = (wrap.scrollLeft + cx - ol) / ow, fy = (wrap.scrollTop + cy - ot) / (inner.offsetHeight || 1);
flatZoom = z;
flatSizeInner();
flatZoomRedraw();
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

/* ---------- отмена сохранённого: как было до последних сохранений на плане ---------- */
// Перед каждым сохранением с плана — снимок всех помещений объекта (до 5 последних, в этом браузере)
const FLAT_HIST_MAX = 5;
function flatHistKey() { return 'flatHist_' + flatObjectId; }
function flatHistList() {
try { const v = JSON.parse(localStorage.getItem(flatHistKey()) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function flatHistSave(list) {
for (let l = list.slice(-FLAT_HIST_MAX); l.length; l.shift()) {
try { localStorage.setItem(flatHistKey(), JSON.stringify(l)); return; } catch (e) { /* мало места — храним меньше */ }
}
try { localStorage.removeItem(flatHistKey()); } catch (e) { /* пусто */ }
}
function flatHistSnap() { return JSON.stringify(objectRooms(flatObj())); }
function flatHistPush(label, rooms) {
if (!flatObjectId || !rooms) return;
const list = flatHistList();
list.push({ label, at: Date.now(), rooms });
flatHistSave(list);
}
function flatHistMark(label) { try { flatHistPush(label, flatHistSnap()); } catch (e) { /* без снимка — сохранение всё равно идёт */ } }
function flatHistDrop() { const list = flatHistList(); list.pop(); flatHistSave(list); }

function flatHistBtnHtml() {
const last = flatHistList().slice(-1)[0];
if (!last) return '';
const t = new Date(last.at);
const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
return `<button type="button" class="measure-open-btn" onclick="flatHistUndo()">↶ Отменить сохранённое: ${escapeHtml(last.label)} (${hm})</button>`;
}

async function flatHistUndo() {
const list = flatHistList();
const last = list[list.length - 1];
const obj = flatObj();
if (!last || !obj) return;
if (!confirm(`Вернуть все помещения как было до «${last.label}»? Правки в замерах этих помещений, сделанные после, тоже откатятся.`)) return;
let rooms;
try { rooms = JSON.parse(last.rooms); } catch (e) { alert('Не получилось прочитать сохранённое.'); return; }
obj.rooms = rooms;
list.pop();
flatHistSave(list);
if (typeof syncCartWithRooms === 'function') syncCartWithRooms();
if (typeof renderInvoice === 'function') renderInvoice();
if (typeof currentObjectId !== 'undefined' && currentObjectId === flatObjectId && typeof renderObjectDetail === 'function') renderObjectDetail();
renderFlatPlan();
if ((await saveCloudData()) !== false) showAddToast('Вернул как было. Ещё раньше — нажмите кнопку отмены ещё раз');
}

/* ---------- правка плана без нейросети: имя, удаление, двери и проёмы, объединение ---------- */

async function flatRoomRename(roomId) {
const room = objectRooms(flatObj()).find(r => r.id === roomId);
if (!room) return;
const name = prompt('Название помещения:', roomName(room));
if (name == null || !name.trim()) return;
flatHistMark('Переименование');
room.measure.room = name.trim().slice(0, 80);
await saveCloudData();
renderFlatPlan();
if (typeof renderInvoice === 'function') renderInvoice();
}

async function flatRoomDelete(roomId) {
flatHistMark('Удаление помещения');
await deleteRoom(flatObjectId, roomId);   // спросит подтверждение, уберёт и из счёта
if (objectRooms(flatObj()).some(r => r.id === roomId)) flatHistDrop();   // передумали
renderFlatPlan();
}

function flatOpsStart() {
flatEdit = null; flatUlAdjust = null; flatScaleMode = false; flatMergeFrom = null;
flatHMode = false;
flatOpsMode = true;
let full = null;
try { full = flatHistSnap(); } catch (e) { full = null; }
flatOpsDraft = { orig: flatOpsSnap(), undo: [], full };
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
if (changed) flatHistPush('Двери и проёмы', flatOpsDraft.full);
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
flatHistMark('Высоты всем');
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
flatHistMark('Высота стен');
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
flatHistMark('Высота стены');
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
flatHistMark('Высота проёма');
list.forEach(x => { x.h = h; x.dh = dh; });
} else {
const h = flatHAsk(o.type === 'window' ? 'Высота окна' : o.pass ? 'Высота прохода' : 'Высота двери', o.h);
if (h === undefined) return;
flatHistMark('Высота проёма');
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
flatHistMark('Объединение помещений');
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
flatHistMark('Масштаб по стене');
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
flatEdit = { sel: null, draft: {}, extra: {}, undo: [], view };
renderFlatPlan();
}

function flatEditCancel() {
if (Object.keys(flatEdit.draft).length && !confirm('Отменить все правки на плане?')) return;
flatEdit = null;
renderFlatPlan();
}

function flatUndo() {
if (!flatEdit || !flatEdit.undo.length) return;
const u = flatEdit.undo.pop();
flatEdit.draft = u.d; flatEdit.extra = u.x;
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

// Края комнат — к стенам чертежа на подложке: у каждой стены рядом (до 30 см) ищем линию,
// где внутри светло (пол), а снаружи — серая или чёрная стена (как после распознавания).
// Выделена комната — только она, иначе все. Только черновик: проверить и «Сохранить»
let flatUlGray = null;   // { src, gray } — яркости картинки подложки, чтобы не читать заново

// Подложка и её яркости + перевод метров плана ↔ точек картинки (подложка — прямоугольник
// x, y, w × w·ar, повёрнутый вокруг центра). Нет подложки или не читается — null
async function flatUlMapping() {
const u = getUnderlay(flatUlId());
if (!u || typeof pgLoadGray !== 'function') return null;
if (!flatUlGray || flatUlGray.src !== u.src) {
try { flatUlGray = { src: u.src, gray: await pgLoadGray(u.src) }; }
catch (e) { alert('Не удалось прочитать подложку.'); return null; }
}
const gray = flatUlGray.gray;
const uh = u.w * u.ar, cx = u.x + u.w / 2, cy = u.y + uh / 2;
const a = (u.rot || 0) * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
const toPx = ([x, y]) => {
const dx = x - cx, dy = y - cy;
const rx = cx + dx * cs + dy * sn, ry = cy - dx * sn + dy * cs;
return [(rx - u.x) / u.w * gray.w, (ry - u.y) / uh * gray.h];
};
const toM = ([px, py]) => {
const rx = u.x + px / gray.w * u.w - cx, ry = u.y + py / gray.h * uh - cy;
return [cx + rx * cs - ry * sn, cy + rx * sn + ry * cs];
};
return { u, gray, toPx, toM, ppm: gray.w / u.w };
}

async function flatSnapUnderlay() {
if (!flatEdit || typeof pgSnapRoom !== 'function') return;
const mp = await flatUlMapping();
if (!mp) return;
const { u, gray, toPx, toM } = mp;
const R = Math.max(4, Math.round(0.3 * gray.w / u.w));
const items = flatItems().filter(r => r.closed && (!flatEdit.sel || r.id === flatEdit.sel));
const out = {};
let sides = 0, skipped = 0;
items.forEach(r => {
const px = r.pts.map(toPx);
const kinds = pgAxes(px);
if (!kinds) { skipped++; return; }
const openings = r.openings.map(o => { const sg = flatOpeningSeg(r, o); return sg ? { px: [toPx([sg.x, sg.y]), toPx([sg.x + sg.ux * sg.w, sg.y + sg.uy * sg.w])] } : null; }).filter(Boolean);
const res = pgSnapRoom(px, kinds, gray, openings, R);
const pts = res.px.map(p => toM(p).map(v => Math.round(v * 1000) / 1000));
const moved = r.pts.reduce((k, p, i) => k + (Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]) >= 0.003 ? 1 : 0), 0);
if (moved) { out[r.id] = pts; sides += moved; }
});
if (!Object.keys(out).length) { showAddToast(skipped ? 'Не прилепилось: у комнат косые стены' : 'Края уже на стенах чертежа — менять нечего'); return; }
flatPushUndo();
Object.assign(flatEdit.draft, out);
renderFlatPlan();
showAddToast(`Прилеплено к чертежу помещений: ${Object.keys(out).length}. Проверьте (лишнее — «Шаг назад») и нажмите «Сохранить»`);
}

// «Обвести по чертежу»: форма выделенной комнаты — по стенам на подложке, с нишами и выступами.
// Толстое тёмное — стены и колонны (тонкие линии — размеры, текст, мебель — убираем), от центра
// комнаты заливаем светлый пол — не дальше 40 см за нынешний контур и не через её двери и окна.
// Края заливки — в прямые стены; ступеньки меньше 6 см — шум. Только черновик
// Стены чертежа: тёмное толще ~5 см (тонкие линии — размеры, текст, рамы окон — убраны),
// красные перегородки и всё, что похоже на показанные образцы («Показать стену»).
// Считаем на всю подложку один раз и храним рядом с яркостями
function flatUlMorph(W, H) {
const pass = (src, keep, rr, horiz) => {
const out = new Uint8Array(W * H);
const L = horiz ? W : H, M = horiz ? H : W;
for (let q = 0; q < M; q++) {
let cnt = 0;
const at = i => (horiz ? q * W + i : i * W + q);
for (let i = 0; i < Math.min(L, rr); i++) cnt += src[at(i)];
for (let i = 0; i < L; i++) {
if (i + rr < L) cnt += src[at(i + rr)];
if (i - rr - 1 >= 0) cnt -= src[at(i - rr - 1)];
const span = Math.min(L - 1, i + rr) - Math.max(0, i - rr) + 1;
out[at(i)] = keep ? (cnt === span ? 1 : 0) : (cnt > 0 ? 1 : 0);
}
}
return out;
};
const dil = (x, rr) => pass(pass(x, 0, rr, true), 0, rr, false), ero = (x, rr) => pass(pass(x, 1, rr, true), 1, rr, false);
// куски маски длиной от minLen точек или примыкающие к стенам touch (короткий выступ от стены);
// короткие отдельные пятна посреди комнаты — надписи, номера — не стены
const keepLong = (x, minLen, into, touch) => {
const seen = new Uint8Array(W * H);
for (let s0 = 0; s0 < W * H; s0++) {
if (!x[s0] || seen[s0]) continue;
const comp = [s0], st = [s0];
seen[s0] = 1;
let xa = W, xb = 0, ya = H, yb = 0, near = false;
while (st.length) {
const i = st.pop(), px = i % W, py = (i - px) / W;
if (touch && !near && ((px > 1 && touch[i - 2]) || (px < W - 2 && touch[i + 2]) || (py > 1 && touch[i - 2 * W]) || (py < H - 2 && touch[i + 2 * W]))) near = true;
if (px < xa) xa = px; if (px > xb) xb = px; if (py < ya) ya = py; if (py > yb) yb = py;
if (px > 0 && x[i - 1] && !seen[i - 1]) { seen[i - 1] = 1; st.push(i - 1); comp.push(i - 1); }
if (px < W - 1 && x[i + 1] && !seen[i + 1]) { seen[i + 1] = 1; st.push(i + 1); comp.push(i + 1); }
if (py > 0 && x[i - W] && !seen[i - W]) { seen[i - W] = 1; st.push(i - W); comp.push(i - W); }
if (py < H - 1 && x[i + W] && !seen[i + W]) { seen[i + W] = 1; st.push(i + W); comp.push(i + W); }
}
if (near || Math.max(xb - xa, yb - ya) >= minLen) comp.forEach(i => { into[i] = 1; });
}
};
return { dil, ero, keepLong };
}

function flatUlWalls(mp) {
const g = flatUlGray;
if (g.walls) return g.walls;
const { gray, ppm } = mp, W = gray.w, H = gray.h;
const { dil, ero, keepLong } = flatUlMorph(W, H);
const k = Math.max(1, Math.round(0.025 * ppm));
let m = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) m[i] = gray.g[i] < 200 ? 1 : 0;
m = dil(ero(m, k), k);
// новые перегородки на чертежах перепланировки — красный контур (часто со штриховкой): закрыть
// промежуток между линиями контура (до ~16 см), убрать одиночные тонкие линии и короткие пятна
const base = m.slice();                                     // толстые тёмные стены — к ним примыкают короткие выступы
if (gray.red) keepLong(dil(ero(ero(dil(gray.red, Math.round(0.08 * ppm)), Math.round(0.08 * ppm)), k), k), 0.4 * ppm, m, base);
// образцы, показанные на этом чертеже: такой же цвет — стена (контур, штриховка, заливка)
flatWallSamples().forEach(sm => {
if (!gray.rgba) return;
const d = gray.rgba, [cr, cg, cb] = sm.c;
const x = new Uint8Array(W * H);
for (let i = 0, j = 0; i < W * H; i++, j += 4) {
const dr = d[j] - cr, dg = d[j + 1] - cg, db = d[j + 2] - cb;
x[i] = dr * dr + dg * dg + db * db < 4900 ? 1 : 0;      // цвет ближе 70
}
const rc = Math.max(1, Math.round(sm.r * ppm));
keepLong(dil(ero(ero(dil(x, rc), rc), k), k), 0.4 * ppm, m, base);
});
g.walls = m;
return m;
}

// Образцы стен этого чертежа (цвет и половина толщины, м) — в этом браузере, по подложке
function flatWallSamplesKey() { return 'flatWallSamples_' + flatUlId(); }
function flatWallSamples() {
try { const v = JSON.parse(localStorage.getItem(flatWallSamplesKey()) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function flatWallSamplesSet(list) {
try { localStorage.setItem(flatWallSamplesKey(), JSON.stringify(list)); } catch (e) { /* пусто */ }
if (flatUlGray) delete flatUlGray.walls;                       // пересчитать стены
}

// Меню «Подгонка» в правке и «Ещё» на плане — чтобы не было стены из кнопок
function flatEditMore() {
if (!flatEdit) return;
const ul = !!getUnderlay(flatUlId()), n = flatWallSamples().length, sel = flatEdit.sel;
openSheet('Подгонка', [
{ icon: '🧲', label: 'Подогнать стены и двери (по соседям)', onClick: () => flatFit() },
...(ul ? [
{ icon: '📐', label: sel ? 'Прилепить эту комнату к чертежу' : 'Прилепить все комнаты к чертежу', onClick: () => flatSnapUnderlay() },
...(sel ? [{ icon: '✏️', label: 'Обвести эту комнату по чертежу (ниши, выступы)', onClick: () => flatTraceUnderlay() }] : []),
null,
{ icon: '👆', label: 'Показать стену на чертеже', onClick: () => flatWallPickStart() },
...(n ? [{ icon: '🧹', label: `Забыть образцы стен (${n})`, onClick: () => flatWallSamplesClear() }] : []),
] : []),
]);
}

function flatMainMore() {
openSheet('План квартиры', [
{ icon: '🧲', label: 'Подогнать стены и двери', onClick: () => { flatEditStart(); flatFit(); } },
{ icon: '📏', label: 'Масштаб по стене', onClick: () => flatScaleStart() },
{ icon: '↕️', label: 'Высоты стен, окон и дверей', onClick: () => flatHStart() },
]);
}

// «Показать стену»: следующее нажатие на чертеже — образец стены
function flatWallPickStart() {
if (!flatEdit) return;
flatEdit.pick = !flatEdit.pick;
renderFlatPlan();
}

async function flatWallPickAt(pt) {
flatEdit.pick = false;
const mp = await flatUlMapping();
if (!mp || !mp.gray.rgba) { renderFlatPlan(); return; }
const { gray, toPx, ppm } = mp, d = gray.rgba, W = gray.w, H = gray.h;
const [cx, cy] = toPx(pt).map(Math.round);
const R = Math.max(3, Math.round(0.15 * ppm));
// цвет: самый частый «не фон» рядом с пальцем (ближе — весомее)
const bins = new Map();
for (let y = Math.max(0, cy - R); y <= Math.min(H - 1, cy + R); y++) for (let x = Math.max(0, cx - R); x <= Math.min(W - 1, cx + R); x++) {
const j = (y * W + x) * 4, r = d[j], g2 = d[j + 1], b = d[j + 2];
const lum = (r * 299 + g2 * 587 + b * 114) / 1000, sat = Math.max(r, g2, b) - Math.min(r, g2, b);
if (lum > 225 && sat < 40) continue;                         // фон
const key = (r >> 5) * 64 + (g2 >> 5) * 8 + (b >> 5), w = 1 / (1 + Math.hypot(x - cx, y - cy));
const v = bins.get(key) || { w: 0, r: 0, g: 0, b: 0 };
v.w += w; v.r += r * w; v.g += g2 * w; v.b += b * w;
bins.set(key, v);
}
if (!bins.size) { renderFlatPlan(); alert('Здесь на чертеже пусто. Приблизьте и нажмите точно на линию или штриховку перегородки.'); return; }
const top = [...bins.values()].sort((a, b) => b.w - a.w)[0];
const c = [top.r / top.w, top.g / top.w, top.b / top.w].map(Math.round);
// толщина: по горизонтали и вертикали через палец — сколько подряд «того же цвета» (разрывы до 3 см — штриховка)
const same = (x, y) => { if (x < 0 || y < 0 || x >= W || y >= H) return false; const j = (y * W + x) * 4; const dr = d[j] - c[0], dg = d[j + 1] - c[1], db = d[j + 2] - c[2]; return dr * dr + dg * dg + db * db < 4900; };
const gap = Math.max(2, Math.round(0.03 * ppm));
const run = (dx, dy) => {
let lo = 0, hi = 0;
for (let s = 1, miss = 0; s < R * 3 && miss <= gap; s++) { if (same(cx - dx * s, cy - dy * s)) { lo = s; miss = 0; } else miss++; }
for (let s = 1, miss = 0; s < R * 3 && miss <= gap; s++) { if (same(cx + dx * s, cy + dy * s)) { hi = s; miss = 0; } else miss++; }
return lo + hi + 1;
};
const T = Math.min(run(1, 0), run(0, 1)) / ppm;                // м: поперёк стены — меньшая
const r = Math.max(0.02, Math.min(0.12, T / 2 + 0.02));
const list = flatWallSamples().filter(sm => Math.hypot(sm.c[0] - c[0], sm.c[1] - c[1], sm.c[2] - c[2]) > 25);
list.push({ c, r });
flatWallSamplesSet(list);
renderFlatPlan();
showAddToast(`Запомнил: такие линии на этом чертеже — стены (образцов: ${list.length}, толщина ≈ ${Math.round(T * 100)} см). Теперь «Обвести по чертежу» или в проёмах «По подложке»`);
}

function flatWallSamplesClear() {
flatWallSamplesSet([]);
renderFlatPlan();
showAddToast('Образцы стен забыты');
}

// «По подложке» в дверях и проёмах: вдоль каждой стены с проёмами смотрим чуть снаружи комнаты —
// где на чертеже нет стены (разрыв 0,4–3 м, со стеной по обе стороны), там дверь или окно.
// Отмеченный проём встаёт на ближайший такой разрыв: его место и ширина. Новых не добавляем
async function flatOpsFitUnderlay() {
if (!flatOpsDraft) return;
const mp = await flatUlMapping();
if (!mp) return;
const walls = flatUlWalls(mp);
const { gray, toPx, ppm } = mp;
const isWall = ([x, y]) => { x = Math.round(x); y = Math.round(y); return x >= 0 && y >= 0 && x < gray.w && y < gray.h && walls[y * gray.w + x] === 1; };
const step = 1 / ppm;
const items = flatItems();
let moved = 0, total = 0;
const done = new Set();                                      // вторые половины дверей, уже поставленные вместе с первой
flatOpsPush();
items.forEach(it => {
const room = flatRooms().find(r => r.id === it.id);
if (!room || !it.closed) return;
const n = it.pts.length;
const byWall = {};
(room.measure.openings || []).forEach((o, oi) => { if (o.wall >= 0 && o.wall < n) (byWall[o.wall] = byWall[o.wall] || []).push(oi); });
Object.keys(byWall).forEach(j => {
j = Number(j);
const a = it.pts[j], b = it.pts[(j + 1) % n];
const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
if (!(L > 0.3)) return;
const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, ox = uy, oy = -ux;   // наружу — налево от стены
// где вдоль стены есть стена чертежа (хоть на одной глубине 3–15 см снаружи)
const N = Math.ceil(L / step), prof = new Uint8Array(N + 1);
for (let t = 0; t <= N; t++) {
const s0 = t * step;
prof[t] = [0.03, 0.06, 0.1, 0.15].some(d => isWall(toPx([a[0] + ux * s0 + ox * d, a[1] + uy * s0 + oy * d]))) ? 1 : 0;
}
// разрывы: со стеной по обе стороны, 0,4–3 м
const gaps = [];
for (let t = 0; t <= N;) {
if (prof[t]) { t++; continue; }
let e = t;
while (e <= N && !prof[e]) e++;
const g0 = t * step, g1 = (e - 1) * step + step;
if (t > 0 && e <= N && g1 - g0 >= 0.4 && g1 - g0 <= 3) gaps.push({ g0, g1, used: false });
t = e;
}
byWall[j].forEach(oi => {
const o = room.measure.openings[oi];
if (done.has(o)) return;
total++;
const partners = o.type === 'window' ? [] : flatOpPartners(it.id, oi);
const w = mNum(o.w), st = flatOpStart(o, L), c = st + w / 2;
let best = null, bs = -Infinity;
gaps.forEach(gp => {
if (gp.used) return;
const ov = Math.min(st + w, gp.g1) - Math.max(st, gp.g0), dc = Math.abs((gp.g0 + gp.g1) / 2 - c);
if (ov <= 0 && dc > 0.6) return;
const sc = ov - dc * 0.5;
if (sc > bs) { bs = sc; best = gp; }
});
if (!best) return;
best.used = true;
const nw = Math.round((best.g1 - best.g0) * 100) / 100;
const nst = Math.round(best.g0 * 100) / 100;
if (Math.abs(nw - w) < 0.01 && Math.abs(nst - st) < 0.01) return;
o.w = FLAT_FMT(nw);
flatOpSetStart(o, L, nst);
moved++;
// вторая половина двери у соседней комнаты — на тот же разрыв
const s0 = [a[0] + ux * nst, a[1] + uy * nst], s1 = [a[0] + ux * (nst + nw), a[1] + uy * (nst + nw)];
partners.forEach(({ room: r2, oi: j2 }) => {
const it2 = items.find(x => x.id === r2.id), o2 = r2.measure.openings[j2];
if (!it2 || !o2) return;
const n2 = it2.pts.length, p2 = it2.pts[o2.wall], q2 = it2.pts[(o2.wall + 1) % n2];
const L2 = Math.hypot(q2[0] - p2[0], q2[1] - p2[1]);
if (!(L2 > 0)) return;
const vx = (q2[0] - p2[0]) / L2, vy = (q2[1] - p2[1]) / L2;
const t0 = (s0[0] - p2[0]) * vx + (s0[1] - p2[1]) * vy, t1 = (s1[0] - p2[0]) * vx + (s1[1] - p2[1]) * vy;
o2.w = FLAT_FMT(Math.round(Math.abs(t1 - t0) * 100) / 100);
flatOpSetStart(o2, L2, Math.round(Math.min(t0, t1) * 100) / 100);
done.add(o2);
});
});
});
});
if (!moved) { flatOpsDraft.undo.pop(); showAddToast(total ? 'Проёмы уже стоят по чертежу (или разрывы в стенах не найдены)' : 'На плане нет проёмов'); return; }
renderFlatPlan();
showAddToast(`Подогнано по чертежу проёмов: ${moved} из ${total}. Проверьте — лишнее «Шаг назад» — и «Сохранить»`);
}

async function flatTraceUnderlay() {
const id = flatEdit && flatEdit.sel;
const it = id && flatItems().find(r => r.id === id);
if (!it) { alert('Сначала нажмите на комнату.'); return; }
if (!it.closed) { alert('Контур комнаты не замкнут.'); return; }
const mp = await flatUlMapping();
if (!mp) return;
const { gray, toPx, toM, ppm } = mp;
const poly = it.pts.map(toPx);
const margin = 0.3 * ppm;
const x0 = Math.max(0, Math.floor(Math.min(...poly.map(p => p[0])) - margin)), y0 = Math.max(0, Math.floor(Math.min(...poly.map(p => p[1])) - margin));
const x1 = Math.min(gray.w, Math.ceil(Math.max(...poly.map(p => p[0])) + margin)), y1 = Math.min(gray.h, Math.ceil(Math.max(...poly.map(p => p[1])) + margin));
const W = x1 - x0, H = y1 - y0;
if (W < 10 || H < 10) { alert('Комната вне подложки.'); return; }
// стены чертежа (толстое тёмное и плотная штриховка) — кусок вокруг комнаты
const wallsAll = flatUlWalls(mp);
const wall = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) wall[y * W + x] = wallsAll[(y + y0) * gray.w + x + x0];
// куда можно лить: внутри контура или до 40 см от него; двери и окна комнаты перекрыты снаружи
const inside = (x, y) => {
let c = false;
for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
const [xi, yi] = poly[i], [xj, yj] = poly[j];
if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
}
return c;
};
const segD = (x, y) => {
let d = Infinity;
for (let i = 0; i < poly.length; i++) {
const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
}
return d;
};
// соседние комнаты (их контуры, чуть ужатые) — туда заливке нельзя
const others = flatItems().filter(r => r.id !== id && r.closed).map(r => r.pts.map(toPx))
.filter(q => q.some(([x, y]) => x > x0 - margin && x < x1 + margin && y > y0 - margin && y < y1 + margin));
const inPoly = (P, x, y) => {
let c = false;
for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
const [xi, yi] = P[i], [xj, yj] = P[j];
if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
}
return c;
};
const edgeD = (P, x, y) => {
let d = Infinity;
for (let i = 0; i < P.length; i++) {
const [ax, ay] = P[i], [bx, by] = P[(i + 1) % P.length];
const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy));
}
return d;
};
const inOther = (x, y) => others.some(P => inPoly(P, x, y) && edgeD(P, x, y) > 0.03 * ppm);
const ok = new Uint8Array(W * H), out = new Uint8Array(W * H), far = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
const i = y * W + x;
if (wall[i]) continue;
const px = x + x0 + 0.5, py = y + y0 + 0.5;
if (inside(px, py)) { ok[i] = 1; continue; }
if (inOther(px, py)) continue;                               // в соседнюю комнату не заходим
const d = segD(px, py);
if (d <= margin) { ok[i] = 1; out[i] = 1; if (d >= margin - 2) far[i] = 1; }
}
it.openings.forEach(o => {
const sg = flatOpeningSeg(it, o);
if (!sg) return;
const step = 0.5 / ppm;
for (let t = -0.1; t <= sg.w + 0.1; t += step) for (let d = 0.01; d <= 0.45; d += step) {   // с запасом 10 см: проём на чертеже бывает шире
// наружу — налево от стены (комната — справа)
const [px, py] = toPx([sg.x + sg.ux * t + sg.uy * d, sg.y + sg.uy * t - sg.ux * d]);
const x = Math.floor(px) - x0, y = Math.floor(py) - y0;
if (x >= 0 && y >= 0 && x < W && y < H) ok[y * W + x] = 0;
}
});
// заливка от центра комнаты (ближайшая к нему светлая точка)
const [lx, ly] = toPx(flatLabelPoint(it.pts));
let seed = -1, best = Infinity;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
if (!ok[y * W + x]) continue;
const d = (x + x0 - lx) ** 2 + (y + y0 - ly) ** 2;
if (d < best) { best = d; seed = y * W + x; }
}
if (seed < 0) { alert('На подложке в этой комнате не нашёл пола.'); return; }
const reg = new Uint8Array(W * H);
const stack = [seed];
reg[seed] = 1;
while (stack.length) {
const i = stack.pop(), x = i % W, y = (i - x) / W;
[[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].forEach(([a, b]) => {
if (a < 0 || b < 0 || a >= W || b >= H) return;
const j = b * W + a;
if (ok[j] && !reg[j]) { reg[j] = 1; stack.push(j); }
});
}
// за контуром оставляем только закрытые стенами куски (ниши): дошёл до края 40 см — это
// утечка через проём в соседнюю комнату или на улицу, такой кусок не берём
const seen = new Uint8Array(W * H);
for (let s0 = 0; s0 < W * H; s0++) {
if (!reg[s0] || !out[s0] || seen[s0]) continue;
const comp = [s0], st = [s0];
let leak = false;
seen[s0] = 1;
while (st.length) {
const i = st.pop(), x = i % W, y = (i - x) / W;
if (far[i]) leak = true;
[[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].forEach(([a, b]) => {
if (a < 0 || b < 0 || a >= W || b >= H) return;
const j = b * W + a;
if (reg[j] && out[j] && !seen[j]) { seen[j] = 1; st.push(j); comp.push(j); }
});
}
if (leak) comp.forEach(i => { reg[i] = 0; });
}
// шум: щели и выступы уже ~8 см (щели в стенах из двух тонких линий, цифры размеров у стен) —
// закрыть узкие щели и срезать узкие выступы
const kr = Math.max(1, Math.round(0.04 * ppm));
const passR = (src, keep, r, horiz) => {
const o = new Uint8Array(W * H);
const L = horiz ? W : H, M = horiz ? H : W;
for (let m = 0; m < M; m++) {
let cnt = 0;
const at = i => (horiz ? m * W + i : i * W + m);
for (let i = 0; i < Math.min(L, r); i++) cnt += src[at(i)];
for (let i = 0; i < L; i++) {
if (i + r < L) cnt += src[at(i + r)];
if (i - r - 1 >= 0) cnt -= src[at(i - r - 1)];
const span = Math.min(L - 1, i + r) - Math.max(0, i - r) + 1;
o[at(i)] = keep ? (cnt === span ? 1 : 0) : (cnt > 0 ? 1 : 0);
}
}
return o;
};
const dil = m => passR(passR(m, 0, kr, true), 0, kr, false), ero = m => passR(passR(m, 1, kr, true), 1, kr, false);
let clean = dil(ero(ero(dil(reg))));                         // закрытие, потом размыкание
// не дальше, чем позволено (закрытие не должно выйти за 30 см и в соседние комнаты)
for (let i = 0; i < W * H; i++) if (clean[i] && !reg[i] && !ok[i] && !wall[i]) clean[i] = 0;
// после чистки — только кусок, где центр комнаты (отрезанные мелкие куски — прочь)
let s1 = -1, b1 = Infinity;
for (let i = 0; i < W * H; i++) {
if (!clean[i]) continue;
const x = i % W, y = (i - x) / W, d = (x + x0 - lx) ** 2 + (y + y0 - ly) ** 2;
if (d < b1) { b1 = d; s1 = i; }
}
reg.fill(0);
if (s1 >= 0) {
const st = [s1];
reg[s1] = 1;
while (st.length) {
const i = st.pop(), x = i % W, y = (i - x) / W;
[[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].forEach(([a, b]) => {
if (a < 0 || b < 0 || a >= W || b >= H) return;
const j = b * W + a;
if (clean[j] && !reg[j]) { reg[j] = 1; st.push(j); }
});
}
}
// касания уголками — закрываем, чтобы край был одной линией
const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && reg[y * W + x] === 1;
for (let changed = true, guard = 0; changed && guard < 5; guard++) {
changed = false;
for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
const a = on(x, y), b = on(x + 1, y), c = on(x, y + 1), d = on(x + 1, y + 1);
if (a && d && !b && !c) { reg[y * W + x + 1] = 1; changed = true; }
else if (b && c && !a && !d) { reg[y * W + x] = 1; changed = true; }
}
}
// внешний край — по часовой (y вниз: заливка справа от направления)
const edges = new Map();
let sx = -1, sy = -1;
for (let y = 0; y < H && sx < 0; y++) for (let x = 0; x < W; x++) if (on(x, y)) { sx = x; sy = y; break; }
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
if (!on(x, y)) continue;
if (!on(x, y - 1)) edges.set(`${x},${y}`, [x + 1, y]);
if (!on(x + 1, y)) edges.set(`${x + 1},${y}`, [x + 1, y + 1]);
if (!on(x, y + 1)) edges.set(`${x + 1},${y + 1}`, [x, y + 1]);
if (!on(x - 1, y)) edges.set(`${x},${y + 1}`, [x, y]);
}
let ring = [[sx, sy]];
for (let cur = edges.get(`${sx},${sy}`), n = 0; cur && (cur[0] !== sx || cur[1] !== sy) && n < 200000; n++) { ring.push(cur); cur = edges.get(cur.join(',')); }
// прямые стены: близкие (до 6 см) положения стен — одно, средневзвешенное по длине
const tol = 0.06 * ppm;
const snap = (axis) => {
const list = [];
ring.forEach((p, i) => { const q = ring[(i + 1) % ring.length]; if (p[axis] === q[axis]) list.push([p[axis], Math.abs(q[1 - axis] - p[1 - axis])]); });
list.sort((a, b) => a[0] - b[0]);
const map = new Map();
for (let i = 0; i < list.length;) {
let j = i, sw = 0, sv = 0;
while (j < list.length && list[j][0] - list[i][0] <= tol) { sw += list[j][1]; sv += list[j][0] * list[j][1]; j++; }
for (let m = i; m < j; m++) map.set(list[m][0], sw ? sv / sw : list[i][0]);
i = j;
}
return map;
};
const mx = snap(0), my = snap(1);
ring = ring.map(([x, y]) => [mx.has(x) ? mx.get(x) : x, my.has(y) ? my.get(y) : y]);
// убрать повторы и точки посреди прямой (в том числе «шипы» туда-обратно)
for (let again = true; again && ring.length > 3;) {
again = false;
const n = ring.length;
for (let i = 0; i < n; i++) {
const q = ring[(i - 1 + n) % n], p = ring[i], r = ring[(i + 1) % n];
const same = Math.abs(p[0] - r[0]) < 1e-6 && Math.abs(p[1] - r[1]) < 1e-6;
if (same || (Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(p[0] - r[0]) < 1e-6) || (Math.abs(q[1] - p[1]) < 1e-6 && Math.abs(p[1] - r[1]) < 1e-6)) {
ring.splice(i, 1); again = true; break;
}
}
}
if (ring.length < 4) { alert('Не получилось обвести эту комнату по чертежу.'); return; }
let pts = ring.map(([x, y]) => toM([x + x0, y + y0]).map(v => Math.round(v * 1000) / 1000));
const a0 = flatPolyArea(it.pts), a1 = flatPolyArea(pts);
if (!(a1 > a0 * 0.5 && a1 < a0 * 1.6)) { alert(`По чертежу вышло ${mFmt(a1)} м² вместо ${mFmt(a0)} м² — похоже, заливка ушла не туда. Подгоните подложку или комнату ближе и попробуйте снова.`); return; }
// тот же обход, что был, и начало — ближе к прежнему первому углу
if (Math.sign(flatArea2(pts)) !== Math.sign(flatArea2(it.pts))) pts.reverse();
let k0 = 0, d0 = Infinity;
pts.forEach((p, i) => { const d = Math.hypot(p[0] - it.pts[0][0], p[1] - it.pts[0][1]); if (d < d0) { d0 = d; k0 = i; } });
pts = pts.slice(k0).concat(pts.slice(0, k0));
flatReplacePolygon(id, it, pts);
showAddToast(`Обведено по чертежу: ${pts.length} углов, ${mFmt(a1)} м² (было ${mFmt(a0)}). Проверьте — лишнее «Шаг назад» или поправьте руками — и «Сохранить»`);
}

// Новый контур комнаты в черновик: проёмы и всё, что привязано к стенам, — на ближайшие
// параллельные стены нового контура (не дальше 35 см), высоты отдельных стен — туда же
function flatReplacePolygon(id, it, pts) {
const room = flatRooms().find(r => r.id === id);
if (!room) return;
const oldN = it.pts.length, n = pts.length;
const ex = flatEdit.extra[id] || { openings: JSON.parse(JSON.stringify(room.measure.openings || [])), wh: (room.measure.wallHeights || []).slice(), map: Array.from({ length: oldN }, (_, k) => k) };
const wallsNew = pts.map((a, j) => { const b = pts[(j + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]); return { a, L, ux: (b[0] - a[0]) / (L || 1), uy: (b[1] - a[1]) / (L || 1) }; });
// ближайшая новая стена для отрезка (точка p, направление u): [номер, отступ p вдоль неё] или null
const nearest = (p, ux, uy, w) => {
let best = null, bd = 0.35;
wallsNew.forEach((s, j) => {
if (!(s.L > 0) || Math.abs(ux * s.uy - uy * s.ux) > 0.05 || ux * s.ux + uy * s.uy < 0) return;
const dx = p[0] - s.a[0], dy = p[1] - s.a[1];
const along = dx * s.ux + dy * s.uy, d = Math.abs(dx * s.uy - dy * s.ux);
if (along + w < 0.05 || along > s.L - 0.05) return;
if (d < bd) { bd = d; best = [j, along]; }
});
return best;
};
const m2 = it.pts.map((a, k) => {
const b = it.pts[(k + 1) % oldN], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
if (!(L > 0)) return -1;
const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
const r = nearest([a[0] + ux * L / 2, a[1] + uy * L / 2], ux, uy, 0);
return r ? r[0] : -1;
});
const openings = ex.openings.map(o => {
const sg = flatOpeningSeg(it, o);
if (!sg) return o;
const r = nearest([sg.x, sg.y], sg.ux, sg.uy, sg.w);
if (!r) return o.wall >= 0 && o.wall < n ? o : { ...o, wall: n - 1 };
const c = { ...o, wall: r[0], from: 'start', off: '0' };
flatOpSetStart(c, wallsNew[r[0]].L, r[1]);
return c;
});
const wh = new Array(n).fill('');
m2.forEach((j, k) => { if (j >= 0 && !wh[j] && ex.wh[k]) wh[j] = ex.wh[k]; });
flatPushUndo();
flatEdit.draft[id] = pts;
flatEdit.extra[id] = { openings, wh, map: ex.map.map(k => (k >= 0 ? m2[k] : k)) };
renderFlatPlan();
}

function flatPushUndo() {
flatEdit.undo.push(JSON.parse(JSON.stringify({ d: flatEdit.draft, x: flatEdit.extra })));
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
if (ids.length) flatHistMark('Правка на плане');
ids.forEach(id => {
const r = rooms.find(x => x.id === id);
if (!r) return;
const ex = flatEdit.extra[id];
if (ex) {
r.measure.openings = ex.openings; r.measure.wallHeights = ex.wh;
// плинтус, плитка, ниши, короба и прочее, привязанное к стенам, — на новые номера
if (typeof remapCeilElWalls === 'function') remapCeilElWalls(r.measure, ex.map);
}
flatApplyPolygon(r, flatEdit.draft[id]);
});
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
// «Показать стену»: нажатие на чертёж — образец стены (после перерисовки при приближении — тоже)
if (flatEdit && flatEdit.pick) svg.addEventListener('click', (ev) => { ev.stopPropagation(); const pt = flatEventPoint(ev); if (pt) flatWallPickAt(pt); }, true);
svg.onpointerdown = (e) => {
if (flatEdit && flatEdit.pick) return;                    // ждём нажатия на стену чертежа — без правки
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
let start = toM(e);
const base = flatPts(ed.sel);
const idx = Number(kind === 'v' ? t.dataset.v : t.dataset.w);
const n = base.length;
// привязка — к углам других комнат и остальным углам этой; порог ~ 8 точек экрана
const tol = 8 * Math.abs(ctm.a);
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
// с места трогаемся плавно: отсчёт — от точки, где палец «сдвинулся», без рывка на порог
if (!moved) { start = [x, y]; dx = 0; dy = 0; }
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
if (!moved && kind === 'w') flatWallMenu(idx);
else if (!moved && kind === 'v') flatCornerMenu(idx);
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
holder.innerHTML = flatSvg(flatItems(), { view: flatEdit.view, sel: flatEdit.sel, underlay: flatUlOpt(), zoom: flatZoom });
const svg = holder.firstElementChild;
old.replaceWith(svg);
flatBindEdit();
}

// Нажали на квадратик стены или кружок угла (без движения)
function flatWallMenu(i) {
openSheet(`Стена ${i + 1}`, [
{ icon: '📏', label: 'Точная длина', onClick: () => flatAskWall(i) },
{ icon: '↔️', label: 'Сдвинуть точно (на мм)', onClick: () => flatNudgeWall(i) },
{ icon: '▭', label: 'Обойти колонну (выступ на стене)', onClick: () => flatColumnWall(i) },
{ icon: '⊔', label: 'Ниша в стене (углубление)', onClick: () => flatColumnWall(i, true) },
]);
}

function flatCornerMenu(i) {
openSheet(`Угол ${i + 1}`, [
{ icon: '◰', label: 'Обойти колонну в этом углу', onClick: () => flatColumnCorner(i) },
]);
}

// Два размера колонны в мм («400» или «400 300»); ввели метры — переведём
function flatAskSize(title, def) {
const raw = prompt(title, def);
if (raw == null) return null;
const v = String(raw).trim().split(/[\s×xх*\/]+/).map(t => mNum(t)).filter(n => n > 0).map(n => (n < 20 ? n : n / 1000));
if (!v.length) return null;
return [v[0], v[1] || v[0]];
}

// Черновик комнаты с новыми углами: проёмы и высоты стен — на новые номера стен.
// map(j, o) → { wall, start } для проёма o на старой стене j; newH(j) — номер стены для высоты
function flatInsertCorners(id, pts, idx, wallOf, heights, what = 'Колонна обойдена') {
const room = flatRooms().find(r => r.id === id);
const it = flatItems().find(r => r.id === id);
if (!room || !it) return;
const oldN = it.pts.length;
const ex = flatEdit.extra[id] || { openings: JSON.parse(JSON.stringify(room.measure.openings || [])), wh: (room.measure.wallHeights || []).slice(), map: Array.from({ length: oldN }, (_, k) => k) };
const len = (P, k) => { const a = P[k], b = P[(k + 1) % P.length]; return Math.hypot(b[0] - a[0], b[1] - a[1]); };
const openings = ex.openings.map(o => {
if (!(o.wall >= 0 && o.wall < oldN)) return o;
const L = len(it.pts, o.wall), w = mNum(o.w);
const r = wallOf(o.wall, flatOpStart(o, L), w);
const c = { ...o, wall: r.wall, from: 'start', off: '0' };
flatOpSetStart(c, len(pts, r.wall), r.start);
return c;
});
flatPushUndo();
flatEdit.draft[id] = pts.map(p => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]);
flatEdit.extra[id] = { openings, wh: heights(ex.wh), map: ex.map.map(k => (k >= 0 ? idx(k) : k)) };   // map — старый номер стены замера → новый
renderFlatPlan();
showAddToast(`${what}. Подгоните её стены по чертежу (тяните квадратики или «Прилепить к подложке») и «Сохранить»`);
}

// Колонна посреди стены i: прямоугольный выступ внутрь комнаты (ширина × глубина);
// niche — наоборот, углубление в стену наружу
function flatColumnWall(i, niche) {
const id = flatEdit && flatEdit.sel;
const pts = id && flatPts(id);
if (!pts) return;
const n = pts.length, a = pts[i], b = pts[(i + 1) % n];
const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
const sz = flatAskSize(niche ? 'Ниша: ширина вдоль стены и глубина, мм (например «600 200»)' : 'Колонна: ширина вдоль стены и насколько выступает, мм (например «400 300»)', niche ? '600 200' : '400 300');
if (!sz || !(L > 0)) return;
const W = sz[0], D = niche ? -sz[1] : sz[1];
if (W >= L - 0.02) { alert(niche ? 'Ниша шире стены.' : 'Колонна шире стены.'); return; }
const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy, ny = ux;   // внутрь комнаты — направо от стены
const s0 = (L - W) / 2;
const P1 = [a[0] + ux * s0, a[1] + uy * s0], P2 = [P1[0] + nx * D, P1[1] + ny * D];
const P3 = [P2[0] + ux * W, P2[1] + uy * W], P4 = [P1[0] + ux * W, P1[1] + uy * W];
const out = pts.slice(0, i + 1).concat([P1, P2, P3, P4], pts.slice(i + 1));
flatInsertCorners(id, out, j => (j > i ? j + 4 : j),
(j, st, w) => (j < i ? { wall: j, start: st } : j > i ? { wall: j + 4, start: st }
: st + w / 2 <= s0 + W / 2 ? { wall: i, start: Math.min(st, s0 - w) } : { wall: i + 4, start: Math.max(0, st - s0 - W) }),
wh => { const h = wh.slice(); h.length = n; const v = h[i] || ''; h.splice(i + 1, 0, v, v, v, v); return h.map(x => x || ''); },
niche ? 'Ниша добавлена' : 'Колонна обойдена');
}

// Колонна в углу i (между стенами i−1 и i): вырез X вдоль стены до угла и Y вдоль стены после
function flatColumnCorner(i) {
const id = flatEdit && flatEdit.sel;
const pts = id && flatPts(id);
if (!pts) return;
const n = pts.length, C = pts[i], P = pts[(i - 1 + n) % n], N = pts[(i + 1) % n];
const L1 = Math.hypot(C[0] - P[0], C[1] - P[1]), L2 = Math.hypot(N[0] - C[0], N[1] - C[1]);
if (!(L1 > 0) || !(L2 > 0)) return;
const u1 = [(C[0] - P[0]) / L1, (C[1] - P[1]) / L1], u2 = [(N[0] - C[0]) / L2, (N[1] - C[1]) / L2];
if (u1[0] * u2[1] - u1[1] * u2[0] < 0.5) { alert('Колонну можно обойти только во внешнем прямом угле комнаты.'); return; }
const sz = flatAskSize(`Колонна в углу: вдоль стены ${(i - 1 + n) % n + 1} и вдоль стены ${i + 1}, мм (например «400 300»)`, '400 400');
if (!sz) return;
const [X, Y] = sz;
if (X >= L1 - 0.02 || Y >= L2 - 0.02) { alert('Колонна больше стены.'); return; }
const Q1 = [C[0] - u1[0] * X, C[1] - u1[1] * X], Q2 = [Q1[0] + u2[0] * Y, Q1[1] + u2[1] * Y], Q3 = [C[0] + u2[0] * Y, C[1] + u2[1] * Y];
const out = pts.slice(0, i).concat([Q1, Q2, Q3], pts.slice(i + 1));
const prev = (i - 1 + n) % n;
flatInsertCorners(id, out, j => (j >= i ? j + 2 : j),
(j, st, w) => (j === i ? { wall: i + 2, start: Math.max(0, st - Y) } : { wall: j >= i ? j + 2 : j, start: j === prev ? Math.min(st, L1 - X - w) : st }),
wh => { const h = wh.slice(); h.length = n; h.splice(i, 0, h[prev] || '', h[prev] || ''); return h.map(x => x || ''); });
}

// Сдвиг стены на заданное число мм: плюс — наружу (комната больше), минус — внутрь
function flatNudgeWall(i) {
const id = flatEdit && flatEdit.sel;
const pts = id && flatPts(id);
if (!pts) return;
const raw = prompt('Сдвинуть стену, мм: плюс — наружу (комната больше), минус — внутрь. Например «15» или «-8»', '10');
if (raw == null) return;
const mm = mNum(String(raw).replace(/\s/g, '').replace('+', ''));
if (!isFinite(mm) || !mm) return;
const n = pts.length, a = pts[i], b = pts[(i + 1) % n];
const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
if (!(len > 0)) return;
const k = -mm / 1000;                                       // внутрь — направо от стены, наружу — налево
const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
flatPushUndo();
[i, (i + 1) % n].forEach(j => { pts[j] = [pts[j][0] + nx * k, pts[j][1] + ny * k]; });
flatEdit.draft[id] = pts.map(p => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]);
renderFlatPlan();
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
