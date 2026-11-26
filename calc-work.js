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
let workForm = null;          // открытая форма записи: { id?, date, name, unit, qty, price, sum, min, note }
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
: `<button type="button" class="btn btn-primary" onclick="workTimerStart()">▶ Запустить таймер</button><button type="button" class="hc-btn" onclick="workFormOpen()">＋ Записать вручную</button>`}
</div>
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
workForm = { date: workDay(), name: '', unit: 'м²', qty: '', price: '', sum: '', min, note: '' };
await workSave();
}
function workFormOpen(id) {
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
