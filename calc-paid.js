// Кабинет мастера — платные функции (распознавание плана и помощник).
// Доступ включает админ: до даты и времени, с лимитом токенов в месяц.
// Проверяет доступ сервер; здесь — только понятные окна и раздел для админа.
// Подключается из calc.html до calc-assistant.js и calc-import.js.

const PAID_NAMES = { plan: 'Распознавание плана', assistant: 'Помощник' };

function paidFmt(n) {
return Number(n || 0).toLocaleString('ru-RU');
}

function paidDate(ts) {
return new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function paidStatus(feature) {
const ai = cloudData.self && cloudData.self.ai;
return (ai && ai[feature]) || { until: 0, limit: 0, used: 0, requestedAt: 0 };
}

// Перед платной функцией: админу и тем, у кого доступ, — можно; остальным —
// предложение запросить доступ. Окончательно решает сервер (402).
function paidCheck(feature) {
if (isCurrentAdmin()) return true;
const st = paidStatus(feature);
if (st.until > Date.now()) return true;
paidOffer(feature, st);
return false;
}

async function paidOffer(feature, st) {
const offer = (cloudData.self && cloudData.self.aiOffer) || '';
const head = `${PAID_NAMES[feature]} — платная функция. Доступ включает администратор после оплаты.`
+ (st.until ? `\n\nВаш доступ закончился ${paidDate(st.until)}.` : '')
+ (offer ? '\n\n' + offer : '');
if (st.requestedAt) {
alert(`${head}\n\nВы уже запросили доступ ${paidDate(st.requestedAt)} — администратор его увидит.`);
return;
}
if (!confirm(head + '\n\nЗапросить доступ?')) return;
try {
const res = await fetch(`${WORKER_URL}/ai-access-request`, {
method: 'POST',
headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
body: JSON.stringify({ feature })
});
const data = await res.json().catch(() => null);
if (!res.ok || !data || !data.ai) { alert((data && data.error) || 'Не удалось отправить запрос'); return; }
if (cloudData.self) cloudData.self.ai = data.ai;
alert('Запрос отправлен. Когда администратор включит доступ, функция заработает (обновите страницу).');
} catch (e) {
alert('Ошибка сети — запрос не отправлен');
}
}

// Ответ сервера «нет доступа / лимит» — объясняем и предлагаем запросить
function paidDenied(feature, data) {
if (data && data.noAccess) {
if (cloudData.self && cloudData.self.ai && cloudData.self.ai[feature]) cloudData.self.ai[feature].until = 0;
paidOffer(feature, paidStatus(feature));
}
}

// Профиль: доступ и расход за месяц
function paidProfileHtml() {
if (isCurrentClient()) return '';
if (isCurrentAdmin()) return '<div class="paid-box"><b>Платные функции</b><div class="paid-row">У администратора доступ всегда. Управление — в меню «Платные функции».</div></div>';
const rows = Object.keys(PAID_NAMES).map(f => {
const st = paidStatus(f);
const on = st.until > Date.now();
return `<div class="paid-row"><b>${PAID_NAMES[f]}:</b> ${on ? `доступ до ${paidDate(st.until)}` : st.requestedAt ? 'доступ запрошен' : 'нет доступа'}
<br><small>Токенов в этом месяце: ${paidFmt(st.used)}${st.limit ? ' из ' + paidFmt(st.limit) : ''} · запросов: ${paidFmt(st.requests)}</small>
${on ? '' : `<br><button type="button" class="btn btn-sm" onclick="paidOffer('${f}', paidStatus('${f}'))">${st.requestedAt ? 'Как оплатить' : 'Запросить доступ'}</button>`}</div>`;
}).join('');
return `<div class="paid-box"><b>Платные функции</b>${rows}</div>`;
}

/* ---------- админ: раздел «Платные функции» ---------- */

let paidAdmin = null; // { users, settings, now }

function paidPendingBadge() {
const n = (cloudData.self && cloudData.self.aiPending) || 0;
const btn = document.getElementById('tabPaidBtn');
if (!btn) return;
btn.style.display = isCurrentAdmin() ? 'block' : 'none';
btn.innerHTML = 'Платные функции' + (n ? ` <span class="paid-dot">${n}</span>` : '');
const chip = document.getElementById('userMenuBtn');
if (chip) chip.classList.toggle('has-paid-req', isCurrentAdmin() && n > 0);
}

async function renderPaidAdmin() {
const box = document.getElementById('paidListContainer');
if (!box) return;
box.innerHTML = '<div class="paid-muted">Загрузка…</div>';
try {
const res = await fetch(`${WORKER_URL}/ai-access`, { headers: { 'Authorization': 'Bearer ' + authToken } });
const data = await res.json().catch(() => null);
if (!res.ok || !data) { box.innerHTML = `<div class="paid-err">${escapeHtml((data && data.error) || 'Не удалось загрузить')}</div>`; return; }
paidAdmin = data;
paidAdminDraw();
} catch (e) {
box.innerHTML = '<div class="paid-err">Ошибка сети — не удалось загрузить</div>';
}
}

function paidAdminDraw() {
const box = document.getElementById('paidListContainer');
if (!box || !paidAdmin) return;
const { users, settings } = paidAdmin;
const now = Date.now();
const pending = users.filter(u => Object.keys(PAID_NAMES).some(f => u.ai[f].requestedAt));
if (cloudData.self) { cloudData.self.aiPending = pending.length; paidPendingBadge(); }
const sorted = [...pending, ...users.filter(u => !pending.includes(u))];
box.innerHTML = `
<div class="paid-box">
<b>Что видят мастера без доступа</b>
<textarea id="paidOffer" rows="3" placeholder="Например: 500 ₽ в месяц, перевод по номеру +7… с пометкой «доступ», потом напишите мне">${escapeHtml(settings.offer || '')}</textarea>
<div class="paid-limits">
<label>Лимит токенов в месяц по умолчанию — распознавание <input type="number" id="paidLimPlan" min="0" step="10000" value="${settings.limits.plan}"></label>
<label>помощник <input type="number" id="paidLimAssistant" min="0" step="10000" value="${settings.limits.assistant}"></label>
</div>
<small class="paid-muted">0 — без лимита. Токены — вход и выход нейросети вместе; одно распознавание обычно 5–15 тыс., сообщение помощнику — 5–20 тыс.</small>
<button type="button" class="btn btn-success btn-sm" onclick="paidSaveSettings()">Сохранить</button>
</div>
${sorted.length ? sorted.map(u => paidUserHtml(u, now)).join('') : '<div class="paid-muted">Мастеров пока нет.</div>'}`;
}

function paidUserHtml(u, now) {
const rows = Object.keys(PAID_NAMES).map(f => {
const st = u.ai[f];
const on = st.until > now;
const login = escapeHtml(JSON.stringify(u.login));
return `<div class="paid-feature${st.requestedAt ? ' paid-req' : ''}">
<div><b>${PAID_NAMES[f]}</b> — ${on ? `<span class="paid-on">до ${paidDate(st.until)}</span>` : st.until ? `истёк ${paidDate(st.until)}` : 'нет доступа'}
${st.requestedAt ? `<span class="paid-ask">просит доступ с ${paidDate(st.requestedAt)}</span>` : ''}</div>
<small class="paid-muted">Токенов в этом месяце: ${paidFmt(st.used)}${st.limit ? ' из ' + paidFmt(st.limit) : ' (без лимита)'} · вход ${paidFmt(st.tokensIn)}, выход ${paidFmt(st.tokensOut)} · запросов ${paidFmt(st.requests)}</small>
<div class="paid-btns">
<button type="button" class="btn btn-sm" onclick='paidAdd(${login}, "${f}", 60)'>+60 мин</button>
<button type="button" class="btn btn-sm" onclick='paidAdd(${login}, "${f}", 1440)'>+1 день</button>
<button type="button" class="btn btn-sm" onclick='paidAdd(${login}, "${f}", 43200)'>+30 дней</button>
<input type="datetime-local" aria-label="Доступ до" value="${on ? paidLocal(st.until) : ''}" onchange='paidUntil(${login}, "${f}", this.value)'>
${on ? `<button type="button" class="btn btn-danger btn-sm" onclick='paidSet(${login}, "${f}", { until: null })'>Выключить</button>` : ''}
</div>
<label class="paid-lim">Свой лимит токенов в месяц <input type="number" min="0" step="10000" placeholder="как у всех" value="${st.customLimit ?? ''}" onchange='paidLimit(${login}, "${f}", this.value)'></label>
</div>`;
}).join('');
return `<div class="paid-user"><div class="paid-user-head"><b>${escapeHtml(u.login)}</b> <small class="paid-muted">${escapeHtml(u.email || '')}</small></div>${rows}</div>`;
}

// Для поля «до»: время в часовом поясе телефона, с точностью до минуты
function paidLocal(ts) {
const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60000);
return d.toISOString().slice(0, 16);
}

async function paidSet(login, feature, change) {
try {
const res = await fetch(`${WORKER_URL}/ai-access`, {
method: 'PUT',
headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
body: JSON.stringify({ login, feature, ...change })
});
const data = await res.json().catch(() => null);
if (!res.ok || !data) { alert((data && data.error) || 'Не удалось сохранить'); return; }
paidAdmin = data;
paidAdminDraw();
} catch (e) {
alert('Ошибка сети — не сохранилось');
}
}

// Продлить: от текущего срока, если он ещё не кончился, иначе от сейчас
function paidAdd(login, feature, minutes) {
const u = paidAdmin && paidAdmin.users.find(x => x.login === login);
const cur = u ? u.ai[feature].until : 0;
paidSet(login, feature, { until: Math.max(Date.now(), cur) + minutes * 60000 });
}

function paidUntil(login, feature, value) {
if (!value) return;
const ts = new Date(value).getTime();
if (!(ts > Date.now())) { alert('Это время уже прошло.'); return; }
paidSet(login, feature, { until: ts });
}

function paidLimit(login, feature, value) {
const v = String(value).trim();
const u = paidAdmin && paidAdmin.users.find(x => x.login === login);
const until = u ? u.ai[feature].until : 0;
paidSet(login, feature, { until, limit: v === '' ? null : Math.max(0, Math.round(Number(v)) || 0) });
}

async function paidSaveSettings() {
const lim = id => Math.max(0, Math.round(Number(document.getElementById(id).value)) || 0);
try {
const res = await fetch(`${WORKER_URL}/ai-access`, {
method: 'PUT',
headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
body: JSON.stringify({ settings: { offer: document.getElementById('paidOffer').value, limits: { plan: lim('paidLimPlan'), assistant: lim('paidLimAssistant') } } })
});
const data = await res.json().catch(() => null);
if (!res.ok || !data) { alert((data && data.error) || 'Не удалось сохранить'); return; }
paidAdmin = data;
paidAdminDraw();
showAddToast('Сохранено');
} catch (e) {
alert('Ошибка сети — не сохранилось');
}
}
