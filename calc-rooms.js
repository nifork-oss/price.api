// Кабинет мастера — помещения объекта: отметка комнат, выбор работ, разбивка по комнатам.
// Подключается из calc.html; порядок подключения важен.

/* ===================== ПОМЕЩЕНИЯ ОБЪЕКТА ===================== */
// Помещения хранятся в объекте (obj.rooms) и замеряются один раз.
// В калькуляторе помещения выбранного объекта отмечаются галочками;
// работа добавляется ОДНОЙ строкой на все отмеченные помещения, а под
// ней — разбивка по комнатам (item.rooms). Исправили замер помещения —
// работы текущего счёта пересчитываются; сохранённые счета не меняются.

let selectedRoomIds = new Set();
let workPickerOpenIdx = null;

const SURFACES = [
{ key: 'walls', tab: 'walls', label: 'Стены' },
{ key: 'wallsMinus', tab: 'wallsMinus', label: 'Стены − участки' },
{ key: 'parts', tab: 'parts', label: 'Участки стен' },
{ key: 'ceiling', tab: 'ceiling', label: 'Потолок' },
{ key: 'ceilingNet', tab: 'ceilingNet', label: 'Потолок − ниши/короба' },
{ key: 'ceilNiche', tab: 'ceilNiche', label: 'Закарнизные ниши' },
{ key: 'ceilBox', tab: 'ceilBox', label: 'Короба, длина' },
{ key: 'ceilFin', tab: 'ceilFin', label: 'Ниши/короба: обработка' },
{ key: 'ceilFinArea', tab: 'ceilFinArea', label: 'Ниши/короба: обработка, м²' },
{ key: 'ceilLight', tab: 'ceilLight', label: 'Подсветка' },
{ key: 'radFin', tab: 'radFin', label: 'Ниши в стенах: обработка' },
{ key: 'radFinArea', tab: 'radFinArea', label: 'Ниши в стенах: обработка, м²' },
{ key: 'slopes', tab: 'slopes', label: 'Откосы' },
{ key: 'narrow', tab: 'narrow', label: 'Узкие' },
{ key: 'corners', tab: 'corners', label: 'Углы' },
{ key: 'cornersOut', tab: 'cornersOut', label: 'Углы наружные' },
{ key: 'cornersIn', tab: 'cornersIn', label: 'Углы внутренние' },
{ key: 'molCornice', tab: 'molCornice', label: 'Карниз' },
{ key: 'molPlinth', tab: 'molPlinth', label: 'Плинтус' },
{ key: 'molCeil', tab: 'molCeil', label: 'Молдинг на потолке' },
{ key: 'molWall', tab: 'molWall', label: 'Молдинг на стенах' },
];

function calcObject() {
const sel = document.getElementById('invoiceObjectSelect');
const id = sel && sel.value && sel.value !== '__new__' ? sel.value : '';
return id ? (cloudData.objects || []).find(o => o.id === id) || null : null;
}
function objectRooms(obj) { return obj && Array.isArray(obj.rooms) ? obj.rooms : []; }
function findObjectRoom(objectId, roomId) {
const obj = (cloudData.objects || []).find(o => o.id === objectId);
return obj ? objectRooms(obj).find(r => r.id === roomId) || null : null;
}
function roomName(room) { return (room && room.measure && room.measure.room) || 'Помещение'; }

function roomSurfaces(room) {
const r = computeMeasure(room.measure);
const out = {};
SURFACES.forEach(s => { out[s.key] = { ...measureValueForTab(r, s.tab), label: s.label }; });
return out;
}

function roundQty(v, unit) {
const q = Math.round(v * 1000) / 1000;
return unit === 'пог. м' ? Math.max(1, q) : q;
}

// Сумма поверхности по нескольким помещениям
function sumSurface(rooms, key) {
let value = 0, unit = '';
rooms.forEach(room => {
const s = roomSurfaces(room)[key];
if (s && s.value > 0) { value += roundQty(s.value, s.unit); unit = s.unit; }
});
return { value: Math.round(value * 1000) / 1000, unit };
}

// Как называется поверхность в счёте, PDF и на странице заказчика.
// Должен совпадать с SURFACE_LABELS в view.html.
const SURFACE_INVOICE_LABEL = {
walls: 'Стены',
wallsMinus: 'Стены без участков',
parts: 'Участки стен',
ceiling: 'Потолок',
ceilingNet: 'Потолок без ниш и коробов',
ceilNiche: 'Закарнизные ниши',
ceilBox: 'Короба',
ceilBoxArea: 'Короба',
ceilFin: 'Ниши и короба: обработка',
ceilFinArea: 'Ниши и короба: обработка',
ceilLight: 'Подсветка',
radFin: 'Ниши в стенах',
radFinArea: 'Ниши в стенах',
slopes: 'Откосы',
narrow: 'Узкие поверхности',
corners: 'Углы',
cornersOut: 'Углы наружные',
cornersIn: 'Углы внутренние',
molCornice: 'Карниз',
molPlinth: 'Плинтус',
molCeil: 'Молдинг на потолке',
molWall: 'Молдинг на стенах',
};
function surfaceInvoiceLabel(item) {
if (!item || !item.surface || item.surface === 'manual') return '';
return SURFACE_INVOICE_LABEL[item.surface] || '';
}

// Разбивка работы по помещениям с указанием, что именно считали:
// «Стены: Гостиная 37,32 · Спальня 30,1 м²», для одного помещения — «Потолок: Кухня».
// Если поверхность неизвестна (старый счёт, ручной ввод) — как раньше, без подписи.
function roomsBreakdownText(item) {
if (!item || !Array.isArray(item.rooms) || !item.rooms.length) return '';
const label = surfaceInvoiceLabel(item);
if (item.rooms.length < 2) return label ? `${label}: ${item.rooms[0].name}` : '';
const list = item.rooms.map(r => `${r.name} ${mFmt(r.qty)}`).join(' · ') + (item.unit ? ' ' + item.unit : '');
return label ? `${label}: ${list}` : list;
}

// Пересобрать строку работы из помещений объекта
function rebuildRoomItem(item, obj) {
if (!item.rooms || !item.surface || item.surface === 'manual') return;
const parts = [];
item.rooms.forEach(r => {
const room = objectRooms(obj).find(x => x.id === r.roomId);
if (!room) return;
const s = roomSurfaces(room)[item.surface];
if (!s || !(s.value > 0)) return;
parts.push({ roomId: room.id, name: roomName(room), qty: roundQty(s.value, item.unit), text: s.text });
});
if (!parts.length) return;
item.rooms = parts;
item.qty = Math.round(parts.reduce((a, p) => a + p.qty, 0) * 1000) / 1000;
item.location = parts.map(p => p.name).join(', ');
item.measure = {
room: item.location,
text: parts.map(p => `${p.name}:\n${p.text}`).join('\n'),
value: item.qty, unit: item.unit
};
}

function syncCartWithRooms() {
const obj = calcObject();
if (!obj) return;
invoiceCart.forEach(item => rebuildRoomItem(item, obj));
}

/* ---------- блок «Помещения» в калькуляторе ---------- */
function setDimLabel(id, text) {
const el = document.getElementById(id);
if (el) el.textContent = text || '';
}

function renderRooms() {
const _o = calcObject();
setDimLabel('dimCalc', _o ? _o.name : '');
const list = document.getElementById('roomsList');
const addBtn = document.getElementById('addRoomBtn');
if (!list) return;
const obj = calcObject();
if (!obj) {
list.innerHTML = '<div class="rooms-hint">Выберите объект выше — помещения хранятся в объекте и замеряются один раз.</div>';
if (addBtn) addBtn.style.display = 'none';
const planBtnHide = document.getElementById('planBtn');
if (planBtnHide) planBtnHide.style.display = 'none';
const aiBtnHide = document.getElementById('aiBtn');
if (aiBtnHide) aiBtnHide.style.display = 'none';
return;
}
if (addBtn) addBtn.style.display = '';
const rooms = objectRooms(obj);
const planBtn = document.getElementById('planBtn');
if (planBtn) planBtn.style.display = rooms.length ? '' : 'none';
const aiBtnEl = document.getElementById('aiBtn');
if (aiBtnEl) aiBtnEl.style.display = '';
// убираем отметки с удалённых помещений
selectedRoomIds = new Set([...selectedRoomIds].filter(id => rooms.some(r => r.id === id)));
if (!rooms.length) {
list.innerHTML = '<div class="rooms-hint">У объекта пока нет помещений. Добавьте их и сделайте замер — дальше отмечайте нужные комнаты и выбирайте работы.</div>';
return;
}
const picked = rooms.filter(r => selectedRoomIds.has(r.id));
const sums = SURFACES.filter(s => s.key !== 'wallsMinus' && s.key !== 'ceilingNet' && s.key !== 'cornersOut' && s.key !== 'cornersIn').map(s => ({ s, v: sumSurface(picked, s.key) })).filter(x => x.v.value > 0);
list.innerHTML = `
<div class="room-select-all">
<button type="button" class="chip" onclick="selectAllRooms(true)">Отметить все</button>
${picked.length ? `<button type="button" class="chip" onclick="selectAllRooms(false)">Снять отметки</button>` : ''}
</div>
${rooms.map(room => {
const surf = roomSurfaces(room);
const on = selectedRoomIds.has(room.id);
const pills = SURFACES.filter(s => s.key !== 'wallsMinus' && s.key !== 'ceilingNet' && s.key !== 'cornersOut' && s.key !== 'cornersIn' && surf[s.key].value > 0).map(s => `${s.label.toLowerCase()} ${mFmt(surf[s.key].value)}`).join(' · ');
return `<div class="room-row${on ? ' on' : ''}">
<label class="room-check">
<input type="checkbox" ${on ? 'checked' : ''} onchange="toggleRoom('${room.id}', this.checked)">
<span><span class="room-name">${escapeHtml(roomName(room))}</span><span class="room-dims">${escapeHtml(pills || 'замер не заполнен')}</span></span>
</label>
<button type="button" class="mp-mini" onclick="openMeasure({ kind: 'room', objectId: '${obj.id}', roomId: '${room.id}' })" aria-label="Замер помещения"><svg class="ic"><use href="#i-ruler"/></svg></button>
</div>`;
}).join('')}
<div class="room-selbar${picked.length ? ' show' : ''}">
<div class="room-selbar-text">Отмечено ${picked.length} ${pluralRu(picked.length, 'помещение', 'помещения', 'помещений')}${sums.length ? '<br><small>' + sums.map(x => `${x.s.label.toLowerCase()} ${mFmt(x.v.value)} ${x.v.unit}`).join(' · ') + '</small>' : ''}</div>
<button type="button" class="room-selbar-btn" onclick="openWorkPicker()" ${picked.length ? '' : 'disabled'}>+ Работа</button>
</div>`;
}

function toggleRoom(id, on) {
if (on) selectedRoomIds.add(id); else selectedRoomIds.delete(id);
renderRooms();
scheduleDraftSave();
}

function selectAllRooms(on) {
const obj = calcObject();
selectedRoomIds = new Set(on ? objectRooms(obj).map(r => r.id) : []);
renderRooms();
scheduleDraftSave();
}

/* ---------- замер помещения: сохранение и закрытие ---------- */
// roomSavedJson — снимок замера на момент последнего сохранения (null — помещение
// ещё не сохранялось). По нему видно, есть ли несохранённые правки. Переменную
// выставляет openMeasure (calc-measure.js); здесь только гарантируем, что она есть.
if (typeof roomSavedJson === 'undefined') window.roomSavedJson = null;

// Снимок того, что сейчас на экране: замер и название помещения
function roomStateJson() {
const nameEl = document.getElementById('mpRoom');
if (!measure) return 'null';
return JSON.stringify({ ...measure, room: (nameEl ? nameEl.value : (measure.room || '')).trim() });
}

// Есть ли в окне замера помещения то, чего ещё нет в сохранённом
function roomIsDirty() {
if (!measure) return false;
if (roomSavedJson === null) {
// помещение новое: сохранять есть что, если введено название или хоть какие-то размеры
const nameEl = document.getElementById('mpRoom');
return !isMeasureEmpty(measure) || !!(nameEl && nameEl.value.trim());
}
return roomStateJson() !== roomSavedJson;
}

// Кнопка «Сохранить» вверху: подсвечена и нажимается, только когда есть что сохранять
function updateRoomSaveBtn() {
const btn = document.getElementById('mpRoomSaveBtn');
if (!btn) return;
const dirty = roomIsDirty();
btn.classList.toggle('dirty', dirty);
btn.disabled = !dirty;
}

// close = true — записать и закрыть окно (кнопка внизу);
// close = false — записать и остаться в замере (кнопка «Сохранить» вверху).
async function saveRoomMeasure(close) {
const name = document.getElementById('mpRoom').value.trim();
if (!name) {
alert('Назовите помещение, например: Гостиная.');
document.getElementById('mpRoom').focus();
return false;
}
const obj = (cloudData.objects || []).find(o => o.id === measureTarget.objectId);
if (!obj) { alert('Объект не найден.'); return false; }
measure.room = name;
measure.objectId = obj.id;
const snapshot = JSON.parse(JSON.stringify(measure));
if (!Array.isArray(obj.rooms)) obj.rooms = [];
let room = measureTarget.roomId ? obj.rooms.find(r => r.id === measureTarget.roomId) : null;
const isNew = !room;
if (room) room.measure = snapshot;
else {
room = { id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), measure: snapshot };
obj.rooms.push(room);
}
const roomId = room.id, objectId = obj.id;
const prevSaved = roomSavedJson;
if (close) {
closeMeasure();
} else {
// остаёмся в окне: новое помещение теперь «живёт» под своим номером,
// и следующее нажатие «Сохранить» обновит его, а не создаст ещё одно
measureTarget.roomId = roomId;
measureDirty = false;
roomSavedJson = roomStateJson();
updateRoomSaveBtn();
if (typeof renderMeasureFooter === 'function') renderMeasureFooter(computeMeasure(measure));
}
syncCartWithRooms();
renderInvoice();
if (typeof currentObjectId !== 'undefined' && currentObjectId === objectId) renderObjectDetail();
scheduleDraftSave();
const ok = (await saveCloudData()) !== false;
// после сохранения данные пришли с сервера заново — перерисуем
syncCartWithRooms();
renderInvoice();
if (typeof currentObjectId !== 'undefined' && currentObjectId === objectId) renderObjectDetail();
if (!ok) {
// не сохранилось в облаке — в окне остаётся отметка «есть несохранённое»
if (!close) { roomSavedJson = prevSaved; updateRoomSaveBtn(); }
return false;
}
showAddToast(close ? (isNew ? `«${name}» добавлено` : 'Замер обновлён') : `«${name}» сохранено`);
return true;
}

async function finishRoomMeasure() { return saveRoomMeasure(true); }
async function quickSaveRoom() { return saveRoomMeasure(false); }

// Крестик в окне замера: если в замере помещения есть несохранённые правки —
// сначала спрашиваем. Обычный замер сам хранит черновик, там спрашивать нечего.
function requestCloseMeasure() {
if (measureTarget && measureTarget.kind === 'room' && roomIsDirty() &&
!confirm('В замере есть несохранённые изменения. Закрыть без сохранения?')) return;
closeMeasure();
}

function addRoom(objectId) {
const obj = objectId ? (cloudData.objects || []).find(o => o.id === objectId) : calcObject();
if (!obj) { alert('Сначала выберите объект.'); return; }
openMeasure({ kind: 'room', objectId: obj.id, roomId: null });
}

function openRoomActions(objectId, roomId) {
const room = findObjectRoom(objectId, roomId);
if (!room) return;
openSheet(roomName(room), [
{ icon: '📏', label: 'Изменить замер', onClick: () => openMeasure({ kind: 'room', objectId, roomId }) },
{ icon: '📋', label: 'Копировать как новое помещение', onClick: () => duplicateRoom(objectId, roomId) },
null,
{ icon: '🗑️', label: 'Удалить помещение', danger: true, onClick: () => deleteRoom(objectId, roomId) },
]);
}

async function duplicateRoom(objectId, roomId) {
const obj = (cloudData.objects || []).find(o => o.id === objectId);
const room = findObjectRoom(objectId, roomId);
if (!obj || !room) return;
const copy = JSON.parse(JSON.stringify(room.measure));
copy.id = 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
copy.room = roomName(room) + ' (копия)';
const newRoom = { id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), measure: copy };
obj.rooms.push(newRoom);
await saveCloudData();
if (typeof currentObjectId !== 'undefined' && currentObjectId === objectId) renderObjectDetail();
renderInvoice();
openMeasure({ kind: 'room', objectId, roomId: newRoom.id });
}

async function deleteRoom(objectId, roomId) {
const obj = (cloudData.objects || []).find(o => o.id === objectId);
const room = findObjectRoom(objectId, roomId);
if (!obj || !room) return;
if (!confirm(`Удалить помещение «${roomName(room)}» из объекта? Уже сохранённые счета не изменятся.`)) return;
obj.rooms = obj.rooms.filter(r => r.id !== roomId);
selectedRoomIds.delete(roomId);
// убираем помещение из работ текущего счёта
invoiceCart.forEach(item => {
if (Array.isArray(item.rooms) && item.rooms.some(r => r.roomId === roomId)) {
item.rooms = item.rooms.filter(r => r.roomId !== roomId);
if (!item.rooms.length) item._remove = true;
}
});
invoiceCart = invoiceCart.filter(i => !i._remove);
syncCartWithRooms();
await saveCloudData();
renderInvoice();
if (typeof currentObjectId !== 'undefined' && currentObjectId === objectId) renderObjectDetail();
}

/* ---------- выбор работы для отмеченных помещений ---------- */
function pickedRooms() {
const obj = calcObject();
return objectRooms(obj).filter(r => selectedRoomIds.has(r.id));
}

// Какую поверхность мастер выбирал для этой работы в прошлый раз — на этом телефоне.
function lastSurfaceStoreKey() { return 'lastSurface:' + (currentUser || ''); }
function loadLastSurfaces() {
try { return JSON.parse(localStorage.getItem(lastSurfaceStoreKey()) || '{}') || {}; } catch (e) { return {}; }
}
function rememberSurface(name, key) {
const m = loadLastSurfaces();
m[name] = key;
// держим список небольшим: не больше 300 работ
const names = Object.keys(m);
if (names.length > 300) delete m[names[0]];
try { localStorage.setItem(lastSurfaceStoreKey(), JSON.stringify(m)); } catch (e) { /* пусто */ }
}

function suggestSurface(srv, has) {
const n = String(srv.name || '').toLowerCase();
// лепнина: потолочный плинтус — это карниз; «закарнизная ниша» (под карниз для штор) — не лепнина
if (/(^|[^а-яё])карниз|галтел|потолочн\S* плинтус/.test(n) && !/закарниз|штор|гардин|тюл/.test(n) && has('molCornice')) return 'molCornice';
if (/плинтус/.test(n) && has('molPlinth')) return 'molPlinth';
if (/молдинг/.test(n) && (has('molCeil') || has('molWall'))) return /потол/.test(n) && has('molCeil') ? 'molCeil' : has('molWall') ? 'molWall' : 'molCeil';
if (/угл|уголк/.test(n) && has('corners')) return /наруж/.test(n) && has('cornersOut') ? 'cornersOut' : /внутр/.test(n) && has('cornersIn') ? 'cornersIn' : 'corners';
if (/откос/.test(n) && has('slopes')) return 'slopes';
if (/плитк|кафел|фартук|панел/.test(n) && has('parts')) return 'parts';
if (/подсвет|светодиод|led|лент/.test(n) && has('ceilLight')) return 'ceilLight';
// ниши в стенах (под батарею, под ТВ) — по отмеченным сторонам
if (/ниш/.test(n) && !/закарниз/.test(n) && /батар|радиат|под\s*окн|(^|[^а-яё])тв([^а-яё]|$)|телевиз|в\s*стен|стенов/.test(n) && (has('radFin') || has('radFinArea'))) return srv.unit === 'м²' && has('radFinArea') ? 'radFinArea' : has('radFin') ? 'radFin' : 'radFinArea';
// шпаклёвка, покраска и т. п. ниш и коробов — по отмеченным сторонам; монтаж — по длине
if (/ниш|короб/.test(n) && /шпакл|покра|грунт|обработ|отдел|шлиф/.test(n) && (has('ceilFin') || has('ceilFinArea'))) return srv.unit === 'м²' && has('ceilFinArea') ? 'ceilFinArea' : 'ceilFin';
if (/ниш/.test(n) && has('ceilNiche')) return 'ceilNiche';
if (/короб/.test(n) && has('ceilBox')) return 'ceilBox';
if (/натяж/.test(n) && has('ceilingNet')) return 'ceilingNet';
if (/потол/.test(n) && has('ceiling')) return 'ceiling';
if (/стен|обо[ий]|плитк|кафел/.test(n) && has('walls')) return 'walls';
if (srv.unit === 'пог. м') return has('slopes') ? 'slopes' : (has('narrow') ? 'narrow' : null);
if (has('walls')) return 'walls';
if (has('ceiling')) return 'ceiling';
return null;
}

// Что из отмеченных помещений уже добавлено в счёт этой работой по этой поверхности
function workSurfaceState(srv, surfaceKey, rooms) {
const price = Number(srv.price) || 0;
const item = invoiceCart.find(i => i.name === srv.name && i.surface === surfaceKey && i.price === price && Array.isArray(i.rooms));
if (!item) return { state: 'none', item: null };
const have = rooms.filter(r => item.rooms.some(x => x.roomId === r.id)).length;
return { state: have === rooms.length ? 'all' : (have > 0 ? 'some' : 'none'), item };
}

function openWorkPicker() {
const rooms = pickedRooms();
if (!rooms.length) { alert('Отметьте помещения, в которых делали работу.'); return; }
workPickerOpenIdx = null;
document.getElementById('wpTitle').textContent = 'Работа: ' + rooms.map(roomName).join(', ');
document.getElementById('wpSearch').value = '';
document.getElementById('workPicker').classList.add('open');
document.body.classList.add('measure-open');
renderWorkPicker();
}

function closeWorkPicker() {
document.getElementById('workPicker').classList.remove('open');
document.body.classList.remove('measure-open');
renderInvoice();
}

function renderWorkPicker() {
const rooms = pickedRooms();
const body = document.getElementById('wpBody');
if (!rooms.length) { body.innerHTML = ''; return; }
const keepScroll = body.scrollTop;
const lastSurf = loadLastSurfaces();
const sums = {};
SURFACES.forEach(s => { sums[s.key] = sumSurface(rooms, s.key); });
const has = k => sums[k].value > 0;
const q = document.getElementById('wpSearch').value.trim().toLowerCase();
const services = cloudData.services || [];
const inCart = new Set(invoiceCart.filter(i => Array.isArray(i.rooms) && i.rooms.some(r => selectedRoomIds.has(r.roomId))).map(i => i.name));
let html = '', cat = null, catPrinted = false, any = false;
services.forEach((srv, idx) => {
if (srv.isCategory) { cat = srv.name; catPrinted = false; return; }
if (q && !String(srv.name).toLowerCase().includes(q) && !(cat && cat.toLowerCase().includes(q))) return;
any = true;
if (cat && !catPrinted) { html += `<div class="wp-cat">${escapeHtml(cat)}</div>`; catPrinted = true; }
const open = workPickerOpenIdx === idx;
const remembered = lastSurf[srv.name];
const sug = remembered && has(remembered) ? remembered : suggestSurface(srv, has);
html += `<div class="wp-item${inCart.has(srv.name) ? ' added' : ''}">
<button type="button" class="wp-row" onclick="toggleWorkOptions(${idx})">
<span class="wp-row-name">${escapeHtml(srv.name)}${inCart.has(srv.name) ? ' <span class="wp-badge">✓ в счёте</span>' : ''}</span>
<span class="wp-row-price">${Number(srv.price).toLocaleString('ru-RU')} ₽${srv.unit ? '/' + escapeHtml(srv.unit) : ''}</span>
</button>
${open ? `<div class="wp-opts">
<div class="wp-opts-title">Что считаем в отмеченных помещениях: <span class="wp-opts-hint">можно несколько, повторное нажатие — убрать</span></div>
<div class="wp-surfaces">
${SURFACES.filter(s => has(s.key)).map(s => {
const st = workSurfaceState(srv, s.key, rooms).state;
const cls = `wp-surface${s.key === sug ? ' suggested' : ''}${st === 'all' ? ' done' : ''}${st === 'some' ? ' partial' : ''}`;
const mark = st === 'all' ? '✓ ' : '';
const extra = st === 'some' ? ' · не все помещения' : '';
return `<button type="button" class="${cls}" onclick="toggleWorkSurface(${idx}, '${s.key}')">${mark}${s.label}<small>${mFmt(sums[s.key].value)} ${sums[s.key].unit}${extra}</small></button>`;
}).join('')}
</div>
<div class="wp-manual">
<input class="mp-in" id="wpManualQty" type="text" inputmode="decimal" placeholder="своё кол-во">
<select id="wpManualUnit">${DEFAULT_UNITS.map(u => `<option ${u === (srv.unit || 'м²') ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}</select>
<button type="button" onclick="addWorkToRooms(${idx}, 'manual')">Добавить</button>
</div>
</div>` : ''}
</div>`;
});
body.innerHTML = `<div class="mp-body-inner">${any ? html : '<div class="mp-empty">Ничего не найдено</div>'}</div>`;
body.scrollTop = keepScroll;
}

function toggleWorkOptions(idx) {
workPickerOpenIdx = workPickerOpenIdx === idx ? null : idx;
renderWorkPicker();
}

function addWorkToRooms(serviceIdx, surfaceKey) {
const rooms = pickedRooms();
const obj = calcObject();
const srv = (cloudData.services || [])[serviceIdx];
if (!rooms.length || !srv || !obj) return;
const names = rooms.map(roomName).join(', ');
if (surfaceKey === 'manual') {
const qty = evalMeasureExpr(document.getElementById('wpManualQty').value);
const unit = document.getElementById('wpManualUnit').value;
if (!(qty > 0)) { alert('Укажите количество.'); document.getElementById('wpManualQty').focus(); return; }
invoiceCart.push({ name: srv.name, price: Number(srv.price) || 0, qty: roundQty(qty, unit), unit, location: names, surface: 'manual' });
showAddToast(`${srv.name}: ${mFmt(roundQty(qty, unit))} ${unit}`);
document.getElementById('wpManualQty').value = '';
} else {
const unit = sumSurface(rooms, surfaceKey).unit || srv.unit || 'м²';
const price = Number(srv.price) || 0;
// Та же работа по той же поверхности уже есть — добавляем комнаты в неё
let item = invoiceCart.find(i => i.name === srv.name && i.surface === surfaceKey && i.price === price && Array.isArray(i.rooms));
if (!item) {
item = { name: srv.name, price, qty: 0, unit, location: '', surface: surfaceKey, rooms: [] };
invoiceCart.push(item);
}
rooms.forEach(room => {
if (!item.rooms.some(r => r.roomId === room.id)) item.rooms.push({ roomId: room.id, name: roomName(room), qty: 0 });
});
rebuildRoomItem(item, obj);
rememberSurface(srv.name, surfaceKey);
showAddToast(`${srv.name} · ${surfaceInvoiceLabel({ surface: surfaceKey }).toLowerCase()}: ${mFmt(item.qty)} ${item.unit}`);
}
// Список вариантов у работы остаётся открытым — можно сразу добавить
// другую поверхность (потолок, откосы), не выбирая работу заново.
renderInvoice();
renderWorkPicker();
scheduleDraftSave();
}

// Нажатие на поверхность: добавлена — убираем, не добавлена или добавлена не везде — добавляем.
function toggleWorkSurface(serviceIdx, surfaceKey) {
const rooms = pickedRooms();
const srv = (cloudData.services || [])[serviceIdx];
if (!rooms.length || !srv) return;
const st = workSurfaceState(srv, surfaceKey, rooms);
if (st.state !== 'all') { addWorkToRooms(serviceIdx, surfaceKey); return; }
const ids = new Set(rooms.map(r => r.id));
st.item.rooms = st.item.rooms.filter(r => !ids.has(r.roomId));
if (!st.item.rooms.length) invoiceCart = invoiceCart.filter(i => i !== st.item);
else rebuildRoomItem(st.item, calcObject());
showAddToast(`${srv.name} · ${surfaceInvoiceLabel({ surface: surfaceKey }).toLowerCase()}: убрано`);
renderInvoice();
renderWorkPicker();
scheduleDraftSave();
}

/* ---------- старый формат (помещения внутри счёта) → в объект ---------- */
// Помещения из черновиков и счетов, собранных до этой версии, переносятся
// в объект, а позиции с одним помещением — в формат с разбивкой.
function migrateLegacyRooms(rooms, items, objectId) {
const obj = objectId ? (cloudData.objects || []).find(o => o.id === objectId) : null;
let changed = false;
if (obj && Array.isArray(rooms) && rooms.length) {
if (!Array.isArray(obj.rooms)) obj.rooms = [];
rooms.forEach(r => {
if (r && r.id && r.measure && !obj.rooms.some(x => x.id === r.id)) { obj.rooms.push({ id: r.id, measure: r.measure }); changed = true; }
});
}
(items || []).forEach(i => {
if (i.roomId && !i.rooms) {
i.rooms = [{ roomId: i.roomId, name: i.location || 'Помещение', qty: i.qty, text: i.measure ? i.measure.text : '' }];
delete i.roomId;
}
});
return changed;
}

/* ---------- помещения на странице объекта ---------- */
function renderObjectRoomsHtml(obj) {
const rooms = objectRooms(obj);
const canEdit = !isCurrentClient();
const list = rooms.length
? rooms.map(room => {
const surf = roomSurfaces(room);
const pills = SURFACES.filter(s => s.key !== 'wallsMinus' && s.key !== 'ceilingNet' && s.key !== 'cornersOut' && s.key !== 'cornersIn' && surf[s.key].value > 0).map(s => `<span class="obj-pill">${s.label} ${mFmt(surf[s.key].value)} ${surf[s.key].unit}</span>`).join('');
return `<div class="room-card">
<div class="room-head">
<div class="room-name">${escapeHtml(roomName(room))}</div>
${canEdit ? `<button type="button" class="hc-btn hc-btn-more" style="flex:0 0 44px; min-height:38px;" onclick="openRoomActions('${obj.id}', '${room.id}')" aria-label="Действия">⋯</button>` : ''}
</div>
<div class="obj-money">${pills || '<span class="obj-pill">замер не заполнен</span>'}</div>
<details class="measure-note" style="margin:6px 0 0;"><summary>Как мерили</summary><div>${escapeHtml(measureSummaryLines(room.measure).join('\n'))}</div></details>
</div>`;
}).join('')
: '<div style="font-size:13px; color:#8d97a5; margin-bottom:8px;">Помещений пока нет. Замерьте их один раз — дальше в калькуляторе останется только отмечать нужные.</div>';
return `<h2 style="margin-top:18px;">Помещения${rooms.length ? ` (${rooms.length})` : ''}</h2>
${list}
${canEdit ? `<button type="button" class="measure-open-btn" onclick="addRoom('${obj.id}')">+ Помещение</button>` : ''}
${rooms.length ? `<button type="button" class="btn btn-primary plan-btn" onclick="openPlanActions('${obj.id}')">Обмерный план (PDF)</button>` : ''}
${canEdit ? `<button type="button" class="measure-open-btn ai-btn" onclick="startPlanRecognition('${obj.id}')">Распознать план по фото (платно)</button>` : ''}`;
}
