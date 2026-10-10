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

// Весь план: items — [{ id, name, measure, plan }]; onTap — имя функции (id) или ''
function flatSvg(items, onTap) {
const rooms = items.map(it => ({ ...it, ...flatRoomPoints(it.measure, it.plan) }));
const all = rooms.flatMap(r => r.pts);
if (!all.length) return '';
const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
const pad = 0.4;
const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
const w = Math.max(...xs) - minX + pad, h = Math.max(...ys) - minY + pad;
const fs = Math.max(0.16, Math.min(0.32, Math.max(w, h) / 45));
const body = rooms.map(r => {
const d = 'M' + r.pts.map(p => p.join(' ')).join('L') + 'Z';
// окна — голубые, двери — коричневые, балконные блоки — зелёные; поверх стены
const ops = (r.measure.openings || []).map(o => {
const q = r.g.segs[o.wall];
const len = q && q.len;
const ow = mNum(o.w), off = mNum(o.off);
if (!q || !(len > 0) || !(ow > 0)) return '';
const a = isFinite(off) ? off : (len - ow) / 2;
const x1 = q.x1 + q.dx * a + r.plan.x, y1 = q.y1 + q.dy * a + r.plan.y;
const x2 = x1 + q.dx * ow, y2 = y1 + q.dy * ow;
const col = o.type === 'door' ? '#9a6b3c' : o.type === 'balcony' ? '#3a9a5c' : '#3d8bd9';
return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${fs * 0.5}" stroke-linecap="butt"/>`;
}).join('');
const [lx, ly] = flatLabelPoint(r.pts);
const area = flatPolyArea(r.pts);
const tap = onTap ? ` onclick="${onTap}('${r.id}')" style="cursor:pointer"` : '';
return `<g class="flat-room"${tap}>
<path d="${d}" fill="${r.g.closed ? '#fff4d1' : '#fde3dc'}" stroke="#14181f" stroke-width="${fs * 0.22}" stroke-linejoin="miter"/>
${ops}
<text x="${lx}" y="${ly - fs * 0.15}" font-size="${fs}" text-anchor="middle" font-family="Arial, sans-serif" fill="#14181f" font-weight="700">${escapeHtml(r.name || '')}</text>
<text x="${lx}" y="${ly + fs * 1.05}" font-size="${fs * 0.85}" text-anchor="middle" font-family="Arial, sans-serif" fill="#5a6470">${(Math.round(area * 10) / 10).toLocaleString('ru-RU')} м²${r.g.closed ? '' : ' · не сходится'}</text>
</g>`;
}).join('');
return `<svg class="flat-svg" viewBox="${minX} ${minY} ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

/* ---------- экран «План квартиры» у объекта ---------- */

let flatObjectId = null;
let flatReturn = false;   // открыли замер комнаты с плана — после него вернуться на план
let flatZoom = 1;

function objectHasFlat(obj) {
return objectRooms(obj).some(r => r.plan && r.measure);
}

function openFlatPlan(objectId) {
flatObjectId = objectId;
flatZoom = 1;
document.getElementById('flatPanel').classList.add('open');
document.body.classList.add('measure-open');
renderFlatPlan();
}

function closeFlatPlan() {
flatObjectId = null;
document.getElementById('flatPanel').classList.remove('open');
document.body.classList.remove('measure-open');
}

function renderFlatPlan() {
const obj = (cloudData.objects || []).find(o => o.id === flatObjectId);
const body = document.getElementById('flatBody');
if (!obj || !body) return;
const rooms = objectRooms(obj).filter(r => r.plan && r.measure);
const rest = objectRooms(obj).length - rooms.length;
const total = rooms.reduce((a, r) => a + flatPolyArea(flatRoomPoints(r.measure, r.plan).pts), 0);
body.innerHTML = `<div class="mp-body-inner">
<div class="ai-hint">Нажмите на помещение — откроется его замер. После правки план обновится.${rest ? ` Помещений без места на плане: ${rest} (добавлены вручную).` : ''}</div>
<div class="flat-zoom"><button type="button" class="mp-head-btn" onclick="flatSetZoom(-1)" aria-label="Мельче">−</button><span>Площадь: <b>${(Math.round(total * 10) / 10).toLocaleString('ru-RU')} м²</b></span><button type="button" class="mp-head-btn" onclick="flatSetZoom(1)" aria-label="Крупнее">+</button></div>
<div class="flat-wrap"><div style="width:${flatZoom * 100}%">${flatSvg(rooms.map(r => ({ id: r.id, name: roomName(r), measure: r.measure, plan: r.plan })), 'flatOpenRoom')}</div></div>
</div>`;
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
