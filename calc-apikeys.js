// Кабинет мастера — API-ключи и замеры от ИИ-агента.
// В профиле мастер создаёт именованный ключ и отдаёт его своему ИИ-агенту
// или сайту (вместе с инструкцией — кнопка «Скопировать для ИИ-агента»).
// По ключу можно смотреть прайс, заводить объекты, присылать замеры и
// создавать сметы. Замеры от агента ждут у объекта: мастер проверяет их
// на том же экране, что после распознавания плана, и только потом добавляет.
// Подключается из calc.html после calc-planfile.js.

let apiKeysState = { keys: null, fresh: null, error: '' };

function apiModeLabel(mode) {
return mode === 'company' ? 'своя компания' : 'сотрудник';
}

function apiDate(ms) {
return ms ? new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

async function apiKeysRequest(method, query, body) {
const res = await fetch(`${WORKER_URL}/api-keys${query || ''}`, {
method,
headers: { 'Authorization': 'Bearer ' + authToken, ...(body ? { 'Content-Type': 'application/json' } : {}) },
...(body ? { body: JSON.stringify(body) } : {})
});
const data = await res.json().catch(() => null);
if (!res.ok || !data) throw new Error((data && data.error) || 'Сервер не ответил');
return data;
}

// Вызывается из renderProfile
async function renderApiKeys() {
const box = document.getElementById('apiKeysBox');
if (!box) return;
box.style.display = isCurrentClient() ? 'none' : 'block';
if (isCurrentClient()) return;
drawApiKeys();
try {
const data = await apiKeysRequest('GET');
apiKeysState.keys = data.keys;
apiKeysState.error = '';
} catch (e) {
apiKeysState.error = 'Не удалось загрузить ключи: ' + e.message;
}
drawApiKeys();
}

function drawApiKeys() {
const list = document.getElementById('apiKeysList');
const fresh = document.getElementById('apiKeyFresh');
const where = document.getElementById('apiKeysWhere');
if (!list || !fresh) return;
if (where) where.textContent = isCompanyMode() ? '«своей компании»' : 'общего кабинета (режим «сотрудник»)';
const st = apiKeysState;
if (st.error) list.innerHTML = `<div class="api-key-empty">${escapeHtml(st.error)}</div>`;
else if (!st.keys) list.innerHTML = '<div class="api-key-empty">Загрузка…</div>';
else if (!st.keys.length) list.innerHTML = '<div class="api-key-empty">Ключей пока нет</div>';
else list.innerHTML = st.keys.map(k => `<div class="api-key-row">
<div class="api-key-info">
<b>${escapeHtml(k.name)}</b>
<small>…${escapeHtml(k.tail)} · ${apiModeLabel(k.mode)} · создан ${apiDate(k.createdAt)}${k.lastUsedAt ? ` · работал ${apiDate(k.lastUsedAt)}` : ' · ещё не использовался'}</small>
</div>
<button type="button" class="btn btn-danger btn-sm" onclick="revokeApiKey('${escapeHtml(k.id)}')">Отозвать</button>
</div>`).join('');
fresh.innerHTML = st.fresh ? `<div class="api-key-fresh">
<div class="api-key-fresh-title">Ключ «${escapeHtml(st.fresh.name)}» создан</div>
<input type="text" readonly value="${escapeHtml(st.fresh.key)}" onclick="this.select()">
<p>Скопируйте его сейчас: потом ключ не показывается — только последние 4 знака. Потеряли — отзовите и создайте новый.</p>
<div style="display:flex; gap:8px; flex-wrap:wrap;">
<button type="button" class="btn btn-primary btn-sm" onclick="copyApiGuide()">🤖 Скопировать для ИИ-агента</button>
<button type="button" class="btn btn-ghost btn-sm" onclick="copyApiText(apiKeysState.fresh.key, 'Ключ скопирован')">Только ключ</button>
</div>
</div>` : '';
}

async function createApiKeyUi() {
const input = document.getElementById('apiKeyName');
const name = (input.value || '').trim();
if (!name) { alert('Назовите ключ — например, «Мой ИИ-агент» или по адресу сайта.'); input.focus(); return; }
try {
const data = await apiKeysRequest('POST', '', { name, site: window.location.href });
apiKeysState = { keys: data.keys, fresh: { name, key: data.key, guide: data.guide }, error: '' };
input.value = '';
drawApiKeys();
} catch (e) {
alert(e.message);
}
}

async function revokeApiKey(id) {
const k = (apiKeysState.keys || []).find(x => x.id === id);
if (!confirm(`Отозвать ключ «${k ? k.name : ''}»? Всё, что работает с этим ключом, сразу перестанет работать.`)) return;
try {
const data = await apiKeysRequest('DELETE', `?id=${encodeURIComponent(id)}`);
apiKeysState.keys = data.keys;
drawApiKeys();
} catch (e) {
alert(e.message);
}
}

function copyApiGuide() {
const f = apiKeysState.fresh;
if (f) copyApiText(f.guide, 'Скопировано — вставьте это своему ИИ-агенту первым сообщением');
}

async function copyApiText(text, done) {
try {
await navigator.clipboard.writeText(text);
showAddToast(done);
} catch (e) {
prompt('Скопируйте вручную:', text);
}
}

/* ---------- замеры от ИИ-агента у объекта ---------- */

// Вызывается из renderObjectDetail
function agentPlansHtml(obj) {
const plans = Array.isArray(obj.agentPlans) ? obj.agentPlans : [];
if (!plans.length || isCurrentClient()) return '';
return `<div class="agent-plans">${plans.map(p => {
const n = Array.isArray(p.rooms) ? p.rooms.length : 0;
return `<div class="agent-plan">
<div class="agent-plan-info">
<b>🤖 Замеры от ИИ-агента${p.title ? ` · ${escapeHtml(p.title)}` : ''}</b>
<small>Ключ «${escapeHtml(p.from || '')}» · ${n} ${pluralRu(n, 'помещение', 'помещения', 'помещений')} · ${apiDate(p.at)}</small>
</div>
<div style="display:flex; gap:6px; flex-wrap:wrap;">
<button type="button" class="btn btn-primary btn-sm" onclick="reviewAgentPlan('${escapeHtml(obj.id)}', '${escapeHtml(p.id)}')">Проверить и добавить</button>
<button type="button" class="btn btn-ghost btn-sm" onclick="dropAgentPlan('${escapeHtml(obj.id)}', '${escapeHtml(p.id)}')">Убрать</button>
</div>
</div>`;
}).join('')}</div>`;
}

function findAgentPlan(objectId, planId) {
const obj = (cloudData.objects || []).find(o => o.id === objectId);
const plan = obj && Array.isArray(obj.agentPlans) ? obj.agentPlans.find(p => p.id === planId) : null;
return { obj, plan };
}

// Экран проверки — как у плана из файла; после «Добавить» замер у объекта
// убирается (applyAiRooms смотрит на aiTarget.agentPlanId)
function reviewAgentPlan(objectId, planId) {
const { plan } = findAgentPlan(objectId, planId);
if (!plan) return;
showPlanImport(objectId, JSON.stringify({ rooms: plan.rooms, warnings: plan.warnings || [] }), `От ИИ-агента «${plan.from || ''}»`);
if (aiTarget && aiTarget.objectId === objectId) aiTarget.agentPlanId = planId;
}

async function dropAgentPlan(objectId, planId) {
const { obj } = findAgentPlan(objectId, planId);
if (!obj || !confirm('Убрать эти замеры, не добавляя их в объект?')) return;
obj.agentPlans = obj.agentPlans.filter(p => p.id !== planId);
await saveCloudData();
renderObjectDetail();
}
