// Кабинет мастера — лестница в помещении: марши, ступени, площадка.
// Подключается из calc.html после calc-measure.js.
//
// measure.stairs = [{
//   type: 'straight' | 'L' | 'U' — прямая, Г-образная или П-образная (с площадкой посередине),
//   H: высота от пола до пола, w: ширина марша, n: ступеней (подъёмов; пусто — подберём),
//   b: проступь (глубина ступени; пусто — по шагу), t: толщина марша снизу (бетон),
//   open: сколько сторон у марша открыто (0 — между стенами, 1 — одна у стены, 2 — обе открыты),
//   wall, off, from: где стоит на плане — стена, отступ от угла А или Б (низ марша) }].
// Считаем: торец (боковины открытых сторон) и низ марша под покраску, плинтус на ступенях
// вдоль стен, плитку на ступени (проступи + подступенки), число ступеней.

const STAIR_TYPES = { straight: 'Прямая', L: 'Г-образная', U: 'П-образная' };
const STAIR_GAP = 0.1;   // просвет между маршами П-образной лестницы

function stairCode(i) { return 'Л-' + (i + 1); }

// Размеры одной лестницы: подъёмы, ступени, марши, площадка
function stairGeom(el) {
const H = mNum(el.H);
if (!(H > 0)) return null;
const w = mNum(el.w) || 0.9;
let n = Math.round(mNum(el.n));
if (!(n >= 2)) n = Math.max(3, Math.round(H / 0.17));
const h = H / n;
// удобный шаг: две высоты + глубина ≈ 63 см
const b = mNum(el.b) || Math.max(0.25, Math.min(0.32, 0.63 - 2 * h));
const tIn = String(el.t == null ? '' : el.t).trim();
const t = tIn === '' ? 0.18 : Math.max(0, mNum(el.t) || 0);
const open = [0, 1, 2].includes(Number(el.open)) ? Number(el.open) : 1;
const type = STAIR_TYPES[el.type] ? el.type : 'straight';
// марши: у Г и П — площадка посередине, она заменяет одну ступень
const ks = type === 'straight' ? [n] : [Math.ceil(n / 2), n - Math.ceil(n / 2)];
const flights = ks.map(k => {
const run = Math.max(0, k - 1) * b, rise = k * h;
return { k, run, rise, slope: Math.hypot(run, rise) };
});
const land = type === 'L' ? { a: w, b: w } : type === 'U' ? { a: w, b: 2 * w + STAIR_GAP } : null;
return { H, w, n, h, b, t, open, type, flights, land, treads: flights.reduce((a, f) => a + Math.max(0, f.k - 1), 0) };
}

function stairsCompute(m) {
const out = { list: [], side: 0, under: 0, plinth: 0, tile: 0, steps: 0 };
(Array.isArray(m.stairs) ? m.stairs : []).forEach((el, idx) => {
const g = stairGeom(el);
if (!g) return;
const { w, h, b, t, open, flights, land } = g;
const atWall = 2 - open;
// торец: «пила» ступеней + полоса толщины марша, по каждой открытой стороне
const side = open * flights.reduce((a, f) => a + Math.max(0, f.k - 1) * b * h / 2 + f.slope * t, 0);
// низ: наклон марша × ширина, плюс низ площадки
const landArea = land ? land.a * land.b : 0;
const under = flights.reduce((a, f) => a + f.slope * w, 0) + landArea;
// плинтус на ступенях вдоль стен: на каждой ступени — проступь + подступенок
const zig = flights.reduce((a, f) => a + f.k * h + Math.max(0, f.k - 1) * b, 0);
const landWall = !land || !atWall ? 0 : g.type === 'L' ? 2 * w : land.b + 2 * w;
const plinth = atWall * zig + landWall;
// плитка: проступи (и площадка) + подступенки
const treadA = g.treads * b * w + landArea, riserA = g.n * h * w;
const e = { idx, code: stairCode(idx), ...g, side, under, plinth, tile: treadA + riserA, treadA, riserA };
const pl = flights.length > 1 ? `марши ${flights.map(f => f.k).join(' + ')} подъёмов, площадка ${mFmt(land.a)}×${mFmt(land.b)}` : '';
e.line = `${e.code} ${STAIR_TYPES[g.type].toLowerCase()}: ${g.n} ступеней по ${Math.round(h * 1000)} мм, проступь ${Math.round(b * 1000)} мм, ширина ${mFmt(w)}${pl ? '; ' + pl : ''}`;
e.lines = [
side > 0 ? `торец (${open === 2 ? 'обе стороны' : 'одна сторона'}): ${mFmt(side)} м²` : 'торец: открытых сторон нет',
`низ марша${land ? ' и площадки' : ''}: ${mFmt(under)} м²`,
plinth > 0 ? `плинтус на ступенях${atWall === 2 ? ' (с двух сторон)' : ''}: ${mFmt(plinth)} пог. м` : 'плинтус: у стен ступеней нет',
`плитка: проступи ${g.treads} шт.${land ? ' + площадка' : ''} ${mFmt(treadA)} м² + подступенки ${g.n} шт. ${mFmt(riserA)} м² = ${mFmt(e.tile)} м²`
];
out.side += side; out.under += under; out.plinth += plinth; out.tile += e.tile; out.steps += g.n;
out.list.push(e);
});
return out;
}

/* ---------- на плане: следы маршей и площадки у стены ---------- */
// Прямоугольники в координатах стены: u — вдоль стены от угла, v — внутрь комнаты.
// Каждый марш — { u0, u1, v0, v1, dir: ±1 по u или ±2 по v (куда вверх), k — подъёмов }.
function stairFootprint(e, off) {
const { w, b, flights, land, type } = e;
const r1 = flights[0].run;
const rects = [{ u0: off, u1: off + r1, v0: 0, v1: w, dir: 1, k: flights[0].k }];
if (type === 'L') {
rects.push({ u0: off + r1, u1: off + r1 + w, v0: 0, v1: w, land: true });
rects.push({ u0: off + r1, u1: off + r1 + w, v0: w, v1: w + flights[1].run, dir: 2, k: flights[1].k });
} else if (type === 'U') {
rects.push({ u0: off + r1, u1: off + r1 + w, v0: 0, v1: land.b, land: true });
rects.push({ u0: off + r1 - flights[1].run, u1: off + r1, v0: w + STAIR_GAP, v1: land.b, dir: -1, k: flights[1].k });
}
void b;
return rects;
}
// Длина лестницы вдоль стены (для отступа «по центру»)
function stairAlong(e) {
const r1 = e.flights[0].run;
return e.type === 'straight' ? r1 : r1 + e.w;
}

// SVG лестницы на плане квартиры: стена комнаты a→b (по часовой, внутрь — направо)
function flatStairsSvg(r, fs) {
const list = Array.isArray(r.stairs) ? r.stairs : [];
if (!list.length) return '';
const n = r.pts.length;
let out = '';
list.forEach((el, i) => {
const e = stairGeom(el);
const wi = Number.isInteger(el.wall) ? el.wall : null;
if (!e || wi == null || wi < 0 || wi >= n || (!r.closed && wi >= n - 1)) return;
const a = r.pts[wi], bb = r.pts[(wi + 1) % n];
const L = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
if (!(L > 0)) return;
let ux = (bb[0] - a[0]) / L, uy = (bb[1] - a[1]) / L;
let ox = a[0], oy = a[1];
const along = stairAlong(e);
const offIn = String(el.off == null ? '' : el.off).trim();
let off = offIn === '' ? Math.max(0, (L - along) / 2) : Math.max(0, mNum(el.off) || 0);
// от угла Б — идём от конца стены назад; внутрь по-прежнему направо от стены
let nx = -uy, ny = ux;
if (el.from === 'end') { ox = bb[0]; oy = bb[1]; ux = -ux; uy = -uy; }
const P = (u, v) => [ox + ux * u + nx * v, oy + uy * u + ny * v];
const sw = fs * 0.06;
stairFootprint(e, off).forEach(rc => {
const c = [P(rc.u0, rc.v0), P(rc.u1, rc.v0), P(rc.u1, rc.v1), P(rc.u0, rc.v1)];
out += `<path d="M${c.map(p => p.join(' ')).join('L')}Z" fill="#e9eef5" fill-opacity=".85" stroke="#3a4656" stroke-width="${sw * 1.5}" pointer-events="none"/>`;
if (rc.land || !rc.k) return;
// линии ступеней поперёк марша и стрелка «вверх»
const steps = rc.k - 1;
const alongU = Math.abs(rc.dir) === 1;
for (let s = 1; s < steps + 1; s++) {
const f = s / (steps + 1);
let p1, p2;
if (alongU) { const u = rc.dir > 0 ? rc.u0 + (rc.u1 - rc.u0) * f : rc.u1 - (rc.u1 - rc.u0) * f; p1 = P(u, rc.v0); p2 = P(u, rc.v1); } else { const v = rc.v0 + (rc.v1 - rc.v0) * f; p1 = P(rc.u0, v); p2 = P(rc.u1, v); }
out += `<line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="#3a4656" stroke-width="${sw}" pointer-events="none"/>`;
}
const mid = alongU ? (rc.v0 + rc.v1) / 2 : (rc.u0 + rc.u1) / 2;
const s0 = alongU ? (rc.dir > 0 ? P(rc.u0 + 0.1, mid) : P(rc.u1 - 0.1, mid)) : P(mid, rc.v0 + 0.1);
const s1 = alongU ? (rc.dir > 0 ? P(rc.u1 - 0.1, mid) : P(rc.u0 + 0.1, mid)) : P(mid, rc.v1 - 0.1);
const dx = s1[0] - s0[0], dy = s1[1] - s0[1], dl = Math.hypot(dx, dy) || 1, ah = Math.min(fs * 0.5, dl * 0.3);
const bx = s1[0] - dx / dl * ah, by = s1[1] - dy / dl * ah;
out += `<path d="M${s0[0]} ${s0[1]}L${s1[0]} ${s1[1]}M${bx - dy / dl * ah * 0.5} ${by + dx / dl * ah * 0.5}L${s1[0]} ${s1[1]}L${bx + dy / dl * ah * 0.5} ${by - dx / dl * ah * 0.5}" fill="none" stroke="#c2361f" stroke-width="${sw * 1.6}" pointer-events="none"/>`;
});
const c0 = P(off + 0.05, e.w / 2);
out += `<text x="${c0[0]}" y="${c0[1]}" font-size="${fs * 0.6}" font-family="Arial, sans-serif" fill="#c2361f" font-weight="700" pointer-events="none">${stairCode(i)}</text>`;
});
return out;
}

/* ---------- вкладка «Лестница» в замере ---------- */
// Профиль сбоку: ступени и низ марша (для проверки на глаз)
function stairProfileSvg(e) {
const W = 300, Hs = 150, pad = 8;
const runs = e.flights.map(f => f.run), totalRun = runs.reduce((a, v) => a + v, 0) + (e.land ? e.land.a : 0);
const k = Math.min((W - 2 * pad) / Math.max(totalRun, 0.1), (Hs - 2 * pad) / e.H);
const X = u => pad + u * k, Y = z => Hs - pad - z * k;
let d = '', u = 0, z = 0, soff = '';
e.flights.forEach((f, fi) => {
const pts = [[u, z]];
for (let s = 0; s < f.k; s++) {
z += e.h; pts.push([u, z]);
if (s < f.k - 1) { u += e.b; pts.push([u, z]); }
}
d += 'M' + pts.map(p => `${X(p[0])} ${Y(p[1])}`).join('L');
// низ марша — параллельно линии ступеней, ниже на толщину
const ang = Math.atan2(f.rise, Math.max(f.run, 0.01)), dz = e.t / Math.cos(ang);
const u0 = pts[0][0], z0 = pts[0][1];
soff += `<line x1="${X(u0 + e.b)}" y1="${Y(Math.max(0, z0 + e.h - dz))}" x2="${X(u)}" y2="${Y(z - dz)}" stroke="#1f6fd1" stroke-width="2" stroke-dasharray="4 3"/>`;
if (fi === 0 && e.land) {
d += `L${X(u + e.land.a)} ${Y(z)}`;
soff += `<line x1="${X(u)}" y1="${Y(z - e.t)}" x2="${X(u + e.land.a)}" y2="${Y(z - e.t)}" stroke="#1f6fd1" stroke-width="2" stroke-dasharray="4 3"/>`;
u += e.land.a;
}
});
return `<svg viewBox="0 0 ${W} ${Hs}" width="100%" style="max-width:${W}px;display:block;margin:6px 0;" xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="${Y(0)}" x2="${W}" y2="${Y(0)}" stroke="#9aa3ad"/><line x1="0" y1="${Y(e.H)}" x2="${W}" y2="${Y(e.H)}" stroke="#9aa3ad" stroke-dasharray="2 3"/><path d="${d}" fill="none" stroke="#14181f" stroke-width="2"/>${soff}</svg>`;
}

function stairsTabHtml(m) {
const list = Array.isArray(m.stairs) ? m.stairs : [];
const walls = Array.isArray(m.walls) ? m.walls : [];
const hasWalls = walls.some(w => mNum(w) > 0);
return `<section class="mp-sec">
<div class="mp-sec-title">Лестница</div>
<div class="mp-hint">Введите высоту от пола до пола и ширину марша — число ступеней и их глубина подберутся сами (можно поправить). Считаются торец и низ марша под покраску, плинтус на ступенях и плитка на ступени.</div>
${list.map((el, i) => {
const type = STAIR_TYPES[el.type] ? el.type : 'straight';
const open = [0, 1, 2].includes(Number(el.open)) ? Number(el.open) : 1;
const wi = Number.isInteger(el.wall) && el.wall < walls.length ? el.wall : null;
return `<div class="mp-open" data-card="stairs.${i}">
<div class="mp-open-top">
<button type="button" class="mp-type" onclick="stairType(${i})" aria-label="Сменить вид лестницы">${stairCode(i)} ${STAIR_TYPES[type]} ▾</button>
<span class="mp-open-area" id="mpStairRes${i}"></span>
<button type="button" class="mp-del" onclick="removeMeasureRow('stairs', ${i})" aria-label="Убрать лестницу">✕</button>
</div>
<div class="mp-dims" style="margin-top:6px;">
<label>От пола до пола ↕${mIn(`stairs.${i}.H`, el.H, '2,9')}</label><span class="mp-x">·</span>
<label>Ширина марша ↔${mIn(`stairs.${i}.w`, el.w, '0,9')}</label><span class="mp-x">·</span>
<label>Толщина снизу${mIn(`stairs.${i}.t`, el.t, '0,18')}</label>
</div>
<div class="mp-dims mp-dims-2" style="margin-top:6px;">
<label>Ступеней${mIn(`stairs.${i}.n`, el.n, 'сами')}</label><span class="mp-x">·</span>
<label>Проступь (глубина)${mIn(`stairs.${i}.b`, el.b, 'сама')}</label>
</div>
<div class="mp-ce-walls"><span class="mp-ce-walls-label">Открытый торец:</span>
${[[0, 'нет, между стенами'], [1, 'одна сторона'], [2, 'обе стороны']].map(([v, t]) => `<button type="button" class="mp-ce-wall${open === v ? ' on' : ''}" onclick="stairOpen(${i}, ${v})" aria-pressed="${open === v}">${t}</button>`).join('')}
</div>
${hasWalls ? `<div class="mp-place"><label>На плане у стены
<select onchange="stairWall(${i}, this.value)">
<option value="">не показывать</option>
${walls.map((w, k) => mNum(w) > 0 ? `<option value="${k}" ${wi === k ? 'selected' : ''}>стена ${k + 1} · ${mFmt(mNum(w))} м</option>` : '').join('')}
</select></label>
${wi != null ? `<label>Низ от угла <button type="button" class="mp-ce-corner" onclick="stairFrom(${i})" aria-label="Сменить угол">${el.from === 'end' ? 'Б' : 'А'} ⇄</button>${mIn(`stairs.${i}.off`, el.off, 'по центру')}</label>` : ''}
</div>` : ''}
<div id="mpStairProf${i}"></div>
<div class="mp-hint" style="margin:4px 0 0;" id="mpStairLines${i}"></div>
</div>`;
}).join('')}
<div class="mp-add-row"><button type="button" class="mp-add" onclick="stairAdd()">+ Лестница</button></div>
<div class="mp-calc" id="mpCalcStairs"></div>
</section>`;
}

function updateStairsOutputs(r) {
const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
const st = r.stairsRes || stairsCompute(measure);
(measure.stairs || []).forEach((el, i) => {
const e = st.list.find(x => x.idx === i);
set('mpStairRes' + i, e ? `${e.n} ступ.` : '');
set('mpStairProf' + i, e ? stairProfileSvg(e) : '');
// не помещается вдоль стены — предупредить (на плане вылезет за комнату)
let warn = '';
const L = Number.isInteger(el.wall) ? mNum((measure.walls || [])[el.wall]) : 0;
if (e && L > 0) {
const offIn = String(el.off == null ? '' : el.off).trim(), need = (offIn === '' ? 0 : mNum(el.off) || 0) + stairAlong(e);
if (need > L + 0.01) warn = `<br><b style="color:#c2361f">Вдоль стены ${el.wall + 1} (${mFmt(L)} м) не помещается: нужно ${mFmt(need)} м — проверьте ступени и отступ или выберите Г/П-образную</b>`;
}
set('mpStairLines' + i, e ? [escapeHtml(e.line), ...e.lines.map(escapeHtml)].join('<br>') + warn : 'Введите высоту от пола до пола');
});
set('mpCalcStairs', st.list.length > 1 ? `Всего: торец ${mFmt(st.side)} м², низ ${mFmt(st.under)} м², плинтус ${mFmt(st.plinth)} пог. м, плитка ${mFmt(st.tile)} м², ступеней ${st.steps}` : '');
}

function stairAdd() {
if (!Array.isArray(measure.stairs)) measure.stairs = [];
const prev = measure.stairs[measure.stairs.length - 1];
const lens = (measure.walls || []).map(mNum);
const cur = typeof rlElevWall === 'number' && lens[rlElevWall] > 0 ? rlElevWall : lens.findIndex(v => v > 0);
measure.stairs.push(prev ? { ...prev, off: '' } : { type: 'straight', H: '', w: '', n: '', b: '', t: '', open: 1, ...(cur >= 0 ? { wall: cur } : {}), off: '', from: 'start' });
saveMeasureDraft();
renderMeasure();
focusMeasurePath(`stairs.${measure.stairs.length - 1}.H`);
}
function stairType(i) {
const el = (measure.stairs || [])[i];
if (!el) return;
const keys = Object.keys(STAIR_TYPES);
el.type = keys[(keys.indexOf(STAIR_TYPES[el.type] ? el.type : 'straight') + 1) % keys.length];
saveMeasureDraft();
renderMeasure();
}
function stairOpen(i, v) {
const el = (measure.stairs || [])[i];
if (!el) return;
el.open = v;
saveMeasureDraft();
renderMeasure();
}
function stairWall(i, v) {
const el = (measure.stairs || [])[i];
if (!el) return;
if (v === '') delete el.wall; else el.wall = Number(v);
saveMeasureDraft();
renderMeasure();
}
function stairFrom(i) {
const el = (measure.stairs || [])[i];
if (!el) return;
el.from = el.from === 'end' ? 'start' : 'end';
saveMeasureDraft();
renderMeasure();
}
let measureStairPick = 'stairSide';
function setStairPick(p) { measureStairPick = p; updateMeasureOutputs(); }
