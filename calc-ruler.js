// Кабинет мастера — рулетка: чертёж комнаты, клавиатура, проёмы на стенах, развёртки стен.
// Подключается из calc.html; порядок подключения важен.

/* ===================== РУЛЕТКА: замер стен чертежом ===================== */
// Сначала выбирается форма комнаты:
//  • прямоугольная — вводятся только длина и ширина, две другие стены те же;
//  • Г-образная — форма нарисована сразу, мерите подсвеченную стену по номеру;
//  • своя — стена за стеной, стрелка показывает, куда пойдёт следующая.
// «← Назад» — к предыдущему полю, «↶» — отменить последнее изменение.

let rulerTarget = null;   // { kind: 'height' } | { kind: 'wall', idx } | { kind: 'wallH', idx } | { kind: 'op', idx, field }
let rulerBuf = '';
let rulerFresh = false;
let rulerUndo = [];       // снимки замера для «Отменить»
let rulerPick = null;     // { type: 'window' | 'door' } — ждём касания стены
const RL_L_TURNS = ['R', 'R', 'R', 'L', 'R', 'R'];
const RL_L_PLACEHOLDER = [4, 3, 2, 1.5, 2, 1.5];
const RL_RECT_PLACEHOLDER = [4, 3, 4, 3];

// Поворот после стены i в градусах (+ направо). У своей формы можно задать
// угол в углу (внутренний, как меряет угломер): 90° — прямой, 135° — тупой.
function rlTurnDeg(m, i, turns, shape) {
const dir = turns[i] === 'L' ? -1 : 1;
if (shape !== 'free') return dir * 90;
// пустой угол — прямой (90°); 0° — разворот назад, 180° — стены на одной прямой
const raw = Array.isArray(m.angles) ? m.angles[i] : '';
const v = raw === undefined || raw === null || String(raw).trim() === '' ? NaN : evalMeasureExpr(raw);
const interior = isFinite(v) && v >= 0 && v < 360 ? v : 90;
return dir * (180 - interior);
}

function rlShape(m) {
if (m.shape) return m.shape;
return m.walls.some(w => mNum(w) > 0) ? 'free' : '';
}
function rlTurns() { if (!Array.isArray(measure.turns)) measure.turns = []; return measure.turns; }

/* ---------- отмена ---------- */
function rulerSnapshot() {
const m = measure;
// углы и начальное направление тоже — иначе после «Отменить» план мог перекоситься
const snap = JSON.stringify({ shape: m.shape, height: m.height, walls: m.walls, wallHeights: m.wallHeights, turns: m.turns, angles: m.angles || [], startHeading: m.startHeading || 0, openings: m.openings, ceilEls: m.ceilEls || [], radNiches: m.radNiches || [], molding: m.molding || null });
if (rulerUndo[rulerUndo.length - 1] !== snap) rulerUndo.push(snap);
if (rulerUndo.length > 50) rulerUndo.shift();
}
function rulerUndoLast() {
const snap = rulerUndo.pop();
if (!snap) { showAddToast('Отменять нечего'); return; }
Object.assign(measure, JSON.parse(snap));
if (!measure.shape) delete measure.shape;
saveMeasureDraft();
// остаёмся на том же поле, если оно ещё существует
const t = rulerTarget;
if (t && t.kind === 'wall' && t.idx >= measure.walls.length) rulerTarget = { kind: 'wall', idx: Math.max(0, measure.walls.length - 1) };
if (t && t.kind === 'op' && !measure.openings[t.idx]) rulerTarget = null;
if (rulerTarget) { rulerBuf = rulerFieldValue(rulerTarget); rulerFresh = true; }
else document.getElementById('measurePanel').classList.remove('ruler-open');
renderMeasure();
renderRulerPad();
showAddToast('Отменено');
}

/* ---------- геометрия ---------- */
function rulerGeometry(m) {
const shape = rlShape(m);
const lens = m.walls.map(mNum);
const real = lens.filter(v => v > 0);
const avg = real.length ? real.reduce((a, b) => a + b, 0) / real.length : 3;
const turns = shape === 'L' ? RL_L_TURNS : shape === 'rect' ? ['R', 'R', 'R', 'R'] : (Array.isArray(m.turns) ? m.turns : []);
const ph = shape === 'L' ? RL_L_PLACEHOLDER : shape === 'rect' ? RL_RECT_PLACEHOLDER : null;
// Курс в градусах: 0 — вправо, +90 — вниз (поворот направо по часовой)
const turnDeg = i => rlTurnDeg(m, i, turns, shape);
let x = 0, y = 0, hd = shape === 'free' ? (Number(m.startHeading) || 0) : 0;
const segs = [];
lens.forEach((L, i) => {
const len = L > 0 ? L : (ph ? ph[i] * (real.length ? avg / 3 : 1) : avg * 0.6);
const rad = hd * Math.PI / 180;
const dx = Math.abs(Math.cos(rad)) < 1e-9 ? 0 : Math.cos(rad), dy = Math.abs(Math.sin(rad)) < 1e-9 ? 0 : Math.sin(rad);
const nx = x + dx * len, ny = y + dy * len;
segs.push({ i, x1: x, y1: y, x2: nx, y2: ny, dx, dy, len: L, empty: !(L > 0), heading: hd });
x = nx; y = ny;
hd = hd + turnDeg(i);
});
const gap = Math.hypot(x, y);
const closed = real.length >= 3 && real.length === lens.length && gap < 0.02;
let n = lens.length;
while (n > 0 && !(lens[n - 1] > 0)) n--;
const lastReal = n ? segs[n - 1] : null;
const checkGap = lastReal ? Math.hypot(lastReal.x2, lastReal.y2) : 0;
const checkable = n >= 3 && lens.slice(0, n).every(v => v > 0);
let hAfter = shape === 'free' ? (Number(m.startHeading) || 0) : 0; // от начального направления комнаты
for (let i = 0; i < n; i++) hAfter += turnDeg(i);
const lx = lastReal ? lastReal.x2 : 0, ly = lastReal ? lastReal.y2 : 0;
const ndx = Math.cos(hAfter * Math.PI / 180), ndy = Math.sin(hAfter * Math.PI / 180);
// «Замкнуть по месту»: стена прямо в начало комнаты под нужным углом
let closeAny = null;
if (checkable && lastReal && checkGap > 0.02) {
const want = Math.atan2(-ly, -lx) * 180 / Math.PI;
let turn = want - lastReal.heading;
while (turn > 180) turn -= 360;
while (turn <= -180) turn += 360;
closeAny = { len: checkGap, dir: turn >= 0 ? 'R' : 'L', interior: 180 - Math.abs(turn) };
}
const along = -(lx * ndx + ly * ndy), across = Math.abs(-lx * ndy + ly * ndx);
const closeLen = checkable && along > 0.01 && across < 0.02 ? along : 0;
// Направление обхода: по часовой (повороты в основном направо) или против.
// От него зависит, где «снаружи» стены — туда идут размеры.
let area2 = 0;
const pts = [[0, 0], ...segs.map(q => [q.x2, q.y2])];
for (let i = 0; i < pts.length - 1; i++) area2 += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
area2 += pts[pts.length - 1][0] * pts[0][1] - pts[0][0] * pts[pts.length - 1][1];
const orient = area2 < 0 ? -1 : 1;
return { segs, endX: x, endY: y, gap, closed, realCount: real.length, checkGap, checkable,
checkClosed: checkable && checkGap < 0.02, closeLen, closeAny, nextDir: [ndx, ndy], lastX: lx, lastY: ly, filled: n, avg, orient };
}

function rulerCheckText(g) {
if (rlShape(measure) === 'rect') {
const m = measure;
return mNum(m.walls[0]) && mNum(m.walls[1]) ? '<span class="rl-ok">Комната сошлась</span>' : '';
}
if (!g.checkable) return '';
if (g.checkClosed) return '<span class="rl-ok">Комната сошлась</span>';
if (rulerTarget && rulerTarget.kind === 'wall' && !rlEditBase) return `<span class="rl-wait">До угла ${mFmt(g.checkGap)} м</span>`;
const fix = !rulerTarget && rlShape(measure) !== 'rect' ? rulerFixOption(-1) : null;
return `<span class="rl-bad">Не сходится на ${mFmt(g.checkGap)} м</span>${fix ? ` <button type="button" class="rl-fix-inline" onclick="rulerApplyFix(-1)">${escapeHtml(fix.label)}</button>` : ''}`;
}

/* ---------- чертёж ---------- */
/* ---------- развёртка стены ---------- */
// Стена «лицом»: длина × высота, окна и двери на своих местах, цепочка
// размеров снизу. Всё касается пальцем и правится той же клавиатурой.
let rlView = 'plan';      // 'plan' | 'elev'
let rlElevWall = 0;

function rulerSetView(v) {
rlView = v;
const t = rulerTarget;
if (v === 'elev' && t) {
if (t.kind === 'wall' || t.kind === 'wallH' || t.kind === 'angle') rlElevWall = t.idx;
else if (t.kind === 'op' && measure.openings[t.idx] && typeof measure.openings[t.idx].wall === 'number') rlElevWall = measure.openings[t.idx].wall;
}
rlElevWall = Math.min(Math.max(0, rlElevWall), Math.max(0, measure.walls.length - 1));
renderMeasure();
}

function rulerElevStep(d) {
const n = measure.walls.length;
rlElevWall = (rlElevWall + d + n) % n;
renderMeasure();
}

// Высота стены: своя, если задана, иначе общая
function wallHeightOf(m, i) {
const own = mNum((m.wallHeights || [])[i]);
return own || mNum(m.height);
}

// Где проём по высоте (метры от пола): [низ, верх]
function openingVert(o, wallH) {
const h = o.type === 'balcony' ? winH(o) : mNum(o.h);
if (o.type === 'door') return { y0: 0, y1: h, guess: false };
if (o.type === 'balcony') {
const dh = mNum(o.dh);
return { y0: Math.max(0, dh - h), y1: dh, guess: false, door: [0, dh] };
}
const sill = (o.sill !== undefined && String(o.sill).trim() !== '') ? evalMeasureExpr(o.sill) : NaN;
if (isFinite(sill) && sill >= 0) return { y0: sill, y1: sill + h, guess: false };
// подоконник не задан — условно 0,8 м, рисуем пунктиром
const y0 = Math.max(0, Math.min(0.8, wallH - h));
return { y0, y1: y0 + h, guess: true };
}

function renderElevation(box) {
const m = measure;
const g = rulerGeometry(m);
const i = Math.min(rlElevWall, g.segs.length - 1);
const s = g.segs[i];
const L = s && s.len > 0 ? s.len : 0;
const Hh = wallHeightOf(m, i);
const W = 320, H = 230;
const left = 44, right = 18, top = 26, bottom = 62;
const t = rulerTarget;
let out = '';
let grid = '';
for (let gx = 0; gx <= W; gx += 16) grid += `M${gx} 0V${H}`;
for (let gy = 0; gy <= H; gy += 16) grid += `M0 ${gy}H${W}`;
out += `<path d="${grid}" stroke="#eff1f4" stroke-width="1"/>`;
if (!(L > 0) || !(Hh > 0)) {
out += `<text x="${W / 2}" y="${H / 2 - 8}" text-anchor="middle" font-size="13" fill="#586270">${!(L > 0) ? 'Введите длину стены' : 'Введите высоту стен'}</text>`;
out += `<text x="${W / 2}" y="${H / 2 + 12}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#14181f" style="cursor:pointer" onclick="rulerEdit('${!(L > 0) ? 'wall' : 'height'}', ${i})">Коснитесь, чтобы ввести</text>`;
box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Развёртка стены">${out}</svg>`;
return;
}
const k = Math.min((W - left - right) / L, (H - top - bottom) / Hh);
const x0 = left + ((W - left - right) - L * k) / 2, yF = top + Hh * k; // пол
// смотрим на стену изнутри комнаты: угол А слева при обходе по часовой
const flip = (g.orient || 1) < 0;
const XA = a => flip ? x0 + (L - a) * k : x0 + a * k;
const Yh = hgt => yF - hgt * k;
const selWall = t && (t.kind === 'wall' || t.kind === 'wallH') && t.idx === i;
// стена
out += `<rect x="${x0}" y="${Yh(Hh)}" width="${L * k}" height="${Hh * k}" fill="#ffffff" stroke="${selWall ? '#e8a900' : '#14181f'}" stroke-width="${selWall ? 3 : 1.6}"/>`;
out += `<path d="M${x0 - 8} ${yF}H${x0 + L * k + 8}" stroke="#14181f" stroke-width="4"/>`;
// лепнина: карниз, плинтус, рамки и линии молдингов
if (typeof molElevShapes === 'function') out += molElevShapes(m, i, XA, Yh, L, Hh);
// углы А и Б
const cornerA = XA(0), cornerB = XA(L);
[[cornerA, 'А'], [cornerB, 'Б']].forEach(([cx, letter]) => {
out += `<circle cx="${cx}" cy="${Yh(Hh) - 12}" r="9" fill="#ffffff" stroke="#14181f" stroke-width="1.2"/><text x="${cx}" y="${Yh(Hh) - 8}" text-anchor="middle" font-size="11" font-weight="700" fill="#14181f">${letter}</text>`;
});
// закрыто мебелью — серой штриховкой, с кодом и названием
// куски стены за мебелью: сам шкаф на этой стене и бока шкафов с соседних стен
const covHere = typeof coversCompute === 'function' ? coversCompute(m).pieces.filter(e => e.wall === i) : [];
if (covHere.length) out += `<defs><pattern id="rlCovHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V6" stroke="#9aa3ad" stroke-width="1.4"/></pattern></defs>`;
covHere.forEach(e => {
const xL = Math.min(XA(e.span[0]), XA(e.span[1])), xR = Math.max(XA(e.span[0]), XA(e.span[1]));
out += `<rect x="${xL}" y="${Yh(e.top)}" width="${xR - xL}" height="${e.h * k}" fill="#eceff2"/><rect x="${xL}" y="${Yh(e.top)}" width="${xR - xL}" height="${e.h * k}" fill="url(#rlCovHatch)" stroke="#5d6878" stroke-width="1.2"/>`;
const lbl = e.side ? e.code + ' бок' : e.code + (e.name ? ' ' + e.name : '');
const cy = Yh((e.top + e.bottom) / 2);
out += `<text x="${(xL + xR) / 2}" y="${cy + 4}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#33404f" paint-order="stroke" stroke="#ffffff" stroke-width="3">${escapeHtml(xR - xL < lbl.length * 6 ? e.code : lbl)}</text>`;
// не до потолка — высота мебели справа
if (!e.toCeil && xR - xL > 30) {
const hx = xR - 6;
out += `<path d="M${hx} ${Yh(e.bottom)}V${Yh(e.top)}M${hx - 3} ${Yh(e.top)}h6" stroke="#33404f" stroke-width="1"/>`;
out += `<text x="${hx - 3}" y="${Yh(e.top) + 11}" text-anchor="end" font-size="10" fill="#33404f" paint-order="stroke" stroke="#eceff2" stroke-width="3">↕${mFmt(e.h)}</text>`;
}
});
// участки стен (плитка, фартук, панели) — голубой заливкой с синей штриховой рамкой
const partHere = typeof partsCompute === 'function' ? partsCompute(m).filter(e => e.wall === i && e.span) : [];
partHere.forEach(e => {
const xL = Math.min(XA(e.span[0]), XA(e.span[1])), xR = Math.max(XA(e.span[0]), XA(e.span[1]));
out += `<rect x="${xL}" y="${Yh(e.top)}" width="${xR - xL}" height="${e.h * k}" fill="#2f6fc0" fill-opacity=".12" stroke="#2f6fc0" stroke-width="1.4" stroke-dasharray="6 3"/>`;
const lbl = e.code + (e.name ? ' ' + e.name : '');
out += `<text x="${xL + 4}" y="${Yh(e.top) + 12}" font-size="10.5" font-weight="700" fill="#1f4f8f" paint-order="stroke" stroke="#ffffff" stroke-width="3">${escapeHtml(xR - xL < lbl.length * 6 ? e.code : lbl)}</text>`;
// высота участка — справа внутри, если он не до потолка
if (!e.toCeil && e.h * k > 22) {
const hx = xR - 5;
out += `<path d="M${hx} ${Yh(e.bottom)}V${Yh(e.top)}M${hx - 3} ${Yh(e.top)}h6M${hx - 3} ${Yh(e.bottom)}h6" stroke="#1f4f8f" stroke-width="1"/>`;
out += `<text x="${hx - 3}" y="${Yh((e.top + e.bottom) / 2) + 4}" text-anchor="end" font-size="10" fill="#1f4f8f" paint-order="stroke" stroke="#ffffff" stroke-width="3">${mFmt(e.h)}</text>`;
}
// низ выше пола — размер от пола у левого края
if (e.bottom > 0.005 && e.bottom * k > 14) {
const dx = xL + 6;
out += `<path d="M${dx} ${yF}V${Yh(e.bottom)}M${dx - 3} ${Yh(e.bottom)}h6" stroke="#1f4f8f" stroke-width="1"/>`;
out += `<text x="${dx + 4}" y="${(yF + Yh(e.bottom)) / 2 + 4}" font-size="10" fill="#1f4f8f" paint-order="stroke" stroke="#ffffff" stroke-width="3">${mFmt(e.bottom)}</text>`;
}
});
// ниши в стенах — штриховой рамкой, с кодом и глубиной
const radHere = typeof radNichesCompute === 'function' ? radNichesCompute(m).list.filter(e => e.wall === i && e.span) : [];
radHere.forEach(e => {
const xL = Math.min(XA(e.span[0]), XA(e.span[1])), xR = Math.max(XA(e.span[0]), XA(e.span[1]));
// низ ниши выше пола — размер от пола у левого края
if (e.raised) {
const dx = xL + 6;
out += `<path d="M${dx} ${yF}V${Yh(e.bottom)}M${dx - 3} ${yF}h6M${dx - 3} ${Yh(e.bottom)}h6" stroke="#8a6d3b" stroke-width="1"/>`;
// низкий отступ — подпись слева от ниши, чтобы не налезать на неё
const low = yF - Yh(e.bottom) < 16;
out += `<text x="${low ? xL - 3 : dx + 4}" y="${(yF + Yh(e.bottom)) / 2 + 4}" text-anchor="${low ? 'end' : 'start'}" font-size="10" fill="#8a6d3b" paint-order="stroke" stroke="#ffffff" stroke-width="3">${mFmt(e.bottom)}</text>`;
}
out += `<rect x="${xL}" y="${Yh(e.top)}" width="${xR - xL}" height="${(e.top - e.bottom) * k}" fill="#f1ece4" stroke="#8a6d3b" stroke-width="1.2" stroke-dasharray="4 2"/>`;
out += `<text x="${(xL + xR) / 2}" y="${Yh((e.top + e.bottom) / 2) + 4}" text-anchor="middle" font-size="10" font-weight="700" fill="#8a6d3b">${e.code}${e.d ? ' · ' + mFmt(e.d) : ''}</text>`;
});
// проёмы
const ops = (m.openings || []).map((o, oi) => ({ o, oi })).filter(({ o }) => o.wall === i && openingWidth(o) > 0);
const edges = [0, L];
// края ниш в стенах — в цепочку размеров (у ниши под окном совпадают с окном или рядом)
radHere.forEach(e => edges.push(e.span[0], e.span[1]));
covHere.forEach(e => edges.push(e.span[0], e.span[1]));
partHere.forEach(e => { if (!e.full) edges.push(e.span[0], e.span[1]); });
ops.forEach(({ o, oi }) => {
const [a0, a1] = openingSpan(o, L);
edges.push(a0, a1);
const v = openingVert(o, Hh);
const sel = t && t.kind === 'op' && t.idx === oi;
const xL = Math.min(XA(a0), XA(a1)), xR = Math.max(XA(a0), XA(a1));
const col = sel ? '#e8a900' : '#14181f';
if (o.type === 'balcony') {
const bp = balconyParts(o, a0, a1);
const dL = Math.min(XA(bp.door[0]), XA(bp.door[1])), dR = Math.max(XA(bp.door[0]), XA(bp.door[1]));
const wL = Math.min(XA(bp.win[0]), XA(bp.win[1])), wR = Math.max(XA(bp.win[0]), XA(bp.win[1]));
out += `<rect x="${dL}" y="${Yh(v.door[1])}" width="${dR - dL}" height="${v.door[1] * k}" fill="#fff7dc" stroke="${col}" stroke-width="1.6"/>`;
out += `<rect x="${wL}" y="${Yh(v.y1)}" width="${wR - wL}" height="${(v.y1 - v.y0) * k}" fill="#eef4ff" stroke="${col}" stroke-width="1.6"/>`;
out += `<path d="M${(wL + wR) / 2} ${Yh(v.y1)}V${Yh(v.y0)}" stroke="${col}" stroke-width=".8"/>`;
} else {
const isDoor = o.type === 'door';
out += `<rect x="${xL}" y="${Yh(v.y1)}" width="${xR - xL}" height="${(v.y1 - v.y0) * k}" fill="${isDoor ? '#fff7dc' : '#eef4ff'}" stroke="${col}" stroke-width="1.6" ${v.guess ? 'stroke-dasharray="4 3"' : ''}/>`;
if (!isDoor) out += `<path d="M${(xL + xR) / 2} ${Yh(v.y1)}V${Yh(v.y0)}M${xL} ${Yh((v.y0 + v.y1) / 2)}H${xR}" stroke="${col}" stroke-width=".8" ${v.guess ? 'stroke-dasharray="3 3"' : ''}/>`;
}
// высота проёма — подпись внутри
const label = o.type === 'balcony' ? `${mFmt(winH(o))} / ${mFmt(mNum(o.dh))}` : mFmt(mNum(o.h));
out += `<text x="${(xL + xR) / 2}" y="${Yh((v.y0 + v.y1) / 2) - 6}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#14181f">${o.type === 'door' ? 'дверь' : o.type === 'balcony' ? 'балк.' : 'окно'}</text>`;
out += `<text x="${(xL + xR) / 2}" y="${Yh((v.y0 + v.y1) / 2) + 9}" text-anchor="middle" font-size="11" fill="#586270">↕ ${label}</text>`;
// подоконник — размер от пола
if (o.type !== 'door' && o.type !== 'balcony') {
const sx = xR + 7;
out += `<path d="M${sx} ${yF}V${Yh(v.y0)}M${sx - 3} ${yF}h6M${sx - 3} ${Yh(v.y0)}h6" stroke="#586270" stroke-width="1"/>`;
out += `<text x="${sx + 4}" y="${(yF + Yh(v.y0)) / 2 + 4}" font-size="10.5" fill="${v.guess ? '#c2361f' : '#586270'}">${v.guess ? '?' : mFmt(v.y0)}</text>`;
out += `<rect x="${sx - 8}" y="${Yh(v.y0)}" width="24" height="${v.y0 * k}" fill="transparent" style="cursor:pointer" onclick="rulerEdit('op', ${oi}, 'sill')"><title>Подоконник от пола</title></rect>`;
}
// касание проёма — изменить
out += `<rect x="${xL}" y="${Yh(v.y1)}" width="${xR - xL}" height="${(v.y1 - v.y0) * k}" fill="transparent" style="cursor:pointer" onclick="rulerEdit('op', ${oi}, 'w')"><title>Изменить проём</title></rect>`;
});
// цепочка размеров снизу
const pts = [...new Set(edges.map(e => Math.round(e * 1000) / 1000))].sort((a, b) => a - b);
const yC = yF + 18;
for (let j = 0; j < pts.length - 1; j++) {
const pa = XA(pts[j]), pb = XA(pts[j + 1]);
const lo = Math.min(pa, pb), hi = Math.max(pa, pb);
out += `<path d="M${lo} ${yC}H${hi}M${lo} ${yC - 5}v10M${hi} ${yC - 5}v10" stroke="#586270" stroke-width="1"/>`;
const seg = pts[j + 1] - pts[j];
if (hi - lo > 14) out += `<text x="${(lo + hi) / 2}" y="${yC - 4}" text-anchor="middle" font-size="10.5" fill="#14181f">${mFmt(seg)}</text>`;
}
// общая длина — касание правит стену
const yT = yF + 42;
out += `<path d="M${x0} ${yT}H${x0 + L * k}M${x0} ${yT - 6}v12M${x0 + L * k} ${yT - 6}v12" stroke="#14181f" stroke-width="1.2"/>`;
out += `<text x="${x0 + L * k / 2}" y="${yT - 5}" text-anchor="middle" font-size="13" font-weight="700" fill="#14181f">${mFmt(L)} м</text>`;
out += `<rect x="${x0}" y="${yT - 22}" width="${L * k}" height="30" fill="transparent" style="cursor:pointer" onclick="rulerEdit('wall', ${i})"><title>Длина стены</title></rect>`;
// высота стены слева — касание правит свою высоту
const xh = x0 - 18;
out += `<path d="M${xh} ${yF}V${Yh(Hh)}M${xh - 5} ${yF}h10M${xh - 5} ${Yh(Hh)}h10" stroke="#14181f" stroke-width="1.2"/>`;
out += `<text x="${xh - 4}" y="${(yF + Yh(Hh)) / 2}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#14181f" transform="rotate(-90 ${xh - 4} ${(yF + Yh(Hh)) / 2})">${mFmt(Hh)}${mNum((m.wallHeights || [])[i]) ? ' (своя)' : ''}</text>`;
out += `<rect x="${xh - 20}" y="${Yh(Hh)}" width="30" height="${Hh * k}" fill="transparent" style="cursor:pointer" onclick="rulerEdit('wallH', ${i})"><title>Высота этой стены</title></rect>`;
box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Развёртка стены ${i + 1}" font-family="inherit">${out}</svg>`;
// площадь стены
const opsArea = ops.reduce((a, { o }) => a + (o.type === 'balcony' ? mNum(o.w) * winH(o) + mNum(o.dw) * mNum(o.dh) : mNum(o.w) * mNum(o.h)) * mCount(o.n), 0);
const sum = document.getElementById('rlElevSum');
const covArea = L < 1 ? 0 : covHere.reduce((a, e) => a + e.area, 0);
const covCut = covHere.filter(e => e.full).reduce((a, e) => a + e.h, 0);
if (sum) sum.innerHTML = L < 1
? (covCut >= Hh - 0.005
? `Стена ${i + 1}: уже метра (${mFmt(L)} м), целиком за мебелью — не обрабатывается`
: `Стена ${i + 1}: уже метра (${mFmt(L)} м) — узкая, считается по высоте: <b>${mFmt(minLen(Hh - covCut))} пог. м</b>${covCut > 0 ? ' (без мебели)' : ''} (во вкладке «Узкие»)`)
: `Стена ${i + 1}: ${mFmt(L)} × ${mFmt(Hh)} = <b>${mFmt(L * Hh)} м²</b>${opsArea > 0 ? ` − проёмы ${mFmt(opsArea)}` : ''}${covArea > 0 ? ` − мебель ${mFmt(covArea)}` : ''}${opsArea > 0 || covArea > 0 ? ` = <b>${mFmt(Math.max(0, L * Hh - opsArea - covArea))} м²</b>` : ''}`;
const nav = document.getElementById('rlElevNav');
if (nav) nav.textContent = `Стена ${i + 1} из ${g.segs.length}`;
}

/* ---------- чертёж стен во весь экран ---------- */
let rlFull = false;
// высота чертежа в единицах рисунка: во весь экран — по пропорциям экрана
function rlH(box) {
if (rlFull && box && box.clientWidth > 0 && box.clientHeight > 0) return Math.round(320 * box.clientHeight / box.clientWidth);
return 230;
}
function rulerToggleFull(on) {
rlFull = typeof on === 'boolean' ? on : !rlFull;
const box = document.getElementById('rlSketch');
if (box) box.classList.toggle('full', rlFull);
document.body.classList.toggle('rl-full-open', rlFull);
// вписываем заново под новый размер
if (!rlUnderlayAdjust && !rlEditBase) rlLastFit = null;
rlPan = { x: 0, y: 0 }; rlZoom = 1;
renderRulerSketch();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && rlFull && !rulerTarget) rulerToggleFull(false); });
window.addEventListener('resize', () => { if (rlFull) renderRulerSketch(); });

function renderRulerSketch() {
const box = document.getElementById('rlSketch');
if (!box) return;
const m = measure;
const shape = rlShape(m);
if ((!shape || rlView === 'elev') && rlFull) { rlFull = false; box.classList.remove('full'); document.body.classList.remove('rl-full-open'); }
if (!shape) { box.innerHTML = rulerShapePickerHtml(); const c = document.getElementById('rlCheck'); if (c) c.innerHTML = ''; return; }
if (rlView === 'elev') {
renderElevation(box);
const chk0 = document.getElementById('rlCheck');
if (chk0) chk0.innerHTML = rulerCheckText(rulerGeometry(m));
const hb0 = document.getElementById('rlHeightVal');
if (hb0) hb0.textContent = mNum(m.height) ? mFmt(mNum(m.height)) + ' м' : 'не задана';
return;
}
const g = rulerGeometry(m);
// во весь экран с открытой клавиатурой — чертёж над ней, а не под ней
if (rlFull) {
const pad = document.querySelector('#measurePanel.ruler-open .rl-pad');
box.style.bottom = pad && pad.offsetHeight ? pad.offsetHeight + 'px' : '';
} else box.style.bottom = '';
const W = 320, H = rlH(box), P = 38;
const xs = [0, ...g.segs.map(s => s.x2)], ys = [0, ...g.segs.map(s => s.y2)];
let ghost = null;
const draftingLast = rulerTarget && rulerTarget.kind === 'wall' && rulerTarget.idx >= m.walls.length - 1;
if (shape === 'free' && g.filled === g.segs.length && !g.checkClosed && !rlEditBase && draftingLast) {
const gl = Math.max(g.avg * 0.45, 0.6);
ghost = { x1: g.lastX, y1: g.lastY, x2: g.lastX + g.nextDir[0] * gl, y2: g.lastY + g.nextDir[1] * gl };
xs.push(ghost.x2); ys.push(ghost.y2);
}
const ul = typeof getUnderlay === 'function' ? getUnderlay(m.id) : null;
// подложку вписываем целиком только при подстройке (или пока стен нет);
// в обычном режиме чертёж вписан по стенам, подложка — фоном
if (ul && !ul.hidden && (rlUnderlayAdjust || !g.realCount)) underlayCorners(ul).forEach(([px, py]) => { xs.push(px); ys.push(py); });
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
let k = Math.min((W - 2 * P) / Math.max(maxX - minX, 0.5), (H - 2 * P) / Math.max(maxY - minY, 0.5));
let ox = (W - (maxX - minX) * k) / 2 - minX * k, oy = (H - (maxY - minY) * k) / 2 - minY * k;
// пока подстраиваем подложку, масштаб чертежа замираем — иначе она «плывёт» под пальцем
if ((rlUnderlayAdjust || rlEditBase) && rlLastFit) {
({ k, ox, oy } = rlLastFit);
// масштаб заморожен, а высота чертежа поменялась (клавиатура во весь экран) — держим по центру
if (rlLastFit.H && rlLastFit.H !== H) oy += (H - rlLastFit.H) / 2;
}
rlLastFit = { k, ox, oy, H };
// Приближение растягивает только саму комнату: цифры, номера и толщина
// линий остаются обычного размера, поэтому в тесных местах подписи расходятся
const z = rlZoom;
const vx = (W - W / z) / 2 + rlPan.x, vy = (H - H / z) / 2 + rlPan.y;
const Xb = v => ox + v * k, Yb = v => oy + v * k;      // без приближения
const X = v => (Xb(v) - vx) * z, Y = v => (Yb(v) - vy) * z;
const t = rulerTarget;
const sel = t && (t.kind === 'wall' || t.kind === 'wallH' || t.kind === 'angle') ? t.idx : -1;
const opSel = t && t.kind === 'op' ? measure.openings[t.idx] : null;
const opWall = opSel && typeof opSel.wall === 'number' ? opSel.wall : -1;
const linked = i => shape === 'rect' && sel >= 0 && i % 2 === sel % 2;
const o2 = g.orient;
let out = '';
// миллиметровка движется вместе с чертежом
let grid = '';
const step = 16;
const gx0 = ((-vx * z) % step + step) % step, gy0 = ((-vy * z) % step + step) % step;
for (let gx = gx0; gx <= W; gx += step) grid += `M${gx} 0V${H}`;
for (let gy = gy0; gy <= H; gy += step) grid += `M0 ${gy}H${W}`;
out += `<path d="${grid}" stroke="#eff1f4" stroke-width="1"/>`;
// прежний контур (до правки) — бледным пунктиром, чтобы было видно, что сдвинулось
if (rlEditBase && rlEditBase.json !== JSON.stringify([m.walls, m.turns, m.angles])) {
out += `<path d="M${rlEditBase.pts.map(([px, py]) => `${X(px)} ${Y(py)}`).join('L')}Z" fill="none" stroke="#8a929c" stroke-width="2" stroke-dasharray="5 4" opacity=".7"/>`;
}
// подложка — фото плана под чертежом
if (ul && !ul.hidden) {
const uh = ul.w * ul.ar, ucx = ul.x + ul.w / 2, ucy = ul.y + uh / 2;
const tr = `rotate(${ul.rot || 0} ${X(ucx)} ${Y(ucy)})`;
out += `<image href="${underlayHref(m.id, ul.src)}" x="${X(ul.x)}" y="${Y(ul.y)}" width="${ul.w * k * z}" height="${uh * k * z}" preserveAspectRatio="none" opacity="${ul.op || 0.45}" transform="${tr}"/>`;
if (rlUnderlayAdjust) out += `<rect x="${X(ul.x)}" y="${Y(ul.y)}" width="${ul.w * k * z}" height="${uh * k * z}" fill="none" stroke="#e8a900" stroke-width="2" stroke-dasharray="6 4" transform="${tr}"/>`;
}
// ниши и короба потолка — бледной полосой со штриховой кромкой
if (Array.isArray(m.ceilEls) && m.ceilEls.length && typeof ceilElStrips === 'function') {
m.ceilEls.forEach(el => {
const isBox = el.type === 'box';
ceilElStrips(m, el, g).forEach(p => {
out += `<path d="M${p.poly.map(([x, y]) => `${X(x)} ${Y(y)}`).join('L')}Z" fill="${isBox ? '#ffe7a3' : '#cfe3ff'}" opacity=".75"/>`;
out += `<path d="${ceilStripEdge(p, X, Y)}" fill="none" stroke="${isBox ? '#a87b00' : '#2f6fc0'}" stroke-width="1.2" stroke-dasharray="5 3"/>`;
if (el.light) { const [l0, l1] = ceilLightPts(p); out += `<path d="M${X(l0[0])} ${Y(l0[1])}L${X(l1[0])} ${Y(l1[1])}" stroke="#ff8c00" stroke-width="2" stroke-linecap="round" stroke-dasharray="0.1 4"/>`; }
});
});
}
if (shape === 'free' && g.segs.length >= 2 && g.filled === g.segs.length && !g.checkClosed && g.checkGap > 0.02 && !ghost) {
out += `<path d="M${X(g.endX)} ${Y(g.endY)}L${X(0)} ${Y(0)}" stroke="#c2361f" stroke-width="1.5" stroke-dasharray="4 4"/>`;
}
// закрыто мебелью: с глубиной — контур шкафа в масштабе, без глубины — штрихованная полоса вдоль стены
if (Array.isArray(m.covers) && m.covers.length && typeof coversCompute === 'function') {
const covs = coversCompute(m).list.filter(e => e.span && g.segs[e.wall]);
if (covs.length) out += `<defs><pattern id="rlCovHatchP" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V5" stroke="#8a939d" stroke-width="1.3"/></pattern></defs>`;
covs.forEach(e => {
const s = g.segs[e.wall];
const nx = -s.dy * o2, ny = s.dx * o2;   // внутрь комнаты
const W0 = a => [s.x1 + s.dx * a, s.y1 + s.dy * a];
let pts;
if (e.d > 0) {
pts = [W0(e.span[0]), W0(e.span[1])];
pts.push([pts[1][0] + nx * e.d, pts[1][1] + ny * e.d], [pts[0][0] + nx * e.d, pts[0][1] + ny * e.d]);
pts = pts.map(([x, y]) => [X(x), Y(y)]);
} else {
const d = 9, [ax, ay] = [X(W0(e.span[0])[0]), Y(W0(e.span[0])[1])], [bx, by] = [X(W0(e.span[1])[0]), Y(W0(e.span[1])[1])];
pts = [[ax + nx * 3, ay + ny * 3], [bx + nx * 3, by + ny * 3], [bx + nx * (3 + d), by + ny * (3 + d)], [ax + nx * (3 + d), ay + ny * (3 + d)]];
}
out += `<path d="M${pts.map(p => p.join(' ')).join('L')}Z" fill="#eceff2" opacity=".9"/><path d="M${pts.map(p => p.join(' ')).join('L')}Z" fill="url(#rlCovHatchP)" stroke="#5d6878" stroke-width="1"/>`;
if (e.d > 0) {
const cx = pts.reduce((a, p) => a + p[0], 0) / 4, cy = pts.reduce((a, p) => a + p[1], 0) / 4;
out += `<text x="${cx}" y="${cy + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="#33404f" paint-order="stroke" stroke="#ffffff" stroke-width="3">${e.code}</text>`;
}
});
}
// участки стен — синей линией вдоль стены изнутри
if (Array.isArray(m.parts) && m.parts.length && typeof partsCompute === 'function') {
partsCompute(m).filter(e => e.span && g.segs[e.wall]).forEach(e => {
const s = g.segs[e.wall];
const nx = -s.dy * o2, ny = s.dx * o2, d = 5;
const P2 = a => [X(s.x1 + s.dx * a) + nx * d, Y(s.y1 + s.dy * a) + ny * d];
const [ax, ay] = P2(e.span[0]), [bx, by] = P2(e.span[1]);
out += `<path d="M${ax} ${ay}L${bx} ${by}" stroke="#2f6fc0" stroke-width="3" stroke-dasharray="6 3" stroke-linecap="butt"/>`;
});
}
const wh = Array.isArray(m.wallHeights) ? m.wallHeights : [];
g.segs.forEach(s => {
const on = s.i === sel || linked(s.i) || s.i === opWall;
out += `<path d="M${X(s.x1)} ${Y(s.y1)}L${X(s.x2)} ${Y(s.y2)}" stroke="${on ? '#ffc83d' : '#14181f'}" stroke-width="${on ? 8 : 5}" stroke-linecap="square" ${s.empty && !on ? 'stroke-dasharray="6 6" opacity=".35"' : ''}/>`;
if (on) out += `<path d="M${X(s.x1)} ${Y(s.y1)}L${X(s.x2)} ${Y(s.y2)}" stroke="#14181f" stroke-width="1.5"/>`;
const mx = (X(s.x1) + X(s.x2)) / 2, my = (Y(s.y1) + Y(s.y2)) / 2;
const own = mNum(wh[s.i]);
const label = s.empty ? '' : mFmt(s.len) + (own ? ` ↕${mFmt(own)}` : '');
if (label) out += `<text x="${mx + s.dy * 18 * o2}" y="${my - s.dx * 18 * o2 + 4}" text-anchor="middle" font-size="13.5" font-weight="${on ? 700 : 500}" fill="#14181f">${escapeHtml(label)}</text>`;
// номер стены: если середину стены занимает окно или дверь — сдвигаем к краю
let bf = 0.5;
const wlb = s.len > 0 ? s.len : Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
(m.openings || []).forEach(op => {
if (op.wall !== s.i) return;
const [p0, p1] = openingSpan(op, wlb);
if (p0 <= wlb * 0.5 + 0.25 && p1 >= wlb * 0.5 - 0.25) {
// в свободный промежуток; если проём выбран — с той стороны, где нет размера отступа
const before = p0, after = wlb - p1;
let side = before >= after ? 'before' : 'after';
if (opSel === op) side = op.from === 'end' ? 'before' : 'after';
bf = side === 'before' ? (p0 / 2) / wlb : (p1 + after / 2) / wlb;
}
});
const bmx = X(s.x1 + (s.x2 - s.x1) * bf), bmy = Y(s.y1 + (s.y2 - s.y1) * bf);
const bx = bmx - s.dy * 16 * o2, by = bmy + s.dx * 16 * o2;
out += `<circle cx="${bx}" cy="${by}" r="9" fill="${on ? '#14181f' : '#ffffff'}" stroke="#14181f" stroke-width="1.2"/>`;
out += `<text x="${bx}" y="${by + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${on ? '#ffc83d' : '#14181f'}">${s.i + 1}</text>`;
});
// углы не по 90° — подпись в углу
if (shape === 'free' && Array.isArray(m.angles)) {
g.segs.forEach(s => {
const a = mNum(m.angles[s.i]);
if (!(a > 0) || Math.abs(a - 90) < 0.05 || Math.abs(a - 180) < 0.05 || s.i === g.segs.length - 1 && !g.closed) return;
const cx = X(s.x2), cy = Y(s.y2);
out += `<text x="${cx - s.dy * 14 * o2 - s.dx * 12}" y="${cy + s.dx * 14 * o2 - s.dy * 12 + 4}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#c2361f">${mFmt(a)}°</text>`;
});
}
// проёмы
let opHits = '';
rlOpHits = {};
(m.openings || []).forEach((o, oi) => {
if (typeof o.wall !== 'number') return;
const s = g.segs[o.wall];
if (!s) return;
const wl = s.len > 0 ? s.len : Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const [a0, a1] = openingSpan(o, wl);
const P2 = a => [X(s.x1 + s.dx * a), Y(s.y1 + s.dy * a)];
const [ax, ay] = P2(a0), [bx, by] = P2(a1);
// для перетаскивания: направление стены на экране и масштаб
rlOpHits[oi] = { ux: s.dx, uy: s.dy, ppm: k * z, L: wl, a0, ow: a1 - a0 };
const picked = opSel === o;
if (picked) out += `<path d="M${ax} ${ay}L${bx} ${by}" stroke="#ffc83d" stroke-width="16" stroke-linecap="round" opacity=".85"/>`;
out += `<path d="M${ax} ${ay}L${bx} ${by}" stroke="#ffffff" stroke-width="9"/>`;
// зона касания проёма — поверх стен
opHits += `<path data-op="${oi}" d="M${ax} ${ay}L${bx} ${by}" stroke="transparent" stroke-width="28" stroke-linecap="round" style="cursor:grab" onclick="rulerOpTap(${oi})"><title>${o.type === 'door' ? 'Дверь' : o.type === 'balcony' ? 'Балконный блок' : 'Окно'} — коснитесь, чтобы изменить, тащите вдоль стены</title></path>`;
{
// ручка прямо на проёме: видно, что его можно взять и потянуть
// (не внутри комнаты — там она садилась на кружок с номером стены)
const mx2 = (ax + bx) / 2, my2 = (ay + by) / 2, ix = 0, iy = 0;
out += `<circle cx="${mx2 + ix}" cy="${my2 + iy}" r="11" fill="${picked ? '#ffc83d' : '#ffffff'}" stroke="#14181f" stroke-width="1.3"/>`;
out += `<text x="${mx2 + ix}" y="${my2 + iy + 4.5}" text-anchor="middle" font-size="13" font-weight="700" fill="#14181f">⇆</text>`;
// ручку тоже можно взять пальцем
opHits += `<circle data-op="${oi}" cx="${mx2 + ix}" cy="${my2 + iy}" r="18" fill="transparent" style="cursor:grab" onclick="rulerOpTap(${oi})"/>`;
}
const part = (r0, r1, door) => {
const [px, py] = P2(r0), [qx, qy] = P2(r1);
out += `<path d="M${px} ${py}L${qx} ${qy}" stroke="#14181f" stroke-width="${door ? 1.2 : 2.4}" ${door ? 'stroke-dasharray="3 2"' : ''}/>`;
};
if (o.type === 'balcony') { const bp = balconyParts(o, a0, a1); part(bp.win[0], bp.win[1], false); part(bp.door[0], bp.door[1], true); }
else part(a0, a1, o.type === 'door');
out += `<path d="M${ax - s.dy * 6} ${ay + s.dx * 6}L${ax + s.dy * 6} ${ay - s.dx * 6}M${bx - s.dy * 6} ${by + s.dx * 6}L${bx + s.dy * 6} ${by - s.dx * 6}" stroke="#14181f" stroke-width="1.5"/>`;
// отступ от выбранного угла — жёлтой размерной линией
if (opSel === o && mNum(o.off) > 0) {
const fromEnd = o.from === 'end';
const [cx, cy] = P2(fromEnd ? wl : 0), [ex, ey] = fromEnd ? [bx, by] : [ax, ay];
const ix = -s.dy * 14 * o2, iy = s.dx * 14 * o2;
out += `<path d="M${cx + ix} ${cy + iy}L${ex + ix} ${ey + iy}" stroke="#e8a900" stroke-width="2.5"/>`;
out += `<text x="${(cx + ex) / 2 + ix * 1.9}" y="${(cy + ey) / 2 + iy * 1.9 + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#14181f">${mFmt(mNum(o.off))}</text>`;
}
});
// метки углов А и Б у стены, на которую ставится проём
if (opWall >= 0 && g.segs[opWall]) {
const s = g.segs[opWall];
[[s.x1, s.y1, 'А', opSel.from !== 'end'], [s.x2, s.y2, 'Б', opSel.from === 'end']].forEach(([px, py, letter, on]) => {
const cx = X(px) - s.dy * 20 * o2, cy = Y(py) + s.dx * 20 * o2;
out += `<circle cx="${cx}" cy="${cy}" r="10" fill="${on ? '#ffc83d' : '#ffffff'}" stroke="#14181f" stroke-width="1.5"/>`;
out += `<text x="${cx}" y="${cy + 4.5}" text-anchor="middle" font-size="12.5" font-weight="700" fill="#14181f">${letter}</text>`;
});
}
if (ghost) {
const ax = X(ghost.x1), ay = Y(ghost.y1), bx = X(ghost.x2), by = Y(ghost.y2);
const [dx, dy] = g.nextDir;
out += `<path d="M${ax} ${ay}L${bx} ${by}" stroke="#e8a900" stroke-width="3" stroke-dasharray="6 5"/>`;
out += `<path d="M${bx - dx * 9 - dy * 6} ${by - dy * 9 + dx * 6}L${bx} ${by}L${bx - dx * 9 + dy * 6} ${by - dy * 9 - dx * 6}" fill="none" stroke="#e8a900" stroke-width="3" stroke-linejoin="round"/>`;
out += `<text x="${(ax + bx) / 2 + dy * 16}" y="${(ay + by) / 2 - dx * 16 + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="#14181f">стена ${g.segs.length + 1}</text>`;
}
g.segs.forEach(s => {
if (rulerPick) out += `<path class="rl-pickwall" d="M${X(s.x1)} ${Y(s.y1)}L${X(s.x2)} ${Y(s.y2)}" stroke="#ffc83d" stroke-width="14" stroke-linecap="round" opacity=".55"/>`;
out += `<path d="M${X(s.x1)} ${Y(s.y1)}L${X(s.x2)} ${Y(s.y2)}" stroke="transparent" stroke-width="26" style="cursor:pointer" onclick="rulerWallTap(${s.i})"><title>Стена ${s.i + 1}</title></path>`;
});
out += opHits;
// середины стен без приближения — к ним приближаем
rlWallMids = g.segs.map(s => ({ i: s.i, x: (Xb(s.x1) + Xb(s.x2)) / 2, y: (Yb(s.y1) + Yb(s.y2)) / 2 }));
box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Чертёж комнаты" font-family="inherit">${out}</svg>
<div class="rl-zoom">
<button type="button" onclick="rulerZoom(1.6)" aria-label="Приблизить">+</button>
<button type="button" onclick="rulerZoom(1 / 1.6)" aria-label="Отдалить">−</button>
${Math.abs(rlZoom - 1) > 0.01 || Math.abs(rlPan.x) > 1 || Math.abs(rlPan.y) > 1 ? '<button type="button" onclick="rulerZoomReset()" aria-label="Весь чертёж">⤢</button>' : ''}
<button type="button" onclick="rulerToggleFull()" aria-label="${rlFull ? 'Закрыть' : 'Во весь экран'}">${rlFull ? '✕' : '⛶'}</button>
</div>`;
rulerBindPanZoom(box);
const chk = document.getElementById('rlCheck');
if (chk) chk.innerHTML = rulerCheckText(g);
const hb = document.getElementById('rlHeightVal');
if (hb) hb.textContent = mNum(m.height) ? mFmt(mNum(m.height)) + ' м' : 'не задана';
}

/* ---------- приближение и перемещение чертежа ---------- */
let rlZoom = 1, rlPan = { x: 0, y: 0 }, rlDragged = false, rlWallMids = [];
// Приближаем к выбранной стене (или к стене проёма); без выбора — к стене,
// ближайшей к середине того, что сейчас видно
function rulerZoom(f) {
const W = 320, H = rlH(document.getElementById('rlSketch'));
const before = rlZoom;
// отдалять можно до половины исходного размера, приближать — до 5 раз
rlZoom = Math.min(5, Math.max(0.5, rlZoom * f));
if (f > 1) {
const t = rulerTarget;
let idx = -1;
if (t && (t.kind === 'wall' || t.kind === 'wallH' || t.kind === 'angle')) idx = t.idx;
else if (t && t.kind === 'op' && measure.openings[t.idx] && typeof measure.openings[t.idx].wall === 'number') idx = measure.openings[t.idx].wall;
let target = rlWallMids.find(w => w.i === idx);
if (!target && rlWallMids.length) {
const cx = W / 2 + rlPan.x, cy = H / 2 + rlPan.y;
target = rlWallMids.reduce((best, w) => (Math.hypot(w.x - cx, w.y - cy) < Math.hypot(best.x - cx, best.y - cy) ? w : best));
}
if (target && before <= 1.01 && Math.abs(rlPan.x) < 1 && Math.abs(rlPan.y) < 1) rlPan = { x: target.x - W / 2, y: target.y - H / 2 };
else if (target) rlPan = { x: rlPan.x + (target.x - (W / 2 + rlPan.x)) * 0.5, y: rlPan.y + (target.y - (H / 2 + rlPan.y)) * 0.5 };
}
renderRulerSketch();
}
function rulerZoomReset() { rlZoom = 1; rlPan = { x: 0, y: 0 }; renderRulerSketch(); }
let rlOpHits = {};
function rulerOpTap(i) {
if (rlDragged) { rlDragged = false; return; }
rulerEdit('op', i, 'w');
}
function rulerMoveOpening() {
const t = rulerTarget; if (!t || t.kind !== 'op') return;
rulerPick = { move: t.idx, type: measure.openings[t.idx].type };
rulerTarget = null;
document.getElementById('measurePanel').classList.remove('ruler-open');
renderMeasure();
}

function rulerRemoveOpening() {
const t = rulerTarget; if (!t || t.kind !== 'op') return;
rulerSnapshot();
measure.openings.splice(t.idx, 1);
if (typeof remapCeilElOpsAfterRemove === 'function') remapCeilElOpsAfterRemove(measure, t.idx);
rulerTarget = null;
document.getElementById('measurePanel').classList.remove('ruler-open');
saveMeasureDraft();
renderMeasure();
showAddToast('Проём убран — можно отменить ↶');
}

function rulerWallTap(i) {
if (rlDragged) { rlDragged = false; return; }
rulerEdit('wall', i);
}
function rulerBindPanZoom(box) {
if (box.dataset.pz) return;
box.dataset.pz = '1';
const pts = new Map();
let start = null;
const snapshot = () => ({ pan: { ...rlPan }, zoom: rlZoom, pts: new Map(pts), moved: start ? start.moved : false });
box.addEventListener('pointerdown', (e) => {
if (e.target.closest('.rl-zoom')) return;
// палец на проёме — будем тащить его вдоль стены
const opEl = e.target.closest && e.target.closest('[data-op]');
box._op = opEl && rlOpHits[opEl.dataset.op] ? { i: Number(opEl.dataset.op), ...rlOpHits[opEl.dataset.op], started: false } : null;
if (typeof rlUnderlayAdjust !== 'undefined' && rlUnderlayAdjust) {
const u = getUnderlay(measure.id);
box._ul = u ? { x: u.x, y: u.y, w: u.w, ar: u.ar } : null;
}
// Новое касание (первый палец) — жест начинается с чистого листа.
// Иначе «застрявший» палец от прошлого жеста превращал перетаскивание в масштаб.
if (e.isPrimary) pts.clear();
pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
start = { ...snapshot(), moved: false };
rlDragged = false;
});
box.addEventListener('pointermove', (e) => {
if (!pts.has(e.pointerId) || !start) return;
pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
const unit = (320 / rlZoom) / (box.clientWidth || 320);
if (pts.size === 1 && start.pts.size === 1) {
const p0 = start.pts.get(e.pointerId); if (!p0) return;
const dx = e.clientX - p0.x, dy = e.clientY - p0.y;
if (!start.moved && Math.hypot(dx, dy) < 6) return;
// окно по стене и подложка — одним пальцем всегда; сам чертёж — двумя (или во весь экран)
if (!box._op && !(rlUnderlayAdjust && box._ul) && !pzOneFingerPan(box, e)) { pzHint(dx, dy); return; }
if (!start.moved) { try { box.setPointerCapture(e.pointerId); } catch (err) { /* пусто */ } }
start.moved = true; rlDragged = true;
if (box._op) {
const op = box._op, o = measure.openings[op.i];
if (o) {
if (!op.started) {
// начало перетаскивания: выбираем проём, запоминаем для «Отменить»
op.started = true;
rulerSnapshot();
if (!o.from) o.from = 'start';
rulerTarget = { kind: 'op', idx: op.i, field: 'off' };
document.getElementById('measurePanel').classList.add('ruler-open');
}
const scr = 320 / (box.clientWidth || 320);
const d = (dx * op.ux + dy * op.uy) * scr / op.ppm;
const a0 = Math.max(0, Math.min(op.L - op.ow, op.a0 + d));
const off = o.from === 'end' ? op.L - (a0 + op.ow) : a0;
o.off = String(Math.round(off * 100) / 100).replace('.', ',');
rulerBuf = o.off; rulerFresh = true;
saveMeasureDraft();
renderRulerSketch();
renderRulerPad();
}
return;
}
if (rlUnderlayAdjust && box._ul && rlLastFit) {
// двигаем подложку в метрах комнаты
const mpp = (320 / (box.clientWidth || 320)) / (rlLastFit.k * rlZoom);
const u = getUnderlay(measure.id);
if (u) { u.x = box._ul.x + dx * mpp; u.y = box._ul.y + dy * mpp; saveUnderlayView(measure.id, u); }
renderRulerSketch();
return;
}
rlPan = { x: start.pan.x - dx * unit, y: start.pan.y - dy * unit };
renderRulerSketch();
} else if (pts.size === 2) {
// второй палец появился — начинаем масштаб от текущего положения
if (start.pts.size !== 2) { start = { ...snapshot(), moved: true }; return; }
const a = [...pts.values()], b = [...start.pts.values()];
const d1 = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), d0 = Math.hypot(b[0].x - b[1].x, b[0].y - b[1].y) || 1;
if (rlUnderlayAdjust && box._ul) {
// щипок меняет размер подложки, центр остаётся на месте
const u = getUnderlay(measure.id);
if (u) {
const w0 = box._ul.w, h0 = w0 * box._ul.ar, cx = box._ul.x + w0 / 2, cy = box._ul.y + h0 / 2;
u.w = Math.max(0.5, Math.min(200, w0 * d1 / d0));
u.x = cx - u.w / 2; u.y = cy - u.w * u.ar / 2;
saveUnderlayView(measure.id, u);
}
start.moved = true; rlDragged = true;
renderRulerSketch();
return;
}
rlZoom = Math.min(5, Math.max(0.5, start.zoom * d1 / d0));
// и двигаем за центром пальцев
const c1 = pzMid(pts), c0 = pzMid(start.pts);
const u2 = (320 / rlZoom) / (box.clientWidth || 320);
rlPan = { x: start.pan.x - (c1.x - c0.x) * u2, y: start.pan.y - (c1.y - c0.y) * u2 };
start.moved = true; rlDragged = true;
renderRulerSketch();
}
});
// «Отпустил» ловим на всей странице: под пальцем чертёж перерисовывается,
// и событие может уйти в уже удалённый кусок картинки
const end = (e) => {
pts.delete(e.pointerId);
if (!pts.size) start = null;
else start = { ...snapshot(), moved: true }; // остался один палец — продолжаем двигать от текущего места
};
window.addEventListener('pointerup', end);
window.addEventListener('pointercancel', end);
pzGuardTouch(box, () => !!box._op || !!(rlUnderlayAdjust && box._ul));
}

// Где на стене проём (метры от угла А): отступ от выбранного угла, иначе по центру
function openingSpan(o, wallLen) {
const ow = Math.min(openingWidth(o) || 0.9, wallLen * 0.9);
// пустой отступ — по центру стены; 0 — вплотную к углу
const raw = String(o.off == null ? '' : o.off).trim();
const v = raw === '' ? NaN : evalMeasureExpr(raw);
let a0 = (wallLen - ow) / 2;
if (isFinite(v) && v >= 0) a0 = o.from === 'end' ? Math.max(0, wallLen - Math.min(v, wallLen) - ow) : Math.min(v, Math.max(0, wallLen - ow));
return [a0, a0 + ow];
}
// Части балконного блока на стене: где дверь, где окно
function balconyParts(o, a0, a1) {
const dw = Math.min(mNum(o.dw), a1 - a0);
return o.side === 'end'
? { win: [a0, a1 - dw], door: [a1 - dw, a1] }
: { door: [a0, a0 + dw], win: [a0 + dw, a1] };
}

/* ---------- выбор формы ---------- */
function rulerShapePickerHtml() {
const tile = (shape, title, sub, path) => `<button type="button" class="rl-shape" onclick="rulerSetShape('${shape}')">
<svg viewBox="0 0 60 44" width="60" height="44" aria-hidden="true"><path d="${path}" fill="none" stroke="#14181f" stroke-width="3" stroke-linejoin="miter"/></svg>
<b>${title}</b><small>${sub}</small></button>`;
return `<div class="rl-shapes">
<div class="rl-shapes-title">Какая комната?</div>
${tile('rect', 'Прямоугольная', 'длина и ширина', 'M6 6H54V38H6Z')}
${tile('L', 'Г-образная', '6 стен по порядку', 'M6 6H54V38H30V24H6Z')}
${tile('free', 'Своя форма', 'стена за стеной', 'M6 38V6H40L54 20V38Z')}
</div>`;
}

function rulerSetShape(shape) {
const hasData = measure.walls.some(w => mNum(w) > 0);
if (hasData && !confirm('Сменить форму комнаты? Длины стен придётся ввести заново (можно отменить кнопкой ↶).')) return;
rulerSnapshot();
measure.shape = shape;
measure.startHeading = 0;
measure.angles = [];
const n = shape === 'rect' ? 4 : shape === 'L' ? 6 : 1;
measure.walls = Array(n).fill('');
measure.wallHeights = Array(n).fill('');
measure.turns = shape === 'L' ? RL_L_TURNS.slice() : [];
(measure.openings || []).forEach(o => { delete o.wall; });
saveMeasureDraft();
rulerEdit(mNum(measure.height) ? 'wall' : 'height', 0);
}

/* ---------- разметка вкладки ---------- */
function rulerWallName(i) {
if (rlShape(measure) === 'rect') return i % 2 === 0 ? 'Длина' : 'Ширина';
return `Стена ${i + 1}`;
}

function rulerSectionHtml() {
const m = measure;
const shape = rlShape(m);
const chips = shape === 'rect'
? [0, 1].map(i => `<button type="button" class="rl-chip${rulerTarget && rulerTarget.kind === 'wall' && rulerTarget.idx % 2 === i ? ' on' : ''}" onclick="rulerEdit('wall', ${i})">${rulerWallName(i)} <b>${mNum(m.walls[i]) ? mFmt(mNum(m.walls[i])) : '—'}</b></button>`).join('')
: m.walls.map((w, i) => `<button type="button" class="rl-chip${rulerTarget && rulerTarget.kind === 'wall' && rulerTarget.idx === i ? ' on' : ''}" onclick="rulerEdit('wall', ${i})">${i + 1}: <b>${mNum(w) ? mFmt(mNum(w)) : '—'}</b></button>`).join('')
+ (shape === 'free' ? `<button type="button" class="rl-chip rl-add" onclick="rulerEdit('wall', ${m.walls[m.walls.length - 1] === '' ? m.walls.length - 1 : m.walls.length})">+ Стена</button>` : '');
const shapeName = { rect: 'Прямоугольная', L: 'Г-образная', free: 'Своя форма' }[shape];
return `<section class="mp-sec rl-sec">
<div class="rl-head">
<button type="button" class="rl-chip" onclick="rulerEdit('height')">Высота <b id="rlHeightVal"></b></button>
${shape ? `<button type="button" class="rl-chip rl-shape-chip" onclick="rulerChangeShape()">${shapeName} ▾</button>` : ''}
<span class="rl-check" id="rlCheck"></span>
</div>
${shape ? `<div class="rl-view" role="group" aria-label="Вид">
<button type="button" class="${rlView === 'plan' ? 'on' : ''}" onclick="rulerSetView('plan')">План</button>
<button type="button" class="${rlView === 'elev' ? 'on' : ''}" onclick="rulerSetView('elev')">Развёртки стен</button>
</div>` : ''}
${shape && rlView === 'elev' ? `<div class="rl-elev-nav">
<button type="button" onclick="rulerElevStep(-1)" aria-label="Предыдущая стена">‹</button>
<span id="rlElevNav"></span>
<button type="button" onclick="rulerElevStep(1)" aria-label="Следующая стена">›</button>
</div>` : ''}
<div class="rl-sketch${rlFull && rlView === 'plan' ? ' full' : ''}" id="rlSketch"></div>
<div class="rl-focus" id="rlFocusSlot" style="display:none"></div>
${shape && rlView === 'elev' ? '<div class="rl-elev-sum" id="rlElevSum"></div><button type="button" class="mp-link-btn" onclick="openElevPrintForMeasure()">Печать развёрток со всеми размерами (PDF) →</button><div class="rl-ophint">Коснитесь длины, высоты, окна или двери — откроется клавиатура. Окно: ширина → высота → подоконник → отступ.</div>' : ''}
${shape ? `<div class="rl-walls">${chips}</div>` : ''}
${shape ? underlayBarHtml() : ''}
${shape ? (rulerPick
? `<div class="rl-pick"><span>${rulerPick.move !== undefined ? 'Куда перенести? Коснитесь стены' : `Коснитесь стены, где ${rulerPick.type === 'door' ? 'дверь' : rulerPick.type === 'balcony' ? 'балконный блок' : 'окно'}`}, или выберите номер:</span> <button type="button" onclick="rulerCancelPick()">Отмена</button></div>
<div class="rl-walls">${m.walls.map((w, i) => `<button type="button" class="rl-chip" onclick="rulerEdit('wall', ${i})">Стена ${i + 1}</button>`).join('')}</div>`
: `<div class="rl-opbtns">${measureAddMenuHtml(null)}</div>
${(m.openings || []).some(o => typeof o.wall === 'number') ? '<div class="rl-ophint"><b>⇆</b> Окно или дверь на чертеже: коснитесь — изменить размеры, потяните за ручку вдоль стены — сдвинуть.</div>' : ''}`) : ''}
<div class="mp-calc" id="mpCalcWalls"></div>
</section>`;
}

function rulerChangeShape() {
rulerTarget = null;
document.getElementById('measurePanel').classList.remove('ruler-open');
const box = document.getElementById('rlSketch');
if (box) box.innerHTML = rulerShapePickerHtml();
}

/* ---------- клавиатура ---------- */
function rulerFieldPath(t) {
if (t.kind === 'height') return 'height';
if (t.kind === 'wall') return 'walls.' + (rlShape(measure) === 'rect' ? t.idx % 2 : t.idx);
if (t.kind === 'wallH') return 'wallHeights.' + t.idx;
if (t.kind === 'angle') return 'angles.' + t.idx;
if (t.kind === 'op') return `openings.${t.idx}.${t.field}`;
return '';
}
function rulerFieldValue(t) {
const parts = rulerFieldPath(t).split('.');
let v = measure;
for (const p of parts) { if (v == null) return ''; v = v[isNaN(p) ? p : Number(p)]; }
return v == null ? '' : String(v);
}
function rulerStartOpening(type) {
const t = rulerTarget;
if (t && (t.kind === 'wall' || t.kind === 'wallH')) { rulerAddOpening(type); return; }
rulerPick = { type };
rulerTarget = null;
document.getElementById('measurePanel').classList.remove('ruler-open');
renderMeasure();
}

function rulerCancelPick() {
rulerPick = null;
renderMeasure();
}

// Правка уже сошедшейся комнаты: запоминаем её контур, чтобы показать
// его пунктиром и не перестраивать масштаб чертежа на каждое изменение
let rlEditBase = null;
function rulerStartEditSession() {
if (rlEditBase) return;
const g = rulerGeometry(measure);
if (!g.closed) return;
rlEditBase = { pts: [[0, 0], ...g.segs.map(q => [q.x2, q.y2])], json: JSON.stringify([measure.walls, measure.turns, measure.angles]) };
}

function rulerEdit(kind, idx, field) {
rulerStartEditSession();
// ждали касания стены, чтобы поставить окно или дверь
if (rulerPick && kind === 'wall' && idx < measure.walls.length && rulerPick.move !== undefined) {
const oi = rulerPick.move;
rulerPick = null;
rulerSnapshot();
measure.openings[oi].wall = idx;
measure.openings[oi].off = '';
saveMeasureDraft();
rulerEdit('op', oi, 'off');
return;
}
if (rulerPick && kind === 'wall' && idx < measure.walls.length) {
const type = rulerPick.type;
rulerPick = null;
rulerTarget = { kind: 'wall', idx };
rulerAddOpening(type);
return;
}
if (kind === 'wall' && idx >= measure.walls.length) {
measure.walls.push('');
if (!Array.isArray(measure.wallHeights)) measure.wallHeights = [];
measure.wallHeights[idx] = '';
}
rulerTarget = kind === 'op' ? { kind, idx, field: field || 'w' } : { kind, idx };
if (rlView === 'elev') {
if ((kind === 'wall' || kind === 'wallH') && typeof idx === 'number') rlElevWall = idx;
if (kind === 'op' && measure.openings[idx] && typeof measure.openings[idx].wall === 'number') rlElevWall = measure.openings[idx].wall;
}
rulerBuf = rulerFieldValue(rulerTarget);
rulerFresh = true;
document.getElementById('measurePanel').classList.add('ruler-open');
rulerToggleKeys(false);
if (measureTab !== 'walls') measureTab = 'walls';
renderMeasure();
renderRulerPad();
}

// Поля проёма по порядку ввода
function rulerOpFields(o) {
// балконный блок: высоту окна не меряем — она = дверь до верха − подоконник
const f = o && o.type === 'balcony' ? ['w', 'dw', 'dh', 'sill'] : o && o.type === 'door' ? ['w', 'h'] : ['w', 'h', 'sill'];
if (o && typeof o.wall === 'number') f.push('off');
return f;
}

function rulerLabel(t) {
if (t.kind === 'height') return 'Высота стен';
if (t.kind === 'wall') return `${rulerWallName(t.idx)} · длина`.replace('Длина · длина', 'Длина комнаты').replace('Ширина · длина', 'Ширина комнаты');
if (t.kind === 'wallH') return `Стена ${t.idx + 1} · своя высота`;
if (t.kind === 'angle') return `Угол после стены ${t.idx + 1}, градусов (прямой — 90)`;
if (t.kind === 'op') {
const o = measure.openings[t.idx] || {};
const where = typeof o.wall === 'number' ? ` · стена ${o.wall + 1}` : '';
const name = o.type === 'door' ? 'Дверь' : o.type === 'balcony' ? 'Балк. блок' : 'Окно';
const fl = {
w: o.type === 'balcony' ? 'окно, ширина ↔' : 'ширина ↔',
h: o.type === 'balcony' ? 'окно, высота ↕' : 'высота ↕',
dw: 'дверь, ширина ↔', dh: o.type === 'balcony' ? 'дверь, высота до верха ↕' : 'дверь, высота ↕',
sill: o.type === 'balcony' ? 'окно от пола до низа — высота окна посчитается сама' : 'подоконник, от пола, м — можно пропустить',
off: `отступ от угла ${o.from === 'end' ? 'Б' : 'А'}, м — можно пропустить`,
}[t.field] || '';
return `${name}${where} · ${fl}`;
}
return '';
}

// во весь экран: клавиатура открылась или поменяла высоту — вписываем чертёж над ней
function rulerFitAbovePad() {
if (!rlFull) return;
const box = document.getElementById('rlSketch');
const pad = document.querySelector('#measurePanel.ruler-open .rl-pad');
const want = pad && pad.offsetHeight ? pad.offsetHeight + 'px' : '';
if (box && box.style.bottom !== want) renderRulerSketch();
}
function renderRulerPad() {
setTimeout(rulerFitAbovePad, 0);
const pad = document.getElementById('rlPad');
if (!pad || !rulerTarget) return;
const t = rulerTarget;
const shape = rlShape(measure);
const val = evalMeasureExpr(rulerBuf);
const isExpr = /[+×*x\-/]/.test(rulerBuf.replace(/^-/, ''));
document.getElementById('rlPadLabel').textContent = rulerLabel(t);
document.getElementById('rlPadValue').innerHTML = rulerBuf
? `${escapeHtml(rulerBuf)}${t.kind === 'angle' ? '°' : ''}${isExpr && isFinite(val) ? ` <small>= ${mFmt(val)}</small>` : ''}`
: `<span class="rl-ph">${t.kind === 'angle' ? '90°' : '0'}</span>`;
document.getElementById('rlUndoBtn').disabled = !rulerUndo.length;
let tools = '';
if (t.kind === 'wall' || t.kind === 'wallH') {
const gg = rulerGeometry(measure);
const emptyLast = t.kind === 'wall' && !mNum(measure.walls[t.idx]) && t.idx === measure.walls.length - 1;
const fix = !emptyLast && shape !== 'rect' ? rulerFixOption(t.idx) : null;
if (fix) {
tools += `<button type="button" class="rl-tool rl-tool-close" onclick="rulerApplyFix(${t.idx})">${escapeHtml(fix.label)}</button>`;
}
if (shape !== 'rect' && emptyLast && gg.closeLen > 0) {
tools += `<button type="button" class="rl-tool rl-tool-close" onclick="rulerCloseRoom(${gg.closeLen})">Замкнуть: ${mFmt(gg.closeLen)} м</button>`;
} else if (shape === 'free' && emptyLast && gg.closeAny) {
const cc = rulerCornerClose(gg);
if (cc) tools += `<button type="button" class="rl-tool rl-tool-close" onclick="rulerCloseCorner()">Замкнуть углом 90°: ${mFmt(cc.a)} + ${mFmt(cc.b)} м</button>`;
tools += `<button type="button" class="rl-tool${cc ? '' : ' rl-tool-close'}" onclick="rulerCloseAny()">${cc ? 'По прямой' : 'Замкнуть по месту'}: ${mFmt(gg.closeAny.len)} м, угол ${Math.round(gg.closeAny.interior)}°</button>`;
}
// «+ Добавить на стену» — в начале ряда, чтобы не прятался за прокруткой
tools += measureAddMenuHtml(t.idx, 'rl-tool');
if (shape === 'free' && t.kind === 'wall') {
const tr = rlTurns()[t.idx] === 'L' ? 'L' : 'R';
const ang = Array.isArray(measure.angles) ? mNum(measure.angles[t.idx]) : 0;
tools += `<span class="rl-turn-label">После стены:</span>
<button type="button" class="rl-tool rl-turn${tr === 'R' ? ' on' : ''}" onclick="rulerTurn('R')">↱ Направо</button>
<button type="button" class="rl-tool rl-turn${tr === 'L' ? ' on' : ''}" onclick="rulerTurn('L')">↰ Налево</button>
<button type="button" class="rl-tool${ang && Math.abs(ang - 90) > 0.05 ? ' on' : ''}" onclick="rulerEdit('angle', ${t.idx})">Угол ${ang ? mFmt(ang) : 90}°</button>`;
}
tools += `<button type="button" class="rl-tool${t.kind === 'wallH' ? ' on' : ''}" onclick="rulerEdit('${t.kind === 'wallH' ? 'wall' : 'wallH'}', ${t.idx})">Своя высота</button>
${shape === 'free' && measure.walls.length > 1 ? `<button type="button" class="rl-tool rl-tool-del" onclick="rulerRemoveWall()">Убрать стену</button>` : ''}`;
}
if (t.kind === 'angle') {
const tr = rlTurns()[t.idx] === 'L' ? 'L' : 'R';
tools += `<button type="button" class="rl-tool rl-turn${tr === 'R' ? ' on' : ''}" onclick="rulerTurn('R')">↱ Направо</button>
<button type="button" class="rl-tool rl-turn${tr === 'L' ? ' on' : ''}" onclick="rulerTurn('L')">↰ Налево</button>
<button type="button" class="rl-tool" onclick="rulerSetAngle(90)">Прямой 90°</button>`;
}
if (t.kind === 'op') {
const o = measure.openings[t.idx] || {};
const ty = o.type === 'door' ? 'door' : o.type === 'balcony' ? 'balcony' : 'window';
if (typeof o.wall === 'number') tools += `<span class="rl-turn-label">⇆ тащите проём по стене</span>`;
tools += ['window', 'door', 'balcony'].map(k => `<button type="button" class="rl-tool${ty === k ? ' on' : ''}" onclick="rulerSetOpType('${k}')">${{ window: 'Окно', door: 'Дверь', balcony: 'Балк. блок' }[k]}</button>`).join('');
if (typeof o.wall === 'number') {
tools += `<span class="rl-turn-label">Отступ от:</span>
<button type="button" class="rl-tool rl-turn${o.from !== 'end' ? ' on' : ''}" onclick="rulerSetOpFrom('start')">угла А</button>
<button type="button" class="rl-tool rl-turn${o.from === 'end' ? ' on' : ''}" onclick="rulerSetOpFrom('end')">угла Б</button>`;
}
if (ty === 'balcony') {
tools += `<span class="rl-turn-label">Дверь у:</span>
<button type="button" class="rl-tool rl-turn${o.side !== 'end' ? ' on' : ''}" onclick="rulerSetOpSide('start')">угла А</button>
<button type="button" class="rl-tool rl-turn${o.side === 'end' ? ' on' : ''}" onclick="rulerSetOpSide('end')">угла Б</button>`;
}
if (typeof o.wall === 'number') tools += `<button type="button" class="rl-tool" onclick="rulerMoveOpening()">На другую стену</button>`;
tools += `<button type="button" class="rl-tool rl-tool-del" onclick="rulerRemoveOpening()">Убрать проём</button>`;
}
const toolsEl = document.getElementById('rlPadTools');
toolsEl.innerHTML = tools;
toolsEl.style.display = tools ? '' : 'none';
let nextLabel = 'Готово ✓';
if (rlView === 'elev' && (t.kind === 'wall' || t.kind === 'wallH' || t.kind === 'height')) nextLabel = 'Готово ✓';
else if (t.kind === 'height') nextLabel = 'К стенам →';
else if (t.kind === 'wall') nextLabel = shape === 'rect' && t.idx % 2 === 1 ? 'Готово ✓' : 'Далее →';
else if (t.kind === 'angle') nextLabel = 'Дальше →';
else if (t.kind === 'op') {
const f = rulerOpFields(measure.openings[t.idx]);
nextLabel = f.indexOf(t.field) < f.length - 1 ? 'Далее →' : 'Готово ✓';
}
document.getElementById('rlNextBtn').textContent = nextLabel;
document.getElementById('rlBackBtn').disabled = t.kind === 'height';
}

function rulerSetOpType(type) {
const t = rulerTarget; if (!t || t.kind !== 'op') return;
const o = measure.openings[t.idx]; if (!o) return;
rulerSnapshot();
o.type = type;
saveMeasureDraft();
updateMeasureOutputs();
renderRulerPad();
}
function rulerSetOpFrom(from) {
const t = rulerTarget; if (!t || t.kind !== 'op') return;
rulerSnapshot();
measure.openings[t.idx].from = from;
saveMeasureDraft(); updateMeasureOutputs(); renderRulerPad();
}
function rulerSetOpSide(side) {
const t = rulerTarget; if (!t || t.kind !== 'op') return;
rulerSnapshot();
measure.openings[t.idx].side = side;
saveMeasureDraft(); updateMeasureOutputs(); renderRulerPad();
}
function rulerSetAngle(v) {
const t = rulerTarget; if (!t || t.kind !== 'angle') return;
rulerSnapshot();
rulerBuf = String(v);
rulerApply();
}
// Замкнуть углом 90°: две стены под прямыми углами вместо одной диагонали.
// Первая — поперёк последней введённой стены, вторая — вдоль неё, до начала.
function rulerCornerClose(g) {
if (!g || !g.checkable || g.filled < 2) return null;
const last = g.segs[g.filled - 1];
const h = last.heading * Math.PI / 180;
const u = [Math.cos(h), Math.sin(h)];                    // вдоль последней стены
const vR = [Math.cos(h + Math.PI / 2), Math.sin(h + Math.PI / 2)]; // направо от неё
const gx = -g.lastX, gy = -g.lastY;                      // от конца до начала комнаты
const gu = gx * u[0] + gy * u[1], gv = gx * vR[0] + gy * vR[1];
if (Math.abs(gv) < 0.02 || Math.abs(gu) < 0.02) return null; // тут хватит одной стены
const firstDir = gv > 0 ? 'R' : 'L';
// вторая стена идёт вдоль последней (вперёд или назад) — поворот снова на 90°
const hA = last.heading + (firstDir === 'R' ? 90 : -90);
const hB = last.heading + (gu > 0 ? 0 : 180);
let turn2 = hB - hA;
while (turn2 > 180) turn2 -= 360;
while (turn2 <= -180) turn2 += 360;
// последняя стена не должна лечь обратно поверх первой
let back = hB - (g.segs[0] ? g.segs[0].heading : 0);
while (back > 180) back -= 360;
while (back <= -180) back += 360;
if (Math.abs(Math.abs(back) - 180) < 1) return null;
return { a: Math.abs(gv), b: Math.abs(gu), dir1: firstDir, dir2: turn2 > 0 ? 'R' : 'L' };
}

function rulerCloseCorner() {
const t = rulerTarget; if (!t) return;
const c = rulerCornerClose(rulerGeometry(measure));
if (!c) return;
rulerSnapshot();
const n = t.idx; // пустая стена, на которой стоим
const fmt = v => String(Math.round(v * 1000) / 1000).replace('.', ',');
const turns = rlTurns();
if (!Array.isArray(measure.angles)) measure.angles = [];
turns[n - 1] = c.dir1; measure.angles[n - 1] = '';
measure.walls[n] = fmt(c.a);
turns[n] = c.dir2; measure.angles[n] = '';
measure.walls[n + 1] = fmt(c.b);
if (!Array.isArray(measure.wallHeights)) measure.wallHeights = [];
measure.wallHeights[n] = measure.wallHeights[n] || '';
measure.wallHeights[n + 1] = '';
saveMeasureDraft();
rulerClose();
showAddToast(rulerGeometry(measure).closed ? 'Комната сошлась углом 90°' : 'Стены добавлены');
}

// Последняя стена — прямо в начало комнаты, угол подбирается сам
function rulerCloseAny() {
const t = rulerTarget; if (!t) return;
const g = rulerGeometry(measure);
if (!g.closeAny) return;
rulerSnapshot();
const prev = t.idx - 1;
rlTurns()[prev] = g.closeAny.dir;
if (!Array.isArray(measure.angles)) measure.angles = [];
measure.angles[prev] = String(Math.round(g.closeAny.interior * 10) / 10).replace('.', ',');
measure.walls[t.idx] = String(Math.round(g.closeAny.len * 1000) / 1000).replace('.', ',');
saveMeasureDraft();
rulerClose();
showAddToast(rulerGeometry(measure).closed ? 'Комната сошлась' : 'Стена добавлена');
}

function rulerApply() {
setMeasurePath(rulerFieldPath(rulerTarget), rulerBuf);
// у прямоугольной комнаты противоположные стены одинаковые
if (rlShape(measure) === 'rect') { measure.walls[2] = measure.walls[0]; measure.walls[3] = measure.walls[1]; }
saveMeasureDraft();
updateMeasureOutputs();
renderRulerPad();
const shape = rlShape(measure);
document.querySelectorAll('.rl-walls .rl-chip:not(.rl-add)').forEach((b, i) => {
const v = mNum(measure.walls[shape === 'rect' ? i : i]);
const bb = b.querySelector('b'); if (bb) bb.textContent = v ? mFmt(v) : '—';
});
}

function rulerKey(k) {
if (!rulerTarget) return;
if (rulerFresh) rulerSnapshot();
if (rulerFresh && /[0-9,]/.test(k)) rulerBuf = '';
rulerFresh = false;
if (k === '⌫') rulerBuf = rulerBuf.slice(0, -1);
else if (k === '+' || k === '×') { if (rulerBuf && !/[+×]$/.test(rulerBuf)) rulerBuf += k; }
else if (k === ',') { const last = rulerBuf.split(/[+×]/).pop(); if (!last.includes(',')) rulerBuf += (last === '' ? '0,' : ','); }
else rulerBuf += k;
rulerApply();
}

function rulerNext() {
if (!rulerTarget) return;
const t = rulerTarget;
// на развёртке правим одно значение и остаёмся на этой стене
if (rlView === 'elev' && (t.kind === 'wall' || t.kind === 'wallH' || t.kind === 'height')) { rulerClose(); return; }
const shape = rlShape(measure);
if (t.kind === 'height') {
if (!shape) { rulerClose(); return; }
const firstEmpty = measure.walls.findIndex(w => !mNum(w));
rulerEdit('wall', firstEmpty === -1 ? 0 : firstEmpty);
return;
}
if (t.kind === 'wall') {
if (shape === 'rect') {
if (t.idx % 2 === 0) { rulerEdit('wall', 1); return; }
rulerClose();
if (mNum(measure.walls[0]) && mNum(measure.walls[1])) showAddToast('Комната сошлась');
return;
}
if (!mNum(measure.walls[t.idx])) { rulerClose(); return; }
const g = rulerGeometry(measure);
if (g.closed && t.idx === measure.walls.length - 1) { rulerClose(); showAddToast('Комната сошлась'); return; }
if (shape === 'L' && t.idx === measure.walls.length - 1) { rulerClose(); return; }
rulerEdit('wall', t.idx + 1);
return;
}
if (t.kind === 'op') {
const f = rulerOpFields(measure.openings[t.idx]);
const i = f.indexOf(t.field);
if (i >= 0 && i < f.length - 1) { rulerEdit('op', t.idx, f[i + 1]); return; }
// первый поставленный проём — подсказываем, как его менять
try {
if (!localStorage.getItem('hintOpDrag')) {
localStorage.setItem('hintOpDrag', '1');
setTimeout(() => showAddToast('Чтобы изменить — коснитесь проёма, чтобы сдвинуть — потяните за ручку ⇆'), 300);
}
} catch (e) { /* пусто */ }
}
if (t.kind === 'angle') { rulerEdit('wall', t.idx + 1); return; }
if (t.kind === 'wallH') { rulerEdit('wall', t.idx); return; }
rulerClose();
}

// «← Назад» — к предыдущему полю
function rulerBack() {
const t = rulerTarget;
if (!t) return;
const shape = rlShape(measure);
if (t.kind === 'angle') { rulerEdit('wall', t.idx); return; }
if (t.kind === 'op') {
const f = rulerOpFields(measure.openings[t.idx]);
const i = f.indexOf(t.field);
if (i > 0) { rulerEdit('op', t.idx, f[i - 1]); return; }
const o = measure.openings[t.idx];
if (o && typeof o.wall === 'number') { rulerEdit('wall', o.wall); return; }
rulerClose(); return;
}
if (t.kind === 'wallH') { rulerEdit('wall', t.idx); return; }
if (t.kind === 'wall') {
const prev = shape === 'rect' ? (t.idx % 2 === 1 ? 0 : -1) : t.idx - 1;
if (prev < 0) { rulerEdit('height'); return; }
// пустую последнюю стену своей формы убираем, раз вернулись
if (shape === 'free' && t.idx === measure.walls.length - 1 && !String(measure.walls[t.idx]).trim() && measure.walls.length > 1) {
measure.walls.pop();
if (Array.isArray(measure.wallHeights)) measure.wallHeights.length = Math.min(measure.wallHeights.length, measure.walls.length);
}
rulerEdit('wall', prev);
return;
}
}

// Свернуть клавиатуру в полоску, чтобы посмотреть чертёж и проёмы целиком
function rulerToggleKeys(force) {
const panel = document.getElementById('measurePanel');
const collapsed = typeof force === 'boolean' ? force : !panel.classList.contains('ruler-collapsed');
panel.classList.toggle('ruler-collapsed', collapsed);
const btn = document.getElementById('rlHideBtn');
if (btn) {
btn.innerHTML = collapsed ? '⌃<small>Клавиатура</small>' : '⌄<small>Скрыть</small>';
btn.setAttribute('aria-label', collapsed ? 'Показать клавиатуру' : 'Скрыть клавиатуру');
}
}

function rulerClose() {
rulerToggleKeys(false);
rlEditBase = null; // правка закончена — чертёж снова подстраивается под экран
rulerTarget = null;
const w = measure.walls;
if (rlShape(measure) === 'free' && w.length > 1 && !String(w[w.length - 1]).trim()) {
w.pop();
if (Array.isArray(measure.wallHeights)) measure.wallHeights.length = Math.min(measure.wallHeights.length, w.length);
}
document.getElementById('measurePanel').classList.remove('ruler-open');
saveMeasureDraft();
renderMeasure();
}

function rulerCloseRoom(len) {
if (!rulerTarget) return;
rulerSnapshot();
rulerBuf = String(Math.round(len * 1000) / 1000).replace('.', ',');
rulerApply();
rulerClose();
showAddToast('Комната сошлась');
}

function rulerTurn(dir) {
const t = rulerTarget; if (!t) return;
rulerSnapshot();
rlTurns()[t.idx] = dir;
saveMeasureDraft();
renderRulerSketch();
renderRulerPad();
}

function rulerAddOpening(type) {
const t = rulerTarget; if (!t) return;
rulerSnapshot();
const prev = [...measure.openings].reverse().find(o => o.type === type);
const fresh = type === 'balcony' ? { type, w: '', h: '', dw: '', dh: '', side: 'start', n: '1', slopes: true } : { type, w: '', h: '', n: '1', slopes: true };
measure.openings.push(prev ? { ...prev, wall: t.idx, off: '', from: 'start' } : { ...fresh, wall: t.idx });
saveMeasureDraft();
rulerEdit('op', measure.openings.length - 1, 'w');
}

// Комната разошлась после правки — какую стену (или две) удлинить/укоротить,
// чтобы контур снова сошёлся. Правленую стену не трогаем, если есть другие.
function rulerFixOption(editedIdx) {
const m = measure;
if (!m.walls.every(w => mNum(w) > 0) || m.walls.length < 3) return null;
const g = rulerGeometry(m);
if (g.closed) return null;
const G = [-g.endX, -g.endY];
if (Math.hypot(G[0], G[1]) < 0.005) return null;
const segs = g.segs.map(q => ({ i: q.i, d: [q.dx, q.dy], L: q.len }));
const others = segs.filter(q => q.i !== editedIdx);
const fmt = v => mFmt(Math.round(v * 1000) / 1000);
// одна стена, параллельная разрыву
let best = null;
for (const q of others) {
const cross = G[0] * q.d[1] - G[1] * q.d[0];
if (Math.abs(cross) > 0.005) continue;
const tt = G[0] * q.d[0] + G[1] * q.d[1];
const nl = q.L + tt;
if (nl < 0.05) continue;
if (!best || Math.abs(tt) < Math.abs(best.changes[0].t)) best = { changes: [{ i: q.i, t: tt, from: q.L, to: nl }] };
}
// иначе — две непараллельные стены
if (!best) {
for (let a = 0; a < others.length; a++) for (let b = a + 1; b < others.length; b++) {
const p = others[a], q = others[b];
const det = p.d[0] * q.d[1] - p.d[1] * q.d[0];
if (Math.abs(det) < 0.2) continue;
const t1 = (G[0] * q.d[1] - G[1] * q.d[0]) / det, t2 = (p.d[0] * G[1] - p.d[1] * G[0]) / det;
if (p.L + t1 < 0.05 || q.L + t2 < 0.05) continue;
const cost = Math.abs(t1) + Math.abs(t2);
if (!best || cost < best.cost) best = { cost, changes: [{ i: p.i, t: t1, from: p.L, to: p.L + t1 }, { i: q.i, t: t2, from: q.L, to: q.L + t2 }] };
}
}
if (!best) return null;
best.label = best.changes.length === 1
? `Подогнать стену ${best.changes[0].i + 1}: ${fmt(best.changes[0].from)} → ${fmt(best.changes[0].to)}`
: `Подогнать стены ${best.changes.map(c => `${c.i + 1}: ${fmt(c.from)} → ${fmt(c.to)}`).join(', ')}`;
return best;
}

function rulerApplyFix(editedIdx) {
const fix = rulerFixOption(editedIdx);
if (!fix) return;
rulerSnapshot();
fix.changes.forEach(c => { measure.walls[c.i] = String(Math.round(c.to * 1000) / 1000).replace('.', ','); });
saveMeasureDraft();
rulerClose();
showAddToast(rulerGeometry(measure).closed ? 'Комната снова сошлась' : 'Стены подогнаны');
}

// После стены a поворота нет — следующая идёт по той же прямой
function rulerIsStraight(a) {
const ang = Array.isArray(measure.angles) ? mNum(measure.angles[a]) : 0;
return Math.abs(ang - 180) < 0.05;
}

// Склеить стену a и следующую за ней (они на одной прямой) в одну.
// Окна и двери остаются на своих местах: отступы пересчитываются от начала новой стены.
function rulerMergeWalls(a) {
const m = measure, b = a + 1;
const La = mNum(m.walls[a]), Lb = mNum(m.walls[b]);
(m.openings || []).forEach(o => {
if (o.wall === a && o.from === 'end' && String(o.off || '').trim() !== '') {
const [a0] = openingSpan(o, La);
o.off = String(Math.round(a0 * 1000) / 1000).replace('.', ','); o.from = 'start';
} else if (o.wall === b) {
const [a0] = openingSpan(o, Lb);
o.off = String(Math.round((La + a0) * 1000) / 1000).replace('.', ','); o.from = 'start'; o.wall = a;
} else if (typeof o.wall === 'number' && o.wall > b) o.wall -= 1;
});
// ниши и короба: стена b вошла в стену a, дальше номера на один меньше
remapCeilElWalls(m, m.walls.map((w, i) => i < b ? i : i === b ? a : i - 1));
m.walls[a] = String(Math.round((La + Lb) * 1000) / 1000).replace('.', ',');
if (Array.isArray(m.turns)) { m.turns[a] = m.turns[b]; m.turns.splice(b, 1); }
if (Array.isArray(m.angles)) { m.angles[a] = m.angles[b] || ''; m.angles.splice(b, 1); }
if (Array.isArray(m.wallHeights)) m.wallHeights.splice(b, 1);
m.walls.splice(b, 1);
}

// Стены как «отрезки с направлением на плане» — из них удобно убирать и упрощать
function rlNormDeg(d) { while (d > 180) d -= 360; while (d <= -180) d += 360; return d; }
function rulerWallList(m) {
const g = rulerGeometry(m);
return g.segs.map((q, i) => ({ L: mNum(m.walls[i]), h: q.heading, wh: (m.wallHeights || [])[i] || '', x1: q.x1, y1: q.y1, ops: [], src: [i] }));
}
// Записать список стен обратно: длины, направление первой, повороты и углы — из направлений
function rulerApplyWallList(m, list) {
const fmt = v => String(Math.round(v * 1000) / 1000).replace('.', ',');
m.shape = 'free';
m.walls = list.map(w => fmt(w.L));
m.wallHeights = list.map(w => w.wh || '');
m.startHeading = list.length ? rlNormDeg(list[0].h) : 0;
m.turns = []; m.angles = [];
list.forEach((w, k) => {
const next = list[(k + 1) % list.length];
const d = rlNormDeg(next.h - w.h);
m.turns[k] = d >= 0 ? 'R' : 'L';
const interior = 180 - Math.abs(d);
m.angles[k] = Math.abs(interior - 90) < 0.05 ? '' : fmt(Math.round(interior * 10) / 10);
});
}

// Комната замкнута, а последняя и первая стены лежат на одной прямой
// (стык попал на «начало» обхода) — склеиваем их в одну стену
function rulerMergeAcrossStart(m) {
const g = rulerGeometry(m);
const n = m.walls.length;
if (!g.closed || n < 4) return false;
const F = g.segs[0], Lst = g.segs[n - 1];
if (Math.abs(rlNormDeg(F.heading - Lst.heading)) > 0.05) return false;
const LL = mNum(m.walls[n - 1]), LF = mNum(m.walls[0]);
(m.openings || []).forEach(o => {
if (o.wall === 0) { const [a0] = openingSpan(o, LF); o.off = String(Math.round((a0 + LL) * 1000) / 1000).replace('.', ','); o.from = 'start'; }
else if (o.wall === n - 1) { const [a0] = openingSpan(o, LL); o.wall = 0; o.off = String(Math.round(a0 * 1000) / 1000).replace('.', ','); o.from = 'start'; }
});
// начало плана — в начало последней стены: сдвигаем пунктир и неподвижный масштаб
const sx = Lst.x1, sy = Lst.y1;
if (rlEditBase) rlEditBase.pts = rlEditBase.pts.map(([px, py]) => [px - sx, py - sy]);
if (rlLastFit) rlLastFit = { ...rlLastFit, ox: rlLastFit.ox + sx * rlLastFit.k, oy: rlLastFit.oy + sy * rlLastFit.k };
remapCeilElWalls(m, m.walls.map((w, i) => i === n - 1 ? 0 : i));
m.walls[0] = String(Math.round((LF + LL) * 1000) / 1000).replace('.', ',');
m.walls.pop();
if (Array.isArray(m.wallHeights)) m.wallHeights.length = Math.min(m.wallHeights.length, n - 1);
if (Array.isArray(m.turns)) m.turns.length = Math.min(m.turns.length, n - 1);
if (Array.isArray(m.angles)) m.angles.length = Math.min(m.angles.length, n - 1);
return true;
}

// Ниши и короба — на новые номера стен по списку (у каждой стены — откуда она)
function rulerRemapCeilByList(m, list) {
const map = [];
list.forEach((w, k) => (w.src || []).forEach(i => { map[i] = k; }));
remapCeilElWalls(m, map);
}

function rulerRemoveWall() {
const t = rulerTarget; if (!t) return;
rulerStartEditSession(); // прежний контур — для пунктира и неподвижного масштаба
rulerSnapshot();
const m = measure, i = t.idx;
// пустые «новые» стены в конце (место для ввода) не участвуют — убираем их
while (m.walls.length > 1 && m.walls.length - 1 !== i && !mNum(m.walls[m.walls.length - 1])) {
m.walls.pop();
if (Array.isArray(m.wallHeights)) m.wallHeights.length = Math.min(m.wallHeights.length, m.walls.length);
}
const list = rulerWallList(m);
// проёмы — к своим стенам, с отступом от начала стены
(m.openings || []).forEach(o => {
if (typeof o.wall !== 'number' || !list[o.wall]) return;
const [a0] = openingSpan(o, list[o.wall].L);
list[o.wall].ops.push({ o, a0 });
});
// Комната была сошедшейся — убираем стену так, чтобы всё остальное осталось на месте:
// обход начинаем со стены, следующей за убранной, а на месте убранной — разрыв.
if (rulerGeometry(m).closed && list.length > 3) {
const turnIn = rlNormDeg(list[i].h - list[(i - 1 + list.length) % list.length].h); // поворот к убранной стене
list[i].ops.forEach(({ o }) => { delete o.wall; delete o.off; });
const rot = [...list.slice(i + 1), ...list.slice(0, i)];
const sx0 = rot[0].x1, sy0 = rot[0].y1;
if (rlEditBase) rlEditBase.pts = rlEditBase.pts.map(([px, py]) => [px - sx0, py - sy0]);
if (rlLastFit) rlLastFit = { ...rlLastFit, ox: rlLastFit.ox + sx0 * rlLastFit.k, oy: rlLastFit.oy + sy0 * rlLastFit.k };
rulerRemapCeilByList(m, rot);
rulerApplyWallList(m, rot);
// после последней стены — тот же поворот, что вёл к убранной: «Замкнуть» предложит её длину
const last = rot.length - 1;
m.turns[last] = turnIn >= 0 ? 'R' : 'L';
const intr = 180 - Math.abs(turnIn);
m.angles[last] = Math.abs(intr - 90) < 0.05 ? '' : String(Math.round(intr * 10) / 10).replace('.', ',');
rot.forEach((w, k) => w.ops.forEach(({ o, a0 }) => {
o.wall = k; o.from = 'start'; o.off = String(Math.round(a0 * 1000) / 1000).replace('.', ',');
}));
saveMeasureDraft();
// на месте убранной — пустая стена: можно ввести новую длину или «Замкнуть»
rulerEdit('wall', m.walls.length);
showAddToast('Стена убрана, остальные на месте. Введите новую стену или «Замкнуть»; «Готово» — оставить разрыв');
return;
}
// убираем стену; её проёмы остаются в списке, но без места на плане
list[i].ops.forEach(({ o }) => { delete o.wall; delete o.off; });
list.splice(i, 1);
// упрощаем стыки: на одной прямой — склеиваем, встречные — гасим друг другом
let merged = 0;
for (let k = 0; k < list.length - 1 && list.length > 1;) {
const A = list[k], B = list[k + 1];
const d = Math.abs(rlNormDeg(B.h - A.h));
if (d < 0.05) {
B.ops.forEach(p => { p.a0 += A.L; });
A.ops.push(...B.ops); A.L += B.L; A.src = [...(A.src || []), ...(B.src || [])];
list.splice(k + 1, 1); merged++;
k = Math.max(0, k - 1);
} else if (Math.abs(d - 180) < 0.05) {
// стены легли друг на друга — остаётся только разница; проёмы на них теряют место
[...A.ops, ...B.ops].forEach(({ o }) => { delete o.wall; delete o.off; });
const keep = A.L >= B.L ? A : B;
const rest = Math.abs(A.L - B.L);
if (rest < 0.001) list.splice(k, 2);
else list.splice(k, 2, { L: rest, h: keep.h, wh: keep.wh, x1: A.x1, y1: A.y1, ops: [] });
merged++;
k = Math.max(0, k - 1);
} else k++;
}
if (list.length < 2) { rulerUndoLast(); showAddToast('Так комнату не построить — отменено'); return; }
// чертёж начинается с первой стены списка — сдвигаем пунктир и неподвижный масштаб, чтобы ничего не поехало
const sx = list[0].x1, sy = list[0].y1;
if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) {
if (rlEditBase) rlEditBase.pts = rlEditBase.pts.map(([px, py]) => [px - sx, py - sy]);
if (rlLastFit) rlLastFit = { ...rlLastFit, ox: rlLastFit.ox + sx * rlLastFit.k, oy: rlLastFit.oy + sy * rlLastFit.k };
}
rulerRemapCeilByList(m, list);
rulerApplyWallList(m, list);
// проёмы — на новые номера стен
list.forEach((w, k) => w.ops.forEach(({ o, a0 }) => {
o.wall = k; o.from = 'start'; o.off = String(Math.round(a0 * 1000) / 1000).replace('.', ',');
}));
if (rulerMergeAcrossStart(m)) merged++;
saveMeasureDraft();
const g = rulerGeometry(m);
if (g.closed) {
rulerClose();
showAddToast(merged ? 'Стена убрана, соседние стены соединены' : 'Стена убрана');
return;
}
const nb = Math.max(0, Math.min(i - 1, m.walls.length - 1));
rulerEdit('wall', nb);
showAddToast(rulerFixOption(nb) || rulerFixOption(-1)
? 'Стена убрана. Комната разошлась — внизу есть «Подогнать»'
: `Стена убрана. Комната разошлась на ${mFmt(g.gap)} м — поправьте стены или отмените ↶`);
}

document.addEventListener('keydown', (e) => {
if (!rulerTarget || !document.getElementById('measurePanel').classList.contains('ruler-open')) return;
if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
const map = { '.': ',', ',': ',', '+': '+', '*': '×', 'x': '×', 'Backspace': '⌫' };
if (/^[0-9]$/.test(e.key)) { rulerKey(e.key); e.preventDefault(); }
else if (map[e.key]) { rulerKey(map[e.key]); e.preventDefault(); }
else if (e.key === 'Enter') { rulerNext(); e.preventDefault(); }
else if (e.key === 'Escape') { rulerClose(); e.preventDefault(); }
else if ((e.ctrlKey || e.metaKey) && e.key === 'z') { rulerUndoLast(); e.preventDefault(); }
});
