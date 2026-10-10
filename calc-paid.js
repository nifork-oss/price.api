// Кабинет мастера — платные функции (распознавание плана и помощник).
// Мастер платит админу, админ пополняет ему баланс в рублях; каждый запрос
// списывает свою стоимость по токенам. Проверяет и списывает сервер; здесь —
// понятные окна для мастера и раздел «Платные функции» для админа.
// Подключается из calc.html до calc-assistant.js и calc-import.js.

const PAID_NAMES = { plan: 'Распознавание плана', assistant: 'Помощник' };

function paidRub(n) {
return Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
}

function paidFmt(n) {
return Number(n || 0).toLocaleString('ru-RU');
}

function paidDate(ts) {
return new Date(ts).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function paidStatus() {
return (cloudData.self && cloudData.self.ai) || { balance: 0, month: {}, requestedAt: 0, pays: [] };
}

// Под ответом нейросети: сколько стоило отправленное, сколько ответ, остаток
function paidCostHtml(cost) {
if (!cost || !(cost.total >= 0)) return '';
return `<div class="as-cost">Отправлено ${paidRub(cost.sent)} · ответ ${paidRub(cost.reply)} · всего <b>${paidRub(cost.total)}</b>`
+ (cost.balance != null ? ` · на балансе ${paidRub(cost.balance)}` : ' · с вас не списано') + '</div>';
}

// Свежий остаток после запроса — чтобы профиль и проверки видели его сразу
function paidApplyCost(cost) {
if (!cost || cost.balance == null || !cloudData.self || !cloudData.self.ai) return;
cloudData.self.ai.balance = cost.balance;
}

// Перед платной функцией: админу и тем, у кого есть деньги на балансе, — можно;
// остальным — как пополнить. Окончательно решает сервер (402).
function paidCheck(feature) {
if (isCurrentAdmin()) return true;
if (paidStatus().balance > 0) return true;
paidOffer(feature);
return false;
}

async function paidOffer(feature) {
const st = paidStatus();
const offer = (cloudData.self && cloudData.self.aiOffer) || '';
const head = `${feature ? PAID_NAMES[feature] + ' — платная функция. ' : ''}Вы пополняете баланс, а каждый запрос списывает с него свою цену. Сообщение помощнику обычно стоит 1–10 ₽, распознавание плана — 10–25 ₽. Сколько стоил запрос, видно под каждым ответом.`
+ `\n\nНа балансе: ${paidRub(st.balance)}`
+ (offer ? '\n\n' + offer : '');
if (st.requestedAt) {
alert(`${head}\n\nВы уже отправили запрос ${paidDate(st.requestedAt)} — администратор его видит.`);
return;
}
if (!confirm(head + '\n\nОтправить администратору запрос на пополнение?')) return;
try {
const res = await fetch(`${WORKER_URL}/ai-access-request`, {
method: 'POST',
headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
body: JSON.stringify({})
});
const data = await res.json().catch(() => null);
if (!res.ok || !data || !data.ai) { alert((data && data.error) || 'Не удалось отправить запрос'); return; }
if (cloudData.self) cloudData.self.ai = data.ai;
alert('Запрос отправлен. Когда администратор пополнит баланс, функция заработает (обновите страницу).');
} catch (e) {
alert('Ошибка сети — запрос не отправлен');
}
}

// Ответ сервера «нет денег» — объясняем и предлагаем пополнить
function paidDenied(feature, data) {
if (data && data.noAccess) {
if (cloudData.self && cloudData.self.ai) cloudData.self.ai.balance = 0;
paidOffer(feature);
}
}

// Мастеру — только рубли
function paidMonthRub(month) {
return Object.keys(PAID_NAMES).map(f => {
const m = (month || {})[f] || {};
return `${PAID_NAMES[f]}: ${paidRub(m.spent)} (запросов: ${paidFmt(m.requests)})`;
}).join('<br>');
}

function paidMonthHtml(month) {
return Object.keys(PAID_NAMES).map(f => {
const m = (month || {})[f] || {};
return `${PAID_NAMES[f]}: ${paidRub(m.spent)} · запросов ${paidFmt(m.requests)} · токенов ${paidFmt(m.tokensIn)} вход / ${paidFmt(m.tokensOut)} выход`;
}).join('<br>');
}

// Профиль: баланс и расход за месяц
function paidProfileHtml() {
if (isCurrentClient()) return '';
if (isCurrentAdmin()) return '<div class="paid-box"><b>Платные функции</b><div class="paid-row">У администратора доступ без оплаты. Балансы мастеров — в меню «Платные функции».</div></div>';
const st = paidStatus();
return `<div class="paid-box"><b>Платные функции: распознавание плана и помощник</b>
<div class="paid-balance">На балансе: <b>${paidRub(st.balance)}</b></div>
<div class="paid-row"><small>Каждый запрос списывает с баланса свою цену: за то, что отправлено нейросети (ваш вопрос, картинка плана, прайс), и за её ответ. Чем больше картинка и длиннее разговор, тем дороже. Обычно сообщение помощнику — 1–10 ₽, распознавание плана — 10–25 ₽. Точная цена — под каждым ответом.</small></div>
<div class="paid-row"><small>Потрачено в этом месяце:<br>${paidMonthRub(st.month)}</small></div>
${st.pays && st.pays.length ? `<div class="paid-row"><small>Пополнения: ${st.pays.slice(0, 5).map(p => `${paidDate(p.at)} — ${paidRub(p.amount)}`).join('; ')}</small></div>` : ''}
<button type="button" class="btn btn-sm" onclick="paidOffer()">${st.requestedAt ? 'Как пополнить' : 'Пополнить баланс'}</button>
</div>`;
}

/* ---------- админ: раздел «Платные функции» ---------- */

let paidAdmin = null; // { users, settings, self, now }

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
const pending = users.filter(u => u.ai.requestedAt);
if (cloudData.self) { cloudData.self.aiPending = pending.length; paidPendingBadge(); }
const sorted = [...pending, ...users.filter(u => !u.ai.requestedAt)];
box.innerHTML = `
<div class="paid-box">
<b>Что видят мастера, когда на балансе нет денег</b>
<textarea id="paidOffer" rows="3" placeholder="Например: перевод на карту по номеру +7… с пометкой «баланс», потом напишите мне — зачислю">${escapeHtml(settings.offer || '')}</textarea>
<b>Цены для мастеров, ₽ за 1 млн токенов</b>
<div class="paid-limits">
<label>что отправлено нейросети <input type="number" id="paidPriceIn" min="0" step="10" value="${settings.prices.in}"></label>
<label>ответ нейросети <input type="number" id="paidPriceOut" min="0" step="10" value="${settings.prices.out}"></label>
</div>
<small class="paid-muted">Ваша цена у ProxyAPI для Sonnet 5.5: 500 и 2500 ₽ (ввод и вывод). Поставите выше — разница остаётся вам. Мастера видят только рубли: под каждым ответом — сколько стоило отправленное и ответ.</small>
<button type="button" class="btn btn-success btn-sm" onclick="paidSaveSettings()">Сохранить</button>
</div>
${paidAdmin.self ? `<div class="paid-box"><b>Ваш расход в этом месяце (без списаний)</b><small class="paid-muted">${paidMonthHtml(paidAdmin.self.month)}</small></div>` : ''}
${sorted.length ? sorted.map(paidUserHtml).join('') : '<div class="paid-muted">Мастеров пока нет.</div>'}`;
}

function paidUserHtml(u) {
const st = u.ai;
const login = escapeHtml(JSON.stringify(u.login));
return `<div class="paid-user${st.requestedAt ? ' paid-req' : ''}">
<div class="paid-user-head"><b>${escapeHtml(u.login)}</b> <small class="paid-muted">${escapeHtml(u.email || '')}</small>
${st.requestedAt ? `<span class="paid-ask">просит пополнить с ${paidDate(st.requestedAt)}</span>` : ''}</div>
<div class="paid-balance">Баланс: <b class="${st.balance > 0 ? 'paid-on' : 'paid-off'}">${paidRub(st.balance)}</b></div>
<small class="paid-muted">В этом месяце:<br>${paidMonthHtml(st.month)}<br>Всего потрачено: ${paidRub(st.spentTotal)}</small>
<div class="paid-btns">
<button type="button" class="btn btn-sm" onclick='paidAdd(${login}, 300)'>+300 ₽</button>
<button type="button" class="btn btn-sm" onclick='paidAdd(${login}, 500)'>+500 ₽</button>
<button type="button" class="btn btn-sm" onclick='paidAdd(${login}, 1000)'>+1000 ₽</button>
<input type="number" step="1" placeholder="Сумма, ₽" aria-label="Сумма пополнения" id="paidSum_${escapeHtml(u.login)}">
<button type="button" class="btn btn-success btn-sm" onclick='paidAddInput(${login})'>Зачислить</button>
</div>
${st.pays && st.pays.length ? `<small class="paid-muted">Пополнения: ${st.pays.slice(0, 5).map(p => `${paidDate(p.at)} ${p.amount > 0 ? '+' : ''}${paidRub(p.amount)}`).join('; ')}</small>` : ''}
</div>`;
}

async function paidPut(body) {
try {
const res = await fetch(`${WORKER_URL}/ai-access`, {
method: 'PUT',
headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
body: JSON.stringify(body)
});
const data = await res.json().catch(() => null);
if (!res.ok || !data) { alert((data && data.error) || 'Не удалось сохранить'); return false; }
paidAdmin = data;
paidAdminDraw();
return true;
} catch (e) {
alert('Ошибка сети — не сохранилось');
return false;
}
}

async function paidAdd(login, amount) {
if (!confirm(`${amount > 0 ? 'Зачислить' : 'Списать'} ${paidRub(Math.abs(amount))} — ${login}?`)) return;
if (await paidPut({ login, add: amount })) showAddToast(`Баланс ${login}: ${amount > 0 ? '+' : ''}${paidRub(amount)}`);
}

// Своя сумма; с минусом — списать (исправить ошибку)
function paidAddInput(login) {
const el = document.getElementById('paidSum_' + login);
const v = Math.round(Number(String(el && el.value || '').replace(',', '.')) * 100) / 100;
if (!v) { alert('Введите сумму в рублях. Чтобы списать — со знаком минус.'); return; }
paidAdd(login, v);
}

async function paidSaveSettings() {
const num = id => Math.max(0, Number(String(document.getElementById(id).value).replace(',', '.')) || 0);
if (await paidPut({ settings: { offer: document.getElementById('paidOffer').value, prices: { in: num('paidPriceIn'), out: num('paidPriceOut') } } })) showAddToast('Сохранено');
}
