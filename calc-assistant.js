// Кабинет мастера — «Помощник»: чат с нейросетью по текущему счёту.
// Видит прайс, помещения выбранного объекта с замерами и счёт; предлагает
// позиции, мастер сам отмечает нужные и добавляет. Объём по поверхности
// помещения считает калькулятор (как «+ Работа»), а не нейросеть.
// Подключается из calc.html после calc-rooms.js.

let assistantChat = [];      // [{ role: 'user'|'assistant', content, items? }]
let assistantBusy = false;
let assistantChatId = null;  // под каким id чат лежит в истории (calc-aichats.js)

function assistantConsentKey() { return 'assistantConsent:' + (currentUser || ''); }

function openAssistant() {
if (!paidCheck('assistant')) return;
let ok = false;
try { ok = localStorage.getItem(assistantConsentKey()) === '1'; } catch (e) { /* пусто */ }
if (!ok) {
if (!confirm('Помощник — платная функция.\n\nПрайс, помещения объекта и текущий счёт отправляются в сторонний сервис (нейросеть Claude), каждое сообщение стоит денег по тарифу ключа API. Помощник только предлагает — что добавить в счёт, решаете вы.')) return;
try { localStorage.setItem(assistantConsentKey(), '1'); } catch (e) { /* пусто */ }
}
document.getElementById('assistantPanel').classList.add('open');
document.body.classList.add('assistant-open');
renderAssistant();
setTimeout(() => document.getElementById('assistantInput').focus(), 50);
}

function closeAssistant() {
document.getElementById('assistantPanel').classList.remove('open');
document.body.classList.remove('assistant-open');
}

// «Новый чат»: текущий остаётся в истории, на пустом экране — список прошлых
function clearAssistant() {
if (assistantBusy) return;
assistantChat = [];
assistantChatId = null;
renderAssistant();
}

function saveAssistantChat() {
const messages = assistantChat.filter(m => !m.streaming).map(m => {
const { streaming, picking, ...rest } = m;
return rest;
});
if (!messages.some(m => m.role === 'assistant')) return;
if (!assistantChatId) assistantChatId = aiChatNewId();
const first = messages.find(m => m.role === 'user');
const obj = calcObject();
aiChatSave({ id: assistantChatId, kind: 'assistant', objectId: obj ? obj.id : '',
title: first ? first.content.slice(0, 80) : 'Чат' }, { messages });
}

async function openAssistantChat(id) {
if (assistantBusy) return;
const data = await aiChatGet(id);
if (!data || !Array.isArray(data.messages)) { alert('Не удалось открыть чат.'); aiChatDelete(id); renderAssistant(); return; }
assistantChat = data.messages;
assistantChatId = id;
renderAssistant();
}

function deleteAssistantChat(id) {
if (!confirm('Удалить этот чат из истории?')) return;
aiChatDelete(id);
if (assistantChatId === id) assistantChatId = null;
renderAssistant();
}

// Что видит помощник: только то, что нужно для счёта
function assistantContext() {
const services = [];
let cat = '';
(cloudData.services || []).forEach((srv, i) => {
if (srv.isCategory) { cat = srv.name || ''; return; }
services.push({ i, name: srv.name, price: Number(srv.price) || 0, ...(srv.unit ? { unit: srv.unit } : {}), ...(cat ? { cat } : {}) });
});
const obj = calcObject();
const rooms = objectRooms(obj).map(room => {
const surfaces = {};
try {
const all = roomSurfaces(room);
Object.keys(all).forEach(k => { if (all[k].value > 0) surfaces[k] = `${mFmt(all[k].value)} ${all[k].unit} (${all[k].label})`; });
} catch (e) { /* замер не считается — помещение без поверхностей */ }
return { id: room.id, name: roomName(room), surfaces };
});
const cart = invoiceCart.map(it => ({ name: it.name, qty: it.qty, unit: it.unit, price: it.price, ...(it.location ? { where: it.location } : {}) }));
return {
doc: selectedDocType === 'estimate' ? 'предварительный расчёт' : 'счёт',
currency: '₽',
object: obj ? (obj.name || obj.address || '') : 'не выбран',
services, rooms, cart,
total: invoiceCart.reduce((a, it) => a + it.qty * it.price, 0),
};
}

// Ответ печатается по мере написания; «Стоп» обрывает его и возвращает
// вопрос в поле ввода, чтобы поправить и отправить заново.
let assistantAbort = null;

async function sendAssistant() {
const input = document.getElementById('assistantInput');
const text = input.value.trim();
if (!text || assistantBusy) return;
assistantChat.push({ role: 'user', content: text });
const reply = { role: 'assistant', content: '', thinking: '', streaming: true };
input.value = '';
assistantBusy = true;
assistantAbort = new AbortController();
renderAssistant();
const history = assistantChat.map(m => ({ role: m.role, content: assistantHistoryText(m) }));
assistantChat.push(reply);
let stopped = false;
try {
const res = await fetch(`${WORKER_URL}/assistant`, {
method: 'POST',
headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
body: JSON.stringify({ messages: history, context: assistantContext(), stream: true }),
signal: assistantAbort.signal
});
if (/ndjson/.test(res.headers.get('content-type') || '') && res.body) {
await assistantReadStream(res.body, reply);
} else {
const data = await res.json().catch(() => null);
if (res.status === 501) {
assistantFail(reply, 'Помощник пока не подключён. Чтобы включить: получите ключ API на console.anthropic.com и добавьте его в Cloudflare → ваш воркер → Settings → Variables and Secrets как секрет ANTHROPIC_API_KEY.');
} else if (res.status === 402) {
assistantFail(reply, (data && data.error) || 'Нет доступа к помощнику.');
paidDenied('assistant', data);
} else if (!res.ok || !data) {
assistantFail(reply, (data && data.error) || 'Помощник не ответил. Попробуйте ещё раз.');
} else {
assistantFinish(reply, data);
}
}
} catch (err) {
if (err && err.name === 'AbortError' && reply.streaming) {
stopped = true;
// Остановили — убираем вопрос и недописанный ответ, вопрос — обратно в поле
assistantChat = assistantChat.filter(m => m !== reply);
const last = assistantChat[assistantChat.length - 1];
if (last && last.role === 'user' && last.content === text) assistantChat.pop();
if (!input.value.trim()) input.value = text;
} else if (reply.streaming) {
assistantFail(reply, 'Нет связи с сервером: ' + (err && err.message ? err.message : err));
}
}
if (!stopped && reply.streaming) assistantFail(reply, reply.content ? reply.content + '\n\n(ответ оборвался)' : 'Помощник не ответил. Попробуйте ещё раз.');
assistantBusy = false;
assistantAbort = null;
if (!stopped) saveAssistantChat();
renderAssistant();
if (stopped) setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 0);
}

function stopAssistant() {
if (assistantAbort) assistantAbort.abort();
}

// Строки JSON от сервера: размышления и текст по кусочкам, в конце — позиции
function assistantReadStream(body, reply) {
return readAiStream(body, ev => {
if (ev.t === 'thinking') reply.thinking += ev.d || '';
else if (ev.t === 'text') reply.content += ev.d || '';
else if (ev.t === 'tool') reply.picking = true;
else if (ev.t === 'done') assistantFinish(reply, ev);
else if (ev.t === 'error') assistantFail(reply, ev.error || 'Помощник не ответил.');
scheduleAssistantRender();
});
}

function assistantFinish(reply, data) {
const items = assistantPrepareItems(data.items || []);
reply.content = data.text || (items.length ? 'Предлагаю добавить:' : 'Нечего предложить.');
reply.items = items;
reply.model = data.model || '';
reply.cost = data.cost || null;
paidApplyCost(reply.cost);
reply.streaming = false;
reply.picking = false;
}

function assistantFail(reply, message) {
reply.content = message;
reply.error = true;
reply.streaming = false;
reply.picking = false;
}

let assistantRenderQueued = false;
function scheduleAssistantRender() {
if (assistantRenderQueued) return;
assistantRenderQueued = true;
(window.requestAnimationFrame || setTimeout)(() => { assistantRenderQueued = false; renderAssistant(); });
}

// В историю для нейросети: ответ помощника вместе с тем, что он предлагал
function assistantHistoryText(m) {
if (m.error) return '(ошибка, ответа не было)';
if (!m.items || !m.items.length) return m.content;
return m.content + '\n[Предложено: ' + m.items.map(it => `${it.name} — ${mFmt(it.qty)} ${it.unit}${it.added ? ' (добавлено)' : ''}`).join('; ') + ']';
}

// Проверяем предложения по прайсу и замерам; объём по поверхности — из калькулятора
function assistantPrepareItems(raw) {
const obj = calcObject();
const allRooms = objectRooms(obj);
const out = [];
raw.forEach(p => {
const srv = (cloudData.services || [])[p.service_index];
if (!srv || srv.isCategory) return;
const price = Number(srv.price) || 0;
if (p.surface && SURFACES.some(s => s.key === p.surface)) {
const rooms = allRooms.filter(r => (p.room_ids || []).includes(r.id));
const sum = rooms.length ? sumSurface(rooms, p.surface) : { value: 0 };
if (sum.value > 0) {
out.push({ serviceIdx: p.service_index, name: srv.name, price, surface: p.surface, roomIds: rooms.map(r => r.id),
qty: Math.round(sum.value * 1000) / 1000, unit: sum.unit, where: rooms.map(roomName).join(', '),
label: surfaceInvoiceLabel({ surface: p.surface }), note: p.note || '', checked: true });
return;
}
}
if (!(p.qty > 0)) return;
const unit = DEFAULT_UNITS.includes(p.unit) ? p.unit : (srv.unit || 'усл.');
out.push({ serviceIdx: p.service_index, name: srv.name, price, qty: roundQty(p.qty, unit), unit, where: '', note: p.note || '', checked: true });
});
return out;
}

function toggleAssistantItem(mi, ii, on) {
const it = assistantChat[mi] && assistantChat[mi].items && assistantChat[mi].items[ii];
if (it) { it.checked = on; saveAssistantChat(); }
}

function addAssistantItems(mi) {
const msg = assistantChat[mi];
if (!msg || !msg.items) return;
const obj = calcObject();
let n = 0;
msg.items.forEach(it => {
if (!it.checked || it.added) return;
const srv = (cloudData.services || [])[it.serviceIdx];
if (!srv || srv.name !== it.name) return; // прайс успели поменять
if (it.surface && obj) {
const rooms = objectRooms(obj).filter(r => it.roomIds.includes(r.id));
if (!rooms.length) return;
addSurfaceWork(srv, rooms, obj, it.surface);
} else {
invoiceCart.push({ name: srv.name, price: it.price, qty: it.qty, unit: it.unit, location: '' });
}
it.added = true;
n++;
});
if (!n) { alert('Отметьте позиции, которые нужно добавить.'); return; }
renderInvoice();
scheduleDraftSave();
showAddToast(`Добавлено в счёт: ${n}`);
saveAssistantChat();
renderAssistant();
}

function renderAssistant() {
const box = document.getElementById('assistantMessages');
if (!box) return;
// Листают историю вверх — не дёргаем вниз на каждом кусочке ответа
const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 60 || !assistantBusy;
if (!assistantChat.length) {
box.innerHTML = `<div class="as-hint">Опишите, что нужно сделать, — помощник подберёт работы из вашего прайса и посчитает объём по замерам помещений.
<div class="as-examples">
<button type="button" onclick="assistantExample(this)">Покраска стен и потолка во всех помещениях</button>
<button type="button" onclick="assistantExample(this)">Что я мог забыть в этом счёте?</button>
<button type="button" onclick="assistantExample(this)">Объясни, из чего складывается сумма</button>
</div></div>`;
const past = aiChatsList('assistant');
if (past.length) box.innerHTML += '<div class="ai-hist-title">Прошлые чаты</div>' + aiChatsListHtml(past, 'openAssistantChat', 'deleteAssistantChat');
} else {
box.innerHTML = assistantChat.map((m, mi) => {
const cls = m.role === 'user' ? 'as-msg as-user' : 'as-msg as-bot' + (m.error ? ' as-error' : '');
let html = `<div class="${cls}">`;
if (m.thinking) html += `<details class="as-think"${m.streaming && !m.content ? ' open' : ''}><summary>${m.streaming && !m.content ? 'Размышляю…' : 'Ход рассуждений'}</summary><div>${escapeHtml(m.thinking)}</div></details>`;
if (m.content) html += `<div class="as-text">${m.role === 'user' ? escapeHtml(m.content) : assistantTextHtml(m.content)}</div>`;
if (m.cost && !m.streaming) html += paidCostHtml(m.cost);
if (m.model && !m.streaming) html += `<div class="as-model">${escapeHtml(m.model)}</div>`;
if (m.streaming) html += `<div class="as-status">${m.picking ? 'Подбираю позиции…' : m.content ? 'Пишу…' : m.thinking ? '' : 'Думаю…'}</div>`;
if (m.items && m.items.length) {
html += '<div class="as-items">' + m.items.map((it, ii) => `
<label class="as-item${it.added ? ' added' : ''}">
<input type="checkbox" ${it.checked ? 'checked' : ''} ${it.added ? 'disabled' : ''} onchange="toggleAssistantItem(${mi}, ${ii}, this.checked)">
<span class="as-item-body">
<b>${escapeHtml(it.name)}</b>
<span>${mFmt(it.qty)} ${escapeHtml(it.unit)} × ${Number(it.price).toLocaleString('ru-RU')} ₽ = ${(Math.round(it.qty * it.price * 100) / 100).toLocaleString('ru-RU')} ₽</span>
${it.where ? `<small>${escapeHtml((it.label ? it.label + ': ' : '') + it.where)}</small>` : ''}
${it.note ? `<small>${escapeHtml(it.note)}</small>` : ''}
${it.added ? '<small class="as-added">в счёте</small>' : ''}
</span>
</label>`).join('') + '</div>';
if (m.items.some(it => !it.added)) html += `<button type="button" class="as-add" onclick="addAssistantItems(${mi})">Добавить отмеченное в счёт</button>`;
}
return html + '</div>';
}).join('');
}
if (stick) box.scrollTop = box.scrollHeight;
const thinkBox = box.querySelector('.as-think[open] > div');
if (thinkBox) thinkBox.scrollTop = thinkBox.scrollHeight;
const btn = document.getElementById('assistantSend');
btn.classList.toggle('as-stop', assistantBusy);
btn.setAttribute('aria-label', assistantBusy ? 'Остановить' : 'Отправить');
btn.innerHTML = assistantBusy ? '<svg class="ic"><use href="#i-stop"/></svg>' : '<svg class="ic"><use href="#i-go"/></svg>';
}

// Ответ нейросети обычным текстом: **жирный** — жирным, остальная разметка
// и служебные номера услуг «(i=25)» убираются.
function assistantTextHtml(text) {
return escapeHtml(String(text || '')
.replace(/\s*\(?\bi\s*=\s*\d+\)?/g, '')
.replace(/^#{1,6}\s+/gm, '')
.replace(/`/g, ''))
.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
.replace(/(^|\s)\*(\S[^*\n]*?)\*(?=\s|$|[.,:;!?])/g, '$1$2');
}

function assistantExample(btn) {
document.getElementById('assistantInput').value = btn.textContent;
sendAssistant();
}
