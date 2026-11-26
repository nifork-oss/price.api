// Кабинет мастера — учёт выполненных работ по объекту: таймер или время вручную, сумма, статистика заработка.
// У объекта — вкладка «Работы» (рядом со «Счета», «Расчёты», «Закупки»): что сделано (из прайса или своё), сколько,
// сколько времени ушло и на какую сумму (цена × количество, можно поправить). Статистика за период: заработано,
// часы, заработок в час, выработка (сколько м² / пог. м в час) и сравнение со сметой/счётом объекта.
// По всем объектам — кнопка «📈 Работы и заработок» над списком объектов.
// Хранится в объекте: obj.works = [{ id, date: 'ГГГГ-ММ-ДД', name, unit, qty, price, sum, min, note }]
// (sum пусто — считается price × qty; min — минуты), obj.workTimer = { start } — идущий таймер (виден на всех устройствах).
// Подключается из calc.html после calc-purchases.js.

const WORK_UNITS = ['м²', 'пог. м', 'шт.', 'компл.', 'час', 'усл.'];
const WORK_PERIODS = { today: 'Сегодня', week: '7 дней', month: 'Этот месяц', prev: 'Прошлый месяц', all: 'Всё время' };
let workForm = null;          // правка одной записи: { id, date, name, unit, qty, price, sum, min, note }
let workDraft = null;         // новые записи списком, как в закупках: { date, rows: [{ name, qty, unit, price, sum, min }], min — общее время }
let workPeriod = 'month';     // период статистики
let workTick = 0;             // таймер на экране

const workNum = v => { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : 0; };
const workRub = n => (Math.round(n * 100) / 100).toLocaleString('ru-RU') + ' ₽';
const workQty = n => (Math.round(n * 100) / 100).toLocaleString('ru-RU');
const workDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function workList(obj) { return Array.isArray(obj && obj.works) ? obj.works : []; }
// сумма записи: вписанная вручную или цена × количество
function workSum(w) { return w.sum !== '' && w.sum != null && workNum(w.sum) ? workNum(w.sum) : Math.round(workNum(w.price) * workNum(w.qty) * 100) / 100; }
function workTime(min) {
const m = Math.round(Number(min) || 0);
if (!m) return '—';
const h = Math.floor(m / 60), r = m % 60;
return h ? `${h} ч${r ? ' ' + r + ' мин' : ''}` : `${r} мин`;
}
// «1:30», «1,5», «90м», «2ч 15м», «45» (минуты) → минуты
function workParseTime(s) {
const t = String(s || '').trim().toLowerCase().replace(',', '.');
if (!t) return 0;
let m = /^(\d+):(\d{1,2})$/.exec(t);
if (m) return Number(m[1]) * 60 + Number(m[2]);
m = /^(?:(\d+(?:\.\d+)?)\s*ч)?\s*(?:(\d+)\s*м(?:ин)?)?$/.exec(t);
if (m && (m[1] || m[2])) return Math.round(Number(m[1] || 0) * 60 + Number(m[2] || 0));
const n = Number(t);
if (!Number.isFinite(n) || n <= 0) return 0;
return /\./.test(t) || n < 10 ? Math.round(n * 60) : Math.round(n); // «1.5» и «3» — часы, «45» — минуты
}
function workPriceOf(name) {
const s = (cloudData.services || []).find(x => x && !x.isCategory && String(x.name).toLowerCase() === String(name || '').trim().toLowerCase());
return s ? { price: Number(s.price) || 0, unit: s.unit || '' } : null;
}
// границы периода [from, to] — строки дат, включительно
function workRange(period) {
const now = new Date(), day = workDay(now);
if (period === 'today') return [day, day];
if (period === 'week') { const d = new Date(now); d.setDate(d.getDate() - 6); return [workDay(d), day]; }
if (period === 'month') return [workDay(new Date(now.getFullYear(), now.getMonth(), 1)), day];
if (period === 'prev') return [workDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)), workDay(new Date(now.getFullYear(), now.getMonth(), 0))];
return ['0000-00-00', '9999-12-31'];
}
function workInPeriod(list, period) { const [a, b] = workRange(period); return list.filter(w => w.date >= a && w.date <= b); }

/* ---------- статистика: итоги, заработок в час, выработка по видам работ ---------- */
function workStats(list) {
const total = list.reduce((a, w) => a + workSum(w), 0), min = list.reduce((a, w) => a + (Number(w.min) || 0), 0);
// заработок в час — только по записям, где указано время (иначе работа без времени завышала бы ставку)
const timed = list.filter(w => Number(w.min) > 0), tSum = timed.reduce((a, w) => a + workSum(w), 0), tMin = timed.reduce((a, w) => a + Number(w.min), 0);
const by = new Map();
list.forEach(w => {
const k = (w.name || 'Без названия') + '|' + (w.unit || '');
const r = by.get(k) || { name: w.name || 'Без названия', unit: w.unit || '', qty: 0, sum: 0, min: 0, tQty: 0, tSum: 0 };
r.qty += workNum(w.qty); r.sum += workSum(w);
if (Number(w.min) > 0) { r.min += Number(w.min); r.tQty += workNum(w.qty); r.tSum += workSum(w); }
by.set(k, r);
});
return { total, min, perHour: tMin ? tSum / (tMin / 60) : 0, rows: [...by.values()].sort((a, b) => b.sum - a.sum) };
}
function workStatsHtml(list, title) {
const st = workStats(list);
if (!list.length) return `<div class="work-empty">${title ? escapeHtml(title) + ': ' : ''}за этот период записей нет.</div>`;
return `<div class="work-totals">
<div><span>Заработано</span><b>${workRub(st.total)}</b></div>
<div><span>Время</span><b>${workTime(st.min)}</b></div>
<div><span>В час</span><b>${st.perHour ? workRub(Math.round(st.perHour)) : '—'}</b></div>
</div>
<table class="work-table"><tr><th>Работа</th><th>Сделано</th><th>Выработка</th><th>В час</th><th>Сумма</th></tr>
${st.rows.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${workQty(r.qty)} ${escapeHtml(r.unit)}${r.min ? `<small>${workTime(r.min)}</small>` : ''}</td>
<td>${r.min && r.tQty ? `${workQty(r.tQty / (r.min / 60))} ${escapeHtml(r.unit)}/ч` : '—'}</td><td>${r.min ? workRub(Math.round(r.tSum / (r.min / 60))) : '—'}</td><td>${workRub(r.sum)}</td></tr>`).join('')}
</table>`;
}
function workPeriodChips(onclickFn) {
return `<div class="chips work-periods">${Object.entries(WORK_PERIODS).map(([k, l]) => `<button type="button" class="chip${workPeriod === k ? ' active' : ''}" onclick="${onclickFn}('${k}')">${l}</button>`).join('')}</div>`;
}

/* ---------- сравнение со сметой: сколько из счетов (а нет счетов — из расчётов) объекта уже сделано ---------- */
function workCompare(obj) {
const docs = (cloudData.history || []).filter(r => r && r.objectId === obj.id);
const inv = docs.filter(r => r.docType !== 'estimate'), src = inv.length ? inv : docs.filter(r => r.docType === 'estimate');
if (!src.length) return null;
const plan = new Map();
src.forEach(r => (r.items || []).forEach(it => {
if (!it || !it.name) return;
const k = String(it.name).trim().toLowerCase() + '|' + (it.unit || '');
const p = plan.get(k) || { name: it.name, unit: it.unit || '', qty: 0, sum: 0 };
p.qty += Number(it.qty) || 0; p.sum += (Number(it.qty) || 0) * (Number(it.price) || 0);
plan.set(k, p);
}));
const done = new Map();
workList(obj).forEach(w => { const k = String(w.name || '').trim().toLowerCase() + '|' + (w.unit || ''); const d = done.get(k) || { qty: 0, sum: 0 }; d.qty += workNum(w.qty); d.sum += workSum(w); done.set(k, d); });
const rows = [...plan.entries()].map(([k, p]) => ({ ...p, done: done.get(k) || { qty: 0, sum: 0 } }));
const planSum = rows.reduce((a, r) => a + r.sum, 0), doneSum = rows.reduce((a, r) => a + Math.min(r.done.sum, r.sum || r.done.sum), 0);
return { kind: inv.length ? 'по счетам' : 'по расчётам', rows, planSum, doneSum };
}
function workCompareHtml(obj) {
const c = workCompare(obj);
if (!c) return '<div class="work-empty">У объекта пока нет счетов и расчётов — сравнивать не с чем.</div>';
const pct = c.planSum ? Math.min(100, Math.round(c.doneSum / c.planSum * 100)) : 0;
return `<div class="work-progress"><div><span>Выполнено ${escapeHtml(c.kind)}</span><b>${pct}%</b></div><i><u style="width:${pct}%"></u></i>
<small>${workRub(c.doneSum)} из ${workRub(c.planSum)} · осталось ${workRub(Math.max(0, c.planSum - c.doneSum))}</small></div>
<table class="work-table"><tr><th>Работа</th><th>По смете</th><th>Сделано</th><th>Осталось</th></tr>
${c.rows.map(r => { const left = Math.max(0, r.qty - r.done.qty); return `<tr${r.done.qty >= r.qty && r.qty ? ' class="done"' : ''}><td>${escapeHtml(r.name)}</td><td>${workQty(r.qty)} ${escapeHtml(r.unit)}</td><td>${workQty(r.done.qty)}</td><td>${left ? workQty(left) : '✓'}</td></tr>`; }).join('')}
</table>
<div class="work-hint">Сравнение — по названию работы и единице: записывайте работу так же, как она названа в счёте.</div>`;
}

/* ---------- запись списком, как закупки: «Шпаклёвка стен 12 м² 1:30» → работа, количество, единица, время ---------- */
const WORK_UNIT_ALIASES = [[/^(м²|м2|кв\.?\s?м\.?|квм)$/i, 'м²'], [/^(пог\.?\s?м\.?|п\.?\s?м\.?|м\.?\s?п\.?|пм|мп)$/i, 'пог. м'], [/^шт\.?$/i, 'шт.'], [/^компл\.?$/i, 'компл.'], [/^усл\.?$/i, 'усл.']];
function workUnitOf(u) { const t = String(u || '').trim(); const hit = WORK_UNIT_ALIASES.find(([re]) => re.test(t)); return hit ? hit[1] : t.slice(0, 10); }
// работа из прайса: точное название, иначе — самое длинное название прайса внутри строки (или строка внутри него)
function workServiceFor(name) {
const low = String(name || '').trim().toLowerCase();
if (low.length < 3) return null;
const list = (cloudData.services || []).filter(x => x && !x.isCategory && x.name);
return list.find(x => x.name.toLowerCase() === low)
|| list.filter(x => low.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(low)).sort((a, b) => b.name.length - a.name.length)[0] || null;
}
function workParseLine(text) {
let t = ' ' + String(text || '').replace(/\s+/g, ' ').trim().replace(/^(?:[-•*]\s*|\d+[.)]\s+)/, '') + ' ';
if (!t.trim()) return null;
// время в строке: «1:30», «2 ч», «1,5 часа», «40 мин», «2ч 15мин»
let min = 0;
t = t.replace(/[\s,;](\d{1,2}):(\d{2})(?=[\s,;])/, (m, h, mm) => { min += Number(h) * 60 + Number(mm); return ' '; });
t = t.replace(/[\s,;](\d+(?:[.,]\d+)?)\s*(?:ч|час|часа|часов)\.?(?=[\s,;])/i, (m, h) => { min += Math.round(Number(h.replace(',', '.')) * 60); return ' '; });
t = t.replace(/[\s,;](\d+)\s*(?:мин|минут|минуты)\.?(?=[\s,;])/i, (m, mm) => { min += Number(mm); return ' '; });
t = t.replace(/\s+/g, ' ').trim().replace(/[\s,;:—–-]+$/, '');
if (!t) return null;
const m = /^(.*?)[\s,;:—–-]+(\d+(?:[.,]\d+)?)\s*([^\d\s][^\d]{0,9})?$/.exec(t);
let name = t, qty = '', unit = '';
if (m && m[1].trim()) { name = m[1].trim(); qty = m[2].replace(',', '.'); unit = workUnitOf(m[3] || ''); }
const srv = workServiceFor(name);
return { name: name.slice(0, 120), qty, unit: unit || (srv && srv.unit) || 'м²', price: srv ? Number(srv.price) || '' : '', sum: '', min };
}
// общее время — работам списка без своего времени: по долям сумм (нет сумм — поровну); итог сходится до минуты
function workShareTime(rows, total) {
const free = rows.filter(r => !(Number(r.min) > 0));
if (!(total > 0) || !free.length) return rows;
const sums = free.map(r => workSum(r)), all = sums.reduce((a, v) => a + v, 0);
let left = Math.round(total);
free.forEach((r, i) => {
const part = i === free.length - 1 ? left : Math.round(total * (all ? sums[i] / all : 1 / free.length));
r.min = Math.max(0, Math.min(left, part)); r.shared = true; left -= r.min;
});
return rows;
}
function workDraftOpen(min) {
workForm = null;
workDraft = { date: workDay(), rows: [], min: min || 0 };
renderObjectDetail();
const el = document.getElementById('workAdd'); if (el) el.focus();
}
function workDraftClose() {
if (workDraft && workDraft.rows.length && !confirm('Убрать несохранённый список работ?')) return;
workDraft = null; renderObjectDetail();
}
function workDraftAdd() {
const inp = document.getElementById('workAdd');
if (!workDraft || !inp) return;
const rows = String(inp.value || '').split('\n').map(workParseLine).filter(Boolean);
if (!rows.length) return;
workDraft.rows.push(...rows);
renderObjectDetail();
const again = document.getElementById('workAdd'); if (again) again.focus();
}
function workDraftSumHint(i) {
const r = workDraft && workDraft.rows[i], el = document.querySelector(`.work-drow[data-i="${i}"] .work-dsum`);
if (r && el) el.placeholder = r.price !== '' && workNum(r.qty) ? workQty(workNum(r.price) * workNum(r.qty)) + ' ₽' : 'сумма';
}
function workDraftSet(i, k, v) {
const r = workDraft && workDraft.rows[i];
if (!r) return;
r[k] = v;
if (k === 'name') {
const srv = workServiceFor(v);
if (srv) { r.price = Number(srv.price) || ''; if (srv.unit) { r.unit = srv.unit; const s = document.querySelector(`.work-drow[data-i="${i}"] .work-dunit`); if (s && [...s.options].some(o => o.value === srv.unit)) s.value = srv.unit; } }
}
workDraftSumHint(i);
}
function workDraftDel(i) { if (workDraft) { workDraft.rows.splice(i, 1); renderObjectDetail(); } }
function workDraftPaste(e) { // вставили несколько строк — сразу в список
const txt = e.clipboardData && e.clipboardData.getData('text');
if (!txt || !/\n/.test(txt.trim())) return;
e.preventDefault();
e.target.value = (e.target.value ? e.target.value + '\n' : '') + txt;
workDraftAdd();
}
function workDraftHtml() {
const d = workDraft, tm = m => (m ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : '');
const names = (cloudData.services || []).filter(s => s && !s.isCategory && s.name).map(s => s.name);
const own = d.rows.filter(r => Number(r.min) > 0).length;
return `<div class="work-form work-draft">
<datalist id="workNames">${names.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
<label class="work-draft-date">Работы за <input type="date" value="${escapeHtml(d.date)}" onchange="workDraft.date = this.value"></label>
${d.rows.map((r, i) => `<div class="work-drow" data-i="${i}">
<input class="work-dname" type="text" list="workNames" maxlength="120" value="${escapeHtml(r.name)}" oninput="workDraftSet(${i}, 'name', this.value)" aria-label="Работа">
<input class="work-dqty" type="text" inputmode="decimal" placeholder="кол-во" value="${escapeHtml(String(r.qty ?? ''))}" oninput="workDraftSet(${i}, 'qty', this.value)" aria-label="Сделано">
<select class="work-dunit" onchange="workDraftSet(${i}, 'unit', this.value)" aria-label="Единица">${[...new Set([r.unit, ...WORK_UNITS])].filter(Boolean).map(u => `<option ${u === r.unit ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}</select>
<input class="work-dtime" type="text" placeholder="своё время" value="${tm(Number(r.min) || 0)}" onchange="workDraftSet(${i}, 'min', workParseTime(this.value))" aria-label="Своё время на эту работу">
<input class="work-dsum" type="text" inputmode="decimal" placeholder="${r.price !== '' && workNum(r.qty) ? workQty(workNum(r.price) * workNum(r.qty)) + ' ₽' : 'сумма'}" value="${escapeHtml(String(r.sum ?? ''))}" oninput="workDraftSet(${i}, 'sum', this.value)" aria-label="Сумма">
<button type="button" class="work-ddel" onclick="workDraftDel(${i})" aria-label="Убрать">✕</button>
</div>`).join('')}
<div class="purchase-add">
<textarea id="workAdd" rows="1" placeholder="Работа и количество: Шпаклёвка стен 12 м²" onkeydown="if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); workDraftAdd(); }" onpaste="workDraftPaste(event)"></textarea>
<button type="button" class="hc-btn" onclick="workDraftAdd()">Добавить</button>
</div>
<div class="work-hint">Enter — добавить работу. Можно вставить сразу несколько строк — каждая станет отдельной работой. Цена и единица — из прайса. Своё время можно дописать в строку: «Шпаклёвка стен 12 м² 1:30» или «… 2 ч».</div>
<label class="work-draft-time">${own && own === d.rows.length ? 'Общее время (у всех работ уже есть своё)' : own ? 'Общее время на работы без своего времени' : 'Общее время на все эти работы'}<input id="workDraftMin" type="text" placeholder="например 6:30" value="${tm(Number(d.min) || 0)}" onchange="workDraft.min = workParseTime(this.value)"></label>
<div class="work-hint">Общее время делится между работами по их суммам — так виден заработок в час по каждой.</div>
<div class="work-form-btns"><button type="button" class="btn btn-primary" onclick="workDraftSave()">Сохранить${d.rows.length ? ' (' + d.rows.length + ')' : ''}</button><button type="button" class="hc-btn" onclick="workDraftClose()">Отмена</button></div>
</div>`;
}
// черновик → записи obj.works (общее время уже разложено по работам)
function workDraftRecords(d, at) {
const date = /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') ? d.date : workDay();
const recs = d.rows.filter(r => String(r.name || '').trim()).map((r, i) => ({
id: 'w' + at.toString(36) + i + Math.random().toString(36).slice(2, 5), at: at + i, date, name: String(r.name).trim().slice(0, 120), unit: r.unit || '',
qty: workNum(r.qty) || '', price: r.price === '' ? '' : workNum(r.price), sum: String(r.sum ?? '').trim() === '' ? '' : workNum(r.sum),
min: Math.max(0, Math.round(Number(r.min) || 0)), note: ''
}));
workShareTime(recs, Number(d.min) || 0);
recs.forEach(w => { if (!w.shared) delete w.shared; });
return recs;
}
async function workDraftSave() {
const obj = workObj(), d = workDraft;
if (!obj || !d) return;
const inp = document.getElementById('workAdd');
if (inp && inp.value.trim()) workDraftAdd(); // недобавленная строка в поле — тоже в список
const mi = document.getElementById('workDraftMin');
if (mi) d.min = workParseTime(mi.value);
const recs = workDraftRecords(d, Date.now());
if (!recs.length) { alert('Добавьте хотя бы одну работу'); return; }
obj.works = [...workList(obj), ...recs];
workDraft = null;
await workSave();
if (typeof showAddToast === 'function') showAddToast(`Записано работ: ${recs.length} · ${workRub(recs.reduce((a, w) => a + workSum(w), 0))}`);
}

/* ---------- вкладка «Работы» у объекта ---------- */
function workObj() { return (cloudData.objects || []).find(o => o.id === currentObjectId) || null; }
function workTabHtml(obj) {
const list = workList(obj).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || 0) - (a.at || 0));
const t = obj.workTimer && obj.workTimer.start;
const days = new Map();
list.forEach(w => { if (!days.has(w.date)) days.set(w.date, []); days.get(w.date).push(w); });
return `<div class="work-timer${t ? ' on' : ''}">
${t ? `<div class="work-clock" id="workClock">${workClock(t)}</div><div class="work-timer-sub">Таймер идёт${obj.workTimer.name ? ': ' + escapeHtml(obj.workTimer.name) : ''}</div>
<button type="button" class="btn btn-primary" onclick="workTimerStop()">⏹ Стоп и записать</button><button type="button" class="hc-btn" onclick="workTimerCancel()">Сбросить</button>`
: `<button type="button" class="btn btn-primary" onclick="workTimerStart()">▶ Запустить таймер</button><button type="button" class="hc-btn" onclick="workDraftOpen()">＋ Записать работы</button>`}
</div>
${workDraft ? workDraftHtml() : ''}
${workForm ? workFormHtml() : ''}
<h3 class="work-h">Статистика</h3>
${workPeriodChips('workSetPeriod')}
${workStatsHtml(workInPeriod(workList(obj), workPeriod))}
<details class="work-cmp"><summary>Сравнение со сметой</summary>${workCompareHtml(obj)}</details>
<h3 class="work-h">Записи${list.length ? ` (${list.length})` : ''}</h3>
${list.length ? [...days.entries()].map(([d, ws]) => `<div class="work-day"><b>${new Date(d + 'T12:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })}</b><span>${workRub(ws.reduce((a, w) => a + workSum(w), 0))}</span></div>
${ws.map(w => `<button type="button" class="work-row" onclick="workFormOpen('${w.id}')"><span class="work-row-name">${escapeHtml(w.name || 'Без названия')}<small>${w.qty ? workQty(workNum(w.qty)) + ' ' + escapeHtml(w.unit || '') : ''}${w.min ? ' · ' + workTime(w.min) : ''}${w.note ? ' · ' + escapeHtml(w.note) : ''}</small></span><b>${workRub(workSum(w))}</b></button>`).join('')}`).join('')
: '<div class="work-empty">Записей пока нет. Запустите таймер, когда начинаете работу, или запишите сделанное вручную.</div>'}`;
}
function workClock(start) {
const s = Math.max(0, Math.floor((Date.now() - start) / 1000));
return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((v, i) => (i ? String(v).padStart(2, '0') : v)).join(':');
}
function workTickStart() {
clearInterval(workTick);
workTick = setInterval(() => {
const el = document.getElementById('workClock'), obj = workObj();
if (!el || !obj || !obj.workTimer) { clearInterval(workTick); workTick = 0; return; }
el.textContent = workClock(obj.workTimer.start);
}, 1000);
}
async function workSave() { renderObjectDetail(); await saveCloudData(); }
function workSetPeriod(p) { workPeriod = p; renderObjectDetail(); }
async function workTimerStart() {
const obj = workObj();
if (!obj) return;
obj.workTimer = { start: Date.now() };
await workSave();
workTickStart();
}
async function workTimerCancel() {
const obj = workObj();
if (!obj || !confirm('Сбросить таймер без записи?')) return;
delete obj.workTimer;
await workSave();
}
async function workTimerStop() {
const obj = workObj();
if (!obj || !obj.workTimer) return;
const min = Math.max(1, Math.round((Date.now() - obj.workTimer.start) / 60000));
delete obj.workTimer;
await saveCloudData();
workDraftOpen(min); // время с таймера — общим на работы, которые сейчас впишут
}
function workFormOpen(id) {
workDraft = null;
const obj = workObj(), w = id && workList(obj).find(x => x.id === id);
workForm = w ? { ...w } : { date: workDay(), name: '', unit: 'м²', qty: '', price: '', sum: '', min: 0, note: '' };
renderObjectDetail();
const el = document.getElementById('workName'); if (el && !w) el.focus();
}
function workFormClose() { workForm = null; renderObjectDetail(); }
function workFormHtml() {
const f = workForm, names = (cloudData.services || []).filter(s => s && !s.isCategory && s.name).map(s => s.name);
const units = [...new Set([f.unit || 'м²', ...(typeof DEFAULT_UNITS !== 'undefined' ? DEFAULT_UNITS : WORK_UNITS)])];
const auto = Math.round(workNum(f.price) * workNum(f.qty) * 100) / 100;
return `<div class="work-form">
<datalist id="workNames">${names.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
<label>Работа<input id="workName" type="text" list="workNames" maxlength="120" placeholder="Из прайса или своя" value="${escapeHtml(f.name || '')}" oninput="workFormName(this.value)"></label>
<div class="work-form-row">
<label>Сделано<input id="workQty" type="text" inputmode="decimal" placeholder="0" value="${escapeHtml(String(f.qty ?? ''))}" oninput="workFormSet('qty', this.value)"></label>
<label>Ед.<select id="workUnit" onchange="workFormSet('unit', this.value)">${units.map(u => `<option ${u === f.unit ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}</select></label>
<label>Время<input id="workMin" type="text" placeholder="1:30" value="${f.min ? Math.floor(f.min / 60) + ':' + String(f.min % 60).padStart(2, '0') : ''}" onchange="workFormSet('min', workParseTime(this.value))"></label>
</div>
<div class="work-form-row">
<label>Цена за ед., ₽<input id="workPrice" type="text" inputmode="decimal" placeholder="из прайса" value="${escapeHtml(String(f.price ?? ''))}" oninput="workFormSet('price', this.value)"></label>
<label>Сумма, ₽<input id="workSum" type="text" inputmode="decimal" placeholder="${auto ? workQty(auto) : 'цена × кол-во'}" value="${escapeHtml(String(f.sum ?? ''))}" oninput="workFormSet('sum', this.value)"></label>
<label>Дата<input id="workDate" type="date" value="${escapeHtml(f.date || workDay())}" onchange="workFormSet('date', this.value)"></label>
</div>
<label>Заметка<input id="workNote" type="text" maxlength="200" placeholder="Комната, этап…" value="${escapeHtml(f.note || '')}" oninput="workFormSet('note', this.value)"></label>
<div class="work-hint">Время: «1:30», «1,5» (часы) или «45» (минуты). Сумма пустая — считается цена × количество.</div>
<div class="work-form-btns"><button type="button" class="btn btn-primary" onclick="workFormSave()">Сохранить</button><button type="button" class="hc-btn" onclick="workFormClose()">Отмена</button>
${f.id ? '<button type="button" class="hc-btn work-del" onclick="workFormDelete()">Удалить</button>' : ''}</div>
</div>`;
}
function workFormSet(k, v) {
if (!workForm) return;
workForm[k] = v;
if (k === 'qty' || k === 'price') { const s = document.getElementById('workSum'), auto = Math.round(workNum(workForm.price) * workNum(workForm.qty) * 100) / 100; if (s) s.placeholder = auto ? workQty(auto) : 'цена × кол-во'; }
}
// выбрали работу из прайса — цена (и единица, если она у услуги есть) подставляются
function workFormName(v) {
workFormSet('name', v);
const p = workPriceOf(v);
if (!p) return;
workForm.price = p.price;
const pi = document.getElementById('workPrice'); if (pi) pi.value = p.price;
if (p.unit) { workForm.unit = p.unit; const u = document.getElementById('workUnit'); if (u) u.value = p.unit; }
workFormSet('price', p.price);
}
async function workFormSave() {
const obj = workObj(), f = workForm;
if (!obj || !f) return;
const name = String(f.name || '').trim();
if (!name) { alert('Укажите работу'); return; }
const rec = { id: f.id || 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: f.at || Date.now(), date: /^\d{4}-\d{2}-\d{2}$/.test(f.date) ? f.date : workDay(),
name: name.slice(0, 120), unit: f.unit || '', qty: workNum(f.qty) || '', price: workNum(f.price) || '', sum: String(f.sum ?? '').trim() === '' ? '' : workNum(f.sum), min: Math.max(0, Math.round(Number(f.min) || 0)), note: String(f.note || '').trim().slice(0, 200) };
const list = workList(obj).filter(x => x.id !== rec.id);
obj.works = [...list, rec];
workForm = null;
await workSave();
showAddToast('Записано: ' + rec.name + ' · ' + workRub(workSum(rec)));
}
async function workFormDelete() {
const obj = workObj(), f = workForm;
if (!obj || !f || !f.id || !confirm('Удалить эту запись?')) return;
obj.works = workList(obj).filter(x => x.id !== f.id);
workForm = null;
await workSave();
}

/* ---------- по всем объектам ---------- */
let workAllPeriod = 'month';
function openWorkAll() {
if (typeof isCurrentClient === 'function' && isCurrentClient()) return;
let box = document.getElementById('workAllView');
if (!box) { box = document.createElement('div'); box.id = 'workAllView'; box.className = 'work-all'; document.body.appendChild(box); }
box.style.display = 'block';
renderWorkAll();
}
function closeWorkAll() { const box = document.getElementById('workAllView'); if (box) box.style.display = 'none'; }
function workAllSetPeriod(p) { workAllPeriod = p; renderWorkAll(); }
function renderWorkAll() {
const box = document.getElementById('workAllView');
if (!box) return;
const objs = (typeof getVisibleObjects === 'function' ? getVisibleObjects() : cloudData.objects || []).filter(o => o && workList(o).length);
const saved = workPeriod; workPeriod = workAllPeriod;
const all = objs.flatMap(o => workInPeriod(workList(o), workAllPeriod).map(w => ({ ...w, obj: o })));
const rows = objs.map(o => { const st = workStats(workInPeriod(workList(o), workAllPeriod)); return { o, st }; }).filter(x => x.st.total || x.st.min).sort((a, b) => b.st.total - a.st.total);
box.innerHTML = `<div class="work-all-in">
<div class="work-all-head"><h2>📈 Работы и заработок</h2><button type="button" class="hc-btn" onclick="closeWorkAll()" aria-label="Закрыть">✕</button></div>
${workPeriodChips('workAllSetPeriod')}
${workStatsHtml(all)}
${rows.length ? `<h3 class="work-h">По объектам</h3><table class="work-table"><tr><th>Объект</th><th>Время</th><th>В час</th><th>Сумма</th></tr>
${rows.map(({ o, st }) => `<tr><td>${escapeHtml(o.name || 'Объект')}</td><td>${workTime(st.min)}</td><td>${st.perHour ? workRub(Math.round(st.perHour)) : '—'}</td><td>${workRub(st.total)}</td></tr>`).join('')}</table>` : ''}
${objs.length ? '' : '<div class="work-empty">Пока нет записей о работах. Их ведут у объекта, во вкладке «Работы».</div>'}
</div>`;
workPeriod = saved;
}

/* ---------- виджет таймера: плашка поверх кабинета и быстрая панель (calc.html?w=timer, ярлык на иконке) ---------- */
function workQuickObjects() {
const objs = (typeof getVisibleObjects === 'function' ? getVisibleObjects() : cloudData.objects || []).filter(o => o && !o.archived);
const last = o => Math.max(o.workTimer ? o.workTimer.start : 0, ...workList(o).map(w => w.at || 0), 0);
return objs.slice().sort((a, b) => last(b) - last(a));
}
function workRunning() { return ((cloudData && cloudData.objects) || []).filter(o => o && o.workTimer && o.workTimer.start && !o.archived); }
function workQuickAllowed() { return !(typeof isCurrentClient === 'function' && isCurrentClient()) && typeof cloudData !== 'undefined' && cloudData && Array.isArray(cloudData.objects); }
function workQuickOpen() {
if (!workQuickAllowed()) return;
let box = document.getElementById('workQuick');
if (!box) { box = document.createElement('div'); box.id = 'workQuick'; box.className = 'work-all work-quick'; box.onclick = e => { if (e.target === box) workQuickClose(); }; document.body.appendChild(box); }
box.style.display = 'block';
workQuickRender();
}
function workQuickClose() { const box = document.getElementById('workQuick'); if (box) box.style.display = 'none'; workChipUpdate(); }
function workQuickRender() {
const box = document.getElementById('workQuick');
if (!box || box.style.display === 'none') return;
const run = workRunning(), all = workQuickObjects().flatMap(o => workList(o));
const today = workStats(workInPeriod(all, 'today')), week = workStats(workInPeriod(all, 'week'));
const stat = (t, st) => `<div class="work-q-stat"><span>${t}</span><b>${workRub(st.total)}</b><small>${st.min ? workTime(st.min) : 'без времени'}${st.perHour ? ' · ' + workRub(Math.round(st.perHour)) + '/ч' : ''}</small></div>`;
const free = workQuickObjects().filter(o => !o.workTimer);
box.innerHTML = `<div class="work-all-in work-q-in">
<div class="work-all-head"><h2>⏱ Таймер работ</h2><button type="button" class="hc-btn" onclick="workQuickClose()" aria-label="Закрыть">✕</button></div>
${run.map(o => `<div class="work-q-run">
<div class="work-q-obj">${escapeHtml(o.name || 'Объект')}</div>
<div class="work-clock" data-work-clock="${escapeHtml(o.id)}">${workClock(o.workTimer.start)}</div>
<div class="work-q-btns"><button type="button" class="btn btn-primary" onclick="workQuickStop('${escapeHtml(o.id)}')">⏹ Стоп и записать</button><button type="button" class="hc-btn" onclick="workQuickCancel('${escapeHtml(o.id)}')">Сбросить</button></div>
</div>`).join('')}
<div class="work-q-stats">${stat('Сегодня', today)}${stat('7 дней', week)}</div>
${free.length ? `<h3 class="work-h">${run.length ? 'Запустить ещё' : 'Запустить таймер'}</h3>
<div class="work-q-list">${free.slice(0, 12).map(o => `<button type="button" class="work-q-start" onclick="workQuickStart('${escapeHtml(o.id)}')"><span>▶</span>${escapeHtml(o.name || 'Объект')}</button>`).join('')}</div>`
: run.length ? '' : '<div class="work-empty">Нет объектов. Создайте объект в кабинете.</div>'}
<button type="button" class="work-all-btn work-q-more" onclick="workQuickClose(); openWorkAll()">📈 Вся статистика</button>
</div>`;
}
async function workQuickStart(id) {
const o = (cloudData.objects || []).find(x => x.id === id);
if (!o || o.workTimer) return;
o.workTimer = { start: Date.now() };
workQuickRender(); workChipUpdate();
if (currentObjectId === id && typeof renderObjectDetail === 'function') { renderObjectDetail(); workTickStart(); }
await saveCloudData();
}
async function workQuickCancel(id) {
const o = (cloudData.objects || []).find(x => x.id === id);
if (!o || !o.workTimer || !confirm('Сбросить таймер без записи?')) return;
delete o.workTimer;
workQuickRender(); workChipUpdate();
if (currentObjectId === id && typeof renderObjectDetail === 'function') renderObjectDetail();
await saveCloudData();
}
// стоп: открываем объект на вкладке «Работы» со списком, время таймера — общим
function workQuickStop(id) {
workQuickClose();
if (typeof openObjectDetail === 'function') openObjectDetail(id);
objectHistorySubTab = 'work';
currentObjectId = id;
workTimerStop();
}
function workChipUpdate() {
let chip = document.getElementById('workChip');
const run = workQuickAllowed() ? workRunning() : [];
const app = document.getElementById('appScreen'), q = document.getElementById('workQuick');
const show = run.length && (!app || app.style.display !== 'none') && !(q && q.style.display === 'block');
if (!show) { if (chip) chip.style.display = 'none'; return; }
if (!chip) { chip = document.createElement('button'); chip.type = 'button'; chip.id = 'workChip'; chip.className = 'work-chip'; chip.onclick = workQuickOpen; document.body.appendChild(chip); }
const o = run[0];
chip.style.display = '';
chip.innerHTML = `<span class="work-chip-dot"></span><b>${workClock(o.workTimer.start)}</b><span class="work-chip-name">${escapeHtml(o.name || 'Объект')}${run.length > 1 ? ' +' + (run.length - 1) : ''}</span>`;
}
if (typeof document !== 'undefined' && typeof setInterval === 'function') setInterval(() => {
workChipUpdate();
document.querySelectorAll('#workQuick [data-work-clock]').forEach(el => {
const o = (cloudData.objects || []).find(x => x.id === el.dataset.workClock);
if (o && o.workTimer) el.textContent = workClock(o.workTimer.start);
});
}, 1000);
// calc.html?w=timer — открыть панель сразу (ярлык на иконке, «Быстрая команда» на iPhone)
(function workQuickFromUrl() {
if (typeof location === 'undefined' || typeof setInterval !== 'function' || !/[?&]w=timer\b/.test(location.search)) return;
let n = 0;
const wait = setInterval(() => {
if (workQuickAllowed() && document.getElementById('appScreen') && document.getElementById('appScreen').style.display !== 'none') { clearInterval(wait); workQuickOpen(); history.replaceState(null, '', location.pathname + location.hash); }
else if (++n > 60) clearInterval(wait);
}, 250);
})();
