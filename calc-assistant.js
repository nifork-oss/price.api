// Кабинет мастера — «Помощник»: чат с нейросетью по текущему счёту.
// Видит прайс, помещения выбранного объекта с замерами и счёт; предлагает
// позиции, мастер сам отмечает нужные и добавляет. Объём по поверхности
// помещения считает калькулятор (как «+ Работа»), а не нейросеть.
// Подключается из calc.html после calc-rooms.js.

let assistantChat = [];      // [{ role: 'user'|'assistant', content, items? }]
let assistantBusy = false;

function assistantConsentKey() { return 'assistantConsent:' + (currentUser || ''); }

function openAssistant() {
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

function clearAssistant() {
if (assistantBusy) return;
assistantChat = [];
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

async function sendAssistant() {
const input = document.getElementById('assistantInput');
const text = input.value.trim();
if (!text || assistantBusy) return;
assistantChat.push({ role: 'user', content: text });
input.value = '';
assistantBusy = true;
renderAssistant();
try {
const res = await fetch(`${WORKER_URL}/assistant`, {
method: 'POST',
headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
body: JSON.stringify({ messages: assistantChat.map(m => ({ role: m.role, content: assistantHistoryText(m) })), context: assistantContext() })
});
const data = await res.json().catch(() => null);
if (res.status === 501) {
assistantChat.push({ role: 'assistant', error: true, content: 'Помощник пока не подключён. Чтобы включить: получите ключ API на console.anthropic.com и добавьте его в Cloudflare → ваш воркер → Settings → Variables and Secrets как секрет ANTHROPIC_API_KEY.' });
} else if (!res.ok || !data) {
assistantChat.push({ role: 'assistant', error: true, content: (data && data.error) || 'Помощник не ответил. Попробуйте ещё раз.' });
} else {
const items = assistantPrepareItems(data.items || []);
assistantChat.push({ role: 'assistant', content: data.text || (items.length ? 'Предлагаю добавить:' : 'Нечего предложить.'), items });
}
} catch (err) {
assistantChat.push({ role: 'assistant', error: true, content: 'Нет связи с сервером: ' + (err && err.message ? err.message : err) });
}
assistantBusy = false;
renderAssistant();
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
if (it) it.checked = on;
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
renderAssistant();
}

function renderAssistant() {
const box = document.getElementById('assistantMessages');
if (!box) return;
if (!assistantChat.length) {
box.innerHTML = `<div class="as-hint">Опишите, что нужно сделать, — помощник подберёт работы из вашего прайса и посчитает объём по замерам помещений.
<div class="as-examples">
<button type="button" onclick="assistantExample(this)">Покраска стен и потолка во всех помещениях</button>
<button type="button" onclick="assistantExample(this)">Что я мог забыть в этом счёте?</button>
<button type="button" onclick="assistantExample(this)">Объясни, из чего складывается сумма</button>
</div></div>`;
} else {
box.innerHTML = assistantChat.map((m, mi) => {
const cls = m.role === 'user' ? 'as-msg as-user' : 'as-msg as-bot' + (m.error ? ' as-error' : '');
let html = `<div class="${cls}"><div class="as-text">${m.role === 'user' ? escapeHtml(m.content) : assistantTextHtml(m.content)}</div>`;
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
if (assistantBusy) box.innerHTML += '<div class="as-msg as-bot as-wait"><div class="as-text">Думаю…</div></div>';
}
box.scrollTop = box.scrollHeight;
document.getElementById('assistantSend').disabled = assistantBusy;
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
