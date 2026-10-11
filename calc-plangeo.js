// Кабинет мастера — план из точек картинки (ответ нейросети) в миллиметры.
// Нейросеть отмечает помещения прямо на картинке и выписывает подписанные размеры
// сторон; точную часть делаем здесь, программой:
//   1) края помещений подгоняем по стенам на картинке (граница светлого пола и тёмной стены);
//   2) масштаб (мм на точку) — по подписанным размерам всех помещений;
//   3) размеры каждого помещения — точно по подписям, место — как на картинке;
//   4) двери соседних помещений — друг напротив друга, стены — одной линией (flatAutoFit);
//   5) картинка — подложкой под план квартиры, уже совмещённой.
// Подключается из calc.html после calc-flat.js, до calc-import.js.

// Яркость точек картинки (0 — чёрный, 255 — белый)
async function pgLoadGray(dataUrl) {
const img = new Image();
img.src = dataUrl;
await img.decode();
const w = img.naturalWidth, h = img.naturalHeight;
const c = document.createElement('canvas');
c.width = w; c.height = h;
const ctx = c.getContext('2d', { willReadFrequently: true });
ctx.drawImage(img, 0, 0);
const d = ctx.getImageData(0, 0, w, h).data;
const g = new Uint8Array(w * h);
for (let i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
return { w, h, g };
}

function pgArea2(p) {
let a = 0;
for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; }
return a;
}

// Помещение из стен только вдоль осей (горизонтальная, вертикальная, по очереди)?
// Тогда у каждой стороны одна координата: y у горизонтальной, x у вертикальной
function pgAxes(px) {
const n = px.length;
const kinds = px.map((p, i) => {
const q = px[(i + 1) % n], dx = Math.abs(q[0] - p[0]), dy = Math.abs(q[1] - p[1]);
return dy <= Math.max(3, dx * 0.2) ? 'h' : dx <= Math.max(3, dy * 0.2) ? 'v' : null;   // до ~11° — неточность отметки, не косая стена
});
if (kinds.some(k => !k) || n % 2) return null;
for (let i = 0; i < n; i++) if (kinds[i] === kinds[(i + 1) % n]) return null;
return kinds;
}

// Стороны → углы: угол i — между стороной i−1 и стороной i
function pgCorners(kinds, at) {
const n = kinds.length;
return kinds.map((k, i) => {
const prev = (i - 1 + n) % n;
return k === 'h' ? [at[prev], at[i]] : [at[i], at[prev]];
});
}

// Подогнать стороны помещения по стенам на картинке: у каждой стороны ищем рядом
// линию, где с внутренней стороны светло (пол), а снаружи темно (стена или её контур)
function pgSnapRoom(px, kinds, gray, openings, rMax) {
const n = px.length;
const at = px.map((p, i) => { const q = px[(i + 1) % n]; return kinds[i] === 'h' ? (p[1] + q[1]) / 2 : (p[0] + q[0]) / 2; });
const cw = pgArea2(px) > 0 ? 1 : -1;                         // по часовой на картинке (y вниз) — площадь > 0
const R = rMax || Math.max(8, Math.round(Math.max(gray.w, gray.h) * 0.02));   // насколько далеко искать стену, точек
const G = (x, y) => {
x = Math.round(x); y = Math.round(y);
return x < 0 || y < 0 || x >= gray.w || y >= gray.h ? 255 : gray.g[y * gray.w + x];
};
const snapped = at.map((c0, i) => {
const p = px[i], q = px[(i + 1) % n];
const dx = q[0] - p[0], dy = q[1] - p[1];
const len = Math.hypot(dx, dy);
if (len < 6) return c0;
// наружу от помещения: для обхода по часовой (y вниз) — (dy, −dx)
const ox = Math.sign(dy) * cw, oy = -Math.sign(dx) * cw;
const N = Math.min(40, Math.max(8, Math.round(len / 6)));
// участки стены с окнами и дверями (их отметила нейросеть) не проверяем: там нет стены, зато есть рамки
const along = (pt) => ((pt[0] - p[0]) * dx + (pt[1] - p[1]) * dy) / len;
const across = (pt) => Math.abs((pt[0] - p[0]) * dy - (pt[1] - p[1]) * dx) / len;
const gaps = (openings || []).filter(o => Array.isArray(o.px) && o.px.length === 2 && o.px.every(q => across(q) <= R * 1.5))
.map(o => { const a = along(o.px[0]) / len, b = along(o.px[1]) / len, m = 12 / len; return [Math.min(a, b) - m, Math.max(a, b) + m]; });
const ts = [];
for (let k = 0; k < N; k++) {
const t = 0.12 + 0.76 * (k + 0.5) / N;                  // без краёв — там углы и соседние стены
if (!gaps.some(([a, b]) => t >= a && t <= b)) ts.push(t);
}
if (ts.length < 3) return c0;
// thick — стена залита (тёмная полоса в несколько точек), иначе — хотя бы тонкий контур.
// Сначала ищем толстую: тонкие линии внутри комнат — это размерные, за них не цепляемся
const find = (thick) => {
let best = c0, bestScore = -1;
for (let d = -R; d <= R; d++) {
const c = c0 + d;
let ok = 0;
for (const t of ts) {
const sx = kinds[i] === 'h' ? p[0] + dx * t : c, sy = kinds[i] === 'h' ? c : p[1] + dy * t;
const inside = G(sx - ox * 1.5, sy - oy * 1.5);
const o1 = G(sx + ox * 1, sy + oy * 1), o2 = G(sx + ox * 3, sy + oy * 3), o3 = G(sx + ox * 5, sy + oy * 5);
const outside = thick ? Math.max(o1, o2, o3) : Math.min(o1, o2);
if (inside >= 200 && outside < 185) ok++;
}
const score = ok / ts.length - Math.abs(d) * 0.004;              // при равенстве — ближе к тому, что отметила нейросеть
if (score > bestScore) { bestScore = score; best = c; }
}
return bestScore >= (thick ? 0.35 : 0.45) ? best : null;
};
const hit = find(true);
return hit != null ? hit : (find(false) ?? c0);
});
return { at: snapped, px: pgCorners(kinds, snapped) };
}

// Наименьшие квадраты для координат сторон помещения: x_i − x_j = b (вес w), x_i ≈ m_i (вес 1)
function pgSolve(n, measured, eqs) {
const A = Array.from({ length: n }, () => new Array(n).fill(0)), B = new Array(n).fill(0);
for (let i = 0; i < n; i++) { A[i][i] += 1; B[i] += measured[i]; }
eqs.forEach(({ i, j, b, w }) => { A[i][i] += w; A[j][j] += w; A[i][j] -= w; A[j][i] -= w; B[i] += w * b; B[j] -= w * b; });
for (let c = 0; c < n; c++) {
let m = c;
for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[m][c])) m = r;
[A[c], A[m]] = [A[m], A[c]]; [B[c], B[m]] = [B[m], B[c]];
for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; B[r] -= f * B[c]; }
}
const x = new Array(n).fill(0);
for (let r = n - 1; r >= 0; r--) { let v = B[r]; for (let k = r + 1; k < n; k++) v -= A[r][k] * x[k]; x[r] = v / A[r][r]; }
return x;
}

// Ответ нейросети (помещения в точках картинки) → помещения в миллиметрах, как для плана квартиры.
// image — то, что ушло нейросети (data:URL). Возвращает { rooms, warnings, underlay } или { error }
async function planFromPixels(res, image) {
const rooms = (res.rooms || []).filter(r => Array.isArray(r.px) && r.px.length >= 3);
if (!rooms.length) return { error: 'В ответе нет помещений, отмеченных на картинке.' };
let gray = null;
try { gray = await pgLoadGray(image); } catch (e) { /* без подгонки по стенам */ }
const warnings = (res.warnings || []).slice();
// 1) края — по стенам на картинке
const work = rooms.map(r => {
const kinds = pgAxes(r.px);
const snap = kinds && gray ? pgSnapRoom(r.px, kinds, gray, r.openings) : null;
return { r, kinds, px: snap ? snap.px : r.px.map(p => p.slice()) };
});
// 2) масштаб — по всем подписанным размерам; явно чужие (отличаются больше чем на 12%) — не в счёт
const ratios = [];
work.forEach(w => (w.r.dims || []).forEach(d => {
const p = w.px[d.edge], q = w.px[(d.edge + 1) % w.px.length];
const l = p && q ? Math.hypot(q[0] - p[0], q[1] - p[1]) : 0;
if (l >= 10) ratios.push(d.mm / l);
}));
let s;                                                       // мм на точку картинки
if (ratios.length) {
ratios.sort((a, b) => a - b);
const med = ratios[Math.floor(ratios.length / 2)];
const good = ratios.filter(v => Math.abs(v / med - 1) <= 0.12);
s = good.reduce((a, v) => a + v, 0) / good.length;
const off = ratios.length - good.length;
if (off) warnings.push(`Размеров не по масштабу чертежа: ${off} — они не учтены, проверьте эти стены.`);
} else {
// размеров нет — масштаб примерный: межкомнатная дверь ~850 мм, без дверей — длинная стена ~5 м
const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
const doors = work.flatMap(w => (w.r.openings || []).filter(o => o.type === 'door' && Array.isArray(o.px) && o.px.length === 2)
.map(o => Math.hypot(o.px[1][0] - o.px[0][0], o.px[1][1] - o.px[0][1]))).filter(l => l >= 5);
const sides = work.flatMap(w => w.px.map((p, i) => { const q = w.px[(i + 1) % w.px.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]); }));
s = doors.length ? 850 / med(doors) : 5000 / Math.max(...sides, 1);
warnings.push('На чертеже нет подписанных размеров — масштаб примерный (по ширине дверей). После добавления откройте «План квартиры» → «Масштаб по стене» и введите настоящую длину одной стены — весь план пересчитается.');
}
// начало координат — верхний левый край плана
const all = work.flatMap(w => w.px);
const ox = Math.min(...all.map(p => p[0])), oy = Math.min(...all.map(p => p[1]));
const toMm = ([x, y]) => [Math.round((x - ox) * s), Math.round((y - oy) * s)];
// 3) размеры помещения — точно по подписям (стороны вдоль осей), место — как на картинке
const out = work.map(({ r, kinds, px }) => {
let pts = px.map(toMm);
if (kinds) {
const n = px.length;
const at = kinds.map((k, i) => (k === 'h' ? pts[i][1] : pts[i][0]));
// размер стороны i — расстояние между соседними с ней сторонами (i−1 и i+1), они другого направления
const eqs = { h: [], v: [] };
(r.dims || []).forEach(d => {
const i = d.edge, a = (i - 1 + n) % n, b = (i + 1) % n;
const sign = Math.sign(at[b] - at[a]) || 1;
eqs[kinds[i] === 'h' ? 'v' : 'h'].push({ i: b, j: a, b: sign * d.mm, w: 1e5 });   // подпись — почти жёстко
});
const fit = { h: null, v: null };
['h', 'v'].forEach(k => {
const idx = kinds.map((kk, i) => (kk === k ? i : -1)).filter(i => i >= 0);
const pos = new Map(idx.map((i, j) => [i, j]));
const sol = pgSolve(idx.length, idx.map(i => at[i]), eqs[k].map(e => ({ i: pos.get(e.i), j: pos.get(e.j), b: e.b, w: e.w })));
const base = Math.round(sol[0] || 0);                      // округляем разности — размеры остаются ровно по подписям
fit[k] = new Map(idx.map((i, j) => [i, base + Math.round(sol[j] - sol[0])]));
});
pts = pgCorners(kinds, kinds.map((k, i) => fit[k].get(i)));
} else if ((r.dims || []).length) {
warnings.push(`«${r.name}»: косые стены — размеры взяты по масштабу, проверьте.`);
}
const openings = (r.openings || []).map(o => {
const { px: opx, ...rest } = o;
if (!Array.isArray(opx) || opx.length !== 2) return o;
let [a, b] = opx.map(toMm);
const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
const wmm = o.width_m ? o.width_m * 1000 : 0;
// ширина по подписи — по середине отмеченного места
if (wmm && len > 0) {
const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len, cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
a = [Math.round(cx - ux * wmm / 2), Math.round(cy - uy * wmm / 2)];
b = [Math.round(cx + ux * wmm / 2), Math.round(cy + uy * wmm / 2)];
}
return { ...rest, at: [a, b], width_m: rest.width_m || Math.round(len) / 1000 };
}).filter(o => o.width_m >= 0.1);
return { name: r.name, height_m: r.height_m, pts, openings };
});
// 4) двери — напротив, стены — одной линией (только сдвиги, размеры не меняются)
try {
const items = out.map((r, i) => { const c = flatPtsToMeasure(r, ''); return flatItem('p' + i, r.name, c.measure, c.plan); });
const sh = flatAutoFit(items);
out.forEach((r, i) => {
const [dx, dy] = sh[i].map(v => Math.round(v * 1000));
if (!dx && !dy) return;
r.pts = r.pts.map(([x, y]) => [x + dx, y + dy]);
r.openings = r.openings.map(o => (o.at ? { ...o, at: o.at.map(([x, y]) => [x + dx, y + dy]) } : o));
});
} catch (e) { /* без выравнивания */ }
// двери, которые остались вразнобой (комнаты уже стоят ровно и не двигаются), —
// одна и та же дверь у двух комнат: ставим обе половины в общую середину
const ops = [];
out.forEach((r, ri) => r.openings.forEach(o => { if (o.at && (o.type === 'door' || o.type === 'balcony')) ops.push({ ri, o }); }));
const axis = (o) => { const [[x1, y1], [x2, y2]] = o.at; return Math.abs(y2 - y1) <= Math.abs(x2 - x1) * 0.1 ? 0 : Math.abs(x2 - x1) <= Math.abs(y2 - y1) * 0.1 ? 1 : -1; };
for (let i = 0; i < ops.length; i++) for (let j = i + 1; j < ops.length; j++) {
const a = ops[i], b = ops[j];
if (a.ri === b.ri) continue;
const ax = axis(a.o);
if (ax < 0 || ax !== axis(b.o) || Math.abs(a.o.width_m - b.o.width_m) > 0.1) continue;
const cross = 1 - ax;
if (Math.abs(a.o.at[0][cross] - b.o.at[0][cross]) > 700) continue;      // через стену не толще 0,7 м
const ca = (a.o.at[0][ax] + a.o.at[1][ax]) / 2, cb = (b.o.at[0][ax] + b.o.at[1][ax]) / 2;
if (Math.abs(ca - cb) > 300 || Math.abs(ca - cb) < 1) continue;
const m = Math.round((ca + cb) / 2);
[a.o, b.o].forEach((o, k) => { const d = m - (k ? cb : ca); o.at = o.at.map(p => { const q = p.slice(); q[ax] += d; return q; }); });
}
// 5) подложка: картинка в метрах плана
const iw = gray ? gray.w : null, ih = gray ? gray.h : null;
const underlay = iw ? { x: -ox * s / 1000, y: -oy * s / 1000, w: iw * s / 1000, ar: ih / iw } : null;
return { rooms: out, warnings, underlay, scale: s, ...(ratios.length ? {} : { roughScale: true }) };
}
