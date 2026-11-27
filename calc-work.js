// Кабинет мастера — учёт выполненных работ по объекту: таймер или время вручную, сумма, статистика заработка.
// У объекта — вкладка «Работы» (рядом со «Счета», «Расчёты», «Закупки»): что сделано (из прайса или своё), сколько,
// сколько времени ушло и на какую сумму (цена × количество, можно поправить). Статистика за период: заработано,
// часы, заработок в час, выработка (сколько м² / пог. м в час) и сравнение со сметой/счётом объекта.
// По всем объектам — кнопка «📈 Работы и заработок» над списком объектов.
// Хранится в объекте: obj.works = [{ id, date: 'ГГГГ-ММ-ДД', name, unit, qty, price, sum, min, note }]
// (sum пусто — считается price × qty; min — минуты), obj.workTimer = { start } — идущий таймер (виден на всех устройствах),
// obj.workTimerDone = { min } — таймер, остановленный с виджета (API /api/v1/timer), ждёт записи работ;
// obj.workTimerAt — когда таймер меняли последний раз (сервер не даёт старой копии страницы затереть таймер с виджета).
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
function workDraftOpen(min, fromDone, sid) {
workForm = null;
const o = typeof workObj === 'function' ? workObj() : null;
workDraft = { date: workDay(), rows: [], min: min || 0, fromDone: !!fromDone, sid: sid || (fromDone && o && o.workTimerDone && o.workTimerDone.sid) || '' };
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
const own = d.rows.filter(r => Number(r.min) > 0).length, dObj = workObj(), hasTeam = !!(dObj && workTeam(dObj).members.length);
return `<div class="work-form work-draft">
<datalist id="workNames">${names.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
<label class="work-draft-date">Работы за <input type="date" value="${escapeHtml(d.date)}" onchange="workDraft.date = this.value"></label>
${d.rows.map((r, i) => `<div class="work-drow${hasTeam ? ' has-who' : ''}" data-i="${i}">
<input class="work-dname" type="text" list="workNames" maxlength="120" value="${escapeHtml(r.name)}" oninput="workDraftSet(${i}, 'name', this.value)" aria-label="Работа">
<input class="work-dqty" type="text" inputmode="decimal" placeholder="кол-во" value="${escapeHtml(String(r.qty ?? ''))}" oninput="workDraftSet(${i}, 'qty', this.value)" aria-label="Сделано">
<select class="work-dunit" onchange="workDraftSet(${i}, 'unit', this.value)" aria-label="Единица">${[...new Set([r.unit, ...WORK_UNITS])].filter(Boolean).map(u => `<option ${u === r.unit ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}</select>
<input class="work-dtime" type="text" placeholder="своё время" value="${tm(Number(r.min) || 0)}" onchange="workDraftSet(${i}, 'min', workParseTime(this.value))" aria-label="Своё время на эту работу">
<input class="work-dsum" type="text" inputmode="decimal" placeholder="${r.price !== '' && workNum(r.qty) ? workQty(workNum(r.price) * workNum(r.qty)) + ' ₽' : 'сумма'}" value="${escapeHtml(String(r.sum ?? ''))}" oninput="workDraftSet(${i}, 'sum', this.value)" aria-label="Сумма">
${workWhoSelect(dObj, r.who, `workDraftSet(${i}, 'who', this.value)`, 'work-dwho')}
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
min: Math.max(0, Math.round(Number(r.min) || 0)), note: '', ...(d.sid ? { sid: d.sid } : {}), ...(r.who ? { who: r.who } : {})
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
if (d.fromDone) { delete obj.workTimerDone; obj.workTimerAt = Date.now(); } // время с виджета записано
workDraft = null;
await workSave();
if (typeof showAddToast === 'function') showAddToast(`Записано работ: ${recs.length} · ${workRub(recs.reduce((a, w) => a + workSum(w), 0))}`);
}

/* ---------- бригада: напарники, кто сделал работу, как делится доход ---------- */
// obj.workTeam = { mode: 'equal' | 'pct' | 'piece', members: [{ id, name, pct }] }; у работы who — id напарника ('' — я).
// Поровну — сумма каждой работы делится на всех (я + напарники); проценты — у напарников свой %, мне — остаток;
// сдельно — сумма работы тому, кто её сделал.
const WORK_TEAM_MODES = { equal: 'Поровну', pct: 'Проценты', piece: 'Сдельно' };
function workTeam(obj) {
const t = obj && obj.workTeam && typeof obj.workTeam === 'object' ? obj.workTeam : {};
return { mode: WORK_TEAM_MODES[t.mode] ? t.mode : 'equal', members: Array.isArray(t.members) ? t.members.filter(m => m && m.id && m.name) : [] };
}
function workWhoName(obj, who) { if (!who) return 'Я'; const m = workTeam(obj).members.find(x => x.id === who); return m ? m.name : 'Напарник'; }
function workMyPct(team) { return Math.max(0, 100 - team.members.reduce((a, m) => a + (Number(m.pct) || 0), 0)); }
// доли суммы одной работы: { '' : мне, id: напарнику }
function workShares(obj, w) {
const team = workTeam(obj), sum = workSum(w), out = {};
if (!team.members.length) { out[''] = sum; return out; }
if (team.mode === 'piece') { out[w.who || ''] = sum; return out; }
if (team.mode === 'pct') {
out[''] = sum * workMyPct(team) / 100;
team.members.forEach(m => { out[m.id] = sum * (Number(m.pct) || 0) / 100; });
return out;
}
const n = team.members.length + 1;
out[''] = sum / n;
team.members.forEach(m => { out[m.id] = sum / n; });
return out;
}
// итог по людям за список работ (работы могут быть с разных объектов: w.obj — объект)
function workSharesTotal(list, objOf) {
const by = new Map();
list.forEach(w => {
const obj = objOf(w), sh = workShares(obj, w);
Object.entries(sh).forEach(([id, v]) => {
const k = id ? obj.id + ':' + id : '';
const r = by.get(k) || { name: workWhoName(obj, id), sum: 0, me: !id };
r.sum += v; by.set(k, r);
});
});
return [...by.values()].sort((a, b) => (b.me - a.me) || b.sum - a.sum);
}
function workSharesHtml(list, objOf) {
const rows = workSharesTotal(list, objOf);
if (rows.length < 2) return '';
return `<div class="work-shares"><h4>👥 Доход по людям</h4>${rows.map(r => `<div class="work-share-row${r.me ? ' me' : ''}"><span>${escapeHtml(r.name)}</span><b>${workRub(Math.round(r.sum))}</b></div>`).join('')}</div>`;
}
function workTeamHtml(obj) {
const team = workTeam(obj), others = [...new Set((cloudData.objects || []).flatMap(o => workTeam(o).members.map(m => m.name)))].filter(n => !team.members.some(m => m.name === n));
return `<details class="work-team"${workTeamOpen ? ' open' : ''} ontoggle="workTeamOpen = this.open"><summary>👥 Бригада${team.members.length ? ': я и ' + team.members.map(m => escapeHtml(m.name)).join(', ') + ' · ' + WORK_TEAM_MODES[team.mode] : ' — добавить напарников'}</summary>
${team.members.length ? `<div class="chips work-team-modes">${Object.entries(WORK_TEAM_MODES).map(([k, l]) => `<button type="button" class="chip${team.mode === k ? ' active' : ''}" onclick="workTeamMode('${k}')">${l}</button>`).join('')}</div>
<div class="work-hint">${team.mode === 'equal' ? 'Сумма каждой работы делится поровну на всех.' : team.mode === 'pct' ? 'У каждого напарника свой процент, вам — остаток.' : 'Каждому — сумма работ, которые он сделал (кто сделал — выбирается у работы и переключается под таймером).'}</div>
<div class="work-team-list"><div class="work-team-row"><span>Я</span>${team.mode === 'pct' ? `<b>${workMyPct(team)}%</b>` : ''}</div>
${team.members.map(m => `<div class="work-team-row"><span>${escapeHtml(m.name)}</span>${team.mode === 'pct' ? `<input type="text" inputmode="decimal" value="${escapeHtml(String(m.pct ?? ''))}" placeholder="%" onchange="workTeamPct('${m.id}', this.value)" aria-label="Процент: ${escapeHtml(m.name)}">%` : ''}<button type="button" class="work-ddel" onclick="workTeamDel('${m.id}')" aria-label="Убрать">✕</button></div>`).join('')}</div>` : ''}
<datalist id="workTeamNames">${others.map(n => `<option value="${escapeHtml(n)}">`).join('')}</datalist>
<div class="purchase-add"><input type="text" id="workTeamAdd" list="workTeamNames" maxlength="40" placeholder="Имя напарника" onkeydown="if (event.key === 'Enter') { event.preventDefault(); workTeamAdd(); }"><button type="button" class="hc-btn" onclick="workTeamAdd()">Добавить</button></div>
</details>`;
}
async function workTeamSave(obj, team) { obj.workTeam = team; workTeamOpen = true; await workSave(); }
let workTeamOpen = false;
async function workTeamAdd() {
const obj = workObj(), inp = document.getElementById('workTeamAdd'), name = inp ? inp.value.trim().slice(0, 40) : '';
if (!obj || !name) return;
const team = workTeam(obj);
if (team.members.some(m => m.name.toLowerCase() === name.toLowerCase())) { inp.value = ''; return; }
team.members.push({ id: 'p' + Date.now().toString(36), name, pct: '' });
await workTeamSave(obj, team);
}
async function workTeamDel(id) {
const obj = workObj(), team = workTeam(obj), m = team.members.find(x => x.id === id);
if (!m || !confirm(`Убрать «${m.name}» из бригады? Его работы останутся, но доход по ним пойдёт вам.`)) return;
team.members = team.members.filter(x => x !== m);
if (obj.workTimer && obj.workTimer.who === id) obj.workTimer.who = '';
await workTeamSave(obj, team);
}
async function workTeamMode(mode) { const obj = workObj(), team = workTeam(obj); team.mode = mode; await workTeamSave(obj, team); }
async function workTeamPct(id, v) {
const obj = workObj(), team = workTeam(obj), m = team.members.find(x => x.id === id);
if (!m) return;
const others = team.members.filter(x => x !== m).reduce((a, x) => a + (Number(x.pct) || 0), 0);
m.pct = Math.max(0, Math.min(100 - others, Math.round((Number(String(v).replace(',', '.')) || 0) * 10) / 10));
await workTeamSave(obj, team);
}
// кто сейчас работает (под идущим таймером): новые работы по ходу записываются на него
function workWhoChips(obj, onclick) {
const team = workTeam(obj), cur = (obj.workTimer && obj.workTimer.who) || '';
if (!team.members.length) return '';
return `<div class="chips work-who"><span>Сейчас делает:</span>${[{ id: '', name: 'Я' }, ...team.members].map(m => `<button type="button" class="chip${cur === m.id ? ' active' : ''}" onclick="${onclick}('${escapeHtml(obj.id)}', '${m.id}')">${escapeHtml(m.name)}</button>`).join('')}</div>`;
}
async function workWhoSet(objId, who) {
const obj = (cloudData.objects || []).find(o => o.id === objId);
if (!obj || !obj.workTimer) return;
obj.workTimer.who = who; obj.workTimerAt = Date.now();
if (currentObjectId === objId && typeof renderObjectDetail === 'function') renderObjectDetail();
workQuickRender();
await saveCloudData();
}
function workWhoSelect(obj, val, onchange, cls) {
const team = workTeam(obj);
if (!team.members.length) return '';
return `<select class="${cls || ''}" onchange="${onchange}" aria-label="Кто сделал">${[{ id: '', name: 'Я' }, ...team.members].map(m => `<option value="${m.id}"${(val || '') === m.id ? ' selected' : ''}>${escapeHtml(m.name)}</option>`).join('')}</select>`;
}

/* ---------- работы по ходу таймера («круги») и смены ---------- */
// Пока таймер идёт, вписанная работа записывается сразу: время — отрезок от прошлой работы (или от запуска) до сейчас.
// Все работы одного запуска — смена: obj.workSessions = [{ id, from, to }], у работы sid, from, to.
function workSessionOpen(obj, start) {
const sid = 's' + Number(start).toString(36);
obj.workSessions = [...(Array.isArray(obj.workSessions) ? obj.workSessions : []).filter(s => s && s.id !== sid), { id: sid, from: Number(start), to: null }].slice(-300);
if (obj.workTimer) obj.workTimer.sid = sid;
return sid;
}
function workSessionOf(obj, sid) { return (Array.isArray(obj.workSessions) ? obj.workSessions : []).find(s => s && s.id === sid) || null; }
function workSessionWorks(obj, sid) { return workList(obj).filter(w => w && sid && w.sid === sid); }
// строки → записи с отрезком времени [last, now]; своё время из строки вычитается из отрезка, остаток — остальным по суммам
function workLapRecords(timer, text, now) {
const rows = String(text || '').split('\n').map(workParseLine).filter(Boolean).slice(0, 30);
if (!timer || !timer.start || !rows.length) return [];
const last = Number(timer.last) || Number(timer.start), seg = Math.max(0, Math.round((now - last) / 60000)), date = workDay(new Date(now));
const recs = rows.map((r, i) => ({ id: 'w' + now.toString(36) + i + Math.random().toString(36).slice(2, 5), at: now + i, date, name: r.name, unit: r.unit,
qty: workNum(r.qty) || '', price: r.price === '' ? '' : workNum(r.price), sum: '', min: r.min, note: '', sid: timer.sid, from: last, to: now, ...(timer.who ? { who: timer.who } : {}) }));
workShareTime(recs, Math.max(0, seg - recs.reduce((a, w) => a + (Number(w.min) || 0), 0)));
recs.forEach(w => { if (!w.shared) delete w.shared; });
return recs;
}
async function workLap(id, inputId) {
const obj = (cloudData.objects || []).find(o => o.id === id), inp = document.getElementById(inputId);
if (!obj || !obj.workTimer || !inp) return;
if (!obj.workTimer.sid) workSessionOpen(obj, obj.workTimer.start);
const now = Date.now(), recs = workLapRecords(obj.workTimer, inp.value, now);
if (!recs.length) { inp.focus(); return; }
obj.works = [...workList(obj), ...recs];
obj.workTimer.last = now; obj.workTimerAt = now;
inp.value = '';
if (currentObjectId === id && typeof renderObjectDetail === 'function') renderObjectDetail();
workQuickRender();
const again = document.getElementById(inputId); if (again) again.focus();
if (typeof showAddToast === 'function') showAddToast(recs.map(w => `✓ ${w.name} · ${workTime(w.min)}`).join(', ') + ' — таймер идёт');
await saveCloudData();
}
function workHm(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function workLapPaste(e, id, inputId) { // вставили список — сразу записать
const txt = e.clipboardData && e.clipboardData.getData('text');
if (!txt || !/\n/.test(txt.trim())) return;
e.preventDefault();
e.target.value = (e.target.value ? e.target.value + '\n' : '') + txt;
workLap(id, inputId);
}
// поле «Что сделано?» и работы этой смены — под идущим таймером (во вкладке и в быстрой панели)
function workLapHtml(obj, inputId) {
const t = obj.workTimer, laps = workSessionWorks(obj, t.sid).sort((a, b) => (a.at || 0) - (b.at || 0));
const last = Number(t.last) || Number(t.start);
return `<div class="work-lap">
${workWhoChips(obj, 'workWhoSet')}
${laps.length ? `<div class="work-lap-list">${laps.map(w => `<div class="work-lap-row"><span class="work-lap-t">${w.from ? workHm(w.from) + '–' + workHm(w.to) : ''}</span><span class="work-lap-n">${escapeHtml(w.name)}${w.qty ? ' · ' + workQty(workNum(w.qty)) + ' ' + escapeHtml(w.unit || '') : ''}${w.who ? ' · <i>' + escapeHtml(workWhoName(obj, w.who)) + '</i>' : ''}</span><span class="work-lap-m">${workTime(w.min)}</span></div>`).join('')}
<div class="work-lap-row work-lap-now"><span class="work-lap-t">${workHm(last)}–…</span><span class="work-lap-n">после последней работы</span><span class="work-lap-m" data-work-since="${escapeHtml(obj.id)}">${workClock(last)}</span></div></div>` : ''}
<div class="purchase-add"><textarea id="${inputId}" rows="1" placeholder="Что сделано? Шпаклёвка стен 12 м²" onkeydown="if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); workLap('${escapeHtml(obj.id)}', '${inputId}'); }" onpaste="workLapPaste(event, '${escapeHtml(obj.id)}', '${inputId}')"></textarea><button type="button" class="hc-btn" onclick="workLap('${escapeHtml(obj.id)}', '${inputId}')">Записать</button></div>
<div class="work-hint">Enter — работа записана со временем ${laps.length ? 'от прошлой работы' : 'от запуска'}, таймер идёт дальше. По «Стоп» все работы соберутся в одну смену.</div>
</div>`;
}
// записи дня: работы одной смены — блоком «9:10–15:40 · 6 ч 30 мин · сумма»
function workDayRowsHtml(obj, ws) {
const row = w => `<button type="button" class="work-row" onclick="workFormOpen('${w.id}')"><span class="work-row-name">${escapeHtml(w.name || 'Без названия')}<small>${[w.from && w.to ? workHm(w.from) + '–' + workHm(w.to) : '', w.qty ? workQty(workNum(w.qty)) + ' ' + escapeHtml(w.unit || '') : '', w.min ? workTime(w.min) : '', w.who ? '👤 ' + escapeHtml(workWhoName(obj, w.who)) : '', w.note ? escapeHtml(w.note) : ''].filter(Boolean).join(' · ')}</small></span><b>${workRub(workSum(w))}</b></button>`;
const done = new Set(), out = [];
ws.forEach(w => {
if (!w.sid) { out.push(row(w)); return; }
if (done.has(w.sid)) return;
done.add(w.sid);
const list = ws.filter(x => x.sid === w.sid).sort((a, b) => (a.at || 0) - (b.at || 0)), s = workSessionOf(obj, w.sid);
const from = s ? s.from : Math.min(...list.map(x => Number(x.from) || Number(x.at))), to = s && s.to ? s.to : (obj.workTimer && obj.workTimer.sid === w.sid ? 0 : Math.max(...list.map(x => Number(x.to) || Number(x.at))));
const min = to ? Math.round((to - from) / 60000) : 0;
out.push(`<div class="work-sess"><div class="work-sess-head"><span>🕘 ${workHm(from)}–${to ? workHm(to) : 'идёт'}${min ? ' · ' + workTime(min) : ''} · работ: ${list.length}</span><b>${workRub(list.reduce((a, x) => a + workSum(x), 0))}</b></div>${list.map(row).join('')}</div>`);
});
return out.join('');
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
<button type="button" class="btn btn-primary" onclick="workTimerStop()">⏹ Стоп</button><button type="button" class="hc-btn" onclick="workTimerCancel()">Сбросить</button>${workLapHtml(obj, 'workLapIn')}`
: `<button type="button" class="btn btn-primary" onclick="workTimerStart()">▶ Запустить таймер</button><button type="button" class="hc-btn" onclick="workDraftOpen()">＋ Записать работы</button>`}
</div>
${obj.workTimerDone && Number(obj.workTimerDone.min) > 0 && !workDraft ? `<div class="work-done">⏹ Таймер остановлен с виджета: <b>${workTime(obj.workTimerDone.min)}</b> — впишите, что сделано
<div class="work-q-btns"><button type="button" class="btn btn-primary" onclick="workDraftOpen(${Math.round(obj.workTimerDone.min)}, true)">＋ Записать работы</button><button type="button" class="hc-btn" onclick="workDoneDrop()">Убрать</button></div></div>` : ''}
${workDraft ? workDraftHtml() : ''}
${workForm ? workFormHtml() : ''}
${workTeamHtml(obj)}
<h3 class="work-h">Статистика</h3>
${workPeriodChips('workSetPeriod')}
${workStatsHtml(workInPeriod(workList(obj), workPeriod))}
${workSharesHtml(workInPeriod(workList(obj), workPeriod), () => obj)}
<details class="work-cmp"><summary>Сравнение со сметой</summary>${workCompareHtml(obj)}</details>
<h3 class="work-h">Записи${list.length ? ` (${list.length})` : ''}</h3>
${list.length ? [...days.entries()].map(([d, ws]) => `<div class="work-day"><b>${new Date(d + 'T12:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })}</b><span>${workRub(ws.reduce((a, w) => a + workSum(w), 0))}</span></div>
${workDayRowsHtml(obj, ws)}`).join('')
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
const now = Date.now();
obj.workTimer = { start: now, last: now }; workSessionOpen(obj, now); obj.workTimerAt = now;
await workSave();
workTickStart();
}
async function workTimerCancel() {
const obj = workObj();
if (!obj || !obj.workTimer) return;
const sid = obj.workTimer.sid, laps = workSessionWorks(obj, sid);
if (!confirm(laps.length ? 'Остановить таймер без записи времени после последней работы? Записанные работы останутся.' : 'Сбросить таймер без записи?')) return;
workTimerEnd(obj, laps.length ? Number(obj.workTimer.last) : 0);
await workSave();
}
// конец смены: to — время окончания (0 — смена без работ убирается)
function workTimerEnd(obj, to) {
const sid = obj.workTimer && obj.workTimer.sid, s = workSessionOf(obj, sid);
if (s) { if (to) s.to = to; else obj.workSessions = obj.workSessions.filter(x => x !== s); }
delete obj.workTimer; obj.workTimerAt = Date.now();
}
async function workTimerStop() {
const obj = workObj();
if (!obj || !obj.workTimer) return;
const now = Date.now(), t = obj.workTimer, sid = t.sid || workSessionOpen(obj, t.start), laps = workSessionWorks(obj, sid);
const rest = Math.round((now - (Number(t.last) || Number(t.start))) / 60000), total = Math.max(1, Math.round((now - t.start) / 60000));
workTimerEnd(obj, now);
await workSave();
const sum = laps.reduce((a, w) => a + workSum(w), 0);
if (laps.length && typeof showAddToast === 'function') showAddToast(`Смена ${workHm(t.start)}–${workHm(now)}: ${workTime(total)}, работ: ${laps.length} · ${workRub(sum)}`);
// время без записанной работы — общим на работы, которые сейчас впишут (в ту же смену)
if (!laps.length) workDraftOpen(total, false, sid);
else if (rest >= 1) workDraftOpen(rest, false, sid);
}
async function workDoneDrop() {
const obj = workObj();
if (!obj || !obj.workTimerDone || !confirm('Убрать время с виджета, не записывая работы?')) return;
delete obj.workTimerDone; obj.workTimerAt = Date.now();
await workSave();
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
${workTeam(workObj()).members.length ? `<label>Кто сделал${workWhoSelect(workObj(), f.who, "workFormSet('who', this.value)")}</label>` : ''}
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
const keep = {}; ['sid', 'from', 'to', 'shared'].forEach(k => { if (f[k] !== undefined && f[k] !== null && f[k] !== '') keep[k] = f[k]; });
if (f.who) keep.who = f.who;
const rec = { ...keep, id: f.id || 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), at: f.at || Date.now(), date: /^\d{4}-\d{2}-\d{2}$/.test(f.date) ? f.date : workDay(),
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
${workSharesHtml(all, w => w.obj)}
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
<div class="work-q-btns"><button type="button" class="btn btn-primary" onclick="workQuickStop('${escapeHtml(o.id)}')">⏹ Стоп</button><button type="button" class="hc-btn" onclick="workQuickCancel('${escapeHtml(o.id)}')">Сбросить</button></div>
${workLapHtml(o, 'workLapQ_' + o.id)}
</div>`).join('')}
${workQuickObjects().filter(o => o.workTimerDone && Number(o.workTimerDone.min) > 0).map(o => `<button type="button" class="work-q-start work-q-done" onclick="workQuickWrite('${escapeHtml(o.id)}')"><span>✎</span>${escapeHtml(o.name || 'Объект')}: не записано ${workTime(o.workTimerDone.min)}</button>`).join('')}
<div class="work-q-stats">${stat('Сегодня', today)}${stat('7 дней', week)}</div>
${free.length ? `<h3 class="work-h">${run.length ? 'Запустить ещё' : 'Запустить таймер'}</h3>
<div class="work-q-list">${free.slice(0, 12).map(o => `<button type="button" class="work-q-start" onclick="workQuickStart('${escapeHtml(o.id)}')"><span>▶</span>${escapeHtml(o.name || 'Объект')}</button>`).join('')}</div>`
: run.length ? '' : '<div class="work-empty">Нет объектов. Создайте объект в кабинете.</div>'}
<button type="button" class="work-all-btn work-q-more" onclick="workQuickClose(); openWorkAll()">📈 Вся статистика</button>
${workWidgetHelp()}
</div>`;
}
async function workQuickStart(id) {
const o = (cloudData.objects || []).find(x => x.id === id);
if (!o || o.workTimer) return;
const now = Date.now(); o.workTimer = { start: now, last: now }; workSessionOpen(o, now); o.workTimerAt = now;
workQuickRender(); workChipUpdate();
if (currentObjectId === id && typeof renderObjectDetail === 'function') { renderObjectDetail(); workTickStart(); }
await saveCloudData();
}
async function workQuickCancel(id) {
const o = (cloudData.objects || []).find(x => x.id === id);
if (!o || !o.workTimer) return;
const laps = workSessionWorks(o, o.workTimer.sid);
if (!confirm(laps.length ? 'Остановить таймер без записи времени после последней работы? Записанные работы останутся.' : 'Сбросить таймер без записи?')) return;
workTimerEnd(o, laps.length ? Number(o.workTimer.last) : 0);
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
function workWidgetBase() { return (typeof WORKER_URL !== 'undefined' ? WORKER_URL : 'https://price-api.nifork.workers.dev') + '/api/v1/timer'; }
function workWidgetCopy() { if (typeof copyApiText === 'function') copyApiText(workWidgetBase(), 'Адрес скопирован'); }
// как поставить виджет на главный экран телефона: «Команды» на iPhone ходят в API по ключу
function workWidgetHelp() {
const base = workWidgetBase();
const url = s => `<code class="work-w-url">${escapeHtml(base + s)}</code>`;
return `<details class="work-w-help"><summary>📱 Виджет на главный экран телефона</summary>
<p>Виджет запускает и останавливает таймер и показывает заработок, не открывая кабинет. Работает по ключу API.</p>
<ol>
<li>В профиле, в «Ключи API», создайте ключ «Виджет» и скопируйте его.</li>
<li>iPhone: приложение «Команды» → ＋. В каждой команде действие <b>«Получить содержимое URL»</b>: «Показать ещё» → Заголовки: <b>X-API-Key</b> = ваш ключ.</li>
<li><b>«Таймер ▶»</b>: «Получить содержимое URL» ${url('')} → «Получить значение словаря» <b>names</b> → «Выбрать из списка» → «Получить содержимое URL» ${url('/start')}, метод <b>POST</b>, тело <b>JSON</b>: поле <b>object</b> = «Выбранный объект» → «Получить значение словаря» <b>text</b> → «Показать уведомление».</li>
<li><b>«Стоп ⏹»</b>: «Получить содержимое URL» ${url('/stop')}, метод <b>POST</b> → значение <b>text</b> → «Показать уведомление». Минуты будут ждать во вкладке «Работы» объекта — впишите, что сделано.</li>
<li><b>«Заработок»</b>: «Получить содержимое URL» ${url('')} → значение <b>text</b> → «Показать уведомление»: что идёт, сегодня и за 7 дней.</li>
<li>Зажмите главный экран → ＋ → «Команды» → виджет на 2 или 4 команды и выберите эти три.</li>
</ol>
<p><b>Android</b>: приложение «HTTP Shortcuts». Создайте в нём переменную <b>Calc</b> (⋮ → «Переменные» → ＋ → «Статическая») со значением — вашим ключом. Затем ⋮ → «Импорт/экспорт» → «Импорт из URL»:</p>${url('').replace('/timer', '/widget/http-shortcuts.json')}<p>Появятся кнопки «▶ Таймер» (выбор объекта), «⏹ Стоп» и «₽ Заработок» — их можно вынести на главный экран.</p>
<button type="button" class="hc-btn" onclick="workWidgetCopy()">Скопировать адрес</button>
</details>`;
}
function workQuickWrite(id) {
const o = (cloudData.objects || []).find(x => x.id === id);
if (!o || !o.workTimerDone) return;
workQuickClose();
if (typeof openObjectDetail === 'function') openObjectDetail(id);
objectHistorySubTab = 'work'; currentObjectId = id;
workDraftOpen(Math.round(o.workTimerDone.min), true);
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
document.querySelectorAll('[data-work-since]').forEach(el => {
const o = (cloudData.objects || []).find(x => x.id === el.dataset.workSince);
if (o && o.workTimer) el.textContent = workClock(Number(o.workTimer.last) || Number(o.workTimer.start));
});
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
