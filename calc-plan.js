// Кабинет мастера — обмерный план в PDF: экспликация и листы с чертежами.
// Подключается из calc.html; порядок подключения важен.

/* ===================== ОБМЕРНЫЙ ПЛАН (PDF) ===================== */
// Из замеров помещений объекта собирается обмерный план, как в
// дизайн-проекте: лист с экспликацией помещений и листы с чертежами
// комнат в масштабе — размерные линии в миллиметрах, окна, двери,
// площадь пола. Каждый лист рисуется векторно (SVG в миллиметрах A4)
// и переносится в PDF в высоком разрешении.

const PL_W = 210, PL_H = 297;           // A4, мм
const PL_FONT = 'Arial, Helvetica, sans-serif';
const PL_SCALES = [20, 25, 40, 50, 75, 100, 125, 150, 200, 250];

function plEsc(s) { return escapeHtml(String(s == null ? '' : s)); }
const plMm = m => Math.round(m * 1000);                 // метры → мм
const plM2 = v => (Math.round(v * 100) / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Контур комнаты в метрах (только если все стены введены)
function plRoomPolygon(m) {
const lens = m.walls.map(mNum);
if (!lens.length || lens.some(v => !(v > 0)) || lens.length < 3) return null;
const g = rulerGeometry(m);
return g;
}

// Угол подписи вдоль стены, чтобы текст не стоял вверх ногами
function plTextAngle(q) {
let a = Math.atan2(q.dy, q.dx) * 180 / Math.PI;
if (a > 90) a -= 180;
if (a <= -90) a += 180;
return Math.round(a * 100) / 100;
}

function plFloorArea(g) {
if (!g || !g.closed) return 0;
const pts = [[0, 0], ...g.segs.map(s => [s.x2, s.y2])];
let a = 0;
for (let i = 0; i < pts.length - 1; i++) a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
return Math.abs(a) / 2;
}

/* ---------- рамка и штамп ---------- */
function plFrame(info, sheetNo, sheetCount, title, docTitle = 'Обмерный план') {
// рамка: слева 20 мм под подшивку, остальные поля 5 мм
let s = `<rect x="20" y="5" width="${PL_W - 25}" height="${PL_H - 10}" fill="none" stroke="#000" stroke-width="0.6"/>`;
// штамп 185 × 40 мм в правом нижнем углу
const x0 = PL_W - 5 - 185, y0 = PL_H - 5 - 40;
s += `<rect x="${x0}" y="${y0}" width="185" height="40" fill="#fff" stroke="#000" stroke-width="0.6"/>`;
const L = (x1, y1, x2, y2, w = 0.3) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${w}"/>`;
s += L(x0, y0 + 10, x0 + 185, y0 + 10, 0.5);
s += L(x0, y0 + 20, x0 + 185, y0 + 20);
s += L(x0, y0 + 30, x0 + 185, y0 + 30);
s += L(x0 + 65, y0, x0 + 65, y0 + 40, 0.5);
s += L(x0 + 135, y0 + 10, x0 + 135, y0 + 40, 0.5);
s += L(x0 + 160, y0 + 10, x0 + 160, y0 + 20, 0.5);
const T = (x, y, text, size = 3, weight = 400, anchor = 'start', fill = '#000') =>
`<text x="${x}" y="${y}" font-family="${PL_FONT}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}">${plEsc(text)}</text>`;
const small = (x, y, t) => T(x, y, t, 2.1, 400, 'start', '#444');
// левая колонка — кто/кому
s += small(x0 + 1.5, y0 + 3.2, 'Исполнитель') + T(x0 + 1.5, y0 + 8, info.company || '—', 3.4, 700);
s += small(x0 + 1.5, y0 + 13.2, 'Заказчик') + T(x0 + 1.5, y0 + 18, info.client || '—', 3.2);
s += small(x0 + 1.5, y0 + 23.2, 'Адрес') + T(x0 + 1.5, y0 + 28, info.address || '—', 3);
s += small(x0 + 1.5, y0 + 33.2, 'Дата') + T(x0 + 1.5, y0 + 38, info.date, 3);
// правая часть — объект и наименование
s += small(x0 + 67, y0 + 3.2, 'Объект') + T(x0 + 67, y0 + 8, info.object, 3.6, 700);
s += T(x0 + 67, y0 + 17.5, docTitle, 4.2, 700);
s += T(x0 + 67, y0 + 27.5, title, 3.2);
s += small(x0 + 67, y0 + 33.2, 'Высоты и размеры по месту, мм') ;
s += small(x0 + 137, y0 + 13.2, 'Лист') + T(x0 + 147.5, y0 + 18.5, sheetNo, 4, 700, 'middle');
s += small(x0 + 162, y0 + 13.2, 'Листов') + T(x0 + 172.5, y0 + 18.5, sheetCount, 4, 700, 'middle');
s += small(x0 + 137, y0 + 23.2, 'Масштаб') + T(x0 + 160, y0 + 28.5, info.scaleNote || 'указан у чертежа', 2.8, 400, 'middle');
s += T(x0 + 160, y0 + 37, 'Кабинет мастера', 2.3, 400, 'middle', '#666');
return s;
}

// Точка внутри контура, наиболее удалённая от стен (перебор по сетке)
function plLabelPoint(g, minX, maxX, minY, maxY) {
const pts = [[0, 0], ...g.segs.map(q => [q.x2, q.y2])];
const inside = (x, y) => {
let c = false;
for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
const [xi, yi] = pts[i], [xj, yj] = pts[j];
if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
}
return c;
};
const distSeg = (x, y, q) => {
const vx = q.x2 - q.x1, vy = q.y2 - q.y1, L2 = vx * vx + vy * vy || 1;
const t = Math.max(0, Math.min(1, ((x - q.x1) * vx + (y - q.y1) * vy) / L2));
return Math.hypot(x - (q.x1 + t * vx), y - (q.y1 + t * vy));
};
let best = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, d: -1 };
if (!g.closed) return best;
const N = 24;
for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
const x = minX + (maxX - minX) * i / N, y = minY + (maxY - minY) * j / N;
if (!inside(x, y)) continue;
const d = Math.min(...g.segs.map(q => distSeg(x, y, q)));
if (d > best.d) best = { cx: x, cy: y, d };
}
return best;
}

/* ---------- лист экспликации ---------- */
function plExplicationPage(rows, info, sheetCount) {
let s = '';
s += `<text x="105" y="20" font-family="${PL_FONT}" font-size="6" font-weight="700" text-anchor="middle">Экспликация помещений</text>`;
const cols = [ // ширина колонок, мм
['№', 8], ['Помещение', 38], ['Пол, м²', 17], ['Периметр, м', 19], ['Высота, м', 17], ['Стены, м²', 18], ['Стены − проёмы', 26], ['Проёмы', 33]];
const x0 = 25, y0 = 28, rh = 8;
let x = x0;
const total = cols.reduce((a, c) => a + c[1], 0);
s += `<rect x="${x0}" y="${y0}" width="${total}" height="${rh + 2}" fill="#ffc83d"/>`;
cols.forEach(([t, w]) => {
s += `<text x="${x + w / 2}" y="${y0 + 6.3}" font-family="${PL_FONT}" font-size="2.6" font-weight="700" text-anchor="middle">${plEsc(t)}</text>`;
x += w;
});
let y = y0 + rh + 2;
const sums = { floor: 0, per: 0, walls: 0, net: 0 };
rows.forEach((r, i) => {
const cells = [String(i + 1), r.name, r.floor ? plM2(r.floor) : '—', plM2(r.per), r.h ? plM2(r.h) : '—', plM2(r.walls), plM2(r.net), r.ops || '—'];
sums.floor += r.floor || 0; sums.per += r.per; sums.walls += r.walls; sums.net += r.net;
x = x0;
cells.forEach((c, ci) => {
const w = cols[ci][1];
const anchor = ci === 1 || ci === 7 ? 'start' : 'middle';
const tx = anchor === 'start' ? x + 1.8 : x + w / 2;
s += `<text x="${tx}" y="${y + 5.6}" font-family="${PL_FONT}" font-size="${ci === 7 ? 2.5 : 3}" text-anchor="${anchor}">${plEsc(c)}</text>`;
x += w;
});
y += rh;
s += `<line x1="${x0}" y1="${y}" x2="${x0 + total}" y2="${y}" stroke="#000" stroke-width="0.2"/>`;
});
// итог
s += `<rect x="${x0}" y="${y}" width="${total}" height="${rh}" fill="#f2f2f2"/>`;
x = x0;
['', 'Итого', plM2(sums.floor), plM2(sums.per), '', plM2(sums.walls), plM2(sums.net), ''].forEach((c, ci) => {
const w = cols[ci][1];
const anchor = ci === 1 ? 'start' : 'middle';
s += `<text x="${anchor === 'start' ? x + 1.8 : x + w / 2}" y="${y + 5.6}" font-family="${PL_FONT}" font-size="3" font-weight="700" text-anchor="${anchor}">${plEsc(c)}</text>`;
x += w;
});
y += rh;
// сетка таблицы
s += `<rect x="${x0}" y="${y0}" width="${total}" height="${y - y0}" fill="none" stroke="#000" stroke-width="0.5"/>`;
x = x0;
cols.slice(0, -1).forEach(([, w]) => { x += w; s += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y}" stroke="#000" stroke-width="0.25"/>`; });
// пояснения
y += 10;
const note = (t) => { s += `<text x="${x0}" y="${y}" font-family="${PL_FONT}" font-size="2.8" fill="#333">${plEsc(t)}</text>`; y += 5; };
note('Размеры на чертежах — в миллиметрах, по внутренним поверхностям стен.');
note('Площадь пола считается по контуру, если комната сошлась при замере.');
note('Окна и двери показаны на стене, к которой привязаны при замере; положение вдоль стены условное.');
if (rows.some(r => r.ceilEls)) note('Ниши (Н) и короба (К) потолка — штриховой линией: ширина от стены × высота, L — длина по стенам; точки — подсветка.');
s += plFrame(info, 1, sheetCount, 'Экспликация помещений');
return s;
}

/* ---------- чертёж комнаты ---------- */
// Строки пояснений под чертежом (каждая не длиннее, чем помещается в ширину листа)
function plWrap(text, max = 105) {
const out = [];
String(text || '').split('\n').forEach(par => {
let line = '';
par.split(' ').forEach(w => { if ((line + ' ' + w).trim().length > max && line) { out.push(line); line = w; } else line = (line + ' ' + w).trim(); });
if (line) out.push(line);
});
return out;
}
function plLegend(m, r, mode) {
const ceilLines = (r.ceilEls || []).map(e => {
const what = e.type === 'box' ? 'короб' : 'закарнизная ниша';
const size = `${plMm(e.w)}${e.h ? '×' + plMm(e.h) : ''}`;
const extra = e.fin && e.fin.length ? `; обработка ${[e.finLin ? `${plM2(e.finLin)} пог. м` : '', e.finArea ? `${plM2(e.finArea)} м²` : ''].filter(Boolean).join(' + ')}` : '';
const where = e.wallsTxt ? ` ${e.wallsTxt === 'по периметру' ? e.wallsTxt : '(' + e.wallsTxt + (e.overOp ? `, вынос ${plMm(e.overOp.ext)}` : '') + (e.partial ? `, от угла ${e.partial.corner} ${plMm(e.partial.off)}` : '') + ')'}` : '';
const lightTxt = e.light ? `, с подсветкой ${plMm(e.lightLen)}` : '';
return `${e.code} — ${what}${where}, ${size}, L = ${plMm(e.len)}${extra}${lightTxt}`;
});
if (mode === 'plan') {
const radLines = (r.radNiches || []).map(e => {
const extra = e.fin.length ? `; обработка ${[e.finLin ? `${plM2(e.finLin)} пог. м` : '', e.finArea ? `${plM2(e.finArea)} м²` : ''].filter(Boolean).join(' + ')}` : '';
return `${e.code} — ниша${e.where ? ` (${e.where})` : ''}, ${plMm(e.w)}×${plMm(e.h)}${e.d ? '×' + plMm(e.d) : ''}${e.raised ? `, от пола ${plMm(e.bottom)}` : ''}${extra}`;
});
return [...ceilLines, ...radLines];
}
const clean = t => String(t || '').replace(/\n\* .*$/s, '');
if (mode === 'floor') return [r.lines.tile_floor, r.lines.tile_blocksFloor, r.lines.tile_blocksWalls, r.lines.mol_plinth].filter(Boolean).map(clean).flatMap(t => plWrap(t));
// потолок: площадь, ниши и короба, рамки молдингов, карниз
return [r.lines.ceilingNet || r.lines.ceiling, ...ceilLines, r.lines.mol_ceil, r.lines.mol_cornice].filter(Boolean).map(clean).flatMap(t => plWrap(t));
}

// mode: 'plan' — обмерный план (как раньше), 'floor' — план пола (плинтус, плитка),
// 'ceiling' — план потолка (ниши, короба, рамки молдингов, карниз, подсветка; без проёмов)
function plRoomDrawing(room, box, mode = 'plan') {
const m = room.measure;
const g = plRoomPolygon(m);
const r = computeMeasure(m);
const name = roomName(room);
let s = '';
const T = (x, y, text, size = 3, weight = 400, anchor = 'middle', fill = '#000', extra = '') =>
`<text x="${x}" y="${y}" font-family="${PL_FONT}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}" ${extra}>${plEsc(text)}</text>`;
// заголовок комнаты
s += T(box.x, box.y + 5, name, 4.6, 700, 'start');
if (!g) {
s += T(box.x, box.y + 14, 'Чертёж недоступен: стены введены одной суммой или не все.', 3, 400, 'start', '#555');
s += T(box.x, box.y + 20, `Периметр ${plM2(r.perimeter)} м · высота ${mNum(m.height) ? plM2(mNum(m.height)) : '—'} м · стены ${plM2(r.wallsGross)} м²`, 3, 400, 'start', '#555');
return { svg: s, scale: null };
}
// масштаб: самый крупный из стандартных, при котором комната с размерами помещается
const xs = [0, ...g.segs.map(q => q.x2)], ys = [0, ...g.segs.map(q => q.y2)];
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
const wM = maxX - minX, hM = maxY - minY;
const pad = 16; // место под размерные линии, мм
// ниши и короба потолка — подписаны под чертежом, место под строки оставляем заранее
const ceilEls = mode === 'floor' ? [] : (r.ceilEls || []).filter(e => e.strips.length);
const loose0 = mode !== 'ceiling' && (m.openings || []).some(o => typeof o.wall !== 'number' && mNum(o.w));
const legend = plLegend(m, r, mode);
const legendN = legend.length;
const legendH = legendN ? 4.2 * legendN + (loose0 ? 4 : 0) : 0;
const availW = box.w - 2 * pad, availH = box.h - 10 - 2 * pad - legendH;
let scale = PL_SCALES[PL_SCALES.length - 1];
for (const sc of PL_SCALES) { if (wM * 1000 / sc <= availW && hM * 1000 / sc <= availH) { scale = sc; break; } }
const k = 1000 / scale; // мм листа на метр
const ox = box.x + pad + (availW - wM * k) / 2 - minX * k;
const oy = box.y + 10 + pad + (availH - hM * k) / 2 - minY * k;
const X = v => ox + v * k, Y = v => oy + v * k;
s += T(box.x + box.w, box.y + 5, `М 1:${scale}`, 3.2, 700, 'end');
// пол — лёгкая заливка, стены — толстая линия
const pts = [[0, 0], ...g.segs.map(q => [q.x2, q.y2])];
const roomPath = `M${pts.map(p => `${X(p[0])} ${Y(p[1])}`).join('L')}Z`;
if (g.closed) s += `<path d="${roomPath}" fill="${mode === 'ceiling' ? '#f2f5fa' : '#fff7dc'}" stroke="none"/>`;
else s += T(box.x, box.y + 10.5, `Контур не замкнут: разрыв ${plMm(g.gap)} мм — проверьте замер`, 2.9, 700, 'start', '#c2361f');
// план пола: плитка по раскладке, обрезана контуром комнаты
if (mode === 'floor' && g.closed && typeof tileGet === 'function') {
const tf = tileGet(m).floor;
if (tf.on && tileSize(tf).w > 0 && tileSize(tf).l > 0) {
const fl = tileFloorLayout(tf, minX, minY, maxX, maxY);
const tiles = tilePolys(tf, minX, minY, maxX, maxY, 4000, fl.origin);
if (tiles) {
const cid = 'plFloorClip' + Math.round(box.y);
s += `<clipPath id="${cid}"><path d="${roomPath}"/></clipPath><g clip-path="url(#${cid})">`;
s += tiles.map(t => `<path d="M${t.map(([x, y]) => `${X(x).toFixed(2)} ${Y(y).toFixed(2)}`).join('L')}Z" fill="#e6f2f4" stroke="#1f7a8c" stroke-width="0.15"/>`).join('');
s += '</g>';
}
}
if (typeof blocksCompute === 'function') blocksCompute(m).list.forEach(b => {
const pp = blockPlanPoly(g, b);
if (!pp) return;
const cx = pp.reduce((a, p) => a + X(p[0]), 0) / 4, cy = pp.reduce((a, p) => a + Y(p[1]), 0) / 4;
s += `<path d="M${pp.map(([x, y]) => `${X(x).toFixed(2)} ${Y(y).toFixed(2)}`).join('L')}Z" fill="#f4e3c3" stroke="#9a6a12" stroke-width="0.3"/>`;
s += T(cx, cy + 1, b.code, 2.8, 700, 'middle', '#9a6a12');
});
}
// план потолка: рамки молдингов (пунктир) и их отступ от стен
if (mode === 'ceiling' && typeof moldingCompute === 'function') {
const mo = moldingCompute(m);
mo.ceil.forEach(f => [f.poly, f.inner].forEach((pp, j) => {
if (!pp) return;
s += `<path d="M${pp.pts.map(([x, y]) => `${X(x)} ${Y(y)}`).join('L')}Z" fill="none" stroke="#5b2d86" stroke-width="${j ? 0.25 : 0.35}" stroke-dasharray="1.6 0.8"/>`;
}));
}
// ниши и короба потолка: полоса вдоль стен и штриховая кромка (элемент выше секущей плоскости)
ceilEls.forEach(e => {
const isBox = e.type === 'box';
e.strips.forEach(p => {
s += `<path d="M${p.poly.map(([x, y]) => `${X(x)} ${Y(y)}`).join('L')}Z" fill="${isBox ? '#efe9d6' : '#e3ecf8'}" stroke="none"/>`;
s += `<path d="${ceilStripEdge(p, X, Y)}" fill="none" stroke="#000" stroke-width="0.3" stroke-dasharray="${isBox ? '2.4 0.8 0.4 0.8' : '1.4 0.9'}"/>`;
// подсветка — точечная линия внутри полосы
if (e.light) { const [l0, l1] = ceilLightPts(p); s += `<line x1="${X(l0[0])}" y1="${Y(l0[1])}" x2="${X(l1[0])}" y2="${Y(l1[1])}" stroke="#000" stroke-width="0.5" stroke-linecap="round" stroke-dasharray="0.01 1.1"/>`; }
});
});
// подписи — поверх всех полос
ceilEls.forEach(e => {
const isBox = e.type === 'box';
// подпись — у самой длинной полосы, вдоль неё, внутри комнаты
const p = e.strips.slice().sort((a, b) => b.q.len - a.q.len)[0];
const q = p.q, o = g.orient || 1;
const nx = -q.dy * o, ny = q.dx * o;
// вдоль стены — в середину самого длинного участка без окон и дверей (там их подписи)
const spans = (m.openings || []).filter(op => op.wall === q.i && openingWidth(op) > 0).map(op => openingSpan(op, q.len)).sort((a, b) => a[0] - b[0]);
let best = [0, q.len], cur = 0;
if (spans.length) {
best = [0, 0];
spans.concat([[q.len, q.len]]).forEach(([a0, a1]) => {
if (a0 - cur > best[1] - best[0]) best = [cur, a0];
cur = Math.max(cur, a1);
});
}
const t = p.span ? 0.5 : (best[0] + best[1]) / 2 / (q.len || 1);
// у ниши над проёмом посередине стоит подпись проёма — отодвигаем дальше в комнату
const lift = (e.overOp ? 6.5 : 2.2) / k;
const mx = p.inner[0][0] + (p.inner[1][0] - p.inner[0][0]) * t + nx * lift, my = p.inner[0][1] + (p.inner[1][1] - p.inner[0][1]) * t + ny * lift;
const ang = plTextAngle(q);
const label = `${e.code} ${plMm(e.w)}${e.h ? '×' + plMm(e.h) : ''}${e.light ? ' подсв.' : ''}`;
s += T(X(mx), Y(my), label, 2.3, 700, 'middle', isBox ? '#5a4500' : '#1f3f73', `transform="rotate(${ang} ${X(mx)} ${Y(my)})" dominant-baseline="middle"`);
// не на всю стену — размер от угла до начала элемента, за его кромкой
const sp = e.strips.length === 1 ? e.strips[0].span : null;
if (sp && e.partial && e.partial.off > 0.0005) {
const fromEnd = e.partial.corner === 'Б';
const c0 = fromEnd ? q.len : 0, c1 = fromEnd ? sp[1] : sp[0];
const io = e.w + 2.5 / k;
const sx = q.x1 + q.dx * c0 + nx * io, sy = q.y1 + q.dy * c0 + ny * io, ex = q.x1 + q.dx * c1 + nx * io, ey = q.y1 + q.dy * c1 + ny * io;
s += `<line x1="${X(sx)}" y1="${Y(sy)}" x2="${X(ex)}" y2="${Y(ey)}" stroke="#000" stroke-width="0.15"/>`;
[[sx, sy], [ex, ey]].forEach(([px, py]) => {
const d = 1 / k;
s += `<line x1="${X(px - (q.dx + nx) * d)}" y1="${Y(py - (q.dy + ny) * d)}" x2="${X(px + (q.dx + nx) * d)}" y2="${Y(py + (q.dy + ny) * d)}" stroke="#000" stroke-width="0.35"/>`;
});
const ox2 = (sx + ex) / 2 + nx * (1.8 / k), oy2 = (sy + ey) / 2 + ny * (1.8 / k);
s += T(X(ox2), Y(oy2), String(plMm(e.partial.off)), 2.2, 400, 'middle', '#333', `transform="rotate(${ang} ${X(ox2)} ${Y(oy2)})" dominant-baseline="middle"`);
}
});
g.segs.forEach(q => {
s += `<line x1="${X(q.x1)}" y1="${Y(q.y1)}" x2="${X(q.x2)}" y2="${Y(q.y2)}" stroke="#000" stroke-width="0.9" stroke-linecap="square"/>`;
});
const orient = g.orient || 1;
// карниз (на плане потолка) и плинтус (на плане пола) — линией вдоль стен внутри комнаты
if (mode !== 'plan' && typeof molGet === 'function') {
const md = molGet(m);
const kind = mode === 'ceiling' ? md.cornice : md.plinth;
if (kind.on) molWalls(kind.walls, m).forEach(i => {
const q = g.segs[i]; if (!q || !(q.len > 0)) return;
const nx = -q.dy * orient, ny = q.dx * orient, d = 1.1 / k;
const seg = (a, b) => b - a > 0.005 ? `<line x1="${X(q.x1 + q.dx * a + nx * d)}" y1="${Y(q.y1 + q.dy * a + ny * d)}" x2="${X(q.x1 + q.dx * b + nx * d)}" y2="${Y(q.y1 + q.dy * b + ny * d)}" stroke="${mode === 'ceiling' ? '#5b2d86' : '#7a5230'}" stroke-width="0.6"/>` : '';
if (mode === 'ceiling') { molCorniceSpans(m, i, q.len).forEach(([a, b]) => { s += seg(a, b); }); return; }
let x = 0;
molPlinthGaps(m, i, q.len).sort((a, b) => a[0] - b[0]).forEach(([a0, a1]) => { s += seg(x, a0); x = Math.max(x, a1); });
s += seg(x, q.len);
});
}
// проёмы (на плане потолка их нет)
(mode === 'ceiling' ? [] : (m.openings || [])).forEach((o, oi) => {
if (typeof o.wall !== 'number' || !g.segs[o.wall]) return;
const q = g.segs[o.wall];
const [a0, a1] = openingSpan(o, q.len);
const ow = a1 - a0;
const ax = q.x1 + q.dx * a0, ay = q.y1 + q.dy * a0, bx = q.x1 + q.dx * a1, by = q.y1 + q.dy * a1;
const nx = -q.dy * orient, ny = q.dx * orient; // внутрь комнаты
// разрыв стены
s += `<line x1="${X(ax)}" y1="${Y(ay)}" x2="${X(bx)}" y2="${Y(by)}" stroke="#fff" stroke-width="1.6"/>`;
const t = 1.6 / k; // условная толщина, м
// окно — три линии переплёта; дверь — проём с тонкой линией (сторона открывания для малярных работ не важна)
const drawWin = (r0, r1, label) => {
const p0x = q.x1 + q.dx * r0, p0y = q.y1 + q.dy * r0, p1x = q.x1 + q.dx * r1, p1y = q.y1 + q.dy * r1;
[-t, 0, t].forEach(d => {
s += `<line x1="${X(p0x + nx * d)}" y1="${Y(p0y + ny * d)}" x2="${X(p1x + nx * d)}" y2="${Y(p1y + ny * d)}" stroke="#000" stroke-width="${d === 0 ? 0.25 : 0.4}"/>`;
});
if (label) s += T(X((p0x + p1x) / 2 + nx * (5 / k)), Y((p0y + p1y) / 2 + ny * (5 / k)) + 1, label, 2.4, 700);
};
const drawDoor = (r0, r1, label) => {
const p0x = q.x1 + q.dx * r0, p0y = q.y1 + q.dy * r0, p1x = q.x1 + q.dx * r1, p1y = q.y1 + q.dy * r1;
s += `<line x1="${X(p0x)}" y1="${Y(p0y)}" x2="${X(p1x)}" y2="${Y(p1y)}" stroke="#000" stroke-width="0.25" stroke-dasharray="1.2 0.8"/>`;
if (label) s += T(X((p0x + p1x) / 2 + nx * (5 / k)), Y((p0y + p1y) / 2 + ny * (5 / k)) + 1, label, 2.4, 700);
};
if (o.type === 'balcony') {
const bp = balconyParts(o, a0, a1);
drawWin(bp.win[0], bp.win[1], '');
drawDoor(bp.door[0], bp.door[1], '');
// граница окна и двери
const mxp = o.side === 'end' ? bp.door[0] : bp.door[1];
s += `<line x1="${X(q.x1 + q.dx * mxp)}" y1="${Y(q.y1 + q.dy * mxp)}" x2="${X(q.x1 + q.dx * mxp + nx * t * 1.4)}" y2="${Y(q.y1 + q.dy * mxp + ny * t * 1.4)}" stroke="#000" stroke-width="0.35"/>`;
s += T(X((ax + bx) / 2 + nx * (5 / k)), Y((ay + by) / 2 + ny * (5 / k)) + 1, `Б-${oi + 1}`, 2.4, 700);
} else if (o.type === 'door') {
drawDoor(a0, a1, `Д-${oi + 1}`);
} else {
drawWin(a0, a1, `О-${oi + 1}`);
}
// привязка: отступ от выбранного угла — размер внутри комнаты
if (mNum(o.off) > 0) {
const fromEnd = o.from === 'end';
const c0 = fromEnd ? q.len : 0, c1 = fromEnd ? a1 : a0;
const io = 3.5 / k;
const sx = q.x1 + q.dx * c0 + nx * io, sy = q.y1 + q.dy * c0 + ny * io, ex = q.x1 + q.dx * c1 + nx * io, ey = q.y1 + q.dy * c1 + ny * io;
s += `<line x1="${X(sx)}" y1="${Y(sy)}" x2="${X(ex)}" y2="${Y(ey)}" stroke="#000" stroke-width="0.15"/>`;
[[sx, sy], [ex, ey]].forEach(([px, py]) => {
const d = 1 / k;
s += `<line x1="${X(px - (q.dx + nx) * d)}" y1="${Y(py - (q.dy + ny) * d)}" x2="${X(px + (q.dx + nx) * d)}" y2="${Y(py + (q.dy + ny) * d)}" stroke="#000" stroke-width="0.35"/>`;
});
const ang = plTextAngle(q);
const tx = (sx + ex) / 2 + nx * (1.8 / k), ty = (sy + ey) / 2 + ny * (1.8 / k);
s += T(X(tx), Y(ty), String(plMm(Math.abs(c1 - c0))), 2.2, 400, 'middle', '#333', `transform="rotate(${ang} ${X(tx)} ${Y(ty)})" dominant-baseline="middle"`);
}
s += `<line x1="${X(ax)}" y1="${Y(ay)}" x2="${X(ax + nx * t * 1.4)}" y2="${Y(ay + ny * t * 1.4)}" stroke="#000" stroke-width="0.5"/>`;
s += `<line x1="${X(bx)}" y1="${Y(by)}" x2="${X(bx + nx * t * 1.4)}" y2="${Y(by + ny * t * 1.4)}" stroke="#000" stroke-width="0.5"/>`;
});
// размерные линии снаружи каждой стены
const wh = Array.isArray(m.wallHeights) ? m.wallHeights : [];
let shortCount = 0;
g.segs.forEach(q => {
const ox2 = q.dy * orient, oy2 = -q.dx * orient;   // наружу
const own0 = mNum(wh[q.i]);
const label0 = String(plMm(q.len)) + (own0 ? ` (h ${plMm(own0)})` : '');
const isShort = q.len * k < label0.length * 1.75 + 4;   // подпись не помещается вдоль стены
const tier = isShort && (shortCount++ % 2 === 1) ? 2 : 1;
const off = (tier === 2 ? 14 : 8) / k, ext = (tier === 2 ? 16 : 10) / k;
const p1x = q.x1 + ox2 * off, p1y = q.y1 + oy2 * off, p2x = q.x2 + ox2 * off, p2y = q.y2 + oy2 * off;
s += `<line x1="${X(q.x1 + ox2 * (1.5 / k))}" y1="${Y(q.y1 + oy2 * (1.5 / k))}" x2="${X(q.x1 + ox2 * ext)}" y2="${Y(q.y1 + oy2 * ext)}" stroke="#000" stroke-width="0.18"/>`;
s += `<line x1="${X(q.x2 + ox2 * (1.5 / k))}" y1="${Y(q.y2 + oy2 * (1.5 / k))}" x2="${X(q.x2 + ox2 * ext)}" y2="${Y(q.y2 + oy2 * ext)}" stroke="#000" stroke-width="0.18"/>`;
s += `<line x1="${X(p1x - q.dx * 2 / k)}" y1="${Y(p1y - q.dy * 2 / k)}" x2="${X(p2x + q.dx * 2 / k)}" y2="${Y(p2y + q.dy * 2 / k)}" stroke="#000" stroke-width="0.18"/>`;
// засечки 45°
[[p1x, p1y], [p2x, p2y]].forEach(([px, py]) => {
const d = 1.4 / k;
s += `<line x1="${X(px - (q.dx + ox2) * d)}" y1="${Y(py - (q.dy + oy2) * d)}" x2="${X(px + (q.dx + ox2) * d)}" y2="${Y(py + (q.dy + oy2) * d)}" stroke="#000" stroke-width="0.45"/>`;
});
const fs = isShort ? 2.4 : 2.9;
// подпись — вдоль размерной линии, с наружной стороны
const mx = (p1x + p2x) / 2 + ox2 * (2.4 / k), my = (p1y + p2y) / 2 + oy2 * (2.4 / k);
const ang = plTextAngle(q);
s += T(X(mx), Y(my), label0, fs, 400, 'middle', '#000', `transform="rotate(${ang} ${X(mx)} ${Y(my)})" dominant-baseline="middle"`);
});
// углы не по 90° — подписи в углах
if (rlShape(m) === 'free' && Array.isArray(m.angles)) {
g.segs.forEach(q => {
const a = mNum(m.angles[q.i]);
if (!(a > 0) || Math.abs(a - 90) < 0.05) return;
const ix = -q.dy * orient, iy = q.dx * orient;
s += T(X(q.x2 + ix * (4 / k) - q.dx * (4 / k)), Y(q.y2 + iy * (4 / k) - q.dy * (4 / k)) + 1, `${String(a).replace('.', ',')}°`, 2.6, 700, 'middle', '#c2361f');
});
}
// подпись внутри комнаты — в самой «просторной» точке (у Г-образной не в углу выреза)
const area = plFloorArea(g);
const { cx, cy } = plLabelPoint(g, minX, maxX, minY, maxY);
if (g.closed) {
s += T(X(cx), Y(cy) - 2, name, 3.4, 700);
s += T(X(cx), Y(cy) + 3, mode === 'ceiling' ? `S потолка = ${plM2(r.ceilingNet > 0 ? r.ceilingNet : (r.ceiling || area))} м²` : `S = ${plM2(area)} м²`, 3, 400);
if (mNum(m.height)) s += T(X(cx), Y(cy) + 7.5, `h = ${plMm(mNum(m.height))}`, 2.7, 400, 'middle', '#333');
}
const loose = mode === 'ceiling' ? [] : (m.openings || []).map((o, oi) => ({ o, oi })).filter(({ o }) => typeof o.wall !== 'number' && mNum(o.w) && (o.type === 'balcony' ? winH(o) : mNum(o.h)));
// пояснения — строками под чертежом
let ly = box.y + box.h - 1 - (loose.length ? 4 : 0) - 4.2 * (legend.length - 1);
legend.forEach(line => { s += T(box.x, ly, line, 2.6, 400, 'start', '#222'); ly += 4.2; });
if (loose.length) {
s += T(box.x, box.y + box.h - 1, 'Без привязки к стене: ' + loose.map(({ o, oi }) =>
(o.type === 'balcony'
? `Б-${oi + 1} окно ${plMm(mNum(o.w))}×${plMm(winH(o))} + дверь ${plMm(mNum(o.dw))}×${plMm(mNum(o.dh))}`
: `${o.type === 'door' ? 'Д' : 'О'}-${oi + 1} ${plMm(mNum(o.w))}×${plMm(mNum(o.h))}`) + (mCount(o.n) !== 1 ? ' ×' + mCount(o.n) : '')).join(', '), 2.6, 400, 'start', '#444');
}
return { svg: s, scale };
}

function plRoomPage(rooms, info, sheetNo, sheetCount, mode = 'plan', docTitle = 'Обмерный план') {
const frameInnerTop = 10, bottomLimit = PL_H - 5 - 40 - 6;
const boxH = rooms.length === 1 ? bottomLimit - frameInnerTop : (bottomLimit - frameInnerTop - 6) / 2;
let s = '';
const scales = [];
rooms.forEach((room, i) => {
const box = { x: 27, y: frameInnerTop + i * (boxH + 6), w: PL_W - 27 - 9, h: boxH };
const d = plRoomDrawing(room, box, mode);
s += d.svg;
if (d.scale) scales.push(d.scale);
if (i === 0 && rooms.length > 1) s += `<line x1="25" y1="${box.y + boxH + 3}" x2="${PL_W - 7}" y2="${box.y + boxH + 3}" stroke="#bbb" stroke-width="0.2" stroke-dasharray="2 1.5"/>`;
});
const uniq = [...new Set(scales)];
const pageInfo = { ...info, scaleNote: uniq.length === 1 ? `1:${uniq[0]}` : (uniq.length ? 'у чертежей' : '—') };
s += plFrame(pageInfo, sheetNo, sheetCount, rooms.map(roomName).join(', '), docTitle);
return s;
}


/* ===================== РАЗВЁРТКИ СТЕН (PDF) ===================== */
// Развёртка стены в масштабе со всеми размерами: цепочка по длине (углы, проёмы,
// ниши), общая длина и высота, у каждого проёма — подоконник, высота и до потолка,
// у ниш — от пола и высота, у лепнины — рамки с отступами. По две стены на лист.
const PL_DIM = '#000';
function plElevDrawing(m, wi, box, title, withTile = false) {
const T = (x, y, text, size = 2.5, weight = 400, anchor = 'middle', fill = '#000', rot = false) =>
`<text x="${x}" y="${y}" font-family="${PL_FONT}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}"${rot ? ` transform="rotate(-90 ${x} ${y})"` : ''}>${plEsc(text)}</text>`;
let s = T(box.x, box.y + 4, title, 3.4, 700, 'start');
const L = mNum((m.walls || [])[wi]), Hh = wallHeightOf(m, wi);
if (!(L > 0) || !(Hh > 0)) return { svg: s + T(box.x, box.y + 10, 'Нет длины или высоты стены — развёртку не построить', 2.8, 400, 'start', '#a33'), scale: 0 };
let g = null;
try { g = rulerGeometry(m); } catch (e) { g = null; }
const td = withTile && typeof tileGet === 'function' ? tileGet(m).walls : null;
const tileOn = !!td && td.on && molWalls(td.walls, m).includes(wi) && tileSize(td).w > 0 && tileSize(td).l > 0;
const padL = 18, padR = 14, padT = 14, padB = tileOn ? 34 : 26;
let sc = PL_SCALES[PL_SCALES.length - 1];
for (const v of PL_SCALES) { if (L * 1000 / v <= box.w - padL - padR && Hh * 1000 / v <= box.h - padT - padB) { sc = v; break; } }
const k = 1000 / sc;
const x0 = box.x + padL + ((box.w - padL - padR) - L * k) / 2, yTop = box.y + padT, yF = yTop + Hh * k;
// смотрим на стену изнутри комнаты — как на экране
const flip = !!g && (g.orient || 1) < 0;
const XA = a => flip ? x0 + (L - a) * k : x0 + a * k;
const Yh = h => yF - h * k;
const line = (x1, y1, x2, y2, w = 0.2, dash = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${PL_DIM}" stroke-width="${w}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
// размерная цепочка по горизонтали: точки вдоль стены (м), высота линии y (мм листа)
const hChain = (pts, y, size = 2.3) => {
const p = [...new Set(pts.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
if (p.length < 2) return '';
let o = line(Math.min(XA(p[0]), XA(p[p.length - 1])), y, Math.max(XA(p[0]), XA(p[p.length - 1])), y);
p.forEach(v => { const x = XA(v); o += line(x, y + 1.2, x, y - 1.2, 0.2) + line(x - 0.7, y + 0.7, x + 0.7, y - 0.7, 0.35); });
for (let i = 0; i < p.length - 1; i++) {
const a = XA(p[i]), b = XA(p[i + 1]), seg = p[i + 1] - p[i];
if (seg < 0.001) continue;
const txt = String(plMm(seg));
o += T((a + b) / 2, y - 0.9, txt, Math.abs(b - a) < txt.length * size * 0.55 ? size * 0.8 : size);
}
return o;
};
// по вертикали: точки — высоты от пола (м), линия на x (мм листа), подписи слева
const vChain = (pts, x, size = 2.2) => {
const p = [...new Set(pts.map(v => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
if (p.length < 2) return '';
let o = line(x, Yh(p[0]), x, Yh(p[p.length - 1]));
p.forEach(v => { const y = Yh(v); o += line(x - 1.2, y, x + 1.2, y, 0.2) + line(x - 0.7, y + 0.7, x + 0.7, y - 0.7, 0.35); });
for (let i = 0; i < p.length - 1; i++) {
const seg = p[i + 1] - p[i];
if (seg < 0.001) continue;
const txt = String(plMm(seg));
o += T(x - 0.9, (Yh(p[i]) + Yh(p[i + 1])) / 2, txt, seg * k < txt.length * size * 0.55 ? size * 0.8 : size, 400, 'middle', '#000', true);
}
return o;
};
// стена и пол
s += `<rect x="${x0}" y="${yTop}" width="${L * k}" height="${Hh * k}" fill="#fff" stroke="#000" stroke-width="0.5"/>`;
s += line(x0 - 3, yF, x0 + L * k + 3, yF, 0.9);
// раскладка плитки: плитки до высоты укладки, подиумы и короба у стены; проёмы ложатся поверх
let tileNote = '';
if (tileOn) {
const Ht = tileWallH(m, td, wi);
const wl = tileWallLayout(m, td, wi, L, Ht);
const tiles = tilePolys(td, 0, 0, L, Ht, 6000, wl.origin);
const cid = `plTileClip${wi}_${Math.round(box.y)}`;
s += `<clipPath id="${cid}"><rect x="${Math.min(XA(0), XA(L))}" y="${Yh(Ht)}" width="${L * k}" height="${Ht * k}"/></clipPath>`;
if (tiles) s += `<g clip-path="url(#${cid})">${tiles.map(t => `<path d="M${t.map(([a, h]) => `${XA(a).toFixed(2)} ${Yh(h).toFixed(2)}`).join('L')}Z" fill="#e6f2f4" stroke="#1f7a8c" stroke-width="0.12"/>`).join('')}</g>`;
else s += `<rect x="${Math.min(XA(0), XA(L))}" y="${Yh(Ht)}" width="${L * k}" height="${Ht * k}" fill="#e6f2f4"/>`;
if (Ht < Hh - 0.005) s += line(x0, Yh(Ht), x0 + L * k, Yh(Ht), 0.35) + T(x0 + L * k + 1, Yh(Ht) + 1, plMm(Ht), 2.1, 700, 'start', '#1f7a8c');
blocksCompute(m).hidden.filter(p => p.wall === wi).sort((a, b) => b.h - a.h).forEach(p => {
const xl = Math.min(XA(p.span[0]), XA(p.span[1])), w = Math.abs(XA(p.span[1]) - XA(p.span[0]));
s += `<rect x="${xl}" y="${Yh(p.h)}" width="${w}" height="${p.h * k}" fill="${p.side ? '#fbf3e3' : '#f4e3c3'}" stroke="#9a6a12" stroke-width="0.3"${p.side ? ' stroke-dasharray="1.2 0.8"' : ''}/>`;
if (p.h * k > 3 && w > 6) s += T(xl + w / 2, Yh(p.h / 2) + 0.8, p.code + (p.side ? ' бок' : ''), 2, 700, 'middle', '#9a6a12');
});
const { w: tw, l: tl, j: tj } = tileSize(td);
const c = tileWallLayoutCount(m, td, wi);
const pcs = tileWallPiecesTxt(m, td, wi);
tileNote = `Плитка ${Math.round(tw * 1000)}×${Math.round(tl * 1000)} мм, шов ${mFmt(tj * 1000)} мм, ${tileLayout(td).label.toLowerCase()}${Ht < Hh - 0.005 ? `, до ${plMm(Ht)} мм` : ''}${pcs ? ` · крайние куски: ${pcs}` : ''}${c ? ` · ${c.whole} целых + ${c.cut} подрезных = ${c.pcs} шт.${c.narrow ? `, узких ${c.narrow}` : ''}` : ''}`;
}
// углы А и Б
[[0, 'А'], [L, 'Б']].forEach(([a, t]) => { s += `<circle cx="${XA(a)}" cy="${yTop - 3.2}" r="1.9" fill="#fff" stroke="#000" stroke-width="0.25"/>` + T(XA(a), yTop - 2.3, t, 2.3, 700); });
// лепнина: карниз и плинтус полосами, рамки и линии молдингов
const lay = typeof molWallLayout === 'function' ? molWallLayout(m, wi) : { frames: [], lines: [] };
const md = typeof molGet === 'function' ? molGet(m) : null;
if (md && md.cornice.on && molWalls(md.cornice.walls, m).includes(wi)) molCorniceSpans(m, wi, L).forEach(([a, b]) => { s += `<rect x="${Math.min(XA(a), XA(b))}" y="${yTop}" width="${Math.abs(XA(b) - XA(a))}" height="1.4" fill="#e6e0ee" stroke="#000" stroke-width="0.15"/>`; });
if (md && md.plinth.on && molWalls(md.plinth.walls, m).includes(wi)) {
let x = 0;
const seg = (a, b) => b - a > 0.005 ? `<rect x="${Math.min(XA(a), XA(b))}" y="${yF - 1.2}" width="${Math.abs(XA(b) - XA(a))}" height="1.2" fill="#eadfce" stroke="#000" stroke-width="0.15"/>` : '';
molPlinthGaps(m, wi, L).sort((a, b) => a[0] - b[0]).forEach(([a0, a1]) => { s += seg(x, a0); x = Math.max(x, a1); });
s += seg(x, L);
}
lay.frames.forEach(f => [f, f.inner].filter(Boolean).forEach((r, j) => {
const xl = Math.min(XA(r.x0), XA(r.x1));
s += `<rect x="${xl}" y="${Yh(r.y1)}" width="${Math.abs(XA(r.x1) - XA(r.x0))}" height="${(r.y1 - r.y0) * k}" fill="none" stroke="#5b2d86" stroke-width="${j ? 0.18 : 0.28}"/>`;
}));
lay.lines.forEach(l => { s += `<line x1="${XA(l.x0)}" y1="${Yh(l.y)}" x2="${XA(l.x1)}" y2="${Yh(l.y)}" stroke="#5b2d86" stroke-width="0.35"/>`; });
// закрыто мебелью — штриховкой
const covs = typeof coversCompute === 'function' ? coversCompute(m).pieces.filter(e => e.wall === wi) : [];
if (covs.length) s += `<defs><pattern id="plCovHatch${wi}" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.6" stroke="#777" stroke-width="0.25"/></pattern></defs>`;
covs.forEach(e => {
const xl = Math.min(XA(e.span[0]), XA(e.span[1])), w = Math.abs(XA(e.span[1]) - XA(e.span[0]));
s += `<rect x="${xl}" y="${Yh(e.top)}" width="${w}" height="${e.h * k}" fill="url(#plCovHatch${wi})" stroke="#000" stroke-width="0.3"/>`;
s += `<rect x="${xl + w / 2 - Math.min(w / 2 - 0.5, 9)}" y="${Yh((e.top + e.bottom) / 2) - 2}" width="${Math.max(1, Math.min(w - 1, 18))}" height="3.2" fill="#fff"/>`;
s += T(xl + w / 2, Yh((e.top + e.bottom) / 2) + 0.4, e.code + (e.side ? (w > 8 ? ' бок' : '') : (e.name && w > 20 ? ' ' + e.name : '')), 2.1, 700);
});
// участки стен — штриховой синей рамкой
const partsW = typeof partsCompute === 'function' ? partsCompute(m).filter(e => e.wall === wi && e.span) : [];
partsW.forEach(e => {
const xl = Math.min(XA(e.span[0]), XA(e.span[1])), w = Math.abs(XA(e.span[1]) - XA(e.span[0]));
s += `<rect x="${xl}" y="${Yh(e.top)}" width="${w}" height="${e.h * k}" fill="#2f6fc0" fill-opacity="0.08" stroke="#1f4f8f" stroke-width="0.3" stroke-dasharray="1.6 0.8"/>`;
s += T(xl + 1, Yh(e.top) + 2.6, e.code + (e.name && w > 25 ? ' ' + e.name : ''), 2, 700, 'start', '#1f4f8f');
});
// ниши в стенах
const niches = typeof radNichesCompute === 'function' ? radNichesCompute(m).list.filter(e => e.wall === wi && e.span) : [];
niches.forEach(e => {
const xl = Math.min(XA(e.span[0]), XA(e.span[1])), w = Math.abs(XA(e.span[1]) - XA(e.span[0]));
s += `<rect x="${xl}" y="${Yh(e.top)}" width="${w}" height="${(e.top - e.bottom) * k}" fill="#f3efe8" stroke="#000" stroke-width="0.25" stroke-dasharray="1.2 0.8"/>`;
s += T(xl + w / 2, Yh((e.top + e.bottom) / 2) + 0.9, `${e.code}${e.d ? ', гл. ' + plMm(e.d) : ''}`, 2.1);
});
// проёмы
const ops = (m.openings || []).map((o, oi) => ({ o, oi })).filter(({ o }) => o.wall === wi && openingWidth(o) > 0);
const edges = [0, L];
ops.forEach(({ o, oi }) => {
const [a0, a1] = openingSpan(o, L);
const v = openingVert(o, Hh);
const xl = Math.min(XA(a0), XA(a1)), xr = Math.max(XA(a0), XA(a1));
if (o.type === 'balcony') {
const bp = balconyParts(o, a0, a1);
[bp.door, bp.win].forEach(sp => edges.push(sp[0], sp[1]));
const dl = Math.min(XA(bp.door[0]), XA(bp.door[1])), dr = Math.max(XA(bp.door[0]), XA(bp.door[1]));
const wl = Math.min(XA(bp.win[0]), XA(bp.win[1])), wr = Math.max(XA(bp.win[0]), XA(bp.win[1]));
s += `<rect x="${dl}" y="${Yh(v.door[1])}" width="${dr - dl}" height="${v.door[1] * k}" fill="#fff" stroke="#000" stroke-width="0.35"/>`;
s += `<rect x="${wl}" y="${Yh(v.y1)}" width="${wr - wl}" height="${(v.y1 - v.y0) * k}" fill="#eef4fb" stroke="#000" stroke-width="0.35"/>`;
} else {
edges.push(a0, a1);
const isDoor = o.type === 'door';
s += `<rect x="${xl}" y="${Yh(v.y1)}" width="${xr - xl}" height="${(v.y1 - v.y0) * k}" fill="${isDoor ? '#fff' : '#eef4fb'}" stroke="#000" stroke-width="0.35"${v.guess ? ' stroke-dasharray="1.5 1"' : ''}/>`;
if (isDoor) s += line(xl, yF, xr, Yh(v.y1), 0.15) + line(xr, yF, xl, Yh(v.y1), 0.15);
else s += line((xl + xr) / 2, Yh(v.y1), (xl + xr) / 2, Yh(v.y0), 0.15) + line(xl, Yh((v.y0 + v.y1) / 2), xr, Yh((v.y0 + v.y1) / 2), 0.15);
}
s += T((xl + xr) / 2, Yh(v.y1) + 3, opCode(o, oi), 2.3, 700);
// по высоте у правого края проёма: пол — подоконник — верх — потолок
s += vChain(o.type === 'door' ? [0, v.y1, Hh] : [0, v.y0, v.y1, Hh], xr + 3);
if (v.guess) s += T((xl + xr) / 2, Yh(v.y0) - 1.5, 'подоконник условно', 1.8, 400, 'middle', '#a33');
});
partsW.forEach(e => {
if (!e.full) edges.push(e.span[0], e.span[1]);
if (!e.toCeil || e.bottom > 0.005) s += vChain([0, e.bottom, e.top, ...(e.toCeil ? [] : [Hh])].filter((v, i) => i !== 1 || e.bottom > 0.005), Math.min(XA(e.span[0]), XA(e.span[1])) + 3);
});
covs.forEach(e => {
edges.push(e.span[0], e.span[1]);
if (!e.toCeil || e.bottom > 0.005) s += vChain([0, e.bottom, e.top, Hh].filter((v, i) => i !== 1 || e.bottom > 0.005), Math.max(XA(e.span[0]), XA(e.span[1])) - 2.5);
});
niches.forEach(e => {
edges.push(e.span[0], e.span[1]);
// высота ниши и низ от пола — у левого края
s += vChain([0, e.bottom, e.top].filter((v, i) => i || e.bottom > 0.005), Math.min(XA(e.span[0]), XA(e.span[1])) - 2.5);
});
// молдинги: у первой рамки ряда — размеры, отступы от пола и до потолка, промежуток, внутренняя рамка
const seen = new Set();
lay.frames.forEach(f => {
if (seen.has(f.ri)) return;
seen.add(f.ri);
const xl = Math.min(XA(f.x0), XA(f.x1)), xr = Math.max(XA(f.x0), XA(f.x1));
s += T(xl + (xr - xl) * 0.4, Yh(f.y1) + Math.min(4.5, (f.y1 - f.y0) * k * 0.3), `${plMm(f.x1 - f.x0)}×${plMm(f.y1 - f.y0)}`, 2.1, 700, 'middle', '#5b2d86');
const others = lay.frames.filter(q => q.ri !== f.ri && Math.min(f.x1, q.x1) - Math.max(f.x0, q.x0) > 0.01);
const below = Math.max(0, ...others.filter(q => q.y1 <= f.y0 + 0.001).map(q => q.y1));
const above = Math.min(Hh, ...others.filter(q => q.y0 >= f.y1 - 0.001).map(q => q.y0));
s += vChain([below, f.y0, f.y1, ...(others.some(q => q.y0 >= f.y1 - 0.001) ? [] : [above])], xl + (xr - xl) * 0.78);
const row = lay.frames.filter(q => q.ri === f.ri);
const j = row.findIndex((q, n) => row[n + 1] && Math.abs(row[n + 1].x0 - q.x1 - q.gap) < 0.005);
if (j >= 0 && row[j].gap > 0) s += hChain([row[j].x1, row[j + 1].x0], Yh(row[j].y0 + (row[j].y1 - row[j].y0) * 0.2), 2);
if (f.inner) s += T(xl + 1, Yh(f.inner.y0) - 0.8, `внутр. ${plMm(f.inner.x0 - f.x0)}`, 1.9, 400, 'start', '#5b2d86');
});
lay.lines.filter((l, n, a) => a.findIndex(q => q.ri === l.ri) === n).forEach(l => { s += vChain([0, l.y], Math.min(XA(l.x0), XA(l.x1)) + 3); });
// цепочка по длине, общая длина, высота стены
s += hChain(edges, yF + 6);
s += hChain([0, L], yF + 13, 2.6);
s += vChain([0, Hh], x0 - 7, 2.6);
// итог под чертежом
const net = ops.reduce((a, { o }) => a + (o.type === 'balcony' ? mNum(o.w) * winH(o) + mNum(o.dw) * mNum(o.dh) : mNum(o.w) * mNum(o.h)) * (mCount(o.n) || 1), 0);
const covA = L < 1 ? 0 : covs.reduce((a, e) => a + e.area, 0);
s += T(box.x, yF + 20, `${plMm(L)} × ${plMm(Hh)} мм · стена ${plM2(L * Hh)} м²${net > 0 ? ` − проёмы ${plM2(net)}` : ''}${covA > 0 ? ` − мебель ${plM2(covA)}` : ''}${net > 0 || covA > 0 ? ` = ${plM2(Math.max(0, L * Hh - net - covA))} м²` : ''} · М 1:${sc}`, 2.5, 400, 'start', '#222');
const notes = [...partsW.map(e => `${e.code}${e.name ? ' ' + e.name : ''}: ${plMm(e.w)}×${plMm(e.h)}${e.bottom > 0.005 ? `, от пола ${plMm(e.bottom)}` : ''} = ${plM2(e.area)} м²`), ...covs.map(e => `${e.code}${e.side ? ' бок' : e.name ? ' ' + e.name : ''}: закрыто ${plMm(e.w)}×${plMm(e.h)}${e.bottom > 0.005 ? `, от пола ${plMm(e.bottom)}` : ''}`), ...niches.map(e => `${e.code}: ${plMm(e.w)}×${plMm(e.h)}${e.d ? '×' + plMm(e.d) : ''}${e.raised ? `, от пола ${plMm(e.bottom)}` : ''}`)];
const tl = tileNote ? plWrap(tileNote, 120) : [];
tl.forEach((t, i) => { s += T(box.x, yF + 24 + i * 3.2, t, 2.2, 700, 'start', '#1f7a8c'); });
if (notes.length) s += T(box.x, yF + 24 + tl.length * 3.2 + (tl.length ? 0.8 : 0), notes.join('; '), 2.2, 400, 'start', '#444');
return { svg: s, scale: sc };
}

function plElevPage(items, info, sheetNo, sheetCount) {
const top = 10, bottomLimit = PL_H - 5 - 40 - 6;
const boxH = (bottomLimit - top - 6) / 2;
let s = '';
const scales = [];
items.forEach((it, i) => {
const box = { x: 27, y: top + i * (boxH + 6), w: PL_W - 27 - 9, h: boxH };
const d = plElevDrawing(it.m, it.wi, box, it.title, !!it.tile);
s += d.svg;
if (d.scale) scales.push(d.scale);
if (i === 0 && items.length > 1) s += `<line x1="25" y1="${box.y + boxH + 3}" x2="${PL_W - 7}" y2="${box.y + boxH + 3}" stroke="#bbb" stroke-width="0.2" stroke-dasharray="2 1.5"/>`;
});
const uniq = [...new Set(scales)];
const names = [...new Set(items.map(it => it.room))].join(', ');
s += plFrame({ ...info, scaleNote: uniq.length === 1 ? `1:${uniq[0]}` : (uniq.length ? 'у чертежей' : '—') }, sheetNo, sheetCount, names, items.some(it => it.tile) ? 'Раскладка плитки' : 'Развёртки стен');
return s;
}

// items: [{ m, wi, room, title }]
async function buildElevPDF(items, info, fileBase) {
if (!items.length) throw new Error('Не выбрано ни одной стены');
const pages = [];
for (let i = 0; i < items.length; i += 2) pages.push(items.slice(i, i + 2));
const { jsPDF } = window.jspdf;
const pdf = new jsPDF('p', 'mm', 'a4');
for (let i = 0; i < pages.length; i++) {
if (i) pdf.addPage();
const png = await plSvgToPng(plElevPage(pages[i], info, i + 1, pages.length));
pdf.addImage(png, 'PNG', 0, 0, PL_W, PL_H, undefined, 'FAST');
}
const safe = String(fileBase || 'zamer').replace(/[^\wа-яё\- ]+/gi, '').trim().replace(/\s+/g, '_');
return { pdfBlob: pdf.output('blob'), fileName: `${items.some(it => it.tile) ? 'Plitka' : 'Razvertki'}_${safe || 'zamer'}.pdf` };
}

/* ---------- выбор развёрток для печати ---------- */
// rooms: [{ name, m }]; sel[i] — набор номеров стен помещения i
let elevPrint = null;
const elevWallsOf = m => (Array.isArray(m.walls) ? m.walls : []).map((w, i) => mNum(w) > 0 ? i : -1).filter(i => i >= 0);
function openElevPrint(rooms, info, fileBase, preset, tile = false) {
rooms = rooms.filter(r => r.m && elevWallsOf(r.m).length);
if (!rooms.length) { showAddToast('Нет стен с длиной — введите стены на вкладке «Стены»'); return; }
elevPrint = { rooms, info, fileBase, tile: !!tile, sel: rooms.map((r, i) => new Set(preset && preset[i] ? preset[i] : elevWallsOf(r.m))) };
document.getElementById('sheetTitle').textContent = tile ? 'Раскладка плитки по стенам — PDF' : 'Развёртки стен — PDF со всеми размерами';
renderElevPrint();
document.getElementById('sheet').classList.add('open');
document.getElementById('sheetOverlay').classList.add('open');
document.body.classList.add('sheet-open');
}
function renderElevPrint() {
const st = elevPrint;
if (!st) return;
const n = st.sel.reduce((a, s) => a + s.size, 0);
document.getElementById('sheetItems').innerHTML = `<div class="ep-list">
${st.rooms.map((r, i) => {
const ws = elevWallsOf(r.m);
const all = ws.every(w => st.sel[i].has(w));
return `<div class="ep-room"><div class="ep-name">${plEsc(r.name)}</div>
<div class="mp-ce-walls"><span class="mp-ce-walls-label">Стены:</span>${ws.map(w => `<button type="button" class="mp-ce-wall${st.sel[i].has(w) ? ' on' : ''}" onclick="elevPrintToggle(${i}, ${w})" aria-pressed="${st.sel[i].has(w)}">${w + 1}</button>`).join('')}<button type="button" class="mp-ce-wall mp-ce-all${all ? ' on' : ''}" onclick="elevPrintAll(${i})">все</button></div></div>`;
}).join('')}
</div>
${st.rooms.some(r => typeof tileGet === 'function' && tileGet(r.m).walls.on) ? `<div class="mp-ce-walls"><span class="mp-ce-walls-label">Плитка:</span><button type="button" class="mp-ce-wall${st.tile ? ' on' : ''}" onclick="elevPrintTile()" aria-pressed="${st.tile}">с раскладкой плитки</button></div>` : ''}
<div class="ep-count">${n ? `Выбрано развёрток: ${n} · листов A4: ${Math.ceil(n / 2)}` : 'Отметьте стены'}</div>
<button type="button" class="sheet-item" onclick="elevPrintGo('share')"${n ? '' : ' disabled'}><span class="sheet-item-icon" aria-hidden="true">${sheetIconHtml('📤')}</span>Отправить PDF</button>
<button type="button" class="sheet-item" onclick="elevPrintGo('download')"${n ? '' : ' disabled'}><span class="sheet-item-icon" aria-hidden="true">${sheetIconHtml('⬇️')}</span>Скачать PDF</button>`;
}
function elevPrintTile() {
if (!elevPrint) return;
elevPrint.tile = !elevPrint.tile;
renderElevPrint();
}
function elevPrintToggle(i, w) {
const set = elevPrint && elevPrint.sel[i];
if (!set) return;
if (set.has(w)) set.delete(w); else set.add(w);
renderElevPrint();
}
function elevPrintAll(i) {
const st = elevPrint;
if (!st || !st.sel[i]) return;
const ws = elevWallsOf(st.rooms[i].m);
st.sel[i] = new Set(ws.every(w => st.sel[i].has(w)) ? [] : ws);
renderElevPrint();
}
async function elevPrintGo(mode) {
const st = elevPrint;
if (!st) return;
const items = [];
st.rooms.forEach((r, i) => [...st.sel[i]].sort((a, b) => a - b).forEach(wi => items.push({ m: r.m, wi, room: r.name, title: `${r.name} — стена ${wi + 1}`, tile: st.tile })));
if (!items.length) return;
closeSheet();
showAddToast('Готовлю развёртки…');
try {
const { pdfBlob, fileName } = await buildElevPDF(items, st.info, st.fileBase);
const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
if (mode === 'share' && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ title: 'Развёртки стен', files: [file] });
else triggerFileDownload(pdfBlob, fileName);
} catch (err) {
if (err && err.name === 'AbortError') return;
console.error('Развёртки:', err);
alert('Не удалось собрать развёртки: ' + (err && err.message ? err.message : err));
}
}
function plObjectInfo(obj) {
return {
company: (cloudData.self && cloudData.self.companyName) || currentUser || '',
client: (obj && obj.client) || '', address: (obj && obj.address) || '', object: (obj && obj.name) || '',
date: new Date().toLocaleDateString('ru-RU'),
};
}
// Все помещения объекта
function openElevPrintForObject(objectId) {
const obj = (cloudData.objects || []).find(o => o.id === objectId);
openElevPrint(objectRooms(obj).map(room => ({ name: roomName(room), m: room.measure })), plObjectInfo(obj), obj && obj.name);
}
// Текущий замер (в том числе несохранённый): отмечена стена с развёртки
// tile — раскладка плитки: отмечены стены с плиткой
function openElevPrintForMeasure(tile = false) {
if (!measure) return;
const obj = measure.objectId ? (cloudData.objects || []).find(o => o.id === measure.objectId) : null;
const name = (measure.room || '').trim() || 'Помещение';
const cur = typeof rlElevWall === 'number' ? rlElevWall : 0;
if (tile && typeof tileGet === 'function' && tileGet(measure).walls.on) { openElevPrint([{ name, m: measure }], plObjectInfo(obj), obj ? `${obj.name}_${name}` : name, [molWalls(tileGet(measure).walls.walls, measure)], true); return; }
openElevPrint([{ name, m: measure }], plObjectInfo(obj), obj ? `${obj.name}_${name}` : name, [mNum((measure.walls || [])[cur]) > 0 ? [cur] : null]);
}

/* ===================== ПЛАНЫ ПОЛА И ПОТОЛКА (PDF) ===================== */
// План пола: размеры, проёмы, площадь, плинтус, плитка по раскладке.
// План потолка: размеры, ниши и короба, рамки молдингов, карниз, подсветка, площадь.
// Небольшие комнаты одного вида — по две на лист, крупные — по одной.
const PL_FLAT = { floor: 'План пола', ceiling: 'План потолка' };
function plFitsHalf(room) {
const g = plRoomPolygon(room.measure);
if (!g) return true;
const xs = [0, ...g.segs.map(q => q.x2)], ys = [0, ...g.segs.map(q => q.y2)];
const wM = Math.max(...xs) - Math.min(...xs), hM = Math.max(...ys) - Math.min(...ys);
const halfH = (PL_H - 5 - 40 - 6 - 10 - 6) / 2 - 10 - 32, fullW = PL_W - 27 - 9 - 32;
return wM * 1000 / 50 <= fullW && hM * 1000 / 50 <= halfH && g.segs.length <= 8;
}
// items: [{ room, mode }]
async function buildFlatPDF(items, info, fileBase) {
if (!items.length) throw new Error('Ничего не выбрано');
const pages = [];
for (let i = 0; i < items.length; i++) {
const a = items[i], b = items[i + 1];
if (b && a.mode === b.mode && plFitsHalf(a.room) && plFitsHalf(b.room)) { pages.push([a, b]); i++; }
else pages.push([a]);
}
const { jsPDF } = window.jspdf;
const pdf = new jsPDF('p', 'mm', 'a4');
for (let i = 0; i < pages.length; i++) {
if (i) pdf.addPage();
const mode = pages[i][0].mode;
const png = await plSvgToPng(plRoomPage(pages[i].map(it => it.room), info, i + 1, pages.length, mode, PL_FLAT[mode]));
pdf.addImage(png, 'PNG', 0, 0, PL_W, PL_H, undefined, 'FAST');
}
const safe = String(fileBase || 'zamer').replace(/[^\wа-яё\- ]+/gi, '').trim().replace(/\s+/g, '_');
return { pdfBlob: pdf.output('blob'), fileName: `Plany_pola_i_potolka_${safe || 'zamer'}.pdf` };
}

/* ---------- выбор планов для печати ---------- */
// rooms: [{ name, room }]; sel[i] — набор видов помещения i: 'floor', 'ceiling'
let flatPrint = null;
function openFlatPrint(rooms, info, fileBase, preset) {
rooms = rooms.filter(r => r.room && r.room.measure && (r.room.measure.walls || []).some(w => mNum(w) > 0));
if (!rooms.length) { showAddToast('Нет стен с длиной — введите стены на вкладке «Стены»'); return; }
flatPrint = { rooms, info, fileBase, sel: rooms.map(() => new Set(preset || ['floor', 'ceiling'])) };
document.getElementById('sheetTitle').textContent = 'Планы пола и потолка — PDF с размерами';
renderFlatPrint();
document.getElementById('sheet').classList.add('open');
document.getElementById('sheetOverlay').classList.add('open');
document.body.classList.add('sheet-open');
}
function renderFlatPrint() {
const st = flatPrint;
if (!st) return;
const n = st.sel.reduce((a, s) => a + s.size, 0);
document.getElementById('sheetItems').innerHTML = `<div class="ep-list">
${st.rooms.map((r, i) => `<div class="ep-room"><div class="ep-name">${plEsc(r.name)}</div>
<div class="mp-ce-walls">${Object.entries(PL_FLAT).map(([k, label]) => `<button type="button" class="mp-ce-wall${st.sel[i].has(k) ? ' on' : ''}" onclick="flatPrintToggle(${i}, '${k}')" aria-pressed="${st.sel[i].has(k)}">${label}</button>`).join('')}</div></div>`).join('')}
</div>
<div class="ep-count">${n ? `Выбрано планов: ${n}` : 'Отметьте, что печатать'}</div>
<button type="button" class="sheet-item" onclick="flatPrintGo('share')"${n ? '' : ' disabled'}><span class="sheet-item-icon" aria-hidden="true">${sheetIconHtml('📤')}</span>Отправить PDF</button>
<button type="button" class="sheet-item" onclick="flatPrintGo('download')"${n ? '' : ' disabled'}><span class="sheet-item-icon" aria-hidden="true">${sheetIconHtml('⬇️')}</span>Скачать PDF</button>`;
}
function flatPrintToggle(i, k) {
const set = flatPrint && flatPrint.sel[i];
if (!set) return;
if (set.has(k)) set.delete(k); else set.add(k);
renderFlatPrint();
}
async function flatPrintGo(mode) {
const st = flatPrint;
if (!st) return;
// сначала все планы пола, потом все планы потолка — так соседние влезают на один лист
const items = [];
['floor', 'ceiling'].forEach(k => st.rooms.forEach((r, i) => { if (st.sel[i].has(k)) items.push({ room: r.room, mode: k }); }));
if (!items.length) return;
closeSheet();
showAddToast('Готовлю планы…');
try {
const { pdfBlob, fileName } = await buildFlatPDF(items, st.info, st.fileBase);
const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
if (mode === 'share' && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ title: 'Планы пола и потолка', files: [file] });
else triggerFileDownload(pdfBlob, fileName);
} catch (err) {
if (err && err.name === 'AbortError') return;
console.error('Планы:', err);
alert('Не удалось собрать планы: ' + (err && err.message ? err.message : err));
}
}
function openFlatPrintForObject(objectId) {
const obj = (cloudData.objects || []).find(o => o.id === objectId);
openFlatPrint(objectRooms(obj).map(room => ({ name: roomName(room), room })), plObjectInfo(obj), obj && obj.name);
}
// Текущий замер (в том числе несохранённый); preset — 'floor' или 'ceiling'
function openFlatPrintForMeasure(preset) {
if (!measure) return;
const obj = measure.objectId ? (cloudData.objects || []).find(o => o.id === measure.objectId) : null;
const name = (measure.room || '').trim() || 'Помещение';
openFlatPrint([{ name, room: { measure } }], plObjectInfo(obj), obj ? `${obj.name}_${name}` : name, preset ? [preset] : null);
}

/* ---------- сборка PDF ---------- */
async function plSvgToPng(inner, dpi = 200) {
const wPx = Math.round(PL_W / 25.4 * dpi), hPx = Math.round(PL_H / 25.4 * dpi);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}" viewBox="0 0 ${PL_W} ${PL_H}"><rect width="${PL_W}" height="${PL_H}" fill="#fff"/>${inner}</svg>`;
const img = new Image();
img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
await img.decode();
const canvas = document.createElement('canvas');
canvas.width = wPx; canvas.height = hPx;
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, wPx, hPx);
ctx.drawImage(img, 0, 0, wPx, hPx);
return canvas.toDataURL('image/png');
}

function plRoomRow(room) {
const m = room.measure;
const r = computeMeasure(m);
const g = plRoomPolygon(m);
const ops = (m.openings || []).filter(o => mNum(o.w) && (o.type === 'balcony' ? winH(o) : mNum(o.h)));
const win = ops.filter(o => o.type !== 'door' && o.type !== 'balcony').reduce((a, o) => a + mCount(o.n), 0);
const door = ops.filter(o => o.type === 'door').reduce((a, o) => a + mCount(o.n), 0);
const balc = ops.filter(o => o.type === 'balcony').reduce((a, o) => a + mCount(o.n), 0);
const opsText = [win ? `окна ${win}` : '', door ? `двери ${door}` : '', balc ? `балк. бл. ${balc}` : ''].filter(Boolean).join(', ');
return { ceilEls: (r.ceilEls || []).length, name: roomName(room), floor: plFloorArea(g) || r.ceiling || 0, per: r.perimeter, h: mNum(m.height), walls: r.wallsGross, net: Math.max(0, (r.openingsArea > 0 ? r.wallsNet : r.wallsGross) - (r.coversArea || 0)), ops: opsText };
}

async function buildMeasurePlanPDF(objectId) {
const obj = (cloudData.objects || []).find(o => o.id === objectId);
const rooms = objectRooms(obj);
if (!obj || !rooms.length) throw new Error('У объекта нет помещений с замером');
const info = {
company: (cloudData.self && cloudData.self.companyName) || currentUser || '',
client: obj.client || '', address: obj.address || '', object: obj.name || '',
date: new Date().toLocaleDateString('ru-RU'),
};
// Комната, которая в половине листа помещается не мельче 1:50, может делить
// лист с такой же; крупная или сложная получает целый лист
const fitsHalf = room => {
const g = plRoomPolygon(room.measure);
if (!g) return true;
const xs = [0, ...g.segs.map(q => q.x2)], ys = [0, ...g.segs.map(q => q.y2)];
const wM = Math.max(...xs) - Math.min(...xs), hM = Math.max(...ys) - Math.min(...ys);
const halfH = (PL_H - 5 - 40 - 6 - 10 - 6) / 2 - 10 - 32, fullW = PL_W - 27 - 9 - 32;
return wM * 1000 / 50 <= fullW && hM * 1000 / 50 <= halfH && g.segs.length <= 8;
};
const pagesRooms = [];
for (let i = 0; i < rooms.length; i++) {
if (fitsHalf(rooms[i]) && i + 1 < rooms.length && fitsHalf(rooms[i + 1])) { pagesRooms.push([rooms[i], rooms[i + 1]]); i++; }
else pagesRooms.push([rooms[i]]);
}
const sheetCount = 1 + pagesRooms.length;
const pages = [plExplicationPage(rooms.map(plRoomRow), info, sheetCount)];
pagesRooms.forEach((pr, i) => pages.push(plRoomPage(pr, info, i + 2, sheetCount)));
const { jsPDF } = window.jspdf;
const pdf = new jsPDF('p', 'mm', 'a4');
for (let i = 0; i < pages.length; i++) {
if (i) pdf.addPage();
const png = await plSvgToPng(pages[i]);
pdf.addImage(png, 'PNG', 0, 0, PL_W, PL_H, undefined, 'FAST');
}
const safe = String(obj.name || 'obekt').replace(/[^\wа-яё\- ]+/gi, '').trim().replace(/\s+/g, '_');
return { pdfBlob: pdf.output('blob'), fileName: `Obmernyy_plan_${safe || 'obekt'}.pdf` };
}

function openPlanActions(objectId) {
const obj = (cloudData.objects || []).find(o => o.id === objectId);
const n = objectRooms(obj).length;
openSheet(`Обмерный план · ${obj ? obj.name : ''} · ${n} ${pluralRu(n, 'помещение', 'помещения', 'помещений')}`, [
{ icon: '📤', label: 'Отправить PDF', onClick: () => exportMeasurePlan(objectId, 'share') },
{ icon: '⬇️', label: 'Скачать PDF', onClick: () => exportMeasurePlan(objectId, 'download') },
null,
{ icon: '📏', label: 'Развёртки стен (PDF)…', onClick: () => openElevPrintForObject(objectId) },
{ icon: '📏', label: 'Планы пола и потолка (PDF)…', onClick: () => openFlatPrintForObject(objectId) },
]);
}

async function exportMeasurePlan(objectId, mode = 'share') {
showAddToast('Готовлю обмерный план…');
try {
const { pdfBlob, fileName } = await buildMeasurePlanPDF(objectId);
const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
if (mode === 'share' && navigator.canShare && navigator.canShare({ files: [file] })) {
await navigator.share({ title: 'Обмерный план', files: [file] });
} else {
triggerFileDownload(pdfBlob, fileName);
}
} catch (err) {
if (err && err.name === 'AbortError') return;
console.error('Обмерный план:', err);
alert('Не удалось собрать обмерный план: ' + (err && err.message ? err.message : err));
}
}
