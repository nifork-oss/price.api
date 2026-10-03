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

/* ---------- расчёт ---------- */
function computeMeasure(m) {
const r = { lines: {} };
const H = mNum(m.height);
// У стены может быть своя высота (мансарда, перегородка не до потолка);
// не указана — берётся общая высота помещения.
const wh = Array.isArray(m.wallHeights) ? m.wallHeights : [];
const wallList = m.walls.map((w, i) => ({ l: mNum(w), h: mNum(wh[i]) })).filter(w => w.l > 0);
const perim = wallList.reduce((a, w) => a + w.l, 0);
r.perimeter = perim;
const common = wallList.filter(w => !w.h);
const own = wallList.filter(w => w.h);
r.wallsGross = (H > 0 ? common.reduce((a, w) => a + w.l, 0) * H : 0) + own.reduce((a, w) => a + w.l * w.h, 0);
const partsText = [];
if (common.length && H > 0) partsText.push(common.length > 1 ? `(${common.map(w => mFmt(w.l)).join(' + ')}) × ${mFmt(H)}` : `${mFmt(common[0].l)} × ${mFmt(H)}`);
own.forEach(w => partsText.push(`${mFmt(w.l)} × ${mFmt(w.h)}`));
if (partsText.length && (!common.length || H > 0)) {
r.lines.walls = `Стены: ${partsText.join(' + ')} = ${mFmt(r.wallsGross)} м²`;
} else if (wallList.length) {
r.lines.walls = `Периметр: ${wallList.map(w => mFmt(w.l)).join(' + ')} = ${mFmt(perim)} м · укажите высоту стен`;
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
if (r.wallsGross > 0 && r.openingsArea > 0) {
r.lines.net = `Стены без проёмов: ${mFmt(r.wallsGross)} − ${mFmt(r.openingsArea)} = ${mFmt(r.wallsNet)} м²`;
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
const wallsBase = r.openingsArea > 0 ? r.wallsNet : r.wallsGross;
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

const nar = m.narrow.map(mNum).filter(v => v > 0);
r.narrow = nar.reduce((a, v) => a + minLen(v), 0);
const narHasMin = nar.some(v => v < 1);
if (nar.length) r.lines.narrow = `Узкие поверхности: ${nar.map(fmtMin).join(' + ')} = ${mFmt(r.narrow)} пог. м${narHasMin ? MIN_NOTE : ''}`;
return r;
}

// Что вставлять из текущей вкладки
function measureValueForTab(r, tab) {
if (tab === 'walls') {
const v = r.openingsArea > 0 ? r.wallsNet : r.wallsGross;
return { value: v, unit: 'м²', label: r.openingsArea > 0 ? 'Стены без проёмов' : 'Площадь стен',
text: [r.lines.walls, r.lines.openings, r.lines.net].filter(Boolean).join('\n') };
}
if (tab === 'parts') return { value: r.parts, unit: 'м²', label: 'Участки стен', text: r.lines.parts || '' };
if (tab === 'wallsMinus') {
return { value: r.parts > 0 ? r.wallsMinusParts : 0, unit: 'м²', label: 'Стены без участков',
text: [r.lines.walls, r.lines.openings, r.lines.net, r.lines.parts, r.lines.wallsMinusParts].filter(Boolean).join('\n') };
}
if (tab === 'ceiling') return { value: r.ceiling, unit: 'м²', label: 'Потолок', text: r.lines.ceiling || '' };
if (tab === 'slopes') return { value: r.slopesLen, unit: 'пог. м', label: 'Откосы', text: r.lines.slopesLen || '' };
if (tab === 'narrow') return { value: r.narrow, unit: 'пог. м', label: 'Узкие поверхности', text: r.lines.narrow || '' };
return { value: 0, unit: '', label: '', text: '' };
}

/* ---------- черновик замера ---------- */
function measureDraftKey() { return 'measureDraft:' + (currentUser || ''); }
function saveMeasureDraft() {
measureDirty = true;
if (measureTarget.kind === 'room') return;
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
</section>`;
} else if (measureTab === 'slopes') {
const valid = m.openings.map((o, i) => ({ o, i })).filter(({ o }) => mNum(o.w) > 0 && mNum(o.h) > 0);
if (!valid.length) {
html += `<section class="mp-sec"><div class="mp-empty">Откосы считаются по окнам и дверям.<br>Сначала добавьте их на вкладке «Стены».</div>
<button type="button" class="mp-link-btn" onclick="setMeasureTab('walls')">← К окнам и дверям</button></section>`;
} else {
html += `<section class="mp-sec">
<div class="mp-sec-title">Какие проёмы с откосами</div>
<div class="mp-hint">Каждый откос отдельно: левый + правый + верх. Откос короче метра считается за 1 пог. м.</div>
${valid.map(({ o, i }) => `<label class="mp-check"><input type="checkbox" ${o.slopes !== false ? 'checked' : ''} onchange="setOpeningSlopes(${i}, this.checked)">
<span>${o.type === 'door' ? 'Дверь' : 'Окно'} ширина ${mFmt(mNum(o.w))}, высота ${mFmt(mNum(o.h))}${mCount(o.n) !== 1 ? `, ${mFmt(mCount(o.n))} шт.` : ''}<br>
откосы: ${slopeSidesText(mNum(o.h), mNum(o.w))}${mCount(o.n) !== 1 ? ` × ${mFmt(mCount(o.n))}` : ''} = <b>${mFmt((2 * minLen(mNum(o.h)) + minLen(mNum(o.w))) * mCount(o.n))} пог. м</b></span></label>`).join('')}
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
set('mpCalcWalls', r.lines.walls ? escapeHtml(r.lines.walls) : '');
set('mpCalcOpenings', [r.lines.openings, r.lines.net].filter(Boolean).map(escapeHtml).join('<br>'));
set('mpCalcCeiling', r.lines.ceiling ? escapeHtml(r.lines.ceiling) : '');
set('mpCeilAuto', r.ceilingAuto
? `Комната сошлась — площадь потолка посчитана по контуру стен: <b>${mFmt(r.ceiling)} м²</b>. Если потолок сложный (короба, уровни), введите участки ниже — тогда посчитается по ним.`
: '');
set('mpCalcParts', [r.lines.parts, r.lines.wallsMinusParts].filter(Boolean).map(escapeHtml).join('<br>'));
(measure.parts || []).forEach((pt, i) => {
const l = mNum(pt.l), h = mNum(pt.h);
set('mpPartArea' + i, l && h ? `${mFmt(l * h)} м²` : '');
});
set('mpCalcSlopes', r.lines.slopesLen ? escapeHtml(r.lines.slopesLen) : '');
set('mpCalcNarrow', r.lines.narrow ? escapeHtml(r.lines.narrow) : '');
measure.openings.forEach((o, i) => {
const w = mNum(o.w), h = mNum(o.h), n = mCount(o.n);
set('mpOpenArea' + i, w && h && n ? `${mFmt(w * h * n)} м²` : '');
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
const effTab = measureTab === 'walls' ? measureWallsPick : measureTab;
const v = measureValueForTab(r, effTab);
let main = '', sub = '', pick = '';
if (measureTab === 'walls' && r.parts > 0 && measureTarget.kind !== 'room') {
const opt = (key, label, val) => `<button type="button" class="${measureWallsPick === key ? 'active' : ''}" onclick="setWallsPick('${key}')">${label}<br><b>${mFmt(val)}</b></button>`;
pick = `<div class="mp-pick">${opt('walls', 'Стены', r.openingsArea > 0 ? r.wallsNet : r.wallsGross)}${opt('parts', 'Участки', r.parts)}${opt('wallsMinus', 'Стены − участки', r.wallsMinusParts)}</div>`;
} else if (measureTab === 'walls') {
sub = r.openingsArea > 0 ? `Стены ${mFmt(r.wallsGross)} − проёмы ${mFmt(r.openingsArea)} м²` : (r.perimeter ? `Периметр ${mFmt(r.perimeter)} м` : 'Введите высоту и длину стен');
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

function setMeasureTab(tab) {
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
if (kind === 'walls' && Array.isArray(measure.wallHeights)) measure.wallHeights.splice(i, 1);
if (kind !== 'openings' && kind !== 'parts' && measure[kind].length === 0) measure[kind].push(kind === 'ceiling' ? { l: '', w: '' } : '');
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
return [r.lines.walls, r.lines.openings, r.lines.net, r.lines.parts, r.lines.wallsMinusParts, r.lines.ceiling, r.lines.slopesLen, r.lines.narrow].filter(Boolean);
}

function measurePills(m) {
const r = computeMeasure(m);
const p = [];
if (r.wallsGross > 0) p.push(`Стены ${mFmt(r.openingsArea > 0 ? r.wallsNet : r.wallsGross)} м²`);
if (r.parts > 0) p.push(`Участки ${mFmt(r.parts)} м²`);
if (r.ceiling > 0) p.push(`Потолок ${mFmt(r.ceiling)} м²`);
if (r.slopesLen > 0) p.push(`Откосы ${mFmt(r.slopesLen)} пог. м`);
if (r.narrow > 0) p.push(`Узкие ${mFmt(r.narrow)} пог. м`);
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
const effTab = measureTab === 'walls' && r.parts > 0 ? measureWallsPick : measureTab;
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
