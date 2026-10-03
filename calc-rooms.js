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
{ key: 'slopes', tab: 'slopes', label: 'Откосы' },
{ key: 'narrow', tab: 'narrow', label: 'Узкие' },
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

// Разбивка работы по помещениям: «Гостиная 37,32 · Спальня 30,1 м²»
function roomsBreakdownText(item) {
if (!item || !Array.isArray(item.rooms) || item.rooms.length < 2) return '';
return item.rooms.map(r => `${r.name} ${mFmt(r.qty)}`).join(' · ') + (item.unit ? ' ' + item.unit : '');
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
const sums = SURFACES.filter(s => s.key !== 'wallsMinus').map(s => ({ s, v: sumSurface(picked, s.key) })).filter(x => x.v.value > 0);
list.innerHTML = `
<div class="room-select-all">
<button type="button" class="chip" onclick="selectAllRooms(true)">Отметить все</button>
${picked.length ? `<button type="button" class="chip" onclick="selectAllRooms(false)">Снять отметки</button>` : ''}
</div>
${rooms.map(room => {
const surf = roomSurfaces(room);
const on = selectedRoomIds.has(room.id);
const pills = SURFACES.filter(s => s.key !== 'wallsMinus' && surf[s.key].value > 0).map(s => `${s.label.toLowerCase()} ${mFmt(surf[s.key].value)}`).join(' · ');
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

/* ---------- замер помещения: «Готово» ---------- */
async function finishRoomMeasure() {
const name = document.getElementById('mpRoom').value.trim();
if (!name) {
alert('Назовите помещение, например: Гостиная.');
document.getElementById('mpRoom').focus();
return;
}
const obj = (cloudData.objects || []).find(o => o.id === measureTarget.objectId);
if (!obj) { alert('Объект не найден.'); return; }
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
closeMeasure();
syncCartWithRooms();
renderInvoice();
if (typeof currentObjectId !== 'undefined' && currentObjectId === objectId) renderObjectDetail();
scheduleDraftSave();
await saveCloudData();
// после сохранения данные пришли с сервера заново — перерисуем
syncCartWithRooms();
renderInvoice();
if (typeof currentObjectId !== 'undefined' && currentObjectId === objectId) renderObjectDetail();
showAddToast(isNew ? `«${name}» добавлено` : 'Замер обновлён');
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

function suggestSurface(srv, has) {
const n = String(srv.name || '').toLowerCase();
if (/откос/.test(n) && has('slopes')) return 'slopes';
if (/плитк|кафел|фартук|панел/.test(n) && has('parts')) return 'parts';
if (/потол/.test(n) && has('ceiling')) return 'ceiling';
if (/стен|обо[ий]|плитк|кафел/.test(n) && has('walls')) return 'walls';
if (srv.unit === 'пог. м') return has('slopes') ? 'slopes' : (has('narrow') ? 'narrow' : null);
if (has('walls')) return 'walls';
if (has('ceiling')) return 'ceiling';
return null;
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
const sug = suggestSurface(srv, has);
html += `<div class="wp-item${inCart.has(srv.name) ? ' added' : ''}">
<button type="button" class="wp-row" onclick="toggleWorkOptions(${idx})">
<span class="wp-row-name">${escapeHtml(srv.name)}${inCart.has(srv.name) ? ' <span class="wp-badge">✓ в счёте</span>' : ''}</span>
<span class="wp-row-price">${Number(srv.price).toLocaleString('ru-RU')} ₽${srv.unit ? '/' + escapeHtml(srv.unit) : ''}</span>
</button>
${open ? `<div class="wp-opts">
<div class="wp-opts-title">Что считаем в отмеченных помещениях:</div>
<div class="wp-surfaces">
${SURFACES.filter(s => has(s.key)).map(s => `<button type="button" class="wp-surface${s.key === sug ? ' suggested' : ''}" onclick="addWorkToRooms(${idx}, '${s.key}')">${s.label}<small>${mFmt(sums[s.key].value)} ${sums[s.key].unit}</small></button>`).join('')}
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
showAddToast(`${srv.name}: ${mFmt(item.qty)} ${item.unit}`);
}
workPickerOpenIdx = null;
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
const pills = SURFACES.filter(s => s.key !== 'wallsMinus' && surf[s.key].value > 0).map(s => `<span class="obj-pill">${s.label} ${mFmt(surf[s.key].value)} ${surf[s.key].unit}</span>`).join('');
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
