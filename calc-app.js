// Кабинет мастера — основное: вход, калькулятор, счета, объекты, история, PDF счёта.
// Подключается из calc.html; порядок подключения важен.

const WORKER_URL = "https://price-api.nifork.workers.dev";
const DEFAULT_UNITS = ['м²', 'пог. м', 'шт.', 'компл.', 'час', 'усл.'];
(function initCustomItemUnitSelect() {
const sel = document.getElementById('customItemUnit');
if (sel) sel.innerHTML = DEFAULT_UNITS.map(u => `<option value="${u}">${u}</option>`).join('');
})();
let cloudData = { services: [], users: [], history: [], objects: [] };
let currentUser = null;
let currentUserRole = null;
let currentUserMode = 'employee';
let currentUserHasTriedCompanyMode = false;
let authToken = null;
let invoiceCart = [];
let invoiceAttachments = [];
let currentObjectId = null;
// Версия данных с сервера — отправляется при сохранении, чтобы не затереть
// изменения, которые кто-то сделал после того, как мы загрузили данные.
let cloudRev = null;
let editingRecordId = null;
let editingReturnContext = null;
let selectedRegisterRole = 'master';
let selectedLoginMode = 'employee';
let selectedDocType = 'invoice';
let objectHistorySubTab = 'invoice';

function escapeHtml(str) {
return String(str ?? '')
.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
.replace(/"/g, "&quot;").replace(/'/g, "&#14181f;");
}

window.addEventListener('DOMContentLoaded', async () => {
authToken = localStorage.getItem('authToken');
const savedUser = localStorage.getItem('currentUser');
currentUserRole = localStorage.getItem('currentUserRole');
currentUserMode = localStorage.getItem('currentUserMode') || 'employee';
currentUserHasTriedCompanyMode = localStorage.getItem('currentUserHasTriedCompanyMode') === 'true';
if (authToken && savedUser) {
currentUser = savedUser;
await loadCloudData();
if (cloudData && Array.isArray(cloudData.objects)) {
showAppScreen();
} else {
handleLogout();
}
}
document.getElementById('clientName').addEventListener('input', updateInvoiceInfo);
document.getElementById('objectAddress').addEventListener('input', updateInvoiceInfo);
document.getElementById('invoiceNote').addEventListener('input', updateInvoiceInfo);

// Если прайс-лист поменяли в другой вкладке (например, через "Редактировать
// свой прайс-лист", который открывается отдельно) — эта вкладка сама этого
// не узнает, пока страницу не перезагрузить. Обновляем список услуг при
// возврате на эту вкладку, чтобы кнопки "Добавить в счёт" не ссылались на
// уже неактуальные позиции.
document.addEventListener('visibilitychange', async () => {
if (document.visibilityState === 'visible' && authToken && currentUser) {
await loadCloudData();
}
});
});

// Перерисовывает открытые вкладки после повторной загрузки данных.
function refreshViewsAfterReload() {
try {
if (!isCurrentClient()) {
populateObjectSelect();
renderHistory();
}
if (document.getElementById('objectsTab').style.display === 'block') {
if (currentObjectId) renderObjectDetail(); else renderObjects();
}
if (document.getElementById('usersTab').style.display === 'block') renderUsersList();
} catch (e) {
console.error('Не удалось обновить экран:', e);
}
}

async function loadCloudData() {
if (!authToken) return;
const loader = document.getElementById('loader');
const maxAttempts = 3;
try {
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
try {
if (loader) {
loader.style.display = 'block';
loader.textContent = attempt === 1 ? 'Загрузка данных...' : `Облако не отвечает, пробую ещё раз (${attempt}/${maxAttempts})...`;
}
const res = await fetch(`${WORKER_URL}/appdata`, {
headers: { "Authorization": "Bearer " + authToken }
});
if (res.ok) {
const result = await res.json();
cloudData = result.data;
cloudRev = typeof result.rev === 'number' ? result.rev : null;
if (!Array.isArray(cloudData.objects)) cloudData.objects = [];
cloudData.self = result.self || { login: currentUser, email: '', companyName: '' };
if (result.role) {
currentUserRole = result.role;
localStorage.setItem('currentUserRole', currentUserRole);
}
if (result.mode) {
currentUserMode = result.mode;
localStorage.setItem('currentUserMode', currentUserMode);
}
if (typeof result.hasTriedCompanyMode === 'boolean') {
currentUserHasTriedCompanyMode = result.hasTriedCompanyMode;
localStorage.setItem('currentUserHasTriedCompanyMode', String(currentUserHasTriedCompanyMode));
}
return;
}
if (res.status === 401) {
authToken = null;
localStorage.removeItem('authToken');
localStorage.removeItem('currentUser');
return;
}
// Другие коды (перегрузка, лимиты облака и т.п.) — есть смысл повторить.
if (attempt === maxAttempts) return;
} catch (e) {
console.error(`Ошибка загрузки (попытка ${attempt}/${maxAttempts}):`, e);
if (attempt === maxAttempts) return;
}
await new Promise(r => setTimeout(r, 600 * attempt));
}
} finally {
if (loader) loader.style.display = 'none';
renderServices();
}
}

async function saveCloudData() {
const maxAttempts = 3;
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
showSyncStatus(attempt === 1 ? 'Сохраняю в облако…' : `Не получилось, пробую ещё раз (${attempt}/${maxAttempts})…`);
try {
const res = await fetch(`${WORKER_URL}/appdata`, {
method: "PUT",
headers: { "Content-Type": "application/json", "Authorization": "Bearer " + authToken },
body: JSON.stringify({ ...cloudData, self: undefined, baseRev: cloudRev ?? undefined })
});
let result = null;
try { result = await res.json(); } catch (parseErr) { /* ответ мог быть пустым */ }
if (res.status === 409) {
// Кто-то другой успел сохранить изменения — наши данные устарели.
// Не перезаписываем его работу: загружаем свежие данные и просим
// повторить последнее действие.
hideSyncStatus(0);
const savedSelf = cloudData.self;
await loadCloudData();
if (!cloudData.self) cloudData.self = savedSelf;
refreshViewsAfterReload();
alert((result && result.error) || 'Данные изменились на другом устройстве. Загружены свежие данные — повторите последнее действие.');
return false;
}
if (res.ok) {
const keepSelf = cloudData.self;
cloudData = result ? result.data : cloudData;
if (cloudData && !cloudData.self) cloudData.self = keepSelf;
if (result && typeof result.rev === 'number') cloudRev = result.rev;
showSyncStatus('Сохранено');
hideSyncStatus();
return true;
}
if (res.status === 401) {
hideSyncStatus(0);
alert("Сессия истекла, войдите снова.");
handleLogout();
return false;
}
if (attempt === maxAttempts) {
hideSyncStatus(0);
alert('Не удалось сохранить данные' + (result && result.error ? (': ' + result.error) : (' (ошибка ' + res.status + ')')) + '. Попробуйте ещё раз — изменения могли не сохраниться в облаке.');
return false;
}
} catch (e) {
console.error(`Ошибка сохранения (попытка ${attempt}/${maxAttempts}):`, e);
if (attempt === maxAttempts) {
hideSyncStatus(0);
alert('Не удалось сохранить данные: нет соединения с сервером. Изменения не сохранены в облаке, попробуйте ещё раз.');
return false;
}
}
await new Promise(r => setTimeout(r, 600 * attempt));
}
return false;
}

function switchAuthMode(mode) {
document.getElementById('loginFormSection').style.display = mode === 'login' ? 'block' : 'none';
document.getElementById('registerFormSection').style.display = mode === 'register' ? 'block' : 'none';
document.getElementById('recoveryFormSection').style.display = mode === 'recovery' ? 'block' : 'none';
document.getElementById('authError').style.display = 'none';
document.getElementById('regError').style.display = 'none';
if (mode === 'register') setRegisterRole('master');
if (mode === 'login') setLoginMode('employee');
}

async function handleLogin() {
const inputVal = document.getElementById('loginInput').value.trim();
const p = document.getElementById('passInput').value.trim();
const errDiv = document.getElementById('authError');
try {
const res = await fetch(`${WORKER_URL}/login`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ login: inputVal, password: p, mode: selectedLoginMode })
});
const result = await res.json();
if (!res.ok) {
errDiv.textContent = result.error || 'Неверный логин/email или пароль';
errDiv.style.display = 'block';
return;
}
authToken = result.token;
currentUser = result.login;
currentUserRole = result.role;
currentUserMode = result.mode || 'employee';
localStorage.setItem('authToken', authToken);
localStorage.setItem('currentUser', currentUser);
localStorage.setItem('currentUserRole', currentUserRole);
localStorage.setItem('currentUserMode', currentUserMode);
currentUserHasTriedCompanyMode = !!result.hasTriedCompanyMode;
localStorage.setItem('currentUserHasTriedCompanyMode', String(currentUserHasTriedCompanyMode));
if (result.role === 'admin') {
localStorage.setItem('isAdminAuthorized', 'true');
} else {
localStorage.removeItem('isAdminAuthorized');
}
errDiv.style.display = 'none';
await loadCloudData();
showAppScreen();
} catch (e) {
errDiv.textContent = 'Ошибка сети, попробуйте ещё раз';
errDiv.style.display = 'block';
}
}

function setLoginMode(mode) {
selectedLoginMode = mode;
document.getElementById('loginModeEmployeeBtn').classList.toggle('active', mode === 'employee');
document.getElementById('loginModeCompanyBtn').classList.toggle('active', mode === 'company');
}

function setDocType(type) {
selectedDocType = type;
if (typeof scheduleDraftSave === 'function') scheduleDraftSave();
document.getElementById('docTypeInvoiceBtn').classList.toggle('active', type === 'invoice');
document.getElementById('docTypeEstimateBtn').classList.toggle('active', type === 'estimate');
document.getElementById('invoicePreviewHeading').textContent = type === 'estimate' ? 'Предпросмотр расчёта' : 'Предпросмотр счета';
updateCalcBarTotal();
}

function setRegisterRole(role) {
selectedRegisterRole = role;
document.getElementById('regRoleMasterBtn').classList.toggle('active', role === 'master');
document.getElementById('regRoleClientBtn').classList.toggle('active', role === 'client');
}

async function handleRegister() {
const l = document.getElementById('regLoginInput').value.trim();
const email = document.getElementById('regEmailInput').value.trim();
const p = document.getElementById('regPassInput').value.trim();
const errDiv = document.getElementById('regError');
errDiv.style.display = 'none';
if (!l || !email || !p) {
errDiv.textContent = 'Заполните все поля!';
errDiv.style.display = 'block';
return;
}
try {
const res = await fetch(`${WORKER_URL}/register`, {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ login: l, email, password: p, role: selectedRegisterRole })
});
const result = await res.json();
if (!res.ok) {
errDiv.textContent = result.error || 'Ошибка регистрации';
errDiv.style.display = 'block';
return;
}
authToken = result.token;
currentUser = result.login;
currentUserRole = result.role;
localStorage.setItem('authToken', authToken);
localStorage.setItem('currentUser', currentUser);
localStorage.setItem('currentUserRole', currentUserRole);
localStorage.removeItem('isAdminAuthorized');
await loadCloudData();
showAppScreen();
} catch (e) {
errDiv.textContent = 'Ошибка сети, попробуйте ещё раз';
errDiv.style.display = 'block';
}
}

function isCurrentAdmin() {
return currentUser === 'admin' || currentUserRole === 'admin';
}

function isCurrentClient() {
return currentUserRole === 'client';
}

function isCompanyMode() {
return currentUserMode === 'company';
}

function showAppScreen() {
document.getElementById('authScreen').style.display = 'none';
document.getElementById('appScreen').style.display = 'block';
document.getElementById('userBadge').textContent = currentUser + (isCompanyMode() ? ' · своя компания' : '');
document.getElementById('companyModePromo').style.display =
(!isCurrentClient() && !isCompanyMode() && !currentUserHasTriedCompanyMode) ? 'block' : 'none';
document.getElementById('tabUsersBtn').style.display = (isCurrentAdmin() && !isCompanyMode()) ? 'block' : 'none';
document.getElementById('tabStatsBtn').style.display = (isCurrentAdmin() && !isCompanyMode()) ? 'block' : 'none';
document.getElementById('editPriceListLink').style.display = isCompanyMode() ? 'inline-flex' : 'none';
document.getElementById('tabCalcBtn').style.display = isCurrentClient() ? 'none' : 'block';
document.getElementById('tabHistoryBtn').style.display = isCurrentClient() ? 'none' : 'block';
document.getElementById('tabProfileBtn').style.display = isCurrentClient() ? 'none' : 'block';
updateNavigation();
if (isCurrentClient()) {
switchTab('objects');
} else {
populateObjectSelect();
renderHistory();
offerDraftRestore();
}
}

function handleLogout() {
currentUser = null;
currentUserRole = null;
currentUserMode = 'employee';
currentUserHasTriedCompanyMode = false;
authToken = null;
localStorage.removeItem('currentUser');
localStorage.removeItem('authToken');
localStorage.removeItem('isAdminAuthorized');
localStorage.removeItem('currentUserRole');
localStorage.removeItem('currentUserMode');
localStorage.removeItem('currentUserHasTriedCompanyMode');
document.getElementById('authScreen').style.display = 'block';
document.getElementById('appScreen').style.display = 'none';
document.body.classList.remove('has-bottom-nav', 'calc-active');
saveDraftNow();
draftReady = false;
hideDraftOffer();
const bottomNav = document.getElementById('bottomNav');
if (bottomNav) bottomNav.style.display = 'none';
switchAuthMode('login');
}

// Меню пользователя (Профиль, Мастера, Статистика, Выйти)
function toggleUserMenu(force) {
const menu = document.getElementById('userMenu');
const btn = document.getElementById('userMenuBtn');
if (!menu || !btn) return;
const open = typeof force === 'boolean' ? force : !menu.classList.contains('open');
menu.classList.toggle('open', open);
btn.setAttribute('aria-expanded', String(open));
}

document.addEventListener('click', (e) => {
if (!e.target.closest('.user-menu-wrap')) toggleUserMenu(false);
});
document.addEventListener('keydown', (e) => {
if (e.key === 'Escape') toggleUserMenu(false);
});

// Пока в поле ввода стоит курсор (открыта клавиатура), нижняя панель
// прячется — иначе на телефоне она поднимается над клавиатурой и
// закрывает поле, в которое печатаешь.
function isTextField(el) {
if (!el) return false;
if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
if (el.tagName !== 'INPUT') return false;
return !['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].includes(el.type);
}
// Клавиатура считается открытой, когда курсор в поле И видимая область
// экрана заметно уменьшилась. Одного курсора мало: на Android клавиатуру
// часто закрывают жестом «назад», а курсор остаётся в поле — панель
// должна вернуться сразу, а не после касания где-то ещё.
function updateKeyboardState() {
const focused = isTextField(document.activeElement);
let open = focused;
if (focused && window.visualViewport) {
open = window.visualViewport.height < window.innerHeight - 120;
}
document.body.classList.toggle('keyboard-open', open);
}
document.addEventListener('focusin', () => setTimeout(updateKeyboardState, 300));
document.addEventListener('focusout', () => setTimeout(updateKeyboardState, 100));
if (window.visualViewport) window.visualViewport.addEventListener('resize', updateKeyboardState);

// Нижняя панель и пункты меню — в зависимости от роли
function updateNavigation() {
const client = isCurrentClient();
const nav = document.getElementById('bottomNav');
if (nav) nav.style.display = client ? 'none' : 'block';
document.body.classList.toggle('has-bottom-nav', !client);
const calcTab = document.getElementById('calcTab');
document.body.classList.toggle('calc-active', !client && !!calcTab && calcTab.style.display !== 'none');
// У заказчика в меню остаётся только «Выйти» — разделитель не нужен
const sep = document.getElementById('userMenuSep');
if (sep) sep.style.display = client ? 'none' : 'block';
}

function switchTab(tab) {
toggleUserMenu(false);
closeSheet();
document.body.classList.toggle('calc-active', tab === 'calc' && !isCurrentClient());
const prevScrollTab = document.querySelector('.nav-tab.active, .menu-item.active');
document.getElementById('calcTab').style.display = tab === 'calc' ? 'block' : 'none';
document.getElementById('objectsTab').style.display = tab === 'objects' ? 'block' : 'none';
document.getElementById('historyTab').style.display = tab === 'history' ? 'block' : 'none';
document.getElementById('profileTab').style.display = tab === 'profile' ? 'block' : 'none';
document.getElementById('usersTab').style.display = tab === 'users' ? 'block' : 'none';
document.getElementById('statsTab').style.display = tab === 'stats' ? 'block' : 'none';
document.getElementById('tabCalcBtn').classList.toggle('active', tab === 'calc');
document.getElementById('tabObjectsBtn').classList.toggle('active', tab === 'objects');
document.getElementById('tabHistoryBtn').classList.toggle('active', tab === 'history');
document.getElementById('tabProfileBtn').classList.toggle('active', tab === 'profile');
document.getElementById('tabUsersBtn').classList.toggle('active', tab === 'users');
document.getElementById('tabStatsBtn').classList.toggle('active', tab === 'stats');
if (prevScrollTab && prevScrollTab.id !== ({ calc: 'tabCalcBtn', objects: 'tabObjectsBtn', history: 'tabHistoryBtn', profile: 'tabProfileBtn', users: 'tabUsersBtn', stats: 'tabStatsBtn' })[tab]) {
window.scrollTo(0, 0);
}
if (tab === 'history') renderHistory();
if (tab === 'profile') renderProfile();
if (tab === 'users') renderUsersList();
if (tab === 'stats') renderStats();
if (tab === 'objects') {
closeObjectDetail();
const newObjectCard = document.getElementById('newObjectCard');
if (newObjectCard) newObjectCard.style.display = isCurrentClient() ? 'none' : 'block';
renderObjects();
}
}

function toggleAccordion(headerEl) {
const categoryBlock = headerEl.closest('.accordion-category');
const isOpen = categoryBlock.classList.contains('open');
const parentContainer = categoryBlock.parentElement;
parentContainer.querySelectorAll('.accordion-category').forEach(block => {
block.classList.remove('open');
});
if (!isOpen) {
categoryBlock.classList.add('open');
}
}

function renderServices() {
const container = document.getElementById('servicesList');
if (!container) return;
container.innerHTML = '';
const queryInput = document.getElementById('searchCalcInput');
const query = queryInput ? queryInput.value.toLowerCase().trim() : '';
const services = cloudData.services || [];
let groups = [];
let currentGroup = { category: null, items: [] };
services.forEach((srv, idx) => {
if (srv.isCategory) {
if (currentGroup.category !== null || currentGroup.items.length > 0) {
groups.push(currentGroup);
}
currentGroup = { category: srv, items: [] };
} else {
currentGroup.items.push({ service: srv, globalIdx: idx });
}
});
if (currentGroup.category !== null || currentGroup.items.length > 0) {
groups.push(currentGroup);
}
let hasResults = false;
groups.forEach(group => {
let filteredItems = group.items;
let categoryMatches = group.category ? group.category.name.toLowerCase().includes(query) : false;
if (query) {
filteredItems = group.items.filter(item => item.service.name.toLowerCase().includes(query));
if (!categoryMatches && filteredItems.length === 0) return;
}
hasResults = true;
const categoryBlock = document.createElement('div');
categoryBlock.className = 'accordion-category';
if (query) categoryBlock.classList.add('open');
const catName = group.category ? group.category.name : "Без категории";
const headerEl = document.createElement('div');
headerEl.className = 'accordion-header';
headerEl.onclick = () => toggleAccordion(headerEl);
headerEl.innerHTML = `
<div style="display:flex; align-items:center; gap:8px; flex:1;">
<span>${escapeHtml(catName)}</span>
</div>
<div style="display:flex; align-items:center; gap:6px;">
<span style="font-size:11px; color:#5d6878; font-weight:normal;">(${filteredItems.length})</span>
<span class="accordion-arrow">▼</span>
</div>
`;
categoryBlock.appendChild(headerEl);
const contentEl = document.createElement('div');
contentEl.className = 'accordion-content';
if (filteredItems.length === 0) {
contentEl.innerHTML = '<div style="font-size:12px; color:#8d97a5; padding:4px;">Нет услуг в этой категории</div>';
} else {
filteredItems.forEach(item => {
const srv = item.service;
const idx = item.globalIdx;
let unitsOptions = DEFAULT_UNITS.map(u => `<option value="${escapeHtml(u)}">${escapeHtml(u)}</option>`).join('');
const card = document.createElement('div');
card.className = 'service-card';
card.innerHTML = `
<div class="service-title">
<span>${escapeHtml(srv.name)}</span>
<span style="display:flex; align-items:center; gap:4px;" title="Можно изменить цену разово, только для этого счёта">
<input type="number" id="input_price_${idx}" class="price-edit-input" value="${srv.price}" min="0" step="1">
<span style="font-size:12px; color:#1d7a4c; font-weight:700;">₽</span>
</span>
</div>
<div class="unit-row">
<input type="number" id="input_qty_${idx}" min="0" step="any" value="1" placeholder="Кол-во" oninput="delete this.dataset.measure">
<select id="select_unit_${idx}">${unitsOptions}</select>
<button type="button" class="mp-mini" onclick="openMeasure({ kind: 'service', idx: ${idx} })" aria-label="Посчитать замером"><svg class="ic"><use href="#i-ruler"/></svg></button>
</div>
<input type="text" id="input_loc_${idx}" class="location-input" placeholder="Где на объекте (необязательно, например: кухня)">
<button type="button" class="add-to-cart-btn" data-idx="${idx}" onclick="addToInvoice(${idx})">Добавить в счёт</button>
`;
contentEl.appendChild(card);
});
}
categoryBlock.appendChild(contentEl);
container.appendChild(categoryBlock);
});
if (!hasResults && query) {
container.innerHTML = '<div style="text-align:center; color:#8d97a5; padding:20px;">Ничего не найдено</div>';
}
renderInvoice();
}

// Замер, вставленный в поле количества, прикрепляется к позиции —
// если число в поле с тех пор не меняли.
function takeMeasureNote(input, qty) {
if (!input || !input.dataset.measure) return null;
let note = null;
try { note = JSON.parse(input.dataset.measure); } catch (e) { /* пусто */ }
delete input.dataset.measure;
return note && Math.abs(Number(note.value) - Number(qty)) < 0.0005 ? note : null;
}

function addCustomInvoiceItem() {
const nameInput = document.getElementById('customItemName');
const priceInput = document.getElementById('customItemPrice');
const qtyInput = document.getElementById('customItemQty');
const unitSelect = document.getElementById('customItemUnit');
if (!nameInput || !priceInput || !qtyInput || !unitSelect) return;
const name = nameInput.value.trim();
let price = parseFloat(priceInput.value);
let qty = parseFloat(qtyInput.value);
const unit = unitSelect.value;
if (!name) {
alert('Укажите название позиции!');
nameInput.focus();
return;
}
if (isNaN(price) || price < 0) {
alert('Укажите корректную цену!');
priceInput.focus();
return;
}
if (isNaN(qty) || qty <= 0) {
alert('Укажите корректное количество!');
qtyInput.focus();
return;
}
const measureNote = takeMeasureNote(qtyInput, qty);
// Погонный метр: меньше одного не бывает, больше — считается как есть (1,001 → 1,001)
if (unit === 'пог. м') qty = Math.max(1, qty);
invoiceCart.push({ name, price, qty, unit, location: '', ...(measureNote ? { measure: measureNote } : {}) });
renderInvoice();
showAddToast(`Добавлено: ${name}`);
nameInput.value = '';
priceInput.value = '';
qtyInput.value = '1';
}

function addToInvoice(idx) {
const qtyInput = document.getElementById(`input_qty_${idx}`);
const unitSelect = document.getElementById(`select_unit_${idx}`);
const priceInput = document.getElementById(`input_price_${idx}`);
const locInput = document.getElementById(`input_loc_${idx}`);
if (!qtyInput || !unitSelect) return;
let qty = parseFloat(qtyInput.value);
const unit = unitSelect.value;
const srv = cloudData.services[idx];
let price = priceInput ? parseFloat(priceInput.value) : Number(srv.price);
if (isNaN(price) || price < 0) price = Number(srv.price);
if (isNaN(qty) || qty <= 0) {
alert('Укажите корректное количество!');
return;
}
// Погонный метр: меньше одного не бывает, больше — считается как есть (1,001 → 1,001)
if (unit === 'пог. м') qty = Math.max(1, qty);
const location = locInput ? locInput.value.trim() : '';
const measureNote = takeMeasureNote(qtyInput, parseFloat(qtyInput.value));
invoiceCart.push({ name: srv.name, price, qty, unit, location, ...(measureNote ? { measure: measureNote } : {}) });
renderInvoice();
showAddToast(`Добавлено: ${srv.name}`);
if (locInput) locInput.value = '';
const btn = document.querySelector(`.add-to-cart-btn[data-idx="${idx}"]`);
if (btn) {
btn.classList.remove('just-added');
void btn.offsetWidth;
btn.classList.add('just-added');
setTimeout(() => btn.classList.remove('just-added'), 400);
}
}

let addToastTimer = null;
function showAddToast(message) {
let toast = document.getElementById('addToast');
if (!toast) {
toast = document.createElement('div');
toast.id = 'addToast';
toast.className = 'add-toast';
document.body.appendChild(toast);
}
toast.textContent = message;
clearTimeout(addToastTimer);
requestAnimationFrame(() => toast.classList.add('show'));
addToastTimer = setTimeout(() => toast.classList.remove('show'), 1600);
}

// В отличие от showAddToast (сам гаснет через 1.6с), это уведомление
// остаётся на экране, пока идёт загрузка/сохранение в облако — используется
// вместе с повторными попытками при сбоях сети или самого JSONBin.
function showSyncStatus(message) {
let toast = document.getElementById('addToast');
if (!toast) {
toast = document.createElement('div');
toast.id = 'addToast';
toast.className = 'add-toast';
document.body.appendChild(toast);
}
clearTimeout(addToastTimer);
toast.textContent = message;
requestAnimationFrame(() => toast.classList.add('show'));
}

function hideSyncStatus(delayMs = 1200) {
const toast = document.getElementById('addToast');
if (!toast) return;
clearTimeout(addToastTimer);
addToastTimer = setTimeout(() => toast.classList.remove('show'), delayMs);
}

function removeFromInvoice(idx) {
invoiceCart.splice(idx, 1);
renderInvoice();
}

/* ===================== ФОТО/ФАЙЛЫ ОТЧЁТА (R2) ===================== */

async function handleReportFileSelect(event) {
const files = Array.from(event.target.files || []);
event.target.value = ''; // чтобы можно было выбрать тот же файл повторно
for (const file of files) {
await uploadReportFile(file);
}
}

async function compressImageIfNeeded(file) {
// Сжимаем только настоящие фото (не скриншоты/gif — они и так лёгкие).
// Реальные фото с камеры телефона часто весят несколько МБ, из-за чего
// на медленном или нестабильном мобильном интернете загрузка просто
// обрывается ("нет соединения"), в отличие от лёгких скриншотов.
if (!file.type || !file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 800 * 1024) {
return file;
}
try {
const bitmap = await createImageBitmap(file);
const maxDim = 1600;
let width = bitmap.width;
let height = bitmap.height;
if (Math.max(width, height) > maxDim) {
const scale = maxDim / Math.max(width, height);
width = Math.round(width * scale);
height = Math.round(height * scale);
}
const canvas = document.createElement('canvas');
canvas.width = width;
canvas.height = height;
const ctx = canvas.getContext('2d');
ctx.drawImage(bitmap, 0, 0, width, height);
const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82));
if (!blob || blob.size >= file.size) return file; // сжатие не помогло — грузим оригинал
const newName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
return new File([blob], newName, { type: 'image/jpeg' });
} catch (e) {
console.error('Не удалось сжать изображение, загружаю как есть:', e);
return file;
}
}

async function uploadFileToServer(file) {
const formData = new FormData();
formData.append('file', file);
return fetch(`${WORKER_URL}/upload`, {
method: 'POST',
headers: { 'Authorization': 'Bearer ' + authToken },
body: formData
});
}

async function uploadReportFile(originalFile) {
const tempId = 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
invoiceAttachments.push({ tempId, name: originalFile.name, size: originalFile.size, type: originalFile.type, uploading: true });
renderReportAttachments();
const file = await compressImageIfNeeded(originalFile);
const maxAttempts = 2;
for (let attempt = 1; attempt <= maxAttempts; attempt++) {
try {
const res = await uploadFileToServer(file);
let result = null;
try { result = await res.json(); } catch (e) { /* пусто */ }
const idx = invoiceAttachments.findIndex(a => a.tempId === tempId);
if (!res.ok) {
if (idx !== -1) invoiceAttachments.splice(idx, 1);
renderReportAttachments();
alert(`Не удалось загрузить файл «${originalFile.name}»${result && result.error ? ': ' + result.error : ''}.`);
return;
}
if (idx !== -1) {
invoiceAttachments[idx] = { url: result.url, publicId: result.publicId, resourceType: result.resourceType, name: result.name, size: result.size, type: result.type };
}
renderReportAttachments();
showAddToast(`Загружено: ${originalFile.name}`);
return;
} catch (e) {
console.error(`Ошибка загрузки файла (попытка ${attempt}/${maxAttempts}):`, e);
if (attempt === maxAttempts) {
const idx = invoiceAttachments.findIndex(a => a.tempId === tempId);
if (idx !== -1) invoiceAttachments.splice(idx, 1);
renderReportAttachments();
alert(`Не удалось загрузить файл «${originalFile.name}»: нет соединения с сервером.`);
return;
}
await new Promise(r => setTimeout(r, 800));
}
}
}

async function removeReportAttachment(idx) {
const att = invoiceAttachments[idx];
if (!att) return;
invoiceAttachments.splice(idx, 1);
renderReportAttachments();
if (att.publicId) {
try {
await fetch(`${WORKER_URL}/file?publicId=${encodeURIComponent(att.publicId)}&resourceType=${encodeURIComponent(att.resourceType || 'image')}`, {
method: 'DELETE',
headers: { 'Authorization': 'Bearer ' + authToken }
});
} catch (e) {
console.error('Не удалось удалить файл из хранилища:', e);
}
}
}

function renderReportAttachments() {
updateCalcDetailsSummary();
const container = document.getElementById('reportAttachmentsList');
if (!container) return;
container.innerHTML = invoiceAttachments.map((att, idx) => {
const isImage = att.type && att.type.startsWith('image/');
const sizeKb = att.size ? Math.round(att.size / 1024) : 0;
const thumb = isImage && att.url
? `<img src="${att.url}" class="attachment-thumb" alt="">`
: `<span class="attachment-thumb" style="display:flex; align-items:center; justify-content:center; font-size:16px;">📄</span>`;
return `
<div class="attachment-chip${att.uploading ? ' attachment-uploading' : ''}">
${thumb}
<span class="attachment-name">${escapeHtml(att.name)}${sizeKb ? ` (${sizeKb} КБ)` : ''}${att.uploading ? ' — загрузка…' : ''}</span>
${!att.uploading ? `<button type="button" class="btn-delete-item" onclick="removeReportAttachment(${idx})">✕</button>` : ''}
</div>
`;
}).join('');
}

function renderAttachmentsHtml(attachments) {
if (!Array.isArray(attachments) || attachments.length === 0) return '';
const chips = attachments.map(att => {
const isImage = att.type && att.type.startsWith('image/');
const downloadBtn = `<button type="button" class="attachment-download-btn" data-url="${escapeHtml(att.url)}" data-name="${escapeHtml(att.name)}" onclick="downloadAttachment(this)" title="Скачать">⬇️</button>`;
if (isImage) {
return `<div class="attachment-chip-wrap"><a href="${att.url}" target="_blank" rel="noopener" class="attachment-link"><img src="${att.url}" class="attachment-thumb" alt="${escapeHtml(att.name)}" title="${escapeHtml(att.name)}"></a>${downloadBtn}</div>`;
}
return `<div class="attachment-chip-wrap"><a href="${att.url}" target="_blank" rel="noopener" class="attachment-link" style="display:flex; align-items:center; gap:4px; background:#eef1f4; border:1px solid #dfe3e8; border-radius:8px; padding:4px 8px; font-size:11px; color:#33404f;">${escapeHtml(att.name)}</a>${downloadBtn}</div>`;
}).join('');
return `<div style="display:flex; flex-wrap:wrap; gap:6px; margin: 6px 0;">${chips}</div>`;
}

async function downloadAttachment(btn) {
const url = btn.dataset.url;
const name = btn.dataset.name || 'file';
if (!url) return;
const originalHtml = btn.innerHTML;
btn.disabled = true;
btn.innerHTML = '⏳';
try {
const res = await fetch(url);
if (!res.ok) throw new Error('HTTP ' + res.status);
const blob = await res.blob();
const link = document.createElement('a');
link.href = URL.createObjectURL(blob);
link.download = name;
document.body.appendChild(link);
link.click();
document.body.removeChild(link);
URL.revokeObjectURL(link.href);
} catch (e) {
console.error('Не удалось скачать файл:', e);
alert('Не удалось скачать файл — можно открыть его по ссылке и сохранить вручную.');
} finally {
btn.disabled = false;
btn.innerHTML = originalHtml;
}
}

/* ===================== ЧЕРНОВИК СЧЁТА ===================== */
// Собранный в калькуляторе счёт сохраняется на телефоне автоматически.
// Если приложение закрылось, телефон выгрузил его из памяти или сайт
// обновился — при следующем открытии предлагается продолжить.
// Черновик свой у каждого пользователя и режима; при редактировании
// счёта из истории черновик не пишется (там исходник уже сохранён).
let draftReady = false;      // запись разрешена (после проверки при входе)
let draftOfferPending = false;
let draftTimer = null;
let lastSavedDraftJson = null; // состояние, совпадающее с только что сохранённым счётом

function draftKey() {
return 'calcDraft:' + (currentUser || '') + ':' + (isCompanyMode() ? 'company' : 'employee');
}

function collectDraftState() {
const select = document.getElementById('invoiceObjectSelect');
const objectId = select && select.value !== '__new__' ? select.value : '';
return {
cart: invoiceCart,
docType: selectedDocType,
objectId,
client: (document.getElementById('clientName').value || '').trim(),
address: (document.getElementById('objectAddress').value || '').trim(),
note: (document.getElementById('invoiceNote').value || '').trim(),
attachments: invoiceAttachments,
roomSel: [...selectedRoomIds]
};
}

function isDraftEmpty(st) {
return !st.cart.length && !st.client && !st.address && !st.note && !st.attachments.length;
}

function readDraft() {
try {
const raw = localStorage.getItem(draftKey());
const d = raw ? JSON.parse(raw) : null;
return d && Array.isArray(d.cart) ? d : null;
} catch (e) {
return null;
}
}

function scheduleDraftSave() {
clearTimeout(draftTimer);
draftTimer = setTimeout(saveDraftNow, 400);
}

function saveDraftNow() {
clearTimeout(draftTimer);
if (!currentUser || isCurrentClient() || editingRecordId) return;
const st = collectDraftState();
// Пока висит предложение продолжить старый черновик, пустой калькулятор
// его не стирает. Если же человек начал новый счёт, не нажав ни одну из
// кнопок, — значит, старый не нужен: убираем предложение.
if (draftOfferPending) {
if (isDraftEmpty(st)) return;
hideDraftOffer();
}
if (!draftReady) return;
try {
const json = JSON.stringify(st);
if (isDraftEmpty(st) || json === lastSavedDraftJson) {
localStorage.removeItem(draftKey());
} else {
localStorage.setItem(draftKey(), JSON.stringify({ ...st, savedAt: Date.now() }));
}
} catch (e) {
// память браузера переполнена или недоступна — черновик просто не сохранится
}
}

// Вызывается после входа: если есть черновик и калькулятор пуст — предлагаем продолжить
function offerDraftRestore() {
draftReady = true;
const d = readDraft();
const st = collectDraftState();
if (!d || !isDraftEmpty(st) || isCurrentClient()) {
hideDraftOffer();
return;
}
const total = d.cart.reduce((sum, i) => sum + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
const obj = d.objectId ? (cloudData.objects || []).find(o => o.id === d.objectId) : null;
const when = d.savedAt ? new Date(d.savedAt) : null;
const whenText = when
? (when.toDateString() === new Date().toDateString()
? 'сегодня в ' + when.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
: when.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))
: '';
const parts = [];
if (obj) parts.push(obj.name); else if (d.client) parts.push(d.client);
if (d.cart.length) parts.push(`${d.cart.length} ${pluralRu(d.cart.length, 'позиция', 'позиции', 'позиций')} · ${total.toLocaleString('ru-RU')} ₽`);
if (whenText) parts.push(whenText);
document.getElementById('draftOfferInfo').textContent = parts.join(' · ');
document.getElementById('draftOffer').classList.add('show');
draftOfferPending = true;
}

function hideDraftOffer() {
draftOfferPending = false;
const el = document.getElementById('draftOffer');
if (el) el.classList.remove('show');
}

function restoreDraft() {
if (editingRecordId) {
alert('Сначала сохраните или отмените редактирование текущего счёта.');
return;
}
const d = readDraft();
hideDraftOffer();
if (!d) return;
setDocType(d.docType === 'estimate' ? 'estimate' : 'invoice');
const select = document.getElementById('invoiceObjectSelect');
if (select) select.value = d.objectId && [...select.options].some(o => o.value === d.objectId) ? d.objectId : '';
['clientName', 'objectAddress', 'invoiceNote'].forEach((id, i) => {
const el = document.getElementById(id);
el.value = [d.client, d.address, d.note][i] || '';
el.dataset.autofilled = '';
});
invoiceCart = d.cart;
if (migrateLegacyRooms(d.rooms, invoiceCart, d.objectId)) saveCloudData();
selectedRoomIds = new Set(Array.isArray(d.roomSel) ? d.roomSel : []);
invoiceAttachments = Array.isArray(d.attachments) ? d.attachments : [];
renderReportAttachments();
renderServices();
renderInvoice();
saveDraftNow();
showAddToast('Черновик восстановлен');
}

function discardDraft() {
hideDraftOffer();
try { localStorage.removeItem(draftKey()); } catch (e) { /* пусто */ }
}

// Отмечаем, что текущее состояние калькулятора уже сохранено в истории —
// черновик для него больше не нужен (пока что-то не изменится).
function markDraftSaved() {
lastSavedDraftJson = JSON.stringify(collectDraftState());
saveDraftNow();
}

document.addEventListener('visibilitychange', () => {
if (document.visibilityState === 'hidden') saveDraftNow();
});
window.addEventListener('pagehide', () => saveDraftNow());

// Короткая строка под заголовком «Заказчик, адрес, пояснение, фото»,
// чтобы видеть заполненное, не раскрывая блок.
function updateCalcDetailsSummary() {
scheduleDraftSave();
const el = document.getElementById('calcDetailsSummary');
if (!el) return;
const client = (document.getElementById('clientName').value || '').trim();
const address = (document.getElementById('objectAddress').value || '').trim();
const note = (document.getElementById('invoiceNote').value || '').trim();
const files = typeof invoiceAttachments !== 'undefined' && Array.isArray(invoiceAttachments) ? invoiceAttachments.length : 0;
const parts = [client ? '' + client : 'Заказчик не указан'];
if (address) parts.push('' + address);
if (note) parts.push('есть пояснение');
if (files) parts.push('' + files);
el.textContent = parts.join('  ·  ');
}

function updateCalcBarTotal() {
document.body.classList.toggle('calc-has-items', typeof invoiceCart !== 'undefined' && invoiceCart.length > 0);
const src = document.getElementById('totalSum');
const dst = document.getElementById('calcBarTotal');
if (src && dst) dst.textContent = src.textContent + ' ₽';
const label = document.getElementById('calcBarLabel');
if (label) label.textContent = (typeof selectedDocType !== 'undefined' && selectedDocType === 'estimate') ? 'Итого по расчёту' : 'Итого';
}

// Итог в нижней полосе повторяет итог предпросмотра — следим за ним,
// чтобы не трогать все места, где он пересчитывается.
document.addEventListener('DOMContentLoaded', () => {
const src = document.getElementById('totalSum');
if (src) new MutationObserver(updateCalcBarTotal).observe(src, { childList: true, characterData: true, subtree: true });
updateCalcBarTotal();
updateCalcDetailsSummary();
});

function updateInvoiceInfo() {
updateCalcDetailsSummary();
const info = document.getElementById('invoiceInfo');
if (!info) return;
const client = document.getElementById('clientName').value.trim();
const address = document.getElementById('objectAddress').value.trim();
const note = document.getElementById('invoiceNote').value.trim();
let html = '';
if (client) html += `<b>Заказчик:</b> ${escapeHtml(client)}<br>`;
if (address) html += `<b>Адрес:</b> ${escapeHtml(address)}<br>`;
if (note) html += `<b>Пояснение:</b> ${escapeHtml(note)}`;
info.innerHTML = html;
}

function renderInvoice() {
if (typeof renderRooms === 'function') renderRooms();
const container = document.getElementById('invoiceItems');
if (!container) return;
container.innerHTML = '';
let total = 0;
updateInvoiceInfo();
if (invoiceCart.length === 0) {
container.innerHTML = '<div style="color:#8d97a5; font-size: 12px; text-align:center; padding: 10px 0;">Счёт пока пуст</div>';
document.getElementById('totalSum').textContent = '0';
return;
}
invoiceCart.forEach((item, idx) => {
const sum = item.qty * item.price;
total += sum;
const unitOptions = DEFAULT_UNITS.includes(item.unit) ? DEFAULT_UNITS : [item.unit, ...DEFAULT_UNITS];
container.innerHTML += `
<div class="invoice-item" style="flex-direction:column; align-items:stretch; gap:6px;">
<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">
<input type="text" value="${escapeHtml(item.name)}" oninput="updateInvoiceItemField(${idx}, 'name', this.value)" style="flex:1; min-width:0; border:1px solid #dfe3e8; border-radius:7px; padding:6px 8px; font-size:13px; font-weight:600;">
<button type="button" class="btn-delete-item" onclick="removeFromInvoice(${idx})">✕</button>
</div>
<div style="display:flex; gap:6px; align-items:center;">
<input type="number" min="0" step="any" value="${item.qty}" oninput="updateInvoiceItemField(${idx}, 'qty', this.value)" style="width:70px; border:1px solid #dfe3e8; border-radius:7px; padding:6px 8px; font-size:13px;" title="Объём/количество">
<button type="button" class="mp-mini" style="width:34px; min-height:32px; font-size:14px;" onclick="openMeasure({ kind: 'cart', idx: ${idx} })" aria-label="Посчитать замером"><svg class="ic"><use href="#i-ruler"/></svg></button>
<select onchange="updateInvoiceItemField(${idx}, 'unit', this.value)" style="border:1px solid #dfe3e8; border-radius:7px; padding:6px 4px; font-size:13px; background:#fff;">
${unitOptions.map(u => `<option value="${u}" ${u === item.unit ? 'selected' : ''}>${u}</option>`).join('')}
</select>
<input type="number" min="0" value="${item.price}" oninput="updateInvoiceItemField(${idx}, 'price', this.value)" style="width:80px; border:1px solid #dfe3e8; border-radius:7px; padding:6px 8px; font-size:13px;" title="Цена за единицу, ₽">
<span style="margin-left:auto; font-weight:700; white-space:nowrap;">${sum.toLocaleString('ru-RU')} ₽</span>
</div>
${roomsBreakdownText(item)
? `<div class="rooms-breakdown">${escapeHtml(roomsBreakdownText(item))}</div>`
: (item.location ? `<div style="font-size:11px; color:#3a4350;">${escapeHtml(item.location)}</div>` : '')}
${measureNoteHtml(item)}
</div>
`;
});
document.getElementById('totalSum').textContent = total.toLocaleString('ru-RU');
}

function updateInvoiceItemField(idx, field, value) {
const item = invoiceCart[idx];
if (!item) return;
if (field === 'qty' && item.measure && Math.abs(Number(value) - Number(item.measure.value)) >= 0.0005) delete item.measure;
// Количество поправили вручную — больше не пересчитываем его по замеру помещения
if (field === 'qty' && item.surface && item.surface !== 'manual') {
item.surface = 'manual';
delete item.rooms; // разбивка больше не сходится с общим количеством
}
setTimeout(() => { if (typeof renderRooms === 'function') renderRooms(); }, 0);
scheduleDraftSave();
if (field === 'qty' || field === 'price') {
item[field] = Number(value) || 0;
} else {
item[field] = value;
}
// Сумму по позиции и итог пересчитываем сразу, без полной перерисовки
// полей ввода — иначе курсор/фокус будет сбрасываться при каждой цифре.
const container = document.getElementById('invoiceItems');
if (container) {
let total = 0;
invoiceCart.forEach(i => total += i.qty * i.price);
document.getElementById('totalSum').textContent = total.toLocaleString('ru-RU');
const row = container.children[idx];
if (row) {
const sumEl = row.querySelector('span[style*="margin-left:auto"]');
if (sumEl) sumEl.textContent = (item.qty * item.price).toLocaleString('ru-RU') + ' ₽';
}
}
}

async function sendPDF() {
if (invoiceCart.length === 0) {
alert("Добавьте услуги в счёт!");
return;
}
const client = document.getElementById('clientName').value.trim();
const address = document.getElementById('objectAddress').value.trim();
const note = document.getElementById('invoiceNote').value.trim();
const dateStr = new Date().toLocaleDateString('ru-RU');
const items = [...invoiceCart];
const docType = selectedDocType;
const saved = await saveInvoiceToHistory(true);
if (!saved) return;
await generateAndSharePDF({ client, address, note, dateStr, items, docType });
}

async function downloadInvoicePDF() {
if (invoiceCart.length === 0) {
alert("Добавьте услуги в счёт!");
return;
}
const client = document.getElementById('clientName').value.trim();
const address = document.getElementById('objectAddress').value.trim();
const note = document.getElementById('invoiceNote').value.trim();
const dateStr = new Date().toLocaleDateString('ru-RU');
const items = [...invoiceCart];
const docType = selectedDocType;
const saved = await saveInvoiceToHistory(true);
if (!saved) return;
await downloadPDF({ client, address, note, dateStr, items, docType });
}

async function toggleShareLink(id) {
if (!isCurrentAdmin()) return;
const rec = (cloudData.history || []).find(r => String(r.id) === String(id));
if (!rec) return;
rec.shareDisabled = !rec.shareDisabled;
await saveCloudData();
renderHistory();
if (currentObjectId) renderObjectDetail();
}

function getInvoiceShareUrl(id) {
const base = window.location.href.replace(/calc\.html.*$/, '');
return `${base}view.html?id=${encodeURIComponent(id)}`;
}

async function shareInvoiceLink(id) {
const url = getInvoiceShareUrl(id);
if (navigator.share) {
try {
await navigator.share({ title: 'Счёт', url });
return;
} catch (e) {
// пользователь отменил или системный шаринг не сработал — пробуем скопировать
}
}
try {
await navigator.clipboard.writeText(url);
showAddToast('Ссылка скопирована');
} catch (e) {
prompt('Скопируйте ссылку на счёт:', url);
}
}

async function sendHistoryRecordPDF(id) {
const rec = (cloudData.history || []).find(r => String(r.id) === String(id));
if (!rec) return;
const dateStr = (rec.date || '').split(',')[0] || new Date().toLocaleDateString('ru-RU');
await generateAndSharePDF({ client: rec.client, address: rec.address, note: rec.note, dateStr, items: rec.items || [], docType: rec.docType });
}

async function downloadHistoryRecordPDF(id) {
const rec = (cloudData.history || []).find(r => String(r.id) === String(id));
if (!rec) return;
const dateStr = (rec.date || '').split(',')[0] || new Date().toLocaleDateString('ru-RU');
await downloadPDF({ client: rec.client, address: rec.address, note: rec.note, dateStr, items: rec.items || [], docType: rec.docType });
}

function triggerFileDownload(blob, fileName) {
const link = document.createElement('a');
link.href = URL.createObjectURL(blob);
link.download = fileName;
document.body.appendChild(link);
link.click();
document.body.removeChild(link);
URL.revokeObjectURL(link.href);
}

async function buildInvoicePDFBlob({ client, address, note, dateStr, items, docType }) {
const isEstimate = docType === 'estimate';
let rows = '';
let total = 0;
items.forEach(item => {
const sum = item.qty * item.price;
total += sum;
rows += `
<tr>
<td style="border: 1px solid #cfd5dd; padding: 8px;">${escapeHtml(item.name)}${roomsBreakdownText(item) ? `<br><span style="font-size:10px; color:#3a4350;">${escapeHtml(roomsBreakdownText(item))}</span>` : (item.location ? `<br><span style="font-size:10px; color:#3a4350;">${escapeHtml(item.location)}</span>` : '')}</td>
<td style="border: 1px solid #cfd5dd; padding: 8px; text-align: center;">${item.qty}</td>
<td style="border: 1px solid #cfd5dd; padding: 8px; text-align: center;">${escapeHtml(item.unit)}</td>
<td style="border: 1px solid #cfd5dd; padding: 8px; text-align: right;">${item.price.toLocaleString('ru-RU')} ₽</td>
<td style="border: 1px solid #cfd5dd; padding: 8px; text-align: right;">${sum.toLocaleString('ru-RU')} ₽</td>
</tr>`;
});
const printContainer = document.createElement('div');
printContainer.style.position = 'absolute';
printContainer.style.top = (window.scrollY || document.documentElement.scrollTop || 0) + 'px';
printContainer.style.left = '0';
printContainer.style.width = '750px';
printContainer.style.background = '#ffffff';
printContainer.style.color = '#1d2733';
printContainer.style.padding = '30px';
printContainer.style.boxSizing = 'border-box';
printContainer.style.zIndex = '999999';
printContainer.style.fontFamily = 'Arial, sans-serif';
printContainer.innerHTML = `
<h2 style="color: #14181f; border-bottom: 2px solid #14181f; padding-bottom: 8px; margin-top:0; font-size: 22px;">${isEstimate ? 'ПРЕДВАРИТЕЛЬНЫЙ РАСЧЁТ' : 'СЧЕТ НА ОПЛАТУ УСЛУГ'}</h2>
${(cloudData.self && cloudData.self.companyName) ? `<p style="margin: 0 0 10px; font-size: 15px; font-weight:700; color:#1d2733;">${escapeHtml(cloudData.self.companyName)}</p>` : ''}
${isEstimate ? '<p style="margin: 0 0 6px; font-size: 12px; color: #8a5a14; background:#fbf7ec; border:1px solid #ecd9a6; border-radius:6px; padding:6px 10px; display:inline-block;">Это предварительный расчёт, не счёт на оплату. Итоговая сумма может измениться.</p>' : ''}
<p style="margin: 6px 0; font-size: 14px;"><b>Дата:</b> ${dateStr}</p>
${client ? `<p style="margin: 6px 0; font-size: 14px;"><b>Заказчик:</b> ${escapeHtml(client)}</p>` : ''}
${address ? `<p style="margin: 6px 0; font-size: 14px;"><b>Адрес объекта:</b> ${escapeHtml(address)}</p>` : ''}
${note ? `<p style="margin: 6px 0; font-size: 14px;"><b>Пояснение:</b> ${escapeHtml(note)}</p>` : ''}
<table style="width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px;">
<thead>
<tr style="background-color: #f4f6f8;">
<th style="border: 1px solid #cfd5dd; padding: 10px; text-align: left;">Наименование</th>
<th style="border: 1px solid #cfd5dd; padding: 10px; text-align: center;">Кол-во</th>
<th style="border: 1px solid #cfd5dd; padding: 10px; text-align: center;">Ед.</th>
<th style="border: 1px solid #cfd5dd; padding: 10px; text-align: right;">Цена</th>
<th style="border: 1px solid #cfd5dd; padding: 10px; text-align: right;">Сумма</th>
</tr>
</thead>
<tbody>${rows}</tbody>
</table>
<h3 style="text-align: right; margin-top: 20px; font-size: 18px; color: #000;">${isEstimate ? 'ИТОГО ПО РАСЧЁТУ' : 'ИТОГО К ОПЛАТЕ'}: ${total.toLocaleString('ru-RU')} ₽</h3>
${(cloudData.self && cloudData.self.invoiceNote) ? `
<div style="margin-top: 25px; padding: 12px; background: #f4f6f8; border-left: 4px solid #14181f; border-radius: 4px; font-size: 11px; color: #485566; line-height: 1.5;">
<b>Примечание:</b><br>
${escapeHtml(cloudData.self.invoiceNote)}
</div>
` : ''}
`;
document.body.appendChild(printContainer);
await new Promise(r => setTimeout(r, 150));
try {
const canvas = await html2canvas(printContainer, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, windowWidth: 750 });
const { jsPDF } = window.jspdf;
const pdf = new jsPDF('p', 'mm', 'a4');
const pdfWidth = pdf.internal.pageSize.getWidth();
const pdfHeight = pdf.internal.pageSize.getHeight();
const imgWidth = pdfWidth;
const imgHeight = (canvas.height * pdfWidth) / canvas.width;
let heightLeft = imgHeight;
let position = 0;
pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, position, imgWidth, imgHeight);
heightLeft -= pdfHeight;
while (heightLeft > 0) {
position = heightLeft - imgHeight;
pdf.addPage();
pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, position, imgWidth, imgHeight);
heightLeft -= pdfHeight;
}
const pdfBlob = pdf.output('blob');
const fileName = `${isEstimate ? 'Raschet' : 'Schet'}_${client || 'zakazchik'}.pdf`;
return { pdfBlob, fileName };
} finally {
if (printContainer.parentNode) document.body.removeChild(printContainer);
}
}

async function generateAndSharePDF(data) {
try {
const { pdfBlob, fileName } = await buildInvoicePDFBlob(data);
const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
const isEstimate = data.docType === 'estimate';
if (navigator.canShare && navigator.canShare({ files: [file] })) {
await navigator.share({ title: isEstimate ? 'Предварительный расчёт' : 'Счет на оплату', text: `${isEstimate ? 'Предварительный расчёт для' : 'Счет на оплату услуг для'} ${data.client || 'заказчика'}`, files: [file] });
} else {
triggerFileDownload(pdfBlob, fileName);
}
} catch (err) {
console.error("Ошибка при создании PDF:", err);
alert("Ошибка при сборке PDF: " + err.message);
}
}

async function downloadPDF(data) {
try {
const { pdfBlob, fileName } = await buildInvoicePDFBlob(data);
triggerFileDownload(pdfBlob, fileName);
} catch (err) {
console.error("Ошибка при создании PDF:", err);
alert("Ошибка при сборке PDF: " + err.message);
}
}

// ==================== ОПЛАТЫ ПО СЧЕТАМ ====================

function getPaymentsSum(rec) {
return (rec.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
}

function getBalanceInfo(rec) {
const total = Number(rec.total || 0);
const paid = getPaymentsSum(rec);
const balance = total - paid;
let status = 'paid';
if (balance > 0) status = 'owes';
else if (balance < 0) status = 'over';
return { total, paid, balance: Math.abs(balance), status };
}

let payModalRecordId = null;

function openPaymentModal(recordId) {
const rec = (cloudData.history || []).find(r => String(r.id) === String(recordId));
if (!rec) return;
payModalRecordId = recordId;
const info = getBalanceInfo(rec);
document.getElementById('payModalSub').innerHTML =
`Счёт: <b>${escapeHtml(rec.client)}</b> — ${rec.total.toLocaleString('ru-RU')} ₽. `+
(info.status === 'owes' ? `Осталось оплатить: <b style="color:#c2361f;">${info.balance.toLocaleString('ru-RU')} ₽</b>`
: info.status === 'over' ? `Уже переплачено на <b style="color:#14181f;">${info.balance.toLocaleString('ru-RU')} ₽</b>`
: `<b style="color:#1d7a4c;">Полностью оплачен</b>`);
document.getElementById('payAmount').value = info.status === 'owes' ? info.balance : '';
document.getElementById('payMethod').value = 'Наличные';
document.getElementById('payDate').value = new Date().toISOString().slice(0, 10);
document.getElementById('payNote').value = '';
document.getElementById('payModalOverlay').classList.add('show');
}

function closePaymentModal() {
document.getElementById('payModalOverlay').classList.remove('show');
payModalRecordId = null;
}

async function confirmAddPayment() {
if (!payModalRecordId) return;
const rec = (cloudData.history || []).find(r => String(r.id) === String(payModalRecordId));
if (!rec) return;
const amount = Number(document.getElementById('payAmount').value);
if (!amount || amount <= 0) {
alert('Укажите сумму оплаты больше нуля.');
return;
}
const method = document.getElementById('payMethod').value;
const dateInput = document.getElementById('payDate').value;
const note = document.getElementById('payNote').value.trim();
const dateStr = dateInput ? new Date(dateInput + 'T12:00:00').toLocaleDateString('ru-RU') : new Date().toLocaleDateString('ru-RU');

const payment = {
id: 'pay_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8),
amount,
method,
note,
date: dateStr,
author: currentUser || 'admin'
};
if (!rec.payments) rec.payments = [];
rec.payments.push(payment);
await saveCloudData();

closePaymentModal();
renderHistory();
if (currentObjectId) renderObjectDetail();

// Отправка чека обязательна — сразу после сохранения открываем шаринг PDF.
await sendPaymentReceipt(rec, payment);
}

async function buildReceiptPDFBlob({ client, address, invoiceDate, payment, totalPaidSoFar, invoiceTotal, balanceInfo }) {
const printContainer = document.createElement('div');
printContainer.style.position = 'absolute';
printContainer.style.top = (window.scrollY || document.documentElement.scrollTop || 0) + 'px';
printContainer.style.left = '0';
printContainer.style.width = '650px';
printContainer.style.background = '#ffffff';
printContainer.style.color = '#1d2733';
printContainer.style.padding = '30px';
printContainer.style.boxSizing = 'border-box';
printContainer.style.zIndex = '999999';
printContainer.style.fontFamily = 'Arial, sans-serif';

const statusLine = balanceInfo.status === 'owes'
? `<p style="margin:6px 0; font-size:14px; color:#c2361f;"><b>Остаток к оплате:</b> ${balanceInfo.balance.toLocaleString('ru-RU')} ₽</p>`
: balanceInfo.status === 'over'
? `<p style="margin:6px 0; font-size:14px; color:#14181f;"><b>Переплата:</b> ${balanceInfo.balance.toLocaleString('ru-RU')} ₽</p>`
: `<p style="margin:6px 0; font-size:14px; color:#1d7a4c;"><b>Счёт оплачен полностью</b></p>`;

printContainer.innerHTML = `
<h2 style="color:#1d7a4c; border-bottom:2px solid #1d7a4c; padding-bottom:8px; margin-top:0; font-size:22px;">ЧЕК ОБ ОПЛАТЕ</h2>
${(cloudData.self && cloudData.self.companyName) ? `<p style="margin: 0 0 10px; font-size: 15px; font-weight:700; color:#1d2733;">${escapeHtml(cloudData.self.companyName)}</p>` : ''}
<p style="margin:6px 0; font-size:14px;"><b>Дата оплаты:</b> ${payment.date}</p>
${client ? `<p style="margin:6px 0; font-size:14px;"><b>Заказчик:</b> ${escapeHtml(client)}</p>` : ''}
${address ? `<p style="margin:6px 0; font-size:14px;"><b>Адрес объекта:</b> ${escapeHtml(address)}</p>` : ''}
<p style="margin:6px 0; font-size:14px;"><b>Счёт от:</b> ${invoiceDate} на сумму ${invoiceTotal.toLocaleString('ru-RU')} ₽</p>
<p style="margin:6px 0; font-size:14px;"><b>Способ оплаты:</b> ${escapeHtml(payment.method)}</p>
${payment.note ? `<p style="margin:6px 0; font-size:14px;"><b>Примечание:</b> ${escapeHtml(payment.note)}</p>` : ''}
<div style="margin-top:16px; padding:14px; background:#eef6f1; border:1px solid #cfe8da; border-radius:8px;">
<div style="font-size:13px; color:#1f5c3d;">Оплачено этим платежом</div>
<div style="font-size:24px; font-weight:700; color:#1d7a4c;">${payment.amount.toLocaleString('ru-RU')} ₽</div>
</div>
<div style="margin-top:14px; padding:12px; background:#f4f6f8; border-radius:8px; font-size:13px; color:#485566;">
<div>Оплачено всего по счёту: <b>${totalPaidSoFar.toLocaleString('ru-RU')} ₽</b> из ${invoiceTotal.toLocaleString('ru-RU')} ₽</div>
${statusLine}
</div>
<p style="margin-top:20px; font-size:11px; color:#8d97a5;">Документ сформирован автоматически как подтверждение оплаты.</p>
`;
document.body.appendChild(printContainer);
await new Promise(r => setTimeout(r, 150));
try {
const canvas = await html2canvas(printContainer, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false, windowWidth: 650 });
const { jsPDF } = window.jspdf;
const pdf = new jsPDF('p', 'mm', 'a4');
const pdfWidth = pdf.internal.pageSize.getWidth();
const imgWidth = pdfWidth;
const imgHeight = (canvas.height * pdfWidth) / canvas.width;
pdf.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, imgWidth, imgHeight);
const pdfBlob = pdf.output('blob');
const fileName = `Chek_${client || 'zakazchik'}_${payment.date.replace(/\./g, '-')}.pdf`;
return { pdfBlob, fileName };
} finally {
if (printContainer.parentNode) document.body.removeChild(printContainer);
}
}

async function sendPaymentReceipt(rec, payment) {
const dateStr = (rec.date || '').split(',')[0] || new Date().toLocaleDateString('ru-RU');
const balanceInfo = getBalanceInfo(rec);
try {
const { pdfBlob, fileName } = await buildReceiptPDFBlob({
client: rec.client, address: rec.address, invoiceDate: dateStr,
payment, totalPaidSoFar: getPaymentsSum(rec), invoiceTotal: Number(rec.total || 0), balanceInfo
});
const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
if (navigator.canShare && navigator.canShare({ files: [file] })) {
await navigator.share({ title: 'Чек об оплате', text: `Чек об оплате ${payment.amount.toLocaleString('ru-RU')} ₽ для ${rec.client || 'заказчика'}`, files: [file] });
} else {
triggerFileDownload(pdfBlob, fileName);
showAddToast('Чек скачан — отправьте его заказчику');
}
} catch (err) {
console.error('Ошибка при создании чека:', err);
alert('Оплата сохранена, но не удалось создать PDF чека: ' + err.message);
}
}

async function resendPaymentReceipt(recordId, paymentId) {
const rec = (cloudData.history || []).find(r => String(r.id) === String(recordId));
if (!rec) return;
const payment = (rec.payments || []).find(p => String(p.id) === String(paymentId));
if (!payment) return;
await sendPaymentReceipt(rec, payment);
}

async function deletePayment(recordId, paymentId) {
if (!confirm('Удалить эту запись об оплате?')) return;
const rec = (cloudData.history || []).find(r => String(r.id) === String(recordId));
if (!rec) return;
rec.payments = (rec.payments || []).filter(p => String(p.id) !== String(paymentId));
await saveCloudData();
renderHistory();
if (currentObjectId) renderObjectDetail();
}

async function saveInvoiceToHistory(silent = false) {
if (invoiceCart.length === 0) {
if (!silent) alert("Счет пуст!");
return false;
}
const objSelect = document.getElementById('invoiceObjectSelect');
const objectId = objSelect ? objSelect.value : '';
if (!objectId || objectId === '__new__') {
alert('Выберите объект для счёта или создайте новый!');
if (objSelect) objSelect.focus();
return false;
}
const client = document.getElementById('clientName').value.trim() || "Без имени";
const address = document.getElementById('objectAddress').value.trim() || "Без адреса";
const note = document.getElementById('invoiceNote').value.trim();
let total = invoiceCart.reduce((sum, item) => sum + (item.qty * item.price), 0);
if (invoiceAttachments.some(a => a.uploading)) {
alert('Дождитесь окончания загрузки файлов отчёта.');
return false;
}
const attachments = invoiceAttachments.filter(a => a.url).map(a => ({ url: a.url, publicId: a.publicId, resourceType: a.resourceType, name: a.name, size: a.size, type: a.type }));

if (editingRecordId) {
const rec = (cloudData.history || []).find(r => String(r.id) === String(editingRecordId));
if (rec) {
rec.client = client;
rec.address = address;
rec.note = note;
rec.objectId = objectId;
rec.items = [...invoiceCart];
rec.total = total;
rec.attachments = attachments;
rec.date = new Date().toLocaleString('ru-RU');
// Тип документа (счёт / предв. расчёт) при редактировании не меняется —
// это фиксируется один раз при создании, чтобы случайно не "превратить"
// сохранённый счёт в расчёт или наоборот.
await saveCloudData();
if (!silent) alert("Изменения сохранены!");
finishEditRecord();
return true;
}
editingRecordId = null;
}

const uniqueId = 'inv_' + Date.now() + '_' + (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(36).substr(2, 10));
const newRecord = {
id: uniqueId,
author: currentUser || "admin",
date: new Date().toLocaleString('ru-RU'),
client,
address,
note,
total,
objectId,
docType: selectedDocType,
items: [...invoiceCart],
attachments
};
if (!cloudData.history) cloudData.history = [];
cloudData.history.unshift(newRecord);
const savedOk = await saveCloudData();
if (savedOk) markDraftSaved();
if (!silent) alert(selectedDocType === 'estimate' ? "Расчёт сохранён!" : "Счет сохранен в историю!");
renderHistory();
return true;
}

// Дата без секунд: «02.10.2026, 15:30:13» → «02.10.2026, 15:30»
function formatRecordDate(date) {
return String(date || '').replace(/(\d{1,2}:\d{2}):\d{2}/, '$1');
}

function renderHistoryCardHtml(rec, containerId, opts = {}) {
const items = rec.items || [];
// Строка позиции как в смете: название и сумма в одну строку,
// под ними «количество × цена», помещения и как считали
const qtyFmt = n => Number(n || 0).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
const itemLine = i =>
`<div class="hc-line">
<div class="hc-l-main">
<div class="hc-l-name">${escapeHtml(i.name)}</div>
<div class="hc-l-sub">${qtyFmt(i.qty)} ${escapeHtml(i.unit)} × ${Number(i.price || 0).toLocaleString('ru-RU')} ₽${i.location && !roomsBreakdownText(i) ? ` · ${escapeHtml(i.location)}` : ''}</div>
${roomsBreakdownText(i) ? `<div class="rooms-breakdown">${escapeHtml(roomsBreakdownText(i))}</div>` : ''}
${measureNoteHtml(i)}
</div>
<div class="hc-l-sum">${(i.qty * i.price).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽</div>
</div>`;
const VISIBLE_ITEMS = 3;
const asLines = arr => arr.map(l => `<div>${l}</div>`).join('');
let itemsHtml = asLines(items.slice(0, VISIBLE_ITEMS).map(itemLine));
const grouped = items.some(i => i.roomId);
if (grouped) {
// Счёт по помещениям: каждое помещение свёрнуто со своей суммой
const groups = [];
items.forEach(i => {
const key = i.roomId ? i.location || 'Помещение' : '';
let g = groups.find(x => x.key === key);
if (!g) { g = { key, items: [] }; groups.push(g); }
g.items.push(i);
});
const lineNoLoc = i => itemLine({ ...i, location: '' });
itemsHtml = groups.map(g => {
const sum = g.items.reduce((a, i) => a + i.qty * i.price, 0);
const title = g.key ? `${escapeHtml(g.key)}` : 'Прочие работы';
return `<details class="hc-room"><summary>${title} · ${g.items.length} ${pluralRu(g.items.length, 'работа', 'работы', 'работ')} · ${sum.toLocaleString('ru-RU')} ₽</summary><div>${asLines(g.items.map(g.key ? lineNoLoc : itemLine))}</div></details>`;
}).join('');
} else if (items.length > VISIBLE_ITEMS) {
const rest = items.length - VISIBLE_ITEMS;
itemsHtml += `<details><summary>Ещё ${rest} ${pluralRu(rest, 'позиция', 'позиции', 'позиций')}</summary>${asLines(items.slice(VISIBLE_ITEMS).map(itemLine))}</details>`;
}
const masterName = rec.author || rec.master || rec.user || 'Мастер';
const recordId = rec.id || ('legacy_' + Math.random());
const isEstimate = rec.docType === 'estimate';
const title = opts.objName || rec.client || (isEstimate ? 'Расчёт' : 'Счёт');
const showClient = opts.showClientAddress && rec.client && rec.client !== title;
const showAddress = opts.showClientAddress && rec.address && rec.address.trim() && rec.address !== 'Без адреса';
const canShare = rec.id && !rec.shareDisabled;
return `
<div class="history-card" id="historyCard_${recordId}">
<div class="hc-top">
<div class="hc-title">
<div class="hc-name">${escapeHtml(title)}${isEstimate ? '<span class="hc-badge" style="background:#f6efd6; color:#85600f;">Расчёт</span>' : ''}${rec.shareDisabled ? '<span class="hc-badge" style="background:#f6dfd8; color:#c2361f;">ссылка выкл.</span>' : ''}</div>
<div class="hc-date">${escapeHtml(formatRecordDate(rec.date))}</div>
</div>
<div class="hc-amount">${Number(rec.total || 0).toLocaleString('ru-RU')} ₽</div>
</div>
${showClient ? `<div class="hc-meta"><span class="meta-k">Заказчик</span> ${escapeHtml(rec.client)}</div>` : ''}
${showAddress ? `<div class="hc-meta"><span class="meta-k">Адрес</span> ${escapeHtml(rec.address)}</div>` : ''}
${isCurrentAdmin() ? `<div class="hc-meta"><span class="meta-k">Мастер</span> ${escapeHtml(masterName)}</div>` : ''}
${rec.note ? `<div class="hc-meta"><span class="meta-k">Пояснение</span> ${escapeHtml(rec.note)}</div>` : ''}
${renderAttachmentsHtml(rec.attachments)}
<div class="hc-items">${itemsHtml ? `<div class="hc-th"><span>Работа</span><span>Сумма</span></div>${itemsHtml}` : '<span style="color:#8d97a5;">Нет позиций</span>'}</div>
${!isEstimate ? renderPaymentSectionHtml(rec, recordId) : ''}
<div class="hc-actions">
<button type="button" class="hc-btn hc-btn-primary" onclick="sendHistoryRecordPDF('${recordId}')"><svg class="ic"><use href="#i-send"/></svg> Отправить PDF</button>
${canShare ? `<button type="button" class="hc-btn" onclick="shareInvoiceLink('${recordId}')" aria-label="Ссылка для заказчика"><svg class="ic"><use href="#i-link"/></svg></button>` : ''}
<button type="button" class="hc-btn hc-btn-more" onclick="openRecordActions('${recordId}', '${containerId}')" aria-label="Другие действия">⋯</button>
</div>
</div>
`;
}

function pluralRu(n, one, few, many) {
const m10 = n % 10, m100 = n % 100;
if (m10 === 1 && m100 !== 11) return one;
if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
return many;
}

/* ---------- Нижняя шторка с действиями ---------- */
// Значки в шторке действий — строгие линейные вместо эмодзи
const SHEET_ICONS = { '⬇️': 'download', '🔗': 'link', '🔒': 'lock', '🔓': 'unlock', '✏️': 'edit', '🗑️': 'trash', '🗑': 'trash',
'📤': 'send', '🧹': 'clear', '💬': 'chat', '📋': 'copy', '📏': 'ruler', '➕': 'plus' };
function sheetIconHtml(icon) {
const id = SHEET_ICONS[icon];
return id ? `<svg class="ic"><use href="#i-${id}"/></svg>` : '';
}
let sheetActions = [];

function openSheet(title, items) {
sheetActions = items.map(i => i && i.onClick);
document.getElementById('sheetTitle').textContent = title || '';
document.getElementById('sheetItems').innerHTML = items.map((item, idx) => {
if (!item) return '<div class="sheet-sep"></div>';
return `<button type="button" class="sheet-item${item.danger ? ' sheet-item-danger' : ''}" onclick="runSheetAction(${idx})"><span class="sheet-item-icon" aria-hidden="true">${sheetIconHtml(item.icon)}</span>${escapeHtml(item.label)}</button>`;
}).join('');
document.getElementById('sheet').classList.add('open');
document.getElementById('sheetOverlay').classList.add('open');
document.body.classList.add('sheet-open');
}

function closeSheet() {
document.getElementById('sheet').classList.remove('open');
document.getElementById('sheetOverlay').classList.remove('open');
document.body.classList.remove('sheet-open');
}

function runSheetAction(idx) {
const fn = sheetActions[idx];
closeSheet();
if (typeof fn === 'function') fn();
}

document.addEventListener('keydown', (e) => {
if (e.key !== 'Escape') return;
const sheetOpen = document.getElementById('sheet').classList.contains('open');
const pickerOpen = document.getElementById('workPicker').classList.contains('open');
if (sheetOpen) closeSheet();
else if (pickerOpen) closeWorkPicker();
else if (typeof closeMeasure === 'function') closeMeasure();
});

function openRecordActions(recordId, containerId) {
const rec = (cloudData.history || []).find(r => String(r.id) === String(recordId));
const isEstimate = rec && rec.docType === 'estimate';
const items = [
{ icon: '⬇️', label: 'Скачать PDF', onClick: () => downloadHistoryRecordPDF(recordId) },
];
if (rec && rec.id && !rec.shareDisabled) {
items.push({ icon: '🔗', label: 'Ссылка для заказчика', onClick: () => shareInvoiceLink(recordId) });
}
if (rec && rec.id && isCurrentAdmin()) {
items.push(rec.shareDisabled
? { icon: '🔓', label: 'Включить ссылку', onClick: () => toggleShareLink(recordId) }
: { icon: '🔒', label: 'Отключить ссылку', onClick: () => toggleShareLink(recordId) });
}
if (!isCurrentClient()) {
items.push({ icon: '✏️', label: 'Редактировать', onClick: () => startEditRecord(recordId, containerId) });
items.push(null);
items.push({ icon: '🗑️', label: isEstimate ? 'Удалить расчёт' : 'Удалить счёт', danger: true, onClick: () => deleteHistoryRecord(recordId) });
}
const title = rec ? `${isEstimate ? 'Расчёт' : 'Счёт'} от ${formatRecordDate(rec.date)} · ${Number(rec.total || 0).toLocaleString('ru-RU')} ₽` : '';
openSheet(title, items);
}

/* ---------- Напоминание об оплате ---------- */
function buildReminderText(rec) {
const info = getBalanceInfo(rec);
const obj = rec.objectId ? (cloudData.objects || []).find(o => o.id === rec.objectId) : null;
const money = n => Number(n || 0).toLocaleString('ru-RU') + ' ₽';
const date = formatRecordDate(rec.date).split(',')[0];
const lines = [];
lines.push(rec.client ? `Здравствуйте, ${rec.client}!` : 'Здравствуйте!');
lines.push(`Напоминаю об оплате${obj ? ` по объекту «${obj.name}»` : ''}: счёт от ${date} на ${money(info.total)}.`);
if (info.paid > 0) lines.push(`Оплачено ${money(info.paid)}, осталось ${money(info.balance)}.`);
else lines.push(`К оплате ${money(info.balance)}.`);
if (rec.id && !rec.shareDisabled) lines.push(`Счёт: ${getInvoiceShareUrl(rec.id)}`);
lines.push('Спасибо!');
const signature = (cloudData.self && (cloudData.self.companyName || '').trim()) || '';
if (signature) lines.push(signature);
return lines.join('\n');
}

function openReminderActions(recordId) {
const rec = (cloudData.history || []).find(r => String(r.id) === String(recordId));
if (!rec) return;
const text = buildReminderText(rec);
const items = [
{ icon: '💬', label: 'Отправить в WhatsApp', onClick: () => window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener') },
];
if (navigator.share) {
items.push({ icon: '📤', label: 'Другое приложение…', onClick: () => navigator.share({ text }).catch(() => {}) });
}
items.push({ icon: '📋', label: 'Скопировать текст', onClick: async () => {
try {
await navigator.clipboard.writeText(text);
showAddToast('Текст скопирован');
} catch (e) {
prompt('Скопируйте текст напоминания:', text);
}
} });
openSheet(`Напоминание об оплате · осталось ${getBalanceInfo(rec).balance.toLocaleString('ru-RU')} ₽`, items);
}

function openObjectActions(id) {
const obj = (cloudData.objects || []).find(o => o.id === id);
openSheet(obj ? obj.name : 'Объект', [
{ icon: '🗑️', label: 'Удалить объект', danger: true, onClick: () => deleteObject(id) },
]);
}

function openCalcActions() {
openSheet(selectedDocType === 'estimate' ? 'Расчёт' : 'Счёт', [
{ icon: '📤', label: 'Отправить PDF', onClick: () => sendPDF() },
{ icon: '⬇️', label: 'Скачать PDF', onClick: () => downloadInvoicePDF() },
null,
{ icon: '🧹', label: 'Очистить всё', danger: true, onClick: () => {
if (confirm('Очистить счёт? Все позиции и заполненные поля будут сброшены.')) resetAll();
} },
]);
}

function renderPaymentSectionHtml(rec, recordId) {
const info = getBalanceInfo(rec);
const balanceClass = info.status === 'owes' ? 'pay-balance-owes' : info.status === 'over' ? 'pay-balance-over' : 'pay-balance-paid';
const balanceLabel = info.status === 'owes' ? `Должен: ${info.balance.toLocaleString('ru-RU')} ₽`
: info.status === 'over' ? `Переплата: ${info.balance.toLocaleString('ru-RU')} ₽`
: 'Оплачено полностью ✓';
const payments = rec.payments || [];
const paymentsHtml = payments.length === 0 ? '' : payments.map(p => `
<div class="pay-history-item">
<span>${p.date} — ${Number(p.amount).toLocaleString('ru-RU')} ₽ <span style="color:#8d97a5;">(${escapeHtml(p.method)})</span></span>
<span style="display:flex; gap:6px;">
<button type="button" onclick="resendPaymentReceipt('${recordId}', '${p.id}')" title="Отправить чек ещё раз" aria-label="Отправить чек ещё раз" style="border:none; background:none; cursor:pointer; color:#5d6878; padding:2px;"><svg class="ic" style="width:16px;height:16px;"><use href="#i-send"/></svg></button>
${!isCurrentClient() ? `<button type="button" onclick="deletePayment('${recordId}', '${p.id}')" title="Удалить" style="border:none; background:none; cursor:pointer; font-size:13px; color:#c2361f;">✕</button>` : ''}
</span>
</div>
`).join('');
const paidPart = info.total > 0 ? Math.min(100, Math.max(0, (info.paid / info.total) * 100)) : 0;
const tapeHtml = info.total > 0 ? `<div class="tape" role="img" aria-label="Оплачено ${Math.round(paidPart)}%"><i style="width:${paidPart}%"></i></div>
<div class="tape-l"><span>оплачено ${info.paid.toLocaleString('ru-RU')} ₽</span>${info.status === 'owes' ? `<span class="due">остаток ${info.balance.toLocaleString('ru-RU')} ₽</span>` : info.status === 'over' ? `<span>переплата ${info.balance.toLocaleString('ru-RU')} ₽</span>` : '<span class="ok">оплачено полностью</span>'}</div>` : '';
return `${tapeHtml}
<div class="pay-balance-line ${balanceClass}"${tapeHtml ? ' style="justify-content:flex-end; padding-top:6px;"' : ''}>
${tapeHtml ? '' : `<span>${balanceLabel}</span>`}
${!isCurrentClient() ? `<span style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
${info.status === 'owes' && rec.id ? `<button type="button" class="btn-delete-item" style="background:#fff; border:1px solid currentColor;" onclick="openReminderActions('${recordId}')">Напомнить</button>` : ''}
<button type="button" class="btn-delete-item" style="background:#fff; border:1px solid currentColor;" onclick="openPaymentModal('${recordId}')">Оплата</button>
</span>` : ''}
</div>
${paymentsHtml}
`;
}

let historyFilter = 'all';

function setHistoryFilter(filter) {
historyFilter = filter;
document.querySelectorAll('.chips .chip').forEach(c => c.classList.toggle('active', c.dataset.filter === filter));
renderHistory();
}

function renderHistory() {
const list = document.getElementById('historyList');
if (!list) return;
setDimLabel('dimHistory', new Date().toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', ''));
let records = cloudData.history || [];
if (!isCurrentAdmin()) {
records = records.filter(r => (r.author || r.master || r.user) === currentUser);
}
// Общая сводка — всегда по всем счетам, независимо от фильтра
renderOverallPayStats(records.filter(r => r.docType !== 'estimate'));
const countEl = document.getElementById('historyCount');
if (records.length === 0) {
list.innerHTML = '<div style="text-align:center; color:#8d97a5; padding: 20px 0; font-size:13px;">Здесь появятся сохранённые счета и расчёты</div>';
if (countEl) countEl.textContent = '';
return;
}
const objName = rec => {
const obj = rec.objectId ? (cloudData.objects || []).find(o => o.id === rec.objectId) : null;
return obj ? obj.name : null;
};
const searchEl = document.getElementById('historySearch');
const query = (searchEl ? searchEl.value : '').trim().toLowerCase();
const filtered = records.filter(rec => {
const isEstimate = rec.docType === 'estimate';
if (historyFilter === 'estimate' && !isEstimate) return false;
if (historyFilter === 'owes' && (isEstimate || getBalanceInfo(rec).status !== 'owes')) return false;
if (historyFilter === 'paid' && (isEstimate || getBalanceInfo(rec).status === 'owes')) return false;
if (!query) return true;
const haystack = [rec.client, rec.address, rec.note, objName(rec), rec.author, rec.master, rec.date,
...(rec.items || []).map(i => i.name)].filter(Boolean).join(' ').toLowerCase();
return haystack.includes(query);
});
if (countEl) {
countEl.textContent = (query || historyFilter !== 'all')
? `Найдено: ${filtered.length} из ${records.length}`
: '';
}
if (filtered.length === 0) {
list.innerHTML = '<div style="text-align:center; color:#8d97a5; padding: 20px 0; font-size:13px;">Ничего не найдено — измените поиск или фильтр</div>';
return;
}
list.innerHTML = filtered.map(rec =>
renderHistoryCardHtml(rec, 'historyList', { objName: objName(rec), showClientAddress: true })
).join('');
}

function renderOverallPayStats(invoiceRecords) {
const box = document.getElementById('overallPayStats');
if (!box) return;
if (invoiceRecords.length === 0) { box.innerHTML = ''; return; }
const totalInvoiced = invoiceRecords.reduce((sum, r) => sum + Number(r.total || 0), 0);
const totalPaid = invoiceRecords.reduce((sum, r) => sum + getPaymentsSum(r), 0);
let owed = 0, overpaid = 0;
invoiceRecords.forEach(r => {
const info = getBalanceInfo(r);
if (info.status === 'owes') owed += info.balance;
if (info.status === 'over') overpaid += info.balance;
});
const rub = n => n.toLocaleString('ru-RU') + ' ₽';
const cells = [
`<div>Выставлено<b>${rub(totalInvoiced)}</b></div>`,
`<div>Оплачено<b>${rub(totalPaid)}</b></div>`,
owed > 0 ? `<div class="due">Должны<b>${rub(owed)}</b></div>` : '',
overpaid > 0 ? `<div>Переплата<b>${rub(overpaid)}</b></div>` : '',
].filter(Boolean);
box.innerHTML = `<div class="stamp" style="--cols:${cells.length}">${cells.join('')}</div>`;
}

async function deleteHistoryRecord(id) {
if (!confirm("Удалить этот счёт из истории?")) return;
const rec = (cloudData.history || []).find(r => String(r.id) === String(id));
cloudData.history = (cloudData.history || []).filter(r => String(r.id) !== String(id));
await saveCloudData();
renderHistory();
if (currentObjectId) renderObjectDetail();
if (rec && Array.isArray(rec.attachments)) {
rec.attachments.forEach(att => {
if (!att.publicId) return;
fetch(`${WORKER_URL}/file?publicId=${encodeURIComponent(att.publicId)}&resourceType=${encodeURIComponent(att.resourceType || 'image')}`, {
method: 'DELETE',
headers: { 'Authorization': 'Bearer ' + authToken }
}).catch(e => console.error('Не удалось удалить файл отчёта из хранилища:', e));
});
}
}

function renderProfile() {
const self = cloudData.self || { login: currentUser, email: '', companyName: '', publicPriceEnabled: false };
document.getElementById('profLogin').value = self.login || currentUser;
document.getElementById('profEmail').value = self.email || '';
document.getElementById('profCompanyName').value = self.companyName || '';
document.getElementById('profInvoiceNote').value = self.invoiceNote || '';
document.getElementById('profPass').value = '';
document.getElementById('priceBackupBox').style.display = isCompanyMode() ? 'block' : 'none';
document.getElementById('publicPriceToggle').checked = !!self.publicPriceEnabled;
updatePublicPriceLinkBox();
}

async function updateProfile() {
const newL = document.getElementById('profLogin').value.trim();
const newEmail = document.getElementById('profEmail').value.trim();
const newCompanyName = document.getElementById('profCompanyName').value.trim();
const newInvoiceNote = document.getElementById('profInvoiceNote').value.trim();
const newP = document.getElementById('profPass').value.trim();
if (!newL) {
alert('Заполните логин!');
return;
}
try {
const res = await fetch(`${WORKER_URL}/appdata`, {
method: "PUT",
headers: { "Content-Type": "application/json", "Authorization": "Bearer " + authToken },
body: JSON.stringify({ baseRev: cloudRev ?? undefined, self: { login: newL, email: newEmail, companyName: newCompanyName, invoiceNote: newInvoiceNote, password: newP || undefined } })
});
const result = await res.json();
if (!res.ok) {
alert(result.error || 'Не удалось сохранить профиль');
return;
}
cloudData.self = result.self;
if (typeof result.rev === 'number') cloudRev = result.rev;
if (result.token) authToken = result.token;
currentUser = result.self.login;
localStorage.setItem('authToken', authToken);
localStorage.setItem('currentUser', currentUser);
if (isCurrentAdmin()) localStorage.setItem('isAdminAuthorized', 'true');
document.getElementById('userBadge').textContent = currentUser + (isCompanyMode() ? ' · своя компания' : '');
document.getElementById('profPass').value = '';
alert('Данные профиля обновлены!');
} catch (e) {
alert('Ошибка сети — не удалось сохранить профиль');
}
}

function getPublicPriceLink() {
const base = window.location.origin + window.location.pathname.replace(/calc\.html$/, 'index.html');
return `${base}?company=${encodeURIComponent(currentUser)}`;
}

function updatePublicPriceLinkBox() {
const toggle = document.getElementById('publicPriceToggle');
const enabled = toggle ? toggle.checked : false;
document.getElementById('publicPriceLinkBox').style.display = enabled ? 'block' : 'none';
if (enabled) {
document.getElementById('publicPriceLinkInput').value = getPublicPriceLink();
document.getElementById('sharePublicPriceBtn').style.display = (navigator.share ? 'inline-block' : 'none');
}
}

async function togglePublicPrice() {
const enabled = document.getElementById('publicPriceToggle').checked;
updatePublicPriceLinkBox();
try {
const res = await fetch(`${WORKER_URL}/appdata`, {
method: "PUT",
headers: { "Content-Type": "application/json", "Authorization": "Bearer " + authToken },
body: JSON.stringify({ baseRev: cloudRev ?? undefined, self: { login: currentUser, publicPriceEnabled: enabled } })
});
const result = await res.json();
if (!res.ok) {
alert(result.error || 'Не удалось сохранить настройку');
document.getElementById('publicPriceToggle').checked = !enabled;
updatePublicPriceLinkBox();
return;
}
cloudData.self = result.self;
if (typeof result.rev === 'number') cloudRev = result.rev;
} catch (e) {
alert('Ошибка сети — не удалось сохранить настройку');
document.getElementById('publicPriceToggle').checked = !enabled;
updatePublicPriceLinkBox();
}
}

function copyPublicPriceLink() {
const link = getPublicPriceLink();
if (navigator.clipboard && navigator.clipboard.writeText) {
navigator.clipboard.writeText(link).then(() => alert('Ссылка скопирована!'));
} else {
const input = document.getElementById('publicPriceLinkInput');
input.select();
document.execCommand('copy');
alert('Ссылка скопирована!');
}
}

function sharePublicPriceLink() {
const link = getPublicPriceLink();
const title = (cloudData.self && cloudData.self.companyName) ? cloudData.self.companyName : 'Мой прайс-лист';
if (navigator.share) {
navigator.share({ title, text: 'Прайс-лист на услуги', url: link }).catch(() => {});
}
}

function downloadPriceBackup() {
const payload = {
exportedAt: new Date().toISOString(),
login: currentUser,
services: cloudData.services || [],
};
const blob = new Blob(['\uFEFF' + JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `price-backup-${currentUser}-${new Date().toISOString().slice(0, 10)}.json`;
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);
}

function restorePriceBackup(event) {
const file = event.target.files[0];
if (!file) return;
const reader = new FileReader();
reader.onload = async (e) => {
try {
const parsed = JSON.parse(e.target.result);
if (!Array.isArray(parsed.services)) {
alert('В файле не найден прайс-лист.');
return;
}
if (!confirm(`Заменить текущий прайс-лист на копию из файла (${parsed.services.length} позиций)? Текущий прайс будет перезаписан.`)) return;
cloudData.services = parsed.services;
await saveCloudData();
renderServices();
alert('Прайс-лист восстановлен из файла.');
} catch (err) {
alert('Не удалось прочитать файл: ' + err.message);
}
};
reader.readAsText(file);
event.target.value = '';
}

function renderUsersList() {
const list = document.getElementById('usersListContainer');
if (!list) return;
list.innerHTML = '';
if (!cloudData.users || cloudData.users.length === 0) {
list.innerHTML = '<div style="color:#8d97a5; font-size:13px;">Список пуст</div>';
return;
}
const roleLabels = { admin: 'Админ', master: 'Мастер', client: 'Заказчик' };
const roleBadgeClasses = { admin: 'badge-admin', master: 'badge-master', client: 'badge-client' };
cloudData.users.forEach((u, idx) => {
const isSelf = u.login === currentUser;
const role = u.role === 'admin' ? 'admin' : (u.role === 'client' ? 'client' : 'master');
const badgeClass = roleBadgeClasses[role];
const roleName = roleLabels[role];
list.innerHTML += `
<div class="user-card">
<div style="flex: 1 1 100%; min-width: 0; padding-right: 8px;">
<b>${escapeHtml(u.login)}</b> <span class="badge ${badgeClass}">${roleName}</span><br>
<span style="color:#5d6878; font-size:11px; word-break: break-word; overflow-wrap: anywhere;">${escapeHtml(u.email || 'нет почты')} | Пароль скрыт 🔒</span>
</div>
<div style="display: flex; gap: 4px; flex-shrink: 0; align-items: center; flex-wrap: wrap;">
<button type="button" class="btn btn-warning btn-sm" onclick="resetUserPassword(${idx})">Сброс пароля</button>
${!isSelf ? `
<select onchange="setUserRole(${idx}, this.value)" style="font-size:12px; padding:6px 8px; border-radius:8px; border:1px solid #cfd5dd; background:#fff;">
<option value="master" ${role === 'master' ? 'selected' : ''}>Мастер</option>
<option value="client" ${role === 'client' ? 'selected' : ''}>Заказчик</option>
<option value="admin" ${role === 'admin' ? 'selected' : ''}>Админ</option>
</select>
<button type="button" class="btn btn-danger btn-sm" onclick="deleteUser(${idx})">Удалить</button>
` : '<span style="font-size:11px; color:#8d97a5; font-weight:600;">Вы</span>'}
</div>
</div>
`;
});
}

async function renderStats() {
const container = document.getElementById('statsListContainer');
if (!container) return;
container.innerHTML = '<div style="color:#8d97a5; font-size:13px;">Загрузка...</div>';
try {
const res = await fetch(`${WORKER_URL}/stats`, {
headers: { "Authorization": "Bearer " + authToken }
});
const result = await res.json();
if (!res.ok) {
container.innerHTML = `<div style="color:#b23a26; font-size:13px;">${escapeHtml(result.error || 'Не удалось загрузить статистику')}</div>`;
return;
}
const stats = result.stats || [];
if (stats.length === 0) {
container.innerHTML = '<div style="color:#8d97a5; font-size:13px;">Пока никто не работал в режиме «своя компания» — статистики нет.</div>';
return;
}
container.innerHTML = stats.map(s => `
<div class="user-card" style="border:1px solid #dfe3e8; border-radius:10px; padding:12px; margin-bottom:8px;">
<div style="font-weight:700; font-size:14px; margin-bottom:8px;">${escapeHtml(s.login)}</div>
<div class="object-stats">
<div class="object-stat-box">Объекты<b>${s.objects}</b></div>
<div class="object-stat-box">Счета<b>${s.invoices}</b></div>
<div class="object-stat-box">Подсчёты<b>${s.estimates}</b></div>
<div class="object-stat-box">Чеки<b>${s.receipts}</b></div>
</div>
</div>
`).join('');
} catch (e) {
container.innerHTML = '<div style="color:#b23a26; font-size:13px;">Ошибка сети — не удалось загрузить статистику</div>';
}
}

async function restoreFromBackup(input) {
const file = input.files && input.files[0];
input.value = '';
if (!file) return;
let backup;
try {
backup = JSON.parse(await file.text());
} catch (e) {
alert('Не удалось прочитать файл — это не резервная копия сайта.');
return;
}
const rec = backup && backup.record;
if (!rec || !Array.isArray(rec.users)) {
alert('Это не резервная копия сайта: в файле нет списка пользователей.');
return;
}
const when = backup.exportedAt ? new Date(backup.exportedAt).toLocaleString('ru-RU') : 'неизвестно';
const companies = rec.companyData && typeof rec.companyData === 'object' ? Object.keys(rec.companyData).length : 0;
const summary =
`Копия от: ${when}\n` +
`Пользователей: ${rec.users.length}\n` +
`Счетов и расчётов: ${Array.isArray(rec.history) ? rec.history.length : 0}\n` +
`Объектов: ${Array.isArray(rec.objects) ? rec.objects.length : 0}\n` +
`Кабинетов «своя компания»: ${companies}`;
if (!confirm(`Восстановить данные из этого файла?\n\n${summary}\n\nВСЕ текущие данные будут заменены. Сначала они скачаются отдельным файлом — на случай, если понадобится вернуть.`)) return;

const btn = document.getElementById('restoreBtn');
const originalText = btn.textContent;
btn.disabled = true;
try {
// 1. Страховка: сохраняем текущие данные
btn.textContent = 'Сохраняю текущие данные...';
const saved = await downloadBackup({ silent: true, prefix: 'before-restore' });
if (!saved && !confirm('Не удалось скачать копию текущих данных. Всё равно восстановить? Текущие данные будут потеряны безвозвратно.')) return;
// 2. Восстановление
btn.textContent = 'Восстанавливаю...';
const res = await fetch(`${WORKER_URL}/restore`, {
method: 'POST',
headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
body: JSON.stringify({ record: rec })
});
const result = await res.json().catch(() => null);
if (!res.ok) {
alert((result && result.error) || ('Не удалось восстановить (ошибка ' + res.status + ')'));
return;
}
alert('Данные восстановлены. Если ваш логин в копии другой — войдите заново.');
await loadCloudData();
refreshViewsAfterReload();
renderStats();
} catch (e) {
alert('Ошибка сети — данные не восстановлены.');
} finally {
btn.disabled = false;
btn.textContent = originalText;
}
}

async function downloadBackup(opts = {}) {
const btn = document.getElementById('backupBtn');
const originalText = btn.textContent;
btn.disabled = true;
btn.textContent = 'Готовлю файл...';
try {
const res = await fetch(`${WORKER_URL}/backup`, {
headers: { "Authorization": "Bearer " + authToken }
});
if (!res.ok) {
let msg = 'Не удалось получить резервную копию';
try { const err = await res.json(); if (err && err.error) msg = err.error; } catch (e) { /* пусто */ }
if (!opts.silent) alert(msg);
return false;
}
const blob = await res.blob();
const link = document.createElement('a');
link.href = URL.createObjectURL(blob);
const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
link.download = `${opts.prefix || 'backup'}-${stamp}.json`;
document.body.appendChild(link);
link.click();
document.body.removeChild(link);
setTimeout(() => URL.revokeObjectURL(link.href), 1000);
return true;
} catch (e) {
if (!opts.silent) alert('Ошибка сети — не удалось скачать резервную копию');
return false;
} finally {
btn.disabled = false;
btn.textContent = originalText;
}
}

async function resetUserPassword(idx) {
const u = cloudData.users[idx];
if (!u) return;
const newPass = prompt(`Новый пароль для ${u.login}:`);
if (!newPass || !newPass.trim()) return;
u.pass = newPass.trim();
await saveCloudData();
alert(`Пароль для ${u.login} обновлён!`);
}

async function setUserRole(idx, role) {
const u = cloudData.users[idx];
if (!u) return;
u.role = role;
await saveCloudData();
renderUsersList();
}

async function addNewUser() {
const l = document.getElementById('newMasterLogin').value.trim();
const email = document.getElementById('newMasterEmail').value.trim();
const p = document.getElementById('newMasterPass').value.trim();
const r = document.getElementById('newMasterRole').value;
if (!l || !p) {
alert('Заполните логин и пароль!');
return;
}
if (cloudData.users.some(u => u.login === l)) {
alert('Такой логин уже занят!');
return;
}
cloudData.users.push({ login: l, email: email, pass: p, role: r });
await saveCloudData();
document.getElementById('newMasterLogin').value = '';
document.getElementById('newMasterEmail').value = '';
document.getElementById('newMasterPass').value = '';
renderUsersList();
alert(`Пользователь ${l} создан!`);
}

async function deleteUser(idx) {
const u = cloudData.users[idx];
if (u.login === currentUser) return;
if (!confirm(`Удалить пользователя ${u.login}?`)) return;
cloudData.users.splice(idx, 1);
await saveCloudData();
renderUsersList();
}

function resetAll() {
document.getElementById('clientName').value = '';
document.getElementById('objectAddress').value = '';
document.getElementById('invoiceNote').value = '';
const objSelect = document.getElementById('invoiceObjectSelect');
if (objSelect) objSelect.value = '';
setDocType('invoice');
invoiceCart = [];
selectedRoomIds = new Set();
invoiceAttachments = [];
renderReportAttachments();
renderServices();
}

/* ===================== ОБЪЕКТЫ ===================== */

function getObjectVisibleTo(obj) {
// Если у объекта явно не задан список видимости — по умолчанию виден только автору
// (старое поведение, для объектов, созданных до появления этой функции).
return Array.isArray(obj.visibleTo) ? obj.visibleTo : (obj.author ? [obj.author] : []);
}

function getVisibleObjects() {
let objects = cloudData.objects || [];
if (!isCurrentAdmin()) {
objects = objects.filter(o => getObjectVisibleTo(o).includes(currentUser));
}
return objects;
}

function getObjectStats(objectId) {
const records = (cloudData.history || []).filter(r => r.objectId === objectId && r.docType !== 'estimate');
const total = records.reduce((sum, r) => sum + Number(r.total || 0), 0);
const paid = records.reduce((sum, r) => sum + getPaymentsSum(r), 0);
let owed = 0, overpaid = 0;
records.forEach(r => {
const info = getBalanceInfo(r);
if (info.status === 'owes') owed += info.balance;
if (info.status === 'over') overpaid += info.balance;
});
return { count: records.length, total, paid, owed, overpaid };
}

function populateObjectSelect() {
const select = document.getElementById('invoiceObjectSelect');
if (!select) return;
const prevValue = select.value;
select.innerHTML = '<option value="">— Выберите объект —</option><option value="__new__">Создать новый объект</option>';
getVisibleObjects().forEach(obj => {
const opt = document.createElement('option');
opt.value = obj.id;
opt.textContent = obj.name;
select.appendChild(opt);
});
if (prevValue && getVisibleObjects().some(o => o.id === prevValue)) {
select.value = prevValue;
}
}

async function onInvoiceObjectChange() {
const select = document.getElementById('invoiceObjectSelect');
if (!select) return;
if (select.value === '__new__') {
await quickCreateObjectFromCalc();
return;
}
selectedRoomIds = new Set();
if (typeof renderRooms === 'function') renderRooms();
if (!select.value) return;
const obj = (cloudData.objects || []).find(o => o.id === select.value);
if (!obj) return;
// Заказчика и адрес берём из объекта. Поле перезаписывается, только если
// оно пустое или в нём то, что мы сами подставили от прошлого объекта, —
// введённое вручную не трогаем.
autofillFromObject('clientName', obj.client);
autofillFromObject('objectAddress', obj.address);
updateInvoiceInfo();
}

function autofillFromObject(inputId, value) {
const input = document.getElementById(inputId);
if (!input) return;
const current = input.value.trim();
if (current && current !== (input.dataset.autofilled || '')) return;
input.value = value || '';
input.dataset.autofilled = value || '';
}

async function quickCreateObjectFromCalc() {
const select = document.getElementById('invoiceObjectSelect');
const name = prompt('Название нового объекта (например: Квартира на ул. Ленина, 1):');
if (!name || !name.trim()) {
if (select) select.value = '';
return;
}
const clientInput = document.getElementById('clientName');
const defaultClient = clientInput ? clientInput.value.trim() : '';
const client = prompt('Имя заказчика:', defaultClient);
if (!client || !client.trim()) {
if (select) select.value = '';
return;
}
const newObj = await createObject({ name: name.trim(), client: client.trim() });
populateObjectSelect();
if (select) select.value = newObj.id;
if (clientInput && !clientInput.value.trim()) {
clientInput.value = newObj.client;
updateInvoiceInfo();
}
renderObjects();
showAddToast(`Объект «${newObj.name}» создан`);
}

async function createObject({ name, client, address = '', access = '', materials = '' }) {
const newObj = {
id: 'obj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
name,
client,
address,
access,
materials,
author: currentUser || 'admin',
visibleTo: [currentUser || 'admin'],
createdAt: new Date().toLocaleString('ru-RU')
};
if (!cloudData.objects) cloudData.objects = [];
cloudData.objects.unshift(newObj);
await saveCloudData();
return newObj;
}

async function addNewObject() {
const name = document.getElementById('newObjName').value.trim();
const client = document.getElementById('newObjClient').value.trim();
const address = document.getElementById('newObjAddress').value.trim();
const access = document.getElementById('newObjAccess').value.trim();
const materials = document.getElementById('newObjMaterials').value.trim();
if (!name || !client) {
alert('Укажите как минимум название объекта и имя заказчика!');
return;
}
await createObject({ name, client, address, access, materials });
document.getElementById('newObjName').value = '';
document.getElementById('newObjClient').value = '';
document.getElementById('newObjAddress').value = '';
document.getElementById('newObjAccess').value = '';
document.getElementById('newObjMaterials').value = '';
const card = document.getElementById('newObjectCard');
if (card) card.classList.remove('open');
populateObjectSelect();
renderObjects();
}

function renderObjects() {
const container = document.getElementById('objectsListContainer');
if (!container) return;
const objects = getVisibleObjects();
setDimLabel('dimObjects', objects.length ? `${objects.length} ${pluralRu(objects.length, 'объект', 'объекта', 'объектов')}` : '');
const searchEl = document.getElementById('objectsSearch');
if (searchEl) searchEl.style.display = objects.length > 3 ? 'block' : 'none';
if (objects.length === 0) {
container.innerHTML = '<div style="text-align:center; color:#8d97a5; padding: 20px 0; font-size:13px;">Добавьте первый объект — кнопка «Новый объект» выше</div>';
return;
}
const query = (searchEl ? searchEl.value : '').trim().toLowerCase();
const shown = query
? objects.filter(o => [o.name, o.client, o.address].filter(Boolean).join(' ').toLowerCase().includes(query))
: objects;
if (shown.length === 0) {
container.innerHTML = '<div style="text-align:center; color:#8d97a5; padding: 20px 0; font-size:13px;">Ничего не найдено</div>';
return;
}
container.innerHTML = '';
shown.forEach(obj => {
const stats = getObjectStats(obj.id);
const card = document.createElement('div');
card.className = 'object-card';
card.setAttribute('role', 'button');
card.tabIndex = 0;
card.onclick = () => openObjectDetail(obj.id);
card.onkeydown = (e) => { if (e.key === 'Enter') openObjectDetail(obj.id); };
let adminInfoHtml = '';
if (isCurrentAdmin()) {
const visibleTo = getObjectVisibleTo(obj);
const hiddenFromAuthor = obj.author && !visibleTo.includes(obj.author);
const visibleText = visibleTo.length ? escapeHtml(visibleTo.join(', ')) : 'только админ';
adminInfoHtml = `<div style="font-size:11px; color:#5d6878; margin-top:8px;">Автор: <b>${escapeHtml(obj.author || '—')}</b> · Видят: ${visibleText}${hiddenFromAuthor ? ' <span style="color:#b23a26; font-weight:600;">(скрыт от автора)</span>' : ''}</div>`;
}
let moneyHtml = '';
if (stats.count > 0) {
const debt = stats.owed > 0
? `<span class="obj-pill obj-pill-owes">Должен ${stats.owed.toLocaleString('ru-RU')} ₽</span>`
: `<span class="obj-pill obj-pill-paid">Оплачено ✓</span>`;
moneyHtml = `<div class="obj-money">
<span class="obj-pill">${stats.count} ${pluralRu(stats.count, 'счёт', 'счёта', 'счетов')} · ${stats.total.toLocaleString('ru-RU')} ₽</span>
${debt}
</div>`;
} else {
moneyHtml = '<div class="obj-money"><span class="obj-pill">Счетов пока нет</span></div>';
}
card.innerHTML = `
<div class="obj-head">
<div class="obj-name">${escapeHtml(obj.name)}</div>
<span class="obj-chevron" aria-hidden="true">›</span>
</div>
<div class="obj-line"><span class="meta-k">Заказчик</span> ${escapeHtml(obj.client)}</div>
${obj.address ? `<div class="obj-line"><span class="meta-k">Адрес</span> ${escapeHtml(obj.address)}</div>` : ''}
${moneyHtml}
${adminInfoHtml}
`;
container.appendChild(card);
});
}

function openObjectDetail(id) {
currentObjectId = id;
objectHistorySubTab = 'invoice';
document.getElementById('objectsListView').style.display = 'none';
document.getElementById('objectDetailView').style.display = 'block';
renderObjectDetail();
}

function closeObjectDetail() {
currentObjectId = null;
document.getElementById('objectsListView').style.display = 'block';
document.getElementById('objectDetailView').style.display = 'none';
}

function goToCalcForObject(id) {
const select = document.getElementById('invoiceObjectSelect');
if (select) {
select.value = id;
onInvoiceObjectChange();
}
switchTab('calc');
}

function renderObjectDetail() {
const container = document.getElementById('objectDetailView');
if (!container || !currentObjectId) return;
const obj = (cloudData.objects || []).find(o => o.id === currentObjectId);
if (!obj) {
closeObjectDetail();
renderObjects();
return;
}
const stats = getObjectStats(obj.id);
const allRecords = (cloudData.history || []).filter(r => r.objectId === obj.id);
const invoiceRecords = allRecords.filter(r => r.docType !== 'estimate');
const estimateRecords = allRecords.filter(r => r.docType === 'estimate');

const invoiceHtml = invoiceRecords.length === 0
? '<div style="text-align:center; color:#8d97a5; padding: 16px 0; font-size:13px;">По этому объекту пока нет счетов</div>'
: invoiceRecords.map(rec => renderHistoryCardHtml(rec, 'objectHistoryList')).join('');
const estimateHtml = estimateRecords.length === 0
? '<div style="text-align:center; color:#8d97a5; padding: 16px 0; font-size:13px;">По этому объекту пока нет предварительных расчётов</div>'
: estimateRecords.map(rec => renderHistoryCardHtml(rec, 'objectHistoryList')).join('');

container.innerHTML = `
<span class="link-text" onclick="closeObjectDetail(); renderObjects();">← К списку объектов</span>
<h1 style="margin-top:10px;">${escapeHtml(obj.name)}</h1>

<div class="profile-box">
<div class="object-detail-field">
<b>Имя заказчика</b>
${escapeHtml(obj.client)}
</div>
<div class="object-detail-field">
<b>Адрес</b>
${obj.address ? escapeHtml(obj.address) : '<span style="color:#8d97a5;">не указан</span>'}
</div>
<div class="object-detail-field">
<b>Доступ на объект</b>
${obj.access ? escapeHtml(obj.access).replace(/\n/g, '<br>') : '<span style="color:#8d97a5;">не указан</span>'}
</div>
<div class="object-detail-field">
<b>Спецификация материалов</b>
${obj.materials ? escapeHtml(obj.materials).replace(/\n/g, '<br>') : '<span style="color:#8d97a5;">не указана</span>'}
</div>
</div>

<div class="object-stats">
<div class="object-stat-box">Всего счетов<b>${stats.count}</b></div>
<div class="object-stat-box">Сумма по объекту<b>${stats.total.toLocaleString('ru-RU')} ₽</b></div>
<div class="object-stat-box" style="background:#eef6f1;">Оплачено<b style="color:#1d7a4c;">${stats.paid.toLocaleString('ru-RU')} ₽</b></div>
${stats.owed > 0 ? `<div class="object-stat-box" style="background:#fbeeea;">Должен<b style="color:#c2361f;">${stats.owed.toLocaleString('ru-RU')} ₽</b></div>` : ''}
${stats.overpaid > 0 ? `<div class="object-stat-box" style="background:#fff4d1;">Переплата<b style="color:#14181f;">${stats.overpaid.toLocaleString('ru-RU')} ₽</b></div>` : ''}
</div>

${!isCurrentClient() ? `<button type="button" class="btn btn-primary" style="margin-top:14px;" onclick="goToCalcForObject('${obj.id}')">Выставить счёт по объекту</button>
<div class="obj-actions">
<button type="button" class="hc-btn" onclick="startEditObject('${obj.id}')">Редактировать</button>
<button type="button" class="hc-btn hc-btn-more" onclick="openObjectActions('${obj.id}')" aria-label="Другие действия">⋯</button>
</div>` : ''}

${renderObjectRoomsHtml(obj)}
${(obj.measurements || []).length ? `<details style="margin:8px 0;"><summary style="cursor:pointer; font-weight:700; color:#485566; padding:6px 0;">История замеров (${obj.measurements.length})</summary>${renderMeasureHistoryHtml(obj.id)}</details>` : ''}

<div class="tab-menu" style="margin-top:16px;">
<button type="button" class="tab-btn ${objectHistorySubTab === 'invoice' ? 'active' : ''}" onclick="switchObjectHistoryTab('invoice')">Счета (${invoiceRecords.length})</button>
<button type="button" class="tab-btn ${objectHistorySubTab === 'estimate' ? 'active' : ''}" onclick="switchObjectHistoryTab('estimate')">Расчёты (${estimateRecords.length})</button>
</div>
<div id="objectHistoryList" style="display:${objectHistorySubTab === 'invoice' ? 'block' : 'none'};">${invoiceHtml}</div>
<div id="objectEstimateList" style="display:${objectHistorySubTab === 'estimate' ? 'block' : 'none'};">${estimateHtml}</div>
`;
}

function switchObjectHistoryTab(type) {
objectHistorySubTab = type;
renderObjectDetail();
}

function startEditObject(id) {
const obj = (cloudData.objects || []).find(o => o.id === id);
if (!obj) return;
const container = document.getElementById('objectDetailView');

let visibilityHtml = '';
if (isCurrentAdmin()) {
const visibleTo = getObjectVisibleTo(obj);
const masters = (cloudData.users || []).filter(u => u.role !== 'admin');
const checkboxesHtml = masters.length === 0
? '<div style="font-size:12px; color:#8d97a5;">Пока нет мастеров или заказчиков</div>'
: masters.map(m => `
<label style="display:flex; align-items:center; gap:8px; font-size:13px; font-weight:normal; text-transform:none; letter-spacing:normal; color:#33404f;">
<input type="checkbox" class="editObjVisibleCheckbox" value="${escapeHtml(m.login)}" ${visibleTo.includes(m.login) ? 'checked' : ''}>
${escapeHtml(m.login)} <span class="badge ${m.role === 'client' ? 'badge-client' : 'badge-master'}">${m.role === 'client' ? 'Заказчик' : 'Мастер'}</span>${m.login === obj.author ? ' <span style="color:#8d97a5;">(автор объекта)</span>' : ''}
</label>
`).join('');
visibilityHtml = `
<div class="form-group">
<label>Кто видит объект (мастера и заказчики)</label>
<div style="display:flex; flex-direction:column; gap:8px; border:1px solid #cfd5dd; border-radius:10px; padding:10px; background:#fff;">
${checkboxesHtml}
</div>
<div style="font-size:11px; color:#8d97a5; margin-top:4px; text-transform:none; letter-spacing:normal; font-weight:normal;">Отметьте заказчика, чтобы дать ему доступ к счетам по этому объекту. Снимите галочку, чтобы скрыть объект — даже от того, кто его создал. Вам как админу объект виден всегда.</div>
</div>
`;
}

container.innerHTML = `
<span class="link-text" onclick="renderObjectDetail()">← Отмена</span>
<h1 style="margin-top:10px;">Редактирование объекта</h1>
<div class="profile-box">
<div class="form-group">
<label>Название объекта</label>
<input type="text" id="editObjName" value="${escapeHtml(obj.name)}">
</div>
<div class="form-group">
<label>Имя заказчика</label>
<input type="text" id="editObjClient" value="${escapeHtml(obj.client)}">
</div>
<div class="form-group">
<label>Адрес</label>
<input type="text" id="editObjAddress" value="${escapeHtml(obj.address || '')}" placeholder="ул. Ленина, д. 1, кв. 5">
</div>
<div class="form-group">
<label>Доступ на объект</label>
<textarea id="editObjAccess">${escapeHtml(obj.access || '')}</textarea>
</div>
<div class="form-group">
<label>Спецификация материалов</label>
<textarea id="editObjMaterials">${escapeHtml(obj.materials || '')}</textarea>
</div>
${visibilityHtml}
<button type="button" class="btn btn-success" onclick="saveObjectEdit('${obj.id}')">Сохранить</button>
</div>
`;
}

async function saveObjectEdit(id) {
const obj = (cloudData.objects || []).find(o => o.id === id);
if (!obj) return;
const name = document.getElementById('editObjName').value.trim();
const client = document.getElementById('editObjClient').value.trim();
if (!name || !client) {
alert('Укажите как минимум название объекта и имя заказчика!');
return;
}
obj.name = name;
obj.client = client;
obj.address = document.getElementById('editObjAddress').value.trim();
obj.access = document.getElementById('editObjAccess').value.trim();
obj.materials = document.getElementById('editObjMaterials').value.trim();
if (isCurrentAdmin()) {
obj.visibleTo = Array.from(document.querySelectorAll('.editObjVisibleCheckbox:checked')).map(cb => cb.value);
}
await saveCloudData();
populateObjectSelect();
renderObjectDetail();
}

async function deleteObject(id) {
if (!confirm('Удалить объект? Связанные счета останутся в общей истории, но потеряют привязку к объекту.')) return;
cloudData.objects = (cloudData.objects || []).filter(o => o.id !== id);
(cloudData.history || []).forEach(r => {
if (r.objectId === id) r.objectId = null;
});
await saveCloudData();
closeObjectDetail();
populateObjectSelect();
renderObjects();
}

/* ===================== РЕДАКТИРОВАНИЕ СЧЁТА В ИСТОРИИ ===================== */

function startEditRecord(id, containerId) {
const rec = (cloudData.history || []).find(r => String(r.id) === String(id));
if (!rec) {
alert('Не удалось найти этот счёт для редактирования.');
return;
}
editingRecordId = id;
editingReturnContext = containerId === 'objectHistoryList' ? 'object' : 'history';
objectHistorySubTab = rec.docType === 'estimate' ? 'estimate' : 'invoice';
invoiceCart = (rec.items || []).map(i => ({ ...i }));
selectedRoomIds = new Set();
if (migrateLegacyRooms(rec.rooms, invoiceCart, rec.objectId)) saveCloudData();
invoiceAttachments = (rec.attachments || []).map(a => ({ ...a }));
renderReportAttachments();

switchTab('calc');

document.getElementById('clientName').value = rec.client || '';
document.getElementById('objectAddress').value = rec.address || '';
document.getElementById('invoiceNote').value = rec.note || '';
const objSelect = document.getElementById('invoiceObjectSelect');
if (objSelect) objSelect.value = rec.objectId || '';
const searchInput = document.getElementById('searchCalcInput');
if (searchInput) searchInput.value = '';
setDocType(rec.docType === 'estimate' ? 'estimate' : 'invoice');

updateEditModeUI();
renderServices();
window.scrollTo({ top: 0, behavior: 'smooth' });
}

function duplicateAsNewFromEdit() {
if (!editingRecordId) return;
if (!confirm('Текущий счёт останется без изменений, а сохранённые сейчас позиции лягут в основу НОВОГО отдельного счёта. Продолжить?')) return;
// Выходим из режима редактирования, но НЕ очищаем корзину/поля формы —
// пусть все текущие позиции, заказчик и адрес останутся предзаполненными,
// просто следующее сохранение создаст новую запись, а не обновит старую.
editingRecordId = null;
editingReturnContext = null;
updateEditModeUI();
showAddToast('Теперь это новый счёт — проверьте данные и сохраните');
window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateEditModeUI() {
const banner = document.getElementById('editModeBanner');
const bannerText = document.getElementById('editModeBannerText');
const saveBtn = document.getElementById('calcSaveBtn');
const docTypeBtns = [document.getElementById('docTypeInvoiceBtn'), document.getElementById('docTypeEstimateBtn')];
if (banner) banner.style.display = editingRecordId ? 'flex' : 'none';
if (bannerText) bannerText.textContent = editingRecordId ? (selectedDocType === 'estimate' ? 'Редактирование расчёта из истории' : 'Редактирование счёта из истории') : 'Редактирование счёта из истории';
if (saveBtn) saveBtn.textContent = editingRecordId ? 'Сохранить изменения' : 'Сохранить';
docTypeBtns.forEach(btn => { if (btn) btn.disabled = !!editingRecordId; });
}

function finishEditRecord() {
const returnToObject = editingReturnContext === 'object' && currentObjectId;
editingRecordId = null;
editingReturnContext = null;
invoiceCart = [];
selectedRoomIds = new Set();
invoiceAttachments = [];
renderReportAttachments();
document.getElementById('clientName').value = '';
document.getElementById('objectAddress').value = '';
document.getElementById('invoiceNote').value = '';
const objSelect = document.getElementById('invoiceObjectSelect');
if (objSelect) objSelect.value = '';
setDocType('invoice');
updateEditModeUI();
renderServices();

if (returnToObject) {
document.getElementById('calcTab').style.display = 'none';
document.getElementById('objectsTab').style.display = 'block';
document.getElementById('historyTab').style.display = 'none';
document.getElementById('profileTab').style.display = 'none';
document.getElementById('usersTab').style.display = 'none';
document.getElementById('tabCalcBtn').classList.remove('active');
document.getElementById('tabObjectsBtn').classList.add('active');
document.getElementById('tabHistoryBtn').classList.remove('active');
document.getElementById('objectsListView').style.display = 'none';
document.getElementById('objectDetailView').style.display = 'block';
renderObjectDetail();
} else {
switchTab('history');
}
}

function cancelEditRecord() {
finishEditRecord();
}

// Регистрируем service worker — без этого браузер не предложит
// "Установить приложение" / "Добавить на главный экран".
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch((err) => {
            console.warn('Service worker не зарегистрировался:', err);
        });
    });
}
