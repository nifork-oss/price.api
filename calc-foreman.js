// Кабинет мастера — прораб по ссылке-приглашению.
// У объекта мастер создаёт личную ссылку и отправляет её прорабу. Прораб открывает foreman.html
// без входа и по счетам этого объекта нажимает «Одобрить» или «Отклонить» (с причиной).
// Здесь — блок у объекта: создать, скопировать, отправить, выпустить заново или отозвать ссылку,
// и видно, что решил прораб по каждому счёту. Решения хранит сервер отдельно от счетов (fa:<id>).
// Подключается из calc.html после calc-apikeys.js.

const foremanState = {};   // id объекта → { invite, docs, error, loading }

function foremanUrl(token) {
const base = window.location.href.replace(/calc\.html.*$/, '').replace(/[?#].*$/, '');
return `${base}foreman.html?t=${encodeURIComponent(token)}`;
}

async function foremanRequest(method, objectId, body) {
const res = await fetch(`${WORKER_URL}/foreman-invite?objectId=${encodeURIComponent(objectId)}`, {
method,
headers: { 'Authorization': 'Bearer ' + authToken, ...(body ? { 'Content-Type': 'application/json' } : {}) },
...(body ? { body: JSON.stringify(body) } : {})
});
const data = await res.json().catch(() => null);
if (!res.ok || !data) throw new Error((data && data.error) || 'Сервер не ответил');
return data;
}

// Место под блок — в renderObjectDetail; данные подтягиваются отдельно
function foremanCardHtml(obj) {
if (isCurrentClient() || !obj) return '';
setTimeout(() => foremanLoad(obj.id), 0);
return `<div class="foreman-card" id="foremanCard">${foremanInner(obj.id)}</div>`;
}

async function foremanLoad(objectId) {
const st = foremanState[objectId] || (foremanState[objectId] = {});
st.loading = true;
try {
const data = await foremanRequest('GET', objectId);
st.invite = data.invite; st.docs = data.docs; st.error = '';
} catch (e) {
st.error = 'Не удалось загрузить: ' + e.message;
}
st.loading = false;
foremanDraw(objectId);
}

function foremanDraw(objectId) {
const box = document.getElementById('foremanCard');
if (box && typeof currentObjectId !== 'undefined' && currentObjectId === objectId) box.innerHTML = foremanInner(objectId);
}

function foremanStatusChip(a) {
if (!a) return '<span class="fm-chip fm-wait">ждёт решения</span>';
const ok = a.status === 'approved';
return `<span class="fm-chip ${ok ? 'fm-ok' : 'fm-bad'}">${ok ? 'одобрил' : 'отклонил'}${a.changed ? ' · сумма изменилась' : ''}</span>`;
}

function foremanInner(objectId) {
const st = foremanState[objectId] || {};
const id = escapeHtml(objectId);
let body;
if (st.error) body = `<div class="api-key-empty">${escapeHtml(st.error)}</div>`;
else if (!st.docs && st.loading !== false) body = '<div class="api-key-empty">Загрузка…</div>';
else if (!st.invite) body = `<div class="fm-hint">Отправьте прорабу личную ссылку: по ней, без входа и пароля, он увидит счета этого объекта и одобрит или отклонит каждый. Решение и причина отказа появятся здесь.</div>
<button type="button" class="btn btn-primary btn-sm" onclick="foremanCreate('${id}')">Создать ссылку для прораба</button>`;
else {
const url = foremanUrl(st.invite.token);
body = `<div class="fm-link"><input type="text" readonly value="${escapeHtml(url)}" onfocus="this.select()" aria-label="Ссылка для прораба"></div>
<div class="fm-btns">
<button type="button" class="btn btn-primary btn-sm" onclick="foremanSend('${id}')">Отправить</button>
<button type="button" class="btn btn-ghost btn-sm" onclick="foremanCopy('${id}')">Скопировать</button>
<button type="button" class="btn btn-ghost btn-sm" onclick="foremanCreate('${id}', true)">Новая ссылка</button>
<button type="button" class="btn btn-ghost btn-sm" onclick="foremanRevoke('${id}')">Отозвать</button>
</div>
<small class="fm-small">${st.invite.name ? 'Для: ' + escapeHtml(st.invite.name) + ' · ' : ''}создана ${apiDate(st.invite.createdAt)}. «Новая ссылка» отключает прежнюю.</small>`;
}
const docs = Array.isArray(st.docs) ? st.docs : [];
const list = st.invite && docs.length ? `<div class="fm-docs">${docs.map(d => `<div class="fm-doc">
<div class="fm-doc-info"><b>${escapeHtml(d.title || (d.docType === 'estimate' ? 'Смета' : 'Счёт'))}</b><small>${escapeHtml(d.date || '')} · ${Number(d.total || 0).toLocaleString('ru-RU')} ₽${d.approval && d.approval.comment ? ' · «' + escapeHtml(d.approval.comment) + '»' : ''}</small></div>
${foremanStatusChip(d.approval)}
</div>`).join('')}</div>` : (st.invite ? '<small class="fm-small">Счетов по этому объекту пока нет — прораб увидит их, когда они появятся.</small>' : '');
return `<h2 style="margin-top:18px;">Прораб${st.invite ? '' : ' — ссылка для согласования'}</h2>${body}${list}`;
}

async function foremanCreate(objectId, again) {
if (again && !confirm('Выпустить новую ссылку? Прежняя перестанет открываться — прорабу нужно будет отправить новую. Его решения по счетам останутся.')) return;
const obj = (cloudData.objects || []).find(o => o.id === objectId);
try {
const data = await foremanRequest('POST', objectId, { name: obj && obj.foreman ? obj.foreman : '' });
(foremanState[objectId] = foremanState[objectId] || {}).invite = data.invite;
await foremanLoad(objectId);
showAddToast('Ссылка для прораба готова');
} catch (e) { alert('Не удалось создать ссылку: ' + e.message); }
}

async function foremanRevoke(objectId) {
if (!confirm('Отозвать ссылку? Прораб больше не сможет её открыть. Уже принятые решения останутся.')) return;
try {
await foremanRequest('DELETE', objectId);
await foremanLoad(objectId);
showAddToast('Ссылка отозвана');
} catch (e) { alert('Не удалось отозвать ссылку: ' + e.message); }
}

function foremanText(objectId) {
const st = foremanState[objectId] || {};
const obj = (cloudData.objects || []).find(o => o.id === objectId) || {};
const url = foremanUrl(st.invite.token);
return { url, text: `${obj.foreman ? obj.foreman + ', здравствуйте! ' : 'Здравствуйте! '}По объекту «${obj.name || ''}» нужно одобрить или отклонить счета — откройте ссылку, вход не нужен:\n${url}` };
}

async function foremanCopy(objectId) {
const st = foremanState[objectId];
if (!st || !st.invite) return;
const { url } = foremanText(objectId);
try { await navigator.clipboard.writeText(url); showAddToast('Ссылка скопирована'); } catch (e) { prompt('Скопируйте ссылку:', url); }
}

function foremanSend(objectId) {
const st = foremanState[objectId];
if (!st || !st.invite) return;
const { url, text } = foremanText(objectId);
const items = [
{ icon: '💬', label: 'WhatsApp', onClick: () => window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener') },
{ icon: '📤', label: 'Telegram', onClick: () => window.open('https://t.me/share/url?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text.replace(url, '').trim()), '_blank', 'noopener') },
];
if (navigator.share) items.push({ icon: '📤', label: 'Другое приложение…', onClick: () => navigator.share({ text }).catch(() => {}) });
items.push({ icon: '🔗', label: 'Скопировать ссылку', onClick: () => foremanCopy(objectId) });
openSheet('Отправить прорабу', items);
}
