// Кабинет мастера — лепнина: карнизы, плинтус, молдинги на потолке и на стенах.
// Подключается из calc.html после calc-ruler.js; порядок подключения важен.

/* ===================== ЛЕПНИНА ===================== */
// В замере: measure.molding = {
//   cornice: { on, walls: [номера] | null (все), plank },   — потолочный карниз
//   plinth:  { on, walls, plank },                           — плинтус, без дверей
//   ceil:    [{ d, dbl, ind }],                              — рамки на потолке с отступом d от стен
//   wall:    [{ type: 'frames', walls, yb, yt, gap, fw,      — ряд рамок на развёртках
//              dbl, ind } |                                  — двойные: внутренняя рамка с отступом ind

//             { type: 'line', walls, y } |                   — горизонтальная линия
//             { type: 'frame', walls, x, w, yb, yt,          — рамка по размерам: x — от левого угла стены,
//               dbl, ind, indY }]                            — w — ширина; у двойной indY — отступ сверху и снизу (пусто — как ind)
// }
// Всё считается в погонных метрах по фактической длине.
// Ширина профиля (по желанию): mw — молдинг рамки/линии, мм; mwIn — внутренней рамки, мм (пусто — как mw).
// С шириной отступ внутренней рамки ind — просвет между молдингами (как на чертеже), без неё — от края до края.

let molElevWall = 0;          // какая стена на развёртке вкладки
let measureMolPick = 'molCornice';

function molGet(m) {
const d = m && m.molding && typeof m.molding === 'object' ? m.molding : {};
return {
cornice: d.cornice || { on: false, walls: null, plank: '' },
plinth: d.plinth || { on: false, walls: null, plank: '' },
ceil: Array.isArray(d.ceil) ? d.ceil : [],
wall: Array.isArray(d.wall) ? d.wall : []
};
}
// для правки: структура в замере создаётся при первом обращении
function molEnsure() {
const d = molGet(measure);
measure.molding = { cornice: d.cornice, plinth: d.plinth, ceil: d.ceil, wall: d.wall };
return measure.molding;
}

function molGeom(m) {
try { return typeof rulerGeometry === 'function' && Array.isArray(m.walls) && m.walls.length ? rulerGeometry(m) : null; } catch (e) { return null; }
}
const molWallLens = m => (Array.isArray(m.walls) ? m.walls : []).map(mNum);
// выбранные стены: null — все, у которых есть длина
function molWalls(sel, m) {
const lens = molWallLens(m);
const all = lens.map((v, i) => (v > 0 ? i : -1)).filter(i => i >= 0);
if (!sel || !Array.isArray(sel)) return all;
return [...new Set(sel)].filter(i => all.includes(i)).sort((a, b) => a - b);
}

// углы между соседними выбранными стенами: внутренние и наружные
// at(i, j) — есть ли карниз/плинтус у самого угла (не спрятан за мебелью)
function molCorners(g, walls, at) {
const res = { in: 0, out: 0 };
if (!g) return res;
const set = new Set(walls), n = g.segs.length, o = g.orient || 1;
g.segs.forEach((q, i) => {
const j = i + 1 < n ? i + 1 : (g.closed ? 0 : -1);
if (j < 0 || !set.has(i) || !set.has(j)) return;
if (at && !at(i, j)) return;
const q2 = g.segs[j];
const c = q.dx * q2.dy - q.dy * q2.dx;
if (Math.abs(c) < 0.02) return;
if (c * o > 0) res.in++; else res.out++;
});
return res;
}

// двери на стене: [начало, конец] вдоль стены (у балконного блока — дверная часть)
function molDoorSpans(m, wi, L) {
return (m.openings || []).filter(o => o.wall === wi && (o.type === 'door' || o.type === 'balcony') && openingWidth(o) > 0).map(o => {
const [a0, a1] = openingSpan(o, L);
return o.type === 'balcony' ? balconyParts(o, a0, a1).door : [a0, a1];
});
}

// Мебель на стене: куски, которые стоят на полу (там нет плинтуса)
// или доходят до потолка (там нет карниза)
function molCoverSpans(m, wi, kind) {
if (typeof coversCompute !== 'function') return [];
return coversCompute(m).pieces.filter(p => p.wall === wi && (kind === 'floor' ? p.bottom < 0.005 : p.toCeil)).map(p => p.span);
}
// где плинтуса нет: двери и мебель на полу
function molPlinthGaps(m, wi, L) { return [...molDoorSpans(m, wi, L), ...molCoverSpans(m, wi, 'floor')]; }
// свободные куски стены [0, L] за вычетом промежутков
function molFreeSpans(L, gaps) {
const out = []; let x = 0;
[...gaps].sort((a, b) => a[0] - b[0]).forEach(([a, b]) => { if (a - x > 0.005) out.push([x, a]); x = Math.max(x, b); });
if (L - x > 0.005) out.push([x, L]);
return out;
}
// угол между стенами i и j открыт: у конца стены i и у начала стены j нет мебели
function molCoverCornerOpen(m, lens, kind) {
return (i, j) => !molCoverSpans(m, i, kind).some(sp => sp[1] >= lens[i] - 0.005) && !molCoverSpans(m, j, kind).some(sp => sp[0] <= 0.005);
}
// карниз: стена без мебели до потолка
function molCorniceSpans(m, wi, L) { return molFreeSpans(L, molCoverSpans(m, wi, 'ceil')); }

// Рамка на потолке: контур комнаты, сдвинутый внутрь на d (углы — «на ус»)
function molOffsetPoly(g, d) {
if (!g || !g.closed || !(d > 0)) return null;
const n = g.segs.length, o = g.orient || 1;
const cross = (q1, q2) => {
const ax = q1.x1 - q1.dy * o * d, ay = q1.y1 + q1.dx * o * d;
const bx = q2.x1 - q2.dy * o * d, by = q2.y1 + q2.dx * o * d;
const det = q1.dx * q2.dy - q1.dy * q2.dx;
if (Math.abs(det) < 0.02) return [q2.x1 - q2.dy * o * d, q2.y1 + q2.dx * o * d];
const t = ((bx - ax) * q2.dy - (by - ay) * q2.dx) / det;
return [ax + q1.dx * t, ay + q1.dy * t];
};
const pts = g.segs.map((q, k) => cross(g.segs[(k - 1 + n) % n], q));
let len = 0;
const edges = [];
for (let k = 0; k < n; k++) {
const a = pts[k], b = pts[(k + 1) % n], q = g.segs[k];
const ex = b[0] - a[0], ey = b[1] - a[1];
if (ex * q.dx + ey * q.dy <= 0.001) return null;   // отступ больше, чем позволяет стена
const e = Math.hypot(ex, ey);
// стена на одной прямой со следующей — сторона рамки продолжается, не отдельный кусок
if (edges.length && Math.abs(g.segs[(k - 1 + n) % n].dx * q.dy - g.segs[(k - 1 + n) % n].dy * q.dx) < 0.02 && k > 0) edges[edges.length - 1] += e;
else edges.push(e);
len += e;
}
return { pts, len, edges };
}

// Двойная рамка: отступ внутренней рамки (0 — рамка одинарная)
const MOL_IND_DEF = '0,05';
const molInd = f => (f && f.dbl ? mNum(f.ind) : 0);
// стороны рамки на стене — каждая отдельный кусок; у двойной ещё четыре внутренние
const molFrameSides = f => [f, f.inner].filter(Boolean).flatMap(r => [r.x1 - r.x0, r.x1 - r.x0, r.y1 - r.y0, r.y1 - r.y0]);
const molFrameLen = f => molFrameSides(f).reduce((a, v) => a + minLen(v), 0);
// ширина профиля, мм (0 — не указана)
const molCm = v => { const n = Number(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) && n > 0 && n < 1000 ? n : 0; };
const molCmTxt = mm => String(mm).replace('.', ',') + ' мм';

/* ---------- закупка молдинга: планки и раскрой ----------
   Молдинг продаётся планками (по умолчанию 2 м, короче не купить). Каждая сторона рамки и каждый кусок линии —
   отдельная деталь (у рамки — по внешнему краю, с запилом 45°). Детали длиннее планки — из нескольких планок со
   стыком. Раскрой — «длинные первыми, каждая — в самый подходящий обрезок» (Best Fit Decreasing): обрезки идут
   в другие места, а не в мусор; на рез — 3 мм. Считается отдельно по каждому профилю (ширина + длина планки). */
const MOL_PLANK_DEF = 2, MOL_KERF = 0.003;
const molPlankOf = row => { const v = mNum(row && row.plank); return v >= 0.3 && v <= 6 ? v : MOL_PLANK_DEF; };
// детали молдинга на стенах помещения: [{ len, mw, plank, label }]
function molPieces(m, prefix = '', keyPre = '') {
const out = [], lens = molWallLens(m);
lens.forEach((L, wi) => {
if (!(L > 0)) return;
const lay = molWallLayout(m, wi);
const frames = lay.frames.slice().sort((a, b) => a.x0 - b.x0);
frames.forEach((f, k) => {
const name = `${prefix}стена ${wi + 1}, рамка ${k + 1}${frames.length === 1 ? '' : ` (${mFmt(f.x1 - f.x0)}×${mFmt(f.y1 - f.y0)})`}`;
[[f, 'наружная'], [f.inner, 'внутренняя']].forEach(([r, kind]) => {
if (!r) return;
const tag = f.inner ? `${name}, ${kind}` : name, w = r.x1 - r.x0, h = r.y1 - r.y0, mw = r.mw || 0, plank = f.plank || MOL_PLANK_DEF;
[['верх', w, 't'], ['низ', w, 'b'], ['лево', h, 'l'], ['право', h, 'r']].forEach(([side, len, sk]) => out.push({ len, mw, plank, label: `${tag}: ${side}`, key: `${keyPre}w${wi}f${k}${r === f ? 'o' : 'i'}${sk}` }));
});
});
lay.lines.forEach((l, j) => out.push({ len: l.x1 - l.x0, mw: l.mw || 0, plank: l.plank || MOL_PLANK_DEF, label: `${prefix}стена ${wi + 1}, линия на ${mFmt(l.y)} м${lay.lines.length > 1 ? `, кусок ${j + 1}` : ''}`, key: `${keyPre}w${wi}l${j}` }));
});
return out.filter(p => p.len > 0.005);
}
// раскрой по профилям: [{ mw, plank, bars: [{ cuts: [{ len, label }], rest }], need, waste }]
function molCutPlan(pieces, kerf = MOL_KERF) {
const groups = new Map();
pieces.forEach(p => {
const key = (p.mw || 0) + '|' + p.plank;
if (!groups.has(key)) groups.set(key, { mw: p.mw || 0, plank: p.plank, raw: [] });
groups.get(key).raw.push(p);
});
// детали длиннее планки — целые планки и добавка со стыком не короче minJoin (огрызок стыковать — плохая работа)
const split = (g, minJoin) => g.raw.flatMap(p => {
if (!(p.len > p.plank + 1e-9)) return [{ len: p.len, label: p.label, key: p.key, whole: p.len }];
const n = Math.ceil(p.len / p.plank - 1e-9), lens = Array.from({ length: n }, () => p.plank);
lens[n - 1] = p.len - p.plank * (n - 1);
if (lens[n - 1] < minJoin) { const add = minJoin - lens[n - 1]; lens[n - 2] -= add; lens[n - 1] += add; }
return lens.map((len, i) => ({ len, label: `${p.label} (${i + 1} из ${n}, стык)`, key: p.key, whole: p.len, part: i + 1, parts: n }));
});
// длинные первыми, каждая — в самый подходящий обрезок (Best Fit Decreasing)
const pack = (parts, plank) => {
const bars = [];
parts.slice().sort((a, b) => b.len - a.len).forEach(part => {
let best = null;
bars.forEach(b => { if (b.rest + 1e-9 >= part.len && (!best || b.rest < best.rest)) best = b; });
if (!best) { best = { cuts: [], rest: plank }; bars.push(best); }
best.cuts.push(part);
best.rest = Math.max(0, best.rest - part.len - kerf);
});
return bars;
};
return [...groups.values()].sort((a, b) => b.mw - a.mw || b.plank - a.plank).map(g => {
// место стыка подбираем: добавка от 20 до 50 см — где меньше планок (при равенстве — добавка длиннее)
let best = null;
[0.5, 0.4, 0.35, 0.3, 0.25, 0.22, 0.2].forEach(mj => {
const parts = split(g, mj), bars = pack(parts, g.plank);
if (!best || bars.length < best.bars.length) best = { parts, bars };
});
const need = best.parts.reduce((a, p) => a + p.len, 0);
return { mw: g.mw, plank: g.plank, bars: best.bars, need, waste: best.bars.reduce((a, b) => a + b.rest, 0) };
});
}
const molBuyName = g => (g.mw ? 'Молдинг ' + molCmTxt(g.mw) : 'Молдинг (ширина не указана)') + (g.plank !== MOL_PLANK_DEF ? `, планка ${mFmt(g.plank)} м` : '');
const molPlanksWord = n => n % 10 === 1 && n % 100 !== 11 ? 'планка' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'планки' : 'планок';
// закупка и раскрой — для замера помещения и для всего объекта: итог строкой, планки — схемой. Нажатие на кусок
// (или на молдинг на развёртке) подсвечивает его везде и показывает цифры только по нему (molPick)
const MOL_CUT_COLORS = ['#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#fb923c', '#a3e635'];
const molKeyColor = key => { let h = 0; for (const ch of String(key).replace(/[tblr]$/, '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return MOL_CUT_COLORS[h % MOL_CUT_COLORS.length]; };
let _molPlans = []; // последние показанные раскрои — чтобы по нажатию найти, где резать кусок
function molCutSvg(g, gi) {
const W = 330, L = 22, RH = 20, GAP = 6, k = (W - L - 4) / g.plank;
let y = 0, s = '';
g.bars.forEach((b, i) => {
s += `<text x="${L - 6}" y="${y + 14}" text-anchor="end" font-size="11" font-weight="700" fill="#7a3fb0">${i + 1}</text>`;
s += `<rect x="${L}" y="${y}" width="${g.plank * k}" height="${RH}" rx="3" fill="#f1f3f6" stroke="#cbd2da" stroke-width="0.8"/>`;
let x = L;
b.cuts.forEach((c, ci) => {
const w = c.len * k;
s += `<g class="mol-pick" data-mk="${c.key}" data-ci="${gi}-${i}-${ci}"><rect class="mol-seg" x="${x}" y="${y}" width="${Math.max(1, w - 1)}" height="${RH}" rx="3" fill="${molKeyColor(c.key)}"/>${w > 30 ? `<text x="${x + w / 2}" y="${y + 14}" text-anchor="middle" font-size="10.5" fill="#14181f" pointer-events="none">${mFmt(c.len)}</text>` : ''}</g>`;
x += w + MOL_KERF * k;
});
y += RH + GAP;
});
return `<svg class="mol-cut-svg" viewBox="0 0 ${W} ${y}" width="100%" style="max-width:${W * 1.4}px" data-g="${gi}">${s}</svg>`;
}
// отметки «закуплено» у объекта: obj.molBuy = { 'ширина|планка': { n — сколько планок было, когда отметили, hidden — убрано } }.
// Понадобилось больше, чем закуплено, — строка возвращается: «закуплено N, нужно ещё M»
const molBuyKey = g => (g.mw || 0) + '|' + g.plank;
function molBuyRowHtml(g, obj) {
const st = obj && obj.molBuy && obj.molBuy[molBuyKey(g)], n = g.bars.length;
const more = st && n > st.n ? n - st.n : 0, done = !!st && !more;
if (done && st.hidden) return '';
const text = `${escapeHtml(molBuyName(g))} — <b>${n} ${molPlanksWord(n)}</b> по ${mFmt(g.plank)} м${more ? ` <span class="mol-buy-more">закуплено ${st.n}, нужно ещё ${more}</span>` : ''}`;
if (!obj) return `<div class="mol-buy-row"><span>${text}</span></div>`;
const k = escapeHtml(molBuyKey(g));
return `<div class="mol-buy-row${done ? ' done' : ''}"><label class="mol-buy-chk"><input type="checkbox" ${done ? 'checked' : ''} onchange="molBuySet('${k}', ${n}, this.checked)"><span>${text}</span></label>
${done ? `<button type="button" class="mol-buy-del" onclick="molBuyHide('${k}')">Удалить</button>` : ''}</div>`;
}
function molBuyObj() { return typeof currentObjectId !== 'undefined' && (cloudData.objects || []).find(o => o.id === currentObjectId) || null; }
async function molBuySet(key, n, on) {
const obj = molBuyObj();
if (!obj) return;
const all = { ...(obj.molBuy || {}) };
if (on) all[key] = { n, at: Date.now() }; else delete all[key];
obj.molBuy = all;
renderObjectDetail();
await saveCloudData();
}
async function molBuyHide(key) {
const obj = molBuyObj();
if (!obj || !obj.molBuy || !obj.molBuy[key]) return;
obj.molBuy = { ...obj.molBuy, [key]: { ...obj.molBuy[key], hidden: true } };
renderObjectDetail();
await saveCloudData();
}
// вернуть убранные строки
async function molBuyShowAll() {
const obj = molBuyObj();
if (!obj || !obj.molBuy) return;
obj.molBuy = Object.fromEntries(Object.entries(obj.molBuy).map(([k, v]) => [k, { ...v, hidden: false }]));
renderObjectDetail();
await saveCloudData();
}
function molBuyHtml(plan, sendable, obj) {
if (!plan.length) return '';
_molPlans = plan;
const rows = plan.map(g => molBuyRowHtml(g, obj)).join(''), hidden = obj ? plan.filter(g => !molBuyRowHtml(g, obj)).length : 0;
return `<div class="mol-buy"><b>Для закупки:</b>${rows || ' всё закуплено'}
${hidden ? `<button type="button" class="mol-buy-show" onclick="molBuyShowAll()">Закупленное убрано: ${hidden} — показать</button>` : ''}
${sendable && typeof purchaseShareKey === 'function' ? `<div id="molSendBox"><button type="button" class="mol-send-btn" onclick="molSendOpen()">📤 Отправить заказчику на закупку…</button></div>` : ''}
<details class="mol-cut"><summary>Раскрой планок</summary>${plan.map((g, gi) => `<div class="mol-cut-g">${escapeHtml(molBuyName(g))}: ${g.bars.length} ${molPlanksWord(g.bars.length)}</div>${molCutSvg(g, gi)}`).join('')}
<div class="mol-pick-info mp-hint">Нажмите на молдинг на развёртке или на кусок планки: он подсветится оранжевым, а синим — то, что режется из остатка той же планки.</div></details></div>`;
}
/* ---------- отправить заказчику: закупка молдинга с правкой количества ----------
   На объекте может уже лежать часть молдинга — у каждого профиля «Есть на объекте» и «Купить» (можно поправить).
   «Создать закупку и отправить» — обычная закупка объекта (calc-purchases.js) со ссылкой для заказчика. */
function molSendOpen() {
const box = document.getElementById('molSendBox');
if (!box || !_molPlans.length) return;
box.innerHTML = `<div class="mol-send">${_molPlans.map((g, i) => `<div class="mol-send-row" data-i="${i}">
<div class="mol-send-name">${escapeHtml(molBuyName(g))}, планки по ${mFmt(g.plank)} м <span>нужно ${g.bars.length} шт.</span></div>
<label>Есть на объекте<input type="number" min="0" inputmode="numeric" class="mol-send-have" value="0" oninput="molSendHave(${i})"></label>
<label>Купить, шт.<input type="number" min="0" inputmode="numeric" class="mol-send-buy" value="${molSendLeft(g)}"></label></div>`).join('')}
<label class="mol-send-note">Кому<input type="text" id="molSendTo" placeholder="Заказчику" maxlength="100"></label>
<div class="mol-send-btns"><button type="button" class="btn btn-primary" onclick="molSendGo()">Создать закупку и отправить</button><button type="button" class="hc-btn" onclick="molSendClose()">Отмена</button></div>
<div class="mp-hint">Список появится во вкладке «Закупки» объекта — по ссылке заказчик отметит, что купил и доставил.</div></div>`;
}
// сколько ещё купить: отмеченное «закуплено» не предлагаем снова (понадобилось больше — только недостающее)
function molSendLeft(g) { const obj = molBuyObj(), st = obj && obj.molBuy && obj.molBuy[molBuyKey(g)]; return st ? Math.max(0, g.bars.length - st.n) : g.bars.length; }
function molSendClose() { const box = document.getElementById('molSendBox'); if (box) box.innerHTML = `<button type="button" class="mol-send-btn" onclick="molSendOpen()">📤 Отправить заказчику на закупку…</button>`; }
// «есть на объекте» — купить столько, сколько не хватает
function molSendHave(i) {
const row = document.querySelector(`.mol-send-row[data-i="${i}"]`), g = _molPlans[i];
if (!row || !g) return;
const have = Math.max(0, Math.round(Number(row.querySelector('.mol-send-have').value) || 0));
row.querySelector('.mol-send-buy').value = Math.max(0, molSendLeft(g) - have);
}
async function molSendGo() {
const obj = (cloudData.objects || []).find(o => o.id === currentObjectId);
if (!obj || typeof purchaseSend !== 'function') return;
const items = [], had = [];
_molPlans.forEach((g, i) => {
const row = document.querySelector(`.mol-send-row[data-i="${i}"]`);
if (!row) return;
const buy = Math.max(0, Math.round(Number(row.querySelector('.mol-send-buy').value) || 0)), have = Math.max(0, Math.round(Number(row.querySelector('.mol-send-have').value) || 0));
const name = `${molBuyName(g)}, планка ${mFmt(g.plank)} м`;
if (buy > 0) items.push({ id: purchaseId(), name, qty: buy, unit: 'шт.', done: false, price: '' });
if (have > 0) had.push(`${name} — ${have} шт.`);
});
if (!items.length) { showAddToast('Покупать нечего: всё уже есть на объекте'); return; }
const to = ((document.getElementById('molSendTo') || {}).value || '').trim();
const p = { id: purchaseId(), title: 'Молдинг', to: to || 'Заказчику', note: had.length ? 'Уже есть на объекте: ' + had.join('; ') : '', createdAt: Date.now(),
author: typeof currentUser === 'string' ? currentUser : '', items, total: '', files: [], delivered: false, inStats: true };
obj.purchases = [...purchaseList(obj), p];
objectHistorySubTab = 'purchase';
purchaseOpenId = p.id;
renderObjectDetail();
await purchaseSend();
}

// нажали на кусок: подсветить его во всех схемах, а куски из остатка той же планки — другим цветом
// (наклеили этот кусок — остаток этой же планки идёт туда, целую планку не режут). Сторона рамки со стыком
// на стене подсвечивается не целиком, а именно своим куском: первый — сверху (слева), следующий — ниже (правее)
function molPick(key, ci) {
document.querySelectorAll('.mol-pick.sel, .mol-pick.mate').forEach(el => el.classList.remove('sel', 'mate'));
document.querySelectorAll('.mol-part-hl').forEach(el => el.remove());
if (!key) return;
const all = [];
_molPlans.forEach((g, gi) => g.bars.forEach((b, bi) => b.cuts.forEach((c, k) => all.push({ g, gi, b, bi, c, ci: `${gi}-${bi}-${k}` }))));
// нажали на кусок планки — только он; на стене — все куски этой стороны
const picked = all.filter(x => (ci ? x.ci === ci : x.c.key === key));
const bars = new Set(picked.map(x => x.b));
const mates = all.filter(x => bars.has(x.b) && !picked.includes(x));
const mark = (x, cls) => {
document.querySelectorAll(`.mol-pick[data-ci="${x.ci}"]`).forEach(el => el.classList.add(cls));
// на стене: целая сторона — подсветкой группы; кусок стороны со стыком — своим отрезком поверх
document.querySelectorAll(`.mol-pick[data-mk="${CSS.escape(x.c.key)}"]:not([data-ci])`).forEach(el => {
if (!x.c.parts) { el.classList.add(cls); return; }
const hl = el.querySelector('.mol-hl'), m = hl && /^M([\d.-]+) ([\d.-]+)([HV])([\d.-]+)$/.exec(hl.getAttribute('d'));
if (!m) return;
const sibs = all.filter(y => y.c.key === x.c.key).map(y => y.c).sort((a, b) => a.part - b.part);
const before = sibs.filter(y => y.part < x.c.part).reduce((a, y) => a + y.len, 0), whole = x.c.whole || sibs.reduce((a, y) => a + y.len, 0);
const x0 = +m[1], y0 = +m[2], end = +m[4], from = m[3] === 'H' ? x0 : y0, span = end - from;
const a = from + span * before / whole, b = from + span * (before + x.c.len) / whole;
const d = m[3] === 'H' ? `M${a} ${y0}H${b}` : `M${x0} ${a}V${b}`;
const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
path.setAttribute('d', d); path.setAttribute('class', 'mol-part-hl ' + cls);
el.parentNode.insertBefore(path, el.nextSibling);
});
};
mates.forEach(x => mark(x, 'mate'));
picked.forEach(x => mark(x, 'sel'));
const plain = l => escapeHtml(l.replace(/ \(\d+ из \d+, стык\)$/, ''));
const first = picked[0];
const info = first
? `<b>${plain(first.c.label)}</b> — ${mFmt(first.c.whole || first.c.len)} м${first.g.mw ? `, молдинг ${molCmTxt(first.g.mw)}` : ''}${first.c.parts ? ` (длиннее планки — со стыком${ci ? `, это ${first.c.part}-й кусок из ${first.c.parts}` : ''})` : ''}
${[...bars].map(b => { const bi = first.g.bars.indexOf(b) >= 0 ? first.g.bars.indexOf(b) : picked.find(x => x.b === b).bi; return `<div class="mol-pick-bar"><b>Планка ${bi + 1}</b>: ${b.cuts.map(c => (picked.some(x => x.c === c) ? `<span class="mol-pick-me">${mFmt(c.len)} — сюда</span>` : `<span class="mol-pick-mate">${mFmt(c.len)} — ${plain(c.label)}${c.parts ? ` (${c.part}-й кусок)` : ''}</span>`)).join(' → ')}${b.rest > 0.005 ? ` → обрезок ${mFmt(b.rest)}` : ''}</div>`; }).join('')}`
: 'Этот молдинг не попал в раскрой.';
document.querySelectorAll('.mol-pick-info').forEach(el => { el.innerHTML = info; el.classList.remove('mp-hint'); });
document.querySelectorAll('details.mol-cut').forEach(d => { d.open = true; });
}
// на стене сторона со стыком — выбирается тот кусок, куда нажали (а не все куски стороны сразу)
function molPartAt(t, e) {
const key = t.getAttribute('data-mk'), hl = t.querySelector('.mol-hl'), svg = t.ownerSVGElement;
const m = hl && /^M([\d.-]+) ([\d.-]+)([HV])([\d.-]+)$/.exec(hl.getAttribute('d'));
if (!m || !svg || !svg.getScreenCTM) return '';
const all = [];
_molPlans.forEach((g, gi) => g.bars.forEach((b, bi) => b.cuts.forEach((c, k) => { if (c.key === key && c.parts) all.push({ c, ci: `${gi}-${bi}-${k}` }); })));
if (!all.length) return '';
const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
const q = pt.matrixTransform(svg.getScreenCTM().inverse());
const from = m[3] === 'H' ? +m[1] : +m[2], span = +m[4] - from, at = ((m[3] === 'H' ? q.x : q.y) - from) / (span || 1);
all.sort((a, b) => a.c.part - b.c.part);
const whole = all[0].c.whole || all.reduce((a, x) => a + x.c.len, 0);
let acc = 0;
for (const x of all) { acc += x.c.len / whole; if (at <= acc + 1e-6) return x.ci; }
return all[all.length - 1].ci;
}
if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('click', e => {
const t = e.target && e.target.closest && e.target.closest('.mol-pick');
if (t) molPick(t.getAttribute('data-mk'), t.getAttribute('data-ci') || molPartAt(t, e));
});

// Раскладка молдингов на стене: рамки обходят проёмы и ниши, линии разрываются на них
function molWallLayout(m, wi) {
const L = mNum((m.walls || [])[wi]);
const Hh = wallHeightOf(m, wi);
const res = { L, Hh, frames: [], lines: [] };
if (!(L > 0) || !(Hh > 0)) return res;
const ops = (m.openings || []).filter(o => o.wall === wi && openingWidth(o) > 0).map(o => {
const [a0, a1] = openingSpan(o, L);
const v = openingVert(o, Hh);
return { a0, a1, y0: o.type === 'balcony' ? 0 : v.y0, y1: v.y1 };
});
// ниши в стенах — тоже препятствие: рамки обходят, линии разрываются
if (typeof radNichesCompute === 'function') radNichesCompute(m).list.filter(e => e.wall === wi && e.span).forEach(e => ops.push({ a0: e.span[0], a1: e.span[1], y0: e.bottom, y1: e.top }));
molGet(m).wall.forEach((row, ri) => {
if (!molWalls(row.walls, m).includes(wi)) return;
if (row.type === 'line') {
const y = mNum(row.y);
if (!(y > 0) || y >= Hh) return;
const cuts = ops.filter(o => o.y0 < y && o.y1 > y).map(o => [o.a0, o.a1]).sort((a, b) => a[0] - b[0]);
let x = 0;
const mw = molCm(row.mw), plank = molPlankOf(row);
cuts.forEach(([c0, c1]) => { if (c0 > x + 0.01) res.lines.push({ ri, x0: x, x1: c0, y, mw, plank }); x = Math.max(x, c1); });
if (L > x + 0.01) res.lines.push({ ri, x0: x, x1: L, y, mw, plank });
return;
}
// рамка по размерам — ровно там, где задана (проёмы не обходит: её ставят по чертежу)
if (row.type === 'frame') {
const x0 = Math.max(0, mNum(row.x)), w = mNum(row.w), fb = mNum(row.yb), ft = Math.min(Hh, mNum(row.yt));
if (!(w > 0) || !(ft > fb)) return;
if (x0 + w > L + 0.005) { res.outside = true; return; }
const mw = molCm(row.mw), mwIn = molCm(row.mwIn) || mw, add = mw / 1000;
const ind0 = molInd(row), iy0 = row.dbl && String(row.indY == null ? '' : row.indY).trim() !== '' ? mNum(row.indY) : ind0;
const ind = ind0 > 0 ? ind0 + add : 0, iy = iy0 > 0 ? iy0 + add : 0;
const fr = { ri, x0, x1: x0 + w, y0: fb, y1: ft, gap: 0, fixed: true, mw, plank: molPlankOf(row) };
if (ind > 0 || iy > 0) {
if (w - 2 * ind >= 0.05 && ft - fb - 2 * iy >= 0.05) fr.inner = { x0: x0 + ind, x1: x0 + w - ind, y0: fb + iy, y1: ft - iy, mw: mwIn };
else fr.innerBad = true;
}
res.frames.push(fr);
return;
}
const yb = mNum(row.yb), yt = Math.min(Hh, mNum(row.yt));
const gap = Math.max(0, evalMeasureExpr(row.gap) || 0);
const fw = mNum(row.fw);
const mw = molCm(row.mw), mwIn = molCm(row.mwIn) || mw;
const ind = molInd(row) > 0 ? molInd(row) + mw / 1000 : 0;
if (!(yt > yb)) return;
// свободные участки стены: от угла до угла за вычетом проёмов в этой полосе (с промежутком)
const blocks = ops.filter(o => o.y0 < yt && o.y1 > yb).map(o => [o.a0 - gap, o.a1 + gap]).sort((a, b) => a[0] - b[0]);
const free = [];
let x = gap;
blocks.forEach(([b0, b1]) => { if (b0 > x) free.push([x, b0]); x = Math.max(x, b1); });
if (L - gap > x) free.push([x, L - gap]);
free.forEach(([f0, f1]) => {
const s = f1 - f0;
if (s < 0.15) return;
let n = fw > 0 ? Math.max(1, Math.round((s + gap) / (fw + gap))) : 1;
let w = (s - gap * (n - 1)) / n;
while (n > 1 && w < 0.15) { n--; w = (s - gap * (n - 1)) / n; }
for (let k = 0; k < n; k++) {
const x0 = f0 + k * (w + gap);
const fr = { ri, x0, x1: x0 + w, y0: yb, y1: yt, gap, mw, plank: molPlankOf(row) };
// внутренняя рамка — если после отступа остаётся хотя бы 10 см
if (ind > 0) {
if (w - 2 * ind >= 0.1 && yt - yb - 2 * ind >= 0.1) fr.inner = { x0: x0 + ind, x1: x0 + w - ind, y0: yb + ind, y1: yt - ind, mw: mwIn };
else fr.innerBad = true;
}
res.frames.push(fr);
}
});
});
return res;
}

// Плинтус по стенам: куски между дверями и углами, обрывы (края дверей и концы
// у стен, где плинтус не продолжается) — заглушка или конверт.
// plinth.env = { on, skip: [ключи обрывов без конверта] }; ключ: 'd<проём>a|b' или 'w<стена>a|b'.
function molPlinthPlan(m, g, pl) {
const lens = molWallLens(m);
const walls = molWalls(pl.walls, m);
const set = new Set(walls);
const n = lens.length;
const res = { walls, pieces: [], ends: [], caps: [], env: [], looseW: 0 };
const nb = (i, step) => { const j = i + step; if (g && g.closed) return (j + n) % n; return j >= 0 && j < n ? j : -1; };
walls.forEach(i => {
const L = lens[i];
const doors = typeof openingSpan === 'function'
? (m.openings || []).map((o, oi) => ({ o, oi })).filter(({ o }) => o.wall === i && (o.type === 'door' || o.type === 'balcony') && openingWidth(o) > 0)
.map(({ o, oi }) => { const [a0, a1] = openingSpan(o, L); const sp = o.type === 'balcony' ? balconyParts(o, a0, a1).door : [a0, a1]; return { oi, code: opCode(o, oi), a0: sp[0], a1: sp[1] }; }).sort((a, b) => a.a0 - b.a0)
: [];
// за мебелью на полу плинтуса нет — он упирается в шкаф
molFreeSpans(L, [...doors.map(dr => [dr.a0, dr.a1]), ...molCoverSpans(m, i, 'floor')]).forEach(([a, b]) => res.pieces.push(b - a));
doors.forEach(dr => {
if (dr.a0 > 0.005) res.ends.push({ key: `d${dr.oi}a`, label: `${dr.code} к углу А`, door: dr.oi });
if (dr.a1 < L - 0.005) res.ends.push({ key: `d${dr.oi}b`, label: `${dr.code} к углу Б`, door: dr.oi });
});
// концы у стен: соседняя стена без плинтуса — обрыв
const pv = nb(i, -1), nx = nb(i, 1);
if (pv < 0 || !set.has(pv)) res.ends.push({ key: `w${i}a`, label: `стена ${i + 1}, угол А` });
if (nx < 0 || !set.has(nx)) res.ends.push({ key: `w${i}b`, label: `стена ${i + 1}, угол Б` });
});
// двери, не поставленные на стену, — вычитаем из общей длины, по две заглушки
const loose = (m.openings || []).filter(o => (o.type === 'door' || o.type === 'balcony') && typeof o.wall !== 'number');
res.looseW = walls.length ? loose.reduce((a, o) => a + (o.type === 'balcony' ? mNum(o.dw) : mNum(o.w)) * mCount(o.n), 0) : 0;
if (res.looseW > 0) { let left = res.looseW; for (let k = res.pieces.length - 1; k >= 0 && left > 0; k--) { const cut = Math.min(res.pieces[k], left); res.pieces[k] -= cut; left -= cut; } res.pieces = res.pieces.filter(v => v > 0.005); }
const looseEnds = walls.length ? loose.reduce((a, o) => a + 2 * Math.max(1, Math.round(mCount(o.n))), 0) : 0;
const env = pl.env && pl.env.on;
const skip = new Set(env && Array.isArray(pl.env.skip) ? pl.env.skip : []);
res.ends.forEach(e => { e.env = !!env && !skip.has(e.key); (e.env ? res.env : res.caps).push(e); });
for (let k = 0; k < looseEnds; k++) (env ? res.env : res.caps).push({ key: 'loose' + k, label: 'дверь без места' });
return res;
}

function moldingCompute(m) {
const d = molGet(m);
const g = molGeom(m);
const lens = molWallLens(m);
const out = { cornice: null, plinth: null, ceil: [], ceilLen: 0, wallLen: 0, wallOut: 0, wallIn: 0, prof: {}, cmOut: [], cmIn: [], wallParts: [], lines: {}, min: false };
const planks = (len, plank) => { const p = mNum(plank); return p > 0 && len > 0 ? Math.ceil(len * 1.1 / p) : 0; };
// куски: каждый короче метра — за 1 пог. м (как откосы и узкие)
const sumMin = list => list.reduce((a, v) => a + minLen(v), 0);
const txtMin = list => list.map(fmtMin).join(' + ');
const hasMin = list => list.some(v => v > 0 && v < 1);
if (d.cornice.on) {
const walls = molWalls(d.cornice.walls, m);
// за мебелью до потолка карниза нет
const pieces = [];
walls.forEach(i => molCorniceSpans(m, i, lens[i]).forEach(([a, b]) => pieces.push(b - a)));
const len = sumMin(pieces);
// угол за мебелью до потолка — без карниза
const c = molCorners(g, walls, molCoverCornerOpen(m, lens, 'ceil'));
if (hasMin(pieces)) out.min = true;
out.cornice = { walls, len, corners: c, planks: planks(pieces.reduce((a, v) => a + v, 0), d.cornice.plank) };
if (len > 0) out.lines.cornice = `Карниз: ${walls.length === lens.filter(v => v > 0).length ? 'по периметру' : 'стены ' + walls.map(i => i + 1).join(', ')} ${txtMin(pieces)} = ${mFmt(len)} пог. м${c.in || c.out ? ` · углы: внутр. ${c.in}, наруж. ${c.out}` : ''}${out.cornice.planks ? ` · планок по ${mFmt(mNum(d.cornice.plank))} м: ${out.cornice.planks} (+10%)` : ''}`;
}
if (d.plinth.on) {
const pl = molPlinthPlan(m, g, d.plinth);
const len = sumMin(pl.pieces) + pl.env.length;     // конверт — 1 пог. м
if (hasMin(pl.pieces)) out.min = true;
const c = molCorners(g, pl.walls, molCoverCornerOpen(m, lens, 'floor'));
out.plinth = { walls: pl.walls, len, caps: pl.caps.length, env: pl.env.length, ends: pl.ends, corners: c, planks: planks(pl.pieces.reduce((a, v) => a + v, 0), d.plinth.plank) };
if (len > 0) out.lines.plinth = `Плинтус: ${txtMin(pl.pieces)}${pl.looseW ? ` − ${mFmt(pl.looseW)} (двери без места на стене)` : ''}${pl.env.length ? ` + конверты ${pl.env.length} × 1` : ''} = ${mFmt(len)} пог. м${pl.caps.length ? ` · заглушек: ${pl.caps.length}` : ''}${c.in || c.out ? ` · углы: внутр. ${c.in}, наруж. ${c.out}` : ''}${out.plinth.planks ? ` · планок по ${mFmt(mNum(d.plinth.plank))} м: ${out.plinth.planks} (+10%)` : ''}`;
}
d.ceil.forEach((f, fi) => {
const dd = mNum(f.d);
const poly = molOffsetPoly(g, dd);
const ind = molInd(f);
const inner = poly && ind > 0 ? molOffsetPoly(g, dd + ind) : null;
const len = poly ? sumMin(poly.edges) + (inner ? sumMin(inner.edges) : 0) : 0;
if (poly && (hasMin(poly.edges) || (inner && hasMin(inner.edges)))) out.min = true;
out.ceil.push({ fi, d: dd, poly, inner, ind, innerBad: !!poly && ind > 0 && !inner, len });
out.ceilLen += len;
});
const okCeil = out.ceil.filter(f => f.poly);
if (okCeil.length) out.lines.ceil = `Молдинг на потолке: ${okCeil.map(f => `рамка в ${mFmt(f.d)} от стен (${txtMin(f.poly.edges)})${f.inner ? ` + внутренняя через ${mFmt(f.ind)} (${txtMin(f.inner.edges)})` : ''}`).join(' + ')} = ${mFmt(out.ceilLen)} пог. м`;
if (d.ceil.length && out.ceil.some(f => f.d > 0 && !f.poly)) out.lines.ceilBad = g && g.closed ? 'Рамка на потолке не помещается — уменьшите отступ' : 'Рамки на потолке считаются, когда комната сошлась на чертеже';
else if (out.ceil.some(f => f.innerBad)) out.lines.ceilBad = 'Внутренняя рамка на потолке не помещается — уменьшите её отступ';
if (d.wall.length && typeof openingSpan === 'function') {
lens.forEach((L, wi) => {
if (!(L > 0)) return;
const lay = molWallLayout(m, wi);
const sides = lay.frames.flatMap(molFrameSides);
const segs = lay.lines.map(l => l.x1 - l.x0);
const fr = sumMin(sides), ln = sumMin(segs);
if (hasMin(sides) || hasMin(segs)) out.min = true;
lay.frames.forEach(f => {
const o = sumMin([f.x1 - f.x0, f.x1 - f.x0, f.y1 - f.y0, f.y1 - f.y0]);
out.wallOut += o; out.prof[f.mw || 0] = (out.prof[f.mw || 0] || 0) + o; if (!out.cmOut.includes(f.mw || 0)) out.cmOut.push(f.mw || 0);
if (f.inner) { const i = sumMin([f.inner.x1 - f.inner.x0, f.inner.x1 - f.inner.x0, f.inner.y1 - f.inner.y0, f.inner.y1 - f.inner.y0]); out.wallIn += i; out.prof[f.inner.mw || 0] = (out.prof[f.inner.mw || 0] || 0) + i; if (!out.cmIn.includes(f.inner.mw || 0)) out.cmIn.push(f.inner.mw || 0); }
});
lay.lines.forEach(l => { const v = minLen(l.x1 - l.x0); out.wallOut += v; out.prof[l.mw || 0] = (out.prof[l.mw || 0] || 0) + v; if (!out.cmOut.includes(l.mw || 0)) out.cmOut.push(l.mw || 0); });
if (fr + ln > 0) {
out.wallLen += fr + ln;
const dbl = lay.frames.filter(f => f.inner).length;
out.wallParts.push(`стена ${wi + 1}: ${[lay.frames.length ? `${lay.frames.length} рам.${dbl ? ` (двойных ${dbl})` : ''} ${mFmt(fr)}` : '', ln ? `линия ${segs.length > 1 ? `(${txtMin(segs)}) ` : ''}${mFmt(ln)}` : ''].filter(Boolean).join(' + ')}`);
}
});
if (out.wallParts.length) out.lines.wall = `Молдинг на стенах: ${out.wallParts.join('; ')} = ${mFmt(out.wallLen)} пог. м`;
const profs = Object.keys(out.prof).map(Number).filter(cm => out.prof[cm] > 0);
if (profs.some(cm => cm > 0)) out.lines.wallProf = 'По профилям: ' + profs.sort((a, b) => b - a).map(cm => `${cm ? 'молдинг ' + molCmTxt(cm) : 'ширина не указана'} — ${mFmt(out.prof[cm])} пог. м`).join('; ');
if (lens.some((L, wi) => L > 0 && molWallLayout(m, wi).frames.some(f => f.innerBad))) out.lines.wallBad = 'Внутренняя рамка не помещается в узкие рамки — там рамка одинарная';
if (lens.some((L, wi) => L > 0 && molWallLayout(m, wi).outside)) out.lines.wallBad = [out.lines.wallBad, 'Рамка по размерам выходит за край стены — проверьте отступ от угла и ширину'].filter(Boolean).join('. ');
}
if (out.min) Object.keys(out.lines).forEach(k => { if (k !== 'ceilBad' && /\*/.test(out.lines[k])) out.lines[k] += MIN_NOTE; });
return out;
}

/* ---------- рисунки ---------- */
const MOL_INK = '#7a3fb0';
// Молдинги, карниз и плинтус на развёртке стены (координаты — функции развёртки)
function molElevShapes(m, wi, XA, Yh, L, Hh) {
const d = molGet(m);
let s = '';
const lay = molWallLayout(m, wi);
const k = Math.abs(Yh(0) - Yh(1));
if (d.cornice.on && molWalls(d.cornice.walls, m).includes(wi)) {
const ch = Math.min(6, 0.1 * k + 2);
molCorniceSpans(m, wi, L).forEach(([a, b]) => { s += `<rect x="${Math.min(XA(a), XA(b))}" y="${Yh(Hh)}" width="${Math.abs(XA(b) - XA(a))}" height="${ch}" fill="#e9dcf5" stroke="${MOL_INK}" stroke-width="1"/>`; });
}
if (d.plinth.on && molWalls(d.plinth.walls, m).includes(wi)) {
const ph = Math.min(6, 0.08 * k + 2);
const doors = molPlinthGaps(m, wi, L).sort((a, b) => a[0] - b[0]);
let x = 0;
const seg = (a, b) => { if (b - a > 0.005) s += `<rect x="${Math.min(XA(a), XA(b))}" y="${Yh(0) - ph}" width="${Math.abs(XA(b) - XA(a))}" height="${ph}" fill="#e3d5c3" stroke="#7a5230" stroke-width="1"/>`; };
doors.forEach(([a0, a1]) => { seg(x, a0); x = Math.max(x, a1); });
seg(x, L);
}
// рамка — полосой ширины профиля (внутрь от края), без ширины — линией
const band = (r, def) => {
const xL = Math.min(XA(r.x0), XA(r.x1)), xR = Math.max(XA(r.x0), XA(r.x1)), yT = Yh(r.y1), yB = Yh(r.y0);
const t = r.mw > 0 ? Math.max(1, r.mw / 1000 * k) : 0;
if (!t) return `<rect x="${xL}" y="${yT}" width="${xR - xL}" height="${yB - yT}" fill="none" stroke="${MOL_INK}" stroke-width="${def}"/>`;
return `<rect x="${xL + t / 2}" y="${yT + t / 2}" width="${Math.max(0, xR - xL - t)}" height="${Math.max(0, yB - yT - t)}" fill="none" stroke="#c9a8e6" stroke-width="${t}"/><rect x="${xL}" y="${yT}" width="${xR - xL}" height="${yB - yT}" fill="none" stroke="${MOL_INK}" stroke-width="0.8"/>`;
};
lay.frames.forEach(f => { s += band(f, 1.6); if (f.inner) s += band(f.inner, 1.2); });
// стороны рамок и куски линий — нажимаются: подсветка здесь и в раскрое планок (molPick), ключи — как в molPieces
const hit = (key, d) => `<g class="mol-pick" data-mk="${key}"><path class="mol-hl" d="${d}" fill="none" stroke-width="4" stroke-linecap="round"/><path d="${d}" fill="none" stroke="transparent" stroke-width="14"/></g>`;
lay.frames.slice().sort((a, b) => a.x0 - b.x0).forEach((f, k) => [[f, 'o'], [f.inner, 'i']].forEach(([r, oi]) => {
if (!r) return;
const xa = XA(r.x0), xb = XA(r.x1), yt = Yh(r.y1), yb = Yh(r.y0);
s += hit(`w${wi}f${k}${oi}t`, `M${xa} ${yt}H${xb}`) + hit(`w${wi}f${k}${oi}b`, `M${xa} ${yb}H${xb}`) + hit(`w${wi}f${k}${oi}l`, `M${xa} ${yt}V${yb}`) + hit(`w${wi}f${k}${oi}r`, `M${xb} ${yt}V${yb}`);
}));
lay.lines.forEach((l, j) => { s += hit(`w${wi}l${j}`, `M${XA(l.x0)} ${Yh(l.y)}H${XA(l.x1)}`); });
lay.lines.forEach(l => {
s += `<path d="M${XA(l.x0)} ${Yh(l.y)}H${XA(l.x1)}" stroke="${MOL_INK}" stroke-width="2"/>`;
});
return s;
}

// Развёртка стены на вкладке «Лепнина»: стена, проёмы, лепнина и размеры рамок
function molElevSvg(m, wi, W = 340, H = 240, vw = { z: 1, x: 0, y: 0 }) {
const g = molGeom(m);
const left = 34, right = 14, top = 16, bottom = 46;
const L = mNum((m.walls || [])[wi]), Hh = wallHeightOf(m, wi);
if (!(L > 0) || !(Hh > 0)) return `<div class="mp-hint" style="padding:18px 8px;text-align:center;">${!(L > 0) ? 'Введите длину стены на вкладке «Стены»' : 'Введите высоту стен на вкладке «Стены»'}</div>`;
// приближение растягивает чертёж; подписи — прежнего размера
const k0 = Math.min((W - left - right) / L, (H - top - bottom) / Hh);
const z = vw.z, vx = (W - W / z) / 2 + vw.x, vy = (H - H / z) / 2 + vw.y;
const k = k0 * z;
// по центру окна — и по ширине, и по высоте (во весь экран окно высокое)
const x0 = (left + ((W - left - right) - L * k0) / 2 - vx) * z, yF = (top + ((H - top - bottom) - Hh * k0) / 2 + Hh * k0 - vy) * z;
const flip = g && (g.orient || 1) < 0;
const XA = a => flip ? x0 + (L - a) * k : x0 + a * k;
const Yh = h => yF - h * k;
let s = `<rect x="${x0}" y="${Yh(Hh)}" width="${L * k}" height="${Hh * k}" fill="#ffffff" stroke="#14181f" stroke-width="1.6"/>`;
s += `<path d="M${x0 - 6} ${yF}H${x0 + L * k + 6}" stroke="#14181f" stroke-width="3"/>`;
// проёмы
(m.openings || []).forEach(o => {
if (o.wall !== wi || !(openingWidth(o) > 0)) return;
const [a0, a1] = openingSpan(o, L);
const v = openingVert(o, Hh);
const xL = Math.min(XA(a0), XA(a1)), xR = Math.max(XA(a0), XA(a1));
const y0 = o.type === 'balcony' ? 0 : v.y0;
s += `<rect x="${xL}" y="${Yh(v.y1)}" width="${xR - xL}" height="${(v.y1 - y0) * k}" fill="${o.type === 'door' ? '#fff7dc' : '#eef4ff'}" stroke="#14181f" stroke-width="1.2" ${v.guess ? 'stroke-dasharray="4 3"' : ''}/>`;
});
s += molElevShapes(m, wi, XA, Yh, L, Hh);
// размеры первой рамки каждого ряда и отступы: от пола, до потолка, промежуток, внутренняя рамка
const lay = molWallLayout(m, wi);
s += molElevDims(lay, XA, Yh, Hh);
// длина и высота стены
s += `<text x="${x0 + L * k / 2}" y="${yF + 18}" text-anchor="middle" font-size="12" font-weight="700" fill="#14181f">${mFmt(L)} м</text>`;
s += `<text x="${x0 - 10}" y="${(yF + Yh(Hh)) / 2}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#14181f" transform="rotate(-90 ${x0 - 10} ${(yF + Yh(Hh)) / 2})">${mFmt(Hh)}</text>`;
if (lay.frames.length || lay.lines.length) {
const fr = lay.frames.reduce((a, f) => a + molFrameLen(f), 0), ln = lay.lines.reduce((a, l) => a + minLen(l.x1 - l.x0), 0);
s += `<text x="${x0 + L * k / 2}" y="${yF + 36}" text-anchor="middle" font-size="11" fill="${MOL_INK}">${lay.frames.length ? `${lay.frames.length} рам. ${mFmt(fr)} пог. м` : ''}${lay.frames.length && ln ? ' · ' : ''}${ln ? `линия ${mFmt(ln)} пог. м` : ''}</text>`;
}
return `<svg class="mol-elev-svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Развёртка стены ${wi + 1}" font-family="inherit">${s}</svg>`;
}

// Размерные отметки рамок на развёртке (синим) у первой рамки каждого ряда:
// от пола (или от рамки ниже), до потолка (или до рамки выше), промежуток, отступ внутренней рамки.
function molElevDims(lay, XA, Yh, Hh) {
const DIM = '#1f6fd1';
let s = '';
const num = (x, y, t, anchor) => `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="9" font-weight="700" fill="${DIM}" paint-order="stroke" stroke="#ffffff" stroke-width="3">${t}</text>`;
const vDim = (x, a, b) => {
if (!(b - a > 0.005)) return '';
const y0 = Yh(a), y1 = Yh(b);
return `<path d="M${x} ${y0}V${y1}M${x - 3} ${y0}H${x + 3}M${x - 3} ${y1}H${x + 3}" stroke="${DIM}" stroke-width="1"/>` + num(x + 4, (y0 + y1) / 2 + 3, mFmt(b - a), 'start');
};
const hDim = (a, b, h, side) => {
if (!(Math.abs(b - a) > 0.005)) return '';
const x0 = Math.min(XA(a), XA(b)), x1 = Math.max(XA(a), XA(b)), y = Yh(h);
return `<path d="M${x0} ${y}H${x1}M${x0} ${y - 3}V${y + 3}M${x1} ${y - 3}V${y + 3}" stroke="${DIM}" stroke-width="1"/>` + (side ? num(x1 + 3, y + 3, mFmt(Math.abs(b - a)), 'start') : num((x0 + x1) / 2, y - 4, mFmt(Math.abs(b - a)), 'middle'));
};
const overlap = (f, g) => Math.min(f.x1, g.x1) - Math.max(f.x0, g.x0) > 0.01;
const seen = new Set();
lay.frames.forEach(f => {
if (seen.has(f.ri)) return;
seen.add(f.ri);
const xL = Math.min(XA(f.x0), XA(f.x1)), xR = Math.max(XA(f.x0), XA(f.x1));
s += `<text x="${(xL + xR) / 2}" y="${(Yh(f.y0) + Yh(f.y1)) / 2 + 4}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${MOL_INK}" paint-order="stroke" stroke="#ffffff" stroke-width="3">${mFmt(f.x1 - f.x0)}×${mFmt(f.y1 - f.y0)}</text>`;
// ширина профиля — под размером рамки: «молдинг 40 мм», у двойной с другим внутренним — «40 / 20 мм»
if (f.mw > 0) s += `<text x="${(xL + xR) / 2}" y="${(Yh(f.y0) + Yh(f.y1)) / 2 + 17}" text-anchor="middle" font-size="9.5" fill="${MOL_INK}" paint-order="stroke" stroke="#ffffff" stroke-width="3">молдинг ${f.inner && f.inner.mw && f.inner.mw !== f.mw ? `${f.mw} / ${f.inner.mw}` : f.mw} мм</text>`;
// по вертикали — цепочкой: до ближайшей рамки другого ряда снизу и сверху, иначе до пола и потолка
const others = lay.frames.filter(g => g.ri !== f.ri && overlap(f, g));
const below = Math.max(0, ...others.filter(g => g.y1 <= f.y0 + 0.001).map(g => g.y1));
const above = Math.min(Hh, ...others.filter(g => g.y0 >= f.y1 - 0.001).map(g => g.y0));
const xv = xL + (xR - xL) * 0.7;
s += vDim(xv, below, f.y0);
if (!others.some(g => g.y0 >= f.y1 - 0.001)) s += vDim(xv, f.y1, above);   // между рядами — уже подписано у верхнего
// рамка по размерам — отступ от левого угла (или от соседней рамки по размерам слева)
if (f.fixed) {
const left = Math.max(0, ...lay.frames.filter(g => g.fixed && g !== f && g.x1 <= f.x0 + 0.001 && g.y0 < f.y1 && g.y1 > f.y0).map(g => g.x1));
s += hDim(left, f.x0, f.y0 + (f.y1 - f.y0) * 0.1);
}
// промежуток — у первой пары соседних рамок ряда (не через окно или дверь)
const row = lay.frames.filter(g => g.ri === f.ri);
const k = row.findIndex((g, j) => row[j + 1] && Math.abs(row[j + 1].x0 - g.x1 - g.gap) < 0.005);
if (k >= 0 && row[k].gap > 0) s += hDim(row[k].x1, row[k + 1].x0, row[k].y0 + (row[k].y1 - row[k].y0) * 0.15);
// отступ внутренней рамки — у левой стороны, ближе к верху
if (f.inner) {
const a = XA(f.x0) < XA(f.x1) ? [f.x0, f.inner.x0] : [f.inner.x1, f.x1];
s += hDim(a[0], a[1], f.inner.y1 - (f.inner.y1 - f.inner.y0) * 0.2, true);
}
});
return s;
}

// План: карниз и плинтус вдоль стен, рамки на потолке
function molPlanSvg(m, res, W = 340, H = 230, vw = { z: 1, x: 0, y: 0 }) {
const g = molGeom(m);
if (!g || !g.segs.length) return '';
const P = 34;
const xs = [0, ...g.segs.map(q => q.x2)], ys = [0, ...g.segs.map(q => q.y2)];
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
const k0 = Math.min((W - 2 * P) / Math.max(maxX - minX, 0.5), (H - 2 * P) / Math.max(maxY - minY, 0.5));
const ox0 = (W - (maxX - minX) * k0) / 2 - minX * k0, oy0 = (H - (maxY - minY) * k0) / 2 - minY * k0;
const z = vw.z, vx = (W - W / z) / 2 + vw.x, vy = (H - H / z) / 2 + vw.y;
const k = k0 * z, ox = (ox0 - vx) * z, oy = (oy0 - vy) * z;
const X = v => ox + v * k, Y = v => oy + v * k;
const o = g.orient || 1;
const d = molGet(m);
let s = '';
const pts = [[0, 0], ...g.segs.map(q => [q.x2, q.y2])];
if (g.closed) s += `<path d="M${pts.map(p => `${X(p[0])} ${Y(p[1])}`).join('L')}Z" fill="#f6f7f9"/>`;
// рамки на потолке
res.ceil.forEach(f => [f.poly, f.inner].forEach(p => { if (p) s += `<path d="M${p.pts.map(([x, y]) => `${X(x)} ${Y(y)}`).join('L')}Z" fill="none" stroke="${MOL_INK}" stroke-width="${p === f.inner ? 1.2 : 1.6}" stroke-dasharray="6 3"/>`; }));
const along = (q, off, a, b, col, w) => {
const nx = -q.dy * o, ny = q.dx * o;
const p0 = [q.x1 + q.dx * a, q.y1 + q.dy * a], p1 = [q.x1 + q.dx * b, q.y1 + q.dy * b];
return `<path d="M${X(p0[0]) + nx * off} ${Y(p0[1]) + ny * off}L${X(p1[0]) + nx * off} ${Y(p1[1]) + ny * off}" stroke="${col}" stroke-width="${w}"/>`;
};
if (d.cornice.on) molWalls(d.cornice.walls, m).forEach(i => { const q = g.segs[i]; if (q && q.len > 0) molCorniceSpans(m, i, q.len).forEach(([a, b]) => { s += along(q, 5, a, b, MOL_INK, 2.5); }); });
if (d.plinth.on) molWalls(d.plinth.walls, m).forEach(i => {
const q = g.segs[i]; if (!q || !(q.len > 0)) return;
const doors = molPlinthGaps(m, i, q.len).sort((a, b) => a[0] - b[0]);
let x = 0;
doors.forEach(([a0, a1]) => { if (a0 > x) s += along(q, 9, x, a0, '#7a5230', 3); x = Math.max(x, a1); });
if (q.len > x) s += along(q, 9, x, q.len, '#7a5230', 3);
});
g.segs.forEach(q => {
s += `<path d="M${X(q.x1)} ${Y(q.y1)}L${X(q.x2)} ${Y(q.y2)}" stroke="#14181f" stroke-width="3.5" stroke-linecap="square" ${q.empty ? 'stroke-dasharray="5 5" opacity=".35"' : ''}/>`;
if (!(q.len > 0)) return;
const mx = (X(q.x1) + X(q.x2)) / 2 + q.dy * o * 14, my = (Y(q.y1) + Y(q.y2)) / 2 - q.dx * o * 14;
const on = q.i === molElevWall;
s += `<circle cx="${mx}" cy="${my}" r="8" fill="${on ? '#14181f' : '#ffffff'}" stroke="#14181f" stroke-width="1"/><text x="${mx}" y="${my + 3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="${on ? '#ffffff' : '#14181f'}">${q.i + 1}</text>`;
s += `<path d="M${X(q.x1)} ${Y(q.y1)}L${X(q.x2)} ${Y(q.y2)}" stroke="transparent" stroke-width="22" style="cursor:pointer" onclick="molTapWall(${q.i})"><title>Развёртка стены ${q.i + 1}</title></path>`;
});
return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Лепнина на плане" font-family="inherit">${s}</svg>`;
}

/* ---------- вкладка «Лепнина» ---------- */
function moldingTabHtml(m) {
const d = molEnsure();
const lens = molWallLens(m);
const hasWalls = lens.some(v => v > 0);
const n = lens.length;
if (molElevWall >= n) molElevWall = 0;
const chips = (sel, onclick, allClick) => {
const ws = molWalls(sel, m);
const all = ws.length === lens.filter(v => v > 0).length;
return `<div class="mp-ce-walls"><span class="mp-ce-walls-label">Стены:</span>${lens.map((v, i) => v > 0 ? `<button type="button" class="mp-ce-wall${ws.includes(i) ? ' on' : ''}" onclick="${onclick(i)}">${i + 1}</button>` : '').join('')}<button type="button" class="mp-ce-wall mp-ce-all${all ? ' on' : ''}" onclick="${allClick}">все</button></div>`;
};
const toggle = (kind, on, label) => `<label class="mp-check mp-ce-light"><input type="checkbox" ${on ? 'checked' : ''} onchange="molSet('${kind}', this.checked)"><span>${label}</span></label>`;
if (!hasWalls) return `<section class="mp-sec"><div class="mp-empty">Лепнина считается по стенам.<br>Сначала введите стены на вкладке «Стены».</div></section>`;
return `<section class="mp-sec">
<div class="mp-sec-title">План</div>
<div class="mp-ce-plan rl-sketch${molFull === 'plan' ? ' full' : ''}" id="mpMolPlan"></div>
<div class="mp-hint">Фиолетовая линия — карниз, коричневая — плинтус, пунктир — рамки на потолке. Касание стены — её развёртка ниже.</div>
</section>
<section class="mp-sec">
<div class="mp-sec-title">Карниз (потолочный плинтус)</div>
${toggle('cornice', d.cornice.on, 'Карниз по стенам')}
${d.cornice.on ? `${chips(d.cornice.walls, i => `molWallToggle('cornice', ${i})`, "molAllWalls('cornice')")}
<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Длина планки, м${mIn('molding.cornice.plank', d.cornice.plank, '2')}</label><span></span><span class="mp-hint" style="margin:0;align-self:center;">для подсчёта планок</span></div>` : ''}
<div class="mp-calc" id="mpCalcMolCornice"></div>
</section>
<section class="mp-sec">
<div class="mp-sec-title">Плинтус</div>
${toggle('plinth', d.plinth.on, 'Плинтус по стенам, без дверных проёмов')}
${d.plinth.on ? `${chips(d.plinth.walls, i => `molWallToggle('plinth', ${i})`, "molAllWalls('plinth')")}
<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Длина планки, м${mIn('molding.plinth.plank', d.plinth.plank, '2,5')}</label><span></span><span class="mp-hint" style="margin:0;align-self:center;">для подсчёта планок</span></div>
${molEnvHtml(m, d)}` : ''}
<div class="mp-calc" id="mpCalcMolPlinth"></div>
</section>
<section class="mp-sec">
<div class="mp-sec-title">Молдинги на потолке</div>
<div class="mp-hint">Рамка по контуру комнаты с отступом от стен. Несколько рамок — вложенные. Двойная — вторая рамка внутри первой с отступом.</div>
${d.ceil.map((f, i) => `<div class="mp-row"><span class="mp-row-label">${i + 1}.</span><span class="mp-unit" style="margin-right:4px;">отступ</span>${mIn(`molding.ceil.${i}.d`, f.d, '0,3')}<span class="mp-unit">м</span><span class="mp-row-res" id="mpMolCeilRes${i}"></span><button type="button" class="mp-del" onclick="molRemove('ceil', ${i})" aria-label="Убрать рамку">✕</button></div>
${molDblHtml(`molDbl('ceil', ${i}, this.checked)`, f, `molding.ceil.${i}.ind`)}`).join('')}
<div class="mp-add-row"><button type="button" class="mp-add" onclick="molAddCeil()">+ Рамка на потолке</button></div>
<div class="mp-calc" id="mpCalcMolCeil"></div>
</section>
<section class="mp-sec">
<div class="mp-sec-title">Молдинги на стенах</div>
<div class="rl-elev-nav"><button type="button" onclick="molStep(-1)" aria-label="Предыдущая стена">‹</button><span>Стена ${molElevWall + 1} из ${n}</span><button type="button" onclick="molStep(1)" aria-label="Следующая стена">›</button></div>
<div class="mp-ce-plan rl-sketch${molFull === 'elev' ? ' full' : ''}" id="mpMolElev"></div>
<div class="mp-hint">Ряд рамок раскладывается по стене сам: рамки обходят окна, двери и ниши с тем же промежутком. Линия — горизонтальный молдинг на высоте, разрывается на проёмах и нишах. Рамка по размерам — одна рамка точно по чертежу: отступ от левого угла стены, ширина, низ и верх от пола. Синим на развёртке — отступы: от пола, до потолка, между рамками и до внутренней рамки.</div>
${d.wall.map((row, i) => `<div class="mp-open">
<div class="mp-open-top">
<button type="button" class="mp-type" onclick="molRowType(${i})">${row.type === 'line' ? 'Линия' : row.type === 'frame' ? 'Рамка по размерам' : 'Ряд рамок'} ▾</button>
<span class="mp-open-area" id="mpMolRowRes${i}"></span>
<button type="button" class="mp-del" onclick="molRemove('wall', ${i})" aria-label="Убрать">✕</button>
</div>
${chips(row.walls, wi => `molRowWall(${i}, ${wi})`, `molRowAll(${i})`)}
${row.type === 'line'
? `<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Высота от пола ↕${mIn(`molding.wall.${i}.y`, row.y, '0,9')}</label><span class="mp-x">·</span><label>Молдинг, мм${mIn(`molding.wall.${i}.mw`, row.mw, '40')}</label></div>
<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Длина планки, м${mIn(`molding.wall.${i}.plank`, row.plank, '2')}</label><span></span><span></span></div>`
: row.type === 'frame'
? `<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>От левого угла ↔${mIn(`molding.wall.${i}.x`, row.x, '0,37')}</label><span class="mp-x">·</span><label>Ширина ↔${mIn(`molding.wall.${i}.w`, row.w, '1,4')}</label></div>
<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Низ от пола ↕${mIn(`molding.wall.${i}.yb`, row.yb, '0,25')}</label><span class="mp-x">·</span><label>Верх от пола ↕${mIn(`molding.wall.${i}.yt`, row.yt, '2,27')}</label></div>
${molDblHtml(`molDbl('wall', ${i}, this.checked)`, row, `molding.wall.${i}.ind`)}
${row.dbl ? `<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Отступ сверху и снизу, м${mIn(`molding.wall.${i}.indY`, row.indY, 'как по бокам')}</label><span></span><span></span></div>` : ''}
${molProfHtml(row, i)}`
: `<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Низ рамок от пола ↕${mIn(`molding.wall.${i}.yb`, row.yb, '0,15')}</label><span class="mp-x">·</span><label>Верх рамок от пола ↕${mIn(`molding.wall.${i}.yt`, row.yt, '0,85')}</label></div>
<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Промежуток ↔${mIn(`molding.wall.${i}.gap`, row.gap, '0,1')}</label><span class="mp-x">·</span><label>Ширина рамки ↔${mIn(`molding.wall.${i}.fw`, row.fw, 'на весь участок')}</label></div>
${molDblHtml(`molDbl('wall', ${i}, this.checked)`, row, `molding.wall.${i}.ind`)}
${molProfHtml(row, i)}`}
</div>`).join('')}
<div class="mp-add-row">
<button type="button" class="mp-add" onclick="molAddRow('frames')">+ Ряд рамок</button>
<button type="button" class="mp-add" onclick="molAddRow('line')">+ Линия</button>
<button type="button" class="mp-add" onclick="molAddRow('frame')">+ Рамка по размерам</button>
</div>
<div class="mp-calc" id="mpCalcMolWall"></div>
<div class="mp-calc" id="mpCalcMolBuy"></div>
</section>`;
}

// Ширина профиля рамок (мм): наружной и, у двойной, внутренней — длина считается по каждому профилю отдельно
function molProfHtml(row, i) {
return `<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Молдинг${row.dbl ? ' наружной' : ''}, мм${mIn(`molding.wall.${i}.mw`, row.mw, '40')}</label>${row.dbl ? `<span class="mp-x">·</span><label>Молдинг внутренней, мм${mIn(`molding.wall.${i}.mwIn`, row.mwIn, 'как наружной')}</label>` : '<span></span><span></span>'}</div>
<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Длина планки, м${mIn(`molding.wall.${i}.plank`, row.plank, '2')}</label><span></span><span class="mp-hint" style="margin:0;align-self:center;">для закупки и раскроя</span></div>
${row.dbl && molCm(row.mw) ? '<div class="mp-hint">С шириной молдинга отступ внутренней рамки — просвет между молдингами, как на чертеже.</div>' : ''}`;
}
// Переключатель «двойная рамка» и отступ внутренней рамки
function molDblHtml(onchange, f, path) {
return `<label class="mp-check mp-ce-light"><input type="checkbox" ${f.dbl ? 'checked' : ''} onchange="${onchange}"><span>Двойная рамка — внутри вторая рамка с отступом</span></label>
${f.dbl ? `<div class="mp-dims mp-dims-2" style="margin-top:6px;"><label>Отступ внутренней рамки, м${mIn(path, f.ind, MOL_IND_DEF)}</label><span></span><span></span></div>` : ''}`;
}
function molDbl(kind, i, on) {
const d = molEnsure();
const f = d[kind][i];
if (!f) return;
f.dbl = !!on;
if (on && !mNum(f.ind)) f.ind = MOL_IND_DEF;
saveMeasureDraft();
renderMeasure();
if (on) focusMeasurePath(`molding.${kind}.${i}.ind`);
}

// Конверты на обрывах плинтуса: плинтус зарезан на 45° и уходит в пол
function molEnvHtml(m, d) {
const env = d.plinth.env || {};
const plan = molPlinthPlan(m, molGeom(m), d.plinth);
return `<label class="mp-check mp-ce-light"><input type="checkbox" ${env.on ? 'checked' : ''} onchange="molEnvSet(this.checked)"><span>Конверты на обрывах — плинтус зарезан на 45° и уходит в пол, каждый по 1 пог. м</span></label>
${env.on && plan.ends.length ? `<div class="mp-ce-walls mp-cn-row"><span class="mp-ce-walls-label">Где конверт (остальные — заглушки):</span>${plan.ends.map(e => `<button type="button" class="mp-ce-wall${e.env ? ' on' : ''}" onclick="molEnvToggle('${e.key}')" aria-pressed="${e.env}">${escapeHtml(e.label)}</button>`).join('')}</div>` : ''}
${env.on && !plan.ends.length ? '<div class="mp-hint">Обрывов нет: плинтус идёт по всем стенам без дверей.</div>' : ''}`;
}
function molEnvSet(on) {
const d = molEnsure();
d.plinth = { ...d.plinth, env: { ...(d.plinth.env || {}), on: !!on } };
saveMeasureDraft();
renderMeasure();
}
function molEnvToggle(key) {
const d = molEnsure();
const env = { ...(d.plinth.env || {}), on: true };
const skip = new Set(Array.isArray(env.skip) ? env.skip : []);
if (skip.has(key)) skip.delete(key); else skip.add(key);
env.skip = [...skip];
d.plinth = { ...d.plinth, env };
saveMeasureDraft();
renderMeasure();
}

// обновление цифр и рисунков без перерисовки полей
function updateMoldingOutputs(r) {
const set = (id, v) => { const el = document.getElementById(id); if (el) el.innerHTML = v; };
const mo = r.mol || moldingCompute(measure);
renderMolViews(mo);
set('mpCalcMolCornice', mo.lines.cornice ? escapeHtml(mo.lines.cornice) : '');
set('mpCalcMolPlinth', mo.lines.plinth ? escapeHtml(mo.lines.plinth) : '');
set('mpCalcMolCeil', [mo.lines.ceil, mo.lines.ceilBad].filter(Boolean).map(escapeHtml).join('<br>'));
set('mpCalcMolWall', [mo.lines.wall, mo.lines.wallProf, mo.lines.wallBad].filter(Boolean).map(escapeHtml).join('<br>'));
{ const box = document.getElementById('mpCalcMolBuy'), open = box && box.querySelector('details[open]'); set('mpCalcMolBuy', molBuyHtml(molCutPlan(molPieces(measure)))); if (open && box) { const d = box.querySelector('details'); if (d) d.open = true; } }
mo.ceil.forEach(f => set('mpMolCeilRes' + f.fi, f.poly ? `= ${mFmt(f.len)}` : ''));
molGet(measure).wall.forEach((row, ri) => {
let len = 0;
molWallLens(measure).forEach((L, wi) => {
if (!(L > 0)) return;
const lay = molWallLayout(measure, wi);
lay.frames.filter(f => f.ri === ri).forEach(f => { len += molFrameLen(f); });
lay.lines.filter(l => l.ri === ri).forEach(l => { len += minLen(l.x1 - l.x0); });
});
set('mpMolRowRes' + ri, len > 0 ? `${mFmt(len)} пог. м` : '');
});
}

function molSet(kind, on) {
const d = molEnsure();
d[kind] = { ...d[kind], on: !!on };
saveMeasureDraft();
renderMeasure();
}
function molWallToggle(kind, wi) {
const d = molEnsure();
const ws = molWalls(d[kind].walls, measure);
const set = new Set(ws);
if (set.has(wi)) set.delete(wi); else set.add(wi);
d[kind] = { ...d[kind], walls: [...set].sort((a, b) => a - b) };
saveMeasureDraft();
renderMeasure();
}
function molAllWalls(kind) {
const d = molEnsure();
const all = molWalls(null, measure);
const cur = molWalls(d[kind].walls, measure);
d[kind] = { ...d[kind], walls: cur.length === all.length ? [] : null };
saveMeasureDraft();
renderMeasure();
}
function molAddCeil() {
const d = molEnsure();
const prev = d.ceil[d.ceil.length - 1];
// следующая рамка — на 0,2 м дальше от стен
const pd = prev ? mNum(prev.d) : 0;
d.ceil.push({ d: pd > 0 ? String(Math.round((pd + 0.2) * 100) / 100).replace('.', ',') : '' });
saveMeasureDraft();
renderMeasure();
focusMeasurePath(`molding.ceil.${d.ceil.length - 1}.d`);
}
function molAddRow(type) {
const d = molEnsure();
const prev = [...d.wall].reverse().find(r => r.type === type);
d.wall.push(type === 'line'
? { type, walls: prev ? prev.walls : [molElevWall], y: prev ? prev.y : '' }
: type === 'frame'
? { type, walls: [molElevWall], x: '', w: '', yb: prev ? prev.yb : '', yt: prev ? prev.yt : '', dbl: prev ? !!prev.dbl : false, ind: prev ? prev.ind || '' : '', indY: prev ? prev.indY || '' : '' }
: { type, walls: prev ? prev.walls : [molElevWall], yb: prev ? prev.yb : '', yt: prev ? prev.yt : '', gap: prev ? prev.gap : '', fw: prev ? prev.fw : '', dbl: prev ? !!prev.dbl : false, ind: prev ? prev.ind || '' : '' });
saveMeasureDraft();
renderMeasure();
focusMeasurePath(`molding.wall.${d.wall.length - 1}.${type === 'line' ? 'y' : type === 'frame' ? 'x' : 'yb'}`);
}
function molRowType(i) {
const d = molEnsure();
const row = d.wall[i];
if (!row) return;
row.type = row.type === 'frames' || !row.type ? 'line' : row.type === 'line' ? 'frame' : 'frames'; // ряд рамок → линия → рамка по размерам
saveMeasureDraft();
renderMeasure();
}
function molRowWall(i, wi) {
const d = molEnsure();
const row = d.wall[i];
if (!row) return;
const set = new Set(molWalls(row.walls, measure));
if (set.has(wi)) set.delete(wi); else set.add(wi);
row.walls = [...set].sort((a, b) => a - b);
molElevWall = wi;
saveMeasureDraft();
renderMeasure();
}
function molRowAll(i) {
const d = molEnsure();
const row = d.wall[i];
if (!row) return;
const all = molWalls(null, measure);
row.walls = molWalls(row.walls, measure).length === all.length ? [] : null;
saveMeasureDraft();
renderMeasure();
}
function molRemove(kind, i) {
const d = molEnsure();
d[kind].splice(i, 1);
saveMeasureDraft();
renderMeasure();
}
function molStep(dir) {
const n = (measure.walls || []).length;
if (!n) return;
molElevWall = (molElevWall + dir + n) % n;
molViews.elev = { z: 1, x: 0, y: 0 };
renderMeasure();
}
function molShowWall(wi) {
molElevWall = wi;
molViews.elev = { z: 1, x: 0, y: 0 };
renderMeasure();
const el = document.getElementById('mpMolElev');
if (el) el.scrollIntoView({ block: 'center' });
}
/* приближение, перемещение и весь экран для плана и развёртки — как на «Углах» */
const molViews = { plan: { z: 1, x: 0, y: 0 }, elev: { z: 1, x: 0, y: 0 } };
let molFull = null, molDragged = false;
function molSize(box, which) {
const base = which === 'plan' ? 230 : 240;
if (molFull === which && box && box.clientWidth > 0 && box.clientHeight > 0) return { W: 340, H: Math.round(340 * box.clientHeight / box.clientWidth) };
return { W: 340, H: base };
}
function renderMolViews(mo) {
if (!measure) return;
mo = mo || moldingCompute(measure);
[['plan', 'mpMolPlan'], ['elev', 'mpMolElev']].forEach(([which, id]) => {
const box = document.getElementById(id);
if (!box) return;
const { W, H } = molSize(box, which);
const vw = molViews[which];
const svg = which === 'plan' ? molPlanSvg(measure, mo, W, H, vw) : molElevSvg(measure, molElevWall, W, H, vw);
// без чертежа (нет стен или высоты) — только подсказка, без кнопок
if (!svg.startsWith('<svg')) { box.innerHTML = svg; return; }
const moved = Math.abs(vw.z - 1) > 0.01 || Math.abs(vw.x) > 1 || Math.abs(vw.y) > 1;
const full = molFull === which;
box.innerHTML = `${svg}<div class="rl-zoom cp-zoom">
<button type="button" onclick="molZoom('${which}', 1.6)" aria-label="Приблизить">+</button>
<button type="button" onclick="molZoom('${which}', 1 / 1.6)" aria-label="Отдалить">−</button>
${moved ? `<button type="button" onclick="molReset('${which}')" aria-label="Весь чертёж">⤢</button>` : ''}
<button type="button" onclick="molToggleFull('${which}')" aria-label="${full ? 'Закрыть' : 'Во весь экран'}">${full ? '✕' : '⛶'}</button>
</div>${full && which === 'elev' ? `<div class="cp-caption">Стена ${molElevWall + 1} <button type="button" class="cn-cap-btn" onclick="molStep(-1)">‹</button><button type="button" class="cn-cap-btn" onclick="molStep(1)">›</button></div>` : ''}`;
bindPanZoom(box, () => molViews[which], () => renderMolViews(), v => { molDragged = v; }, f => molZoom(which, f));
});
}
function molZoom(which, f) { const v = molViews[which]; v.z = Math.min(8, Math.max(0.5, v.z * f)); renderMolViews(); }
function molReset(which) { molViews[which] = { z: 1, x: 0, y: 0 }; renderMolViews(); }
function molToggleFull(which) {
molFull = molFull === which ? null : which;
document.body.classList.toggle('cp-full-open', !!molFull);
['plan', 'elev'].forEach(w => { const b = document.getElementById(w === 'plan' ? 'mpMolPlan' : 'mpMolElev'); if (b) b.classList.toggle('full', molFull === w); });
renderMolViews();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && molFull) molToggleFull(molFull); });
window.addEventListener('resize', () => { if (molFull) renderMolViews(); });
// касание стены на плане — её развёртка; после перетаскивания не срабатывает
function molTapWall(i) {
if (molDragged) { molDragged = false; return; }
if (molFull === 'plan') molToggleFull('plan');
molShowWall(i);
}

function setMolPick(p) { measureMolPick = p; updateMeasureOutputs(); }

// номера стен в лепнине после перестройки стен: map[старый] = новый (или -1)
function remapMoldingWalls(m, map) {
if (!m || !m.molding) return;
const fix = ws => Array.isArray(ws) ? [...new Set(ws.map(i => map[i]).filter(i => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b) : ws;
['cornice', 'plinth'].forEach(k => { if (m.molding[k]) m.molding[k].walls = fix(m.molding[k].walls); });
(m.molding.wall || []).forEach(row => { row.walls = fix(row.walls); });
}
