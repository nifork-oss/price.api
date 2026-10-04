// Кабинет мастера — мелочи: проверка новой версии сайта, поля со значением «1».
// Подключается из calc.html; порядок подключения важен.

// ---------- Проверка новой версии сайта ----------
// Страница запоминает, какой была при открытии, и время от времени
// (при возвращении в приложение и раз в 5 минут) сверяется с сервером.
// Если файл на сервере изменился — показывает оповещение. Ничего
// настраивать при выкладке новой версии не нужно.
(function () {
const pageUrl = location.pathname;
let baseline = null;
let dismissedVersion = null;
let lastCheck = 0;

async function fetchCurrent() {
const res = await fetch(pageUrl, { cache: 'no-store' });
if (!res.ok) return null;
return await res.text();
}

async function checkForUpdate() {
if (location.protocol === 'file:') return;
if (Date.now() - lastCheck < 30000) return;
lastCheck = Date.now();
try {
const text = await fetchCurrent();
if (text === null) return;
if (baseline === null) { baseline = text; return; }
if (text !== baseline && text !== dismissedVersion) {
window.__pendingUpdateVersion = text;
document.getElementById('updateBanner').classList.add('show');
}
} catch (e) {
// нет сети — проверим в следующий раз
}
}

window.dismissUpdateBanner = function () {
dismissedVersion = window.__pendingUpdateVersion || null;
document.getElementById('updateBanner').classList.remove('show');
};

window.reloadForUpdate = function () {
// Собранный счёт сохранится как черновик и будет предложен после обновления.
// Правки счёта из истории черновиком не сохраняются — о них переспрашиваем.
if (typeof editingRecordId !== 'undefined' && editingRecordId &&
!confirm('Вы редактируете счёт из истории — несохранённые правки пропадут. Обновить сейчас?')) return;
if (typeof saveDraftNow === 'function') saveDraftNow();
location.reload();
};

window.addEventListener('load', () => setTimeout(checkForUpdate, 2000));
document.addEventListener('visibilitychange', () => {
if (document.visibilityState === 'visible') checkForUpdate();
});
setInterval(() => {
if (document.visibilityState === 'visible') checkForUpdate();
}, 5 * 60 * 1000);
})();

// ---------- Числовые поля со значением по умолчанию ----------
// В полях, где заранее стоит «1» (или «0»), при касании значение
// исчезает — можно сразу печатать нужное число, не стирая единицу.
// Если ничего не ввели и ушли из поля, прежнее значение возвращается.
(function () {
const DEFAULTS = ['1', '0'];
document.addEventListener('focusin', (e) => {
const el = e.target;
if (!(el instanceof HTMLInputElement) || el.type !== 'number') return;
if (!DEFAULTS.includes(el.value)) return;
el.dataset.defaultValue = el.value;
if (!el.dataset.origPlaceholder) el.dataset.origPlaceholder = el.placeholder || '';
el.placeholder = el.value;
el.value = '';
});
document.addEventListener('focusout', (e) => {
const el = e.target;
if (!(el instanceof HTMLInputElement) || el.type !== 'number') return;
if (el.dataset.defaultValue === undefined) return;
const def = el.dataset.defaultValue;
delete el.dataset.defaultValue;
el.placeholder = el.dataset.origPlaceholder || '';
if (el.value === '') {
el.value = def;
// сообщаем странице, что значение вернулось (пересчёт сумм)
el.dispatchEvent(new Event('input', { bubbles: true }));
}
});
})();

// ---------- Кнопка «Назад» и то же место после перезагрузки ----------
// Окна кабинета (меню, лист снизу, замер, чертёж во весь экран, карточка
// объекта, другие разделы) лежат друг на друге. Каждому открытому окну
// соответствует шаг в истории браузера: кнопка «Назад» телефона закрывает
// верхнее окно, а на главном экране спрашивает, закрыть ли кабинет.
// Где пользователь был (раздел, объект, замер и его вкладка), запоминается
// на время сессии вкладки — после перезагрузки открывается то же место.
(function () {
const $ = id => document.getElementById(id);
const isOpen = (id, cls = 'open') => { const el = $(id); return !!el && el.classList.contains(cls); };
const shown = id => { const el = $(id); return !!el && el.style.display !== 'none' && el.style.display !== ''; };
const appOn = () => shown('appScreen');
const mainTab = () => (typeof isCurrentClient === 'function' && isCurrentClient()) ? 'objects' : 'calc';
const TABS = ['calc', 'objects', 'history', 'profile', 'users', 'stats'];
const curTab = () => TABS.find(t => shown(t + 'Tab')) || mainTab();
// переменные других частей (объявлены через let — на window их нет)
const V = {
molFull: () => typeof molFull !== 'undefined' ? molFull : null,
tileFull: () => typeof tileFull !== 'undefined' ? tileFull : null,
tileElevWall: () => typeof tileElevWall !== 'undefined' ? tileElevWall : null,
cnFull: () => typeof cnFull !== 'undefined' ? cnFull : null,
cpFull: () => typeof cpFull !== 'undefined' ? cpFull : false,
rlFull: () => typeof rlFull !== 'undefined' ? rlFull : false,
rulerPick: () => typeof rulerPick !== 'undefined' ? rulerPick : null,
currentObjectId: () => typeof currentObjectId !== 'undefined' ? currentObjectId : null,
currentUser: () => typeof currentUser !== 'undefined' ? currentUser : '',
measure: () => typeof measure !== 'undefined' ? measure : null,
measureTarget: () => typeof measureTarget !== 'undefined' ? measureTarget : null,
measureTab: () => typeof measureTab !== 'undefined' ? measureTab : null,
rlView: () => typeof rlView !== 'undefined' ? rlView : null,
rlElevWall: () => typeof rlElevWall !== 'undefined' ? rlElevWall : null,
molElevWall: () => typeof molElevWall !== 'undefined' ? molElevWall : null,
cnElevWall: () => typeof cnElevWall !== 'undefined' ? cnElevWall : null,
};
const g = name => V[name]();

// Окна сверху вниз: открыто ли и как закрыть
const LAYERS = [
{ on: () => isOpen('sheet'), close: () => closeSheet() },
{ on: () => isOpen('payModalOverlay', 'show'), close: () => closePaymentModal() },
{ on: () => isOpen('userMenu'), close: () => toggleUserMenu(false) },
{ on: () => isOpen('aiPanel'), close: () => closeAiReview() },
{ on: () => isOpen('workPicker'), close: () => closeWorkPicker() },
{ on: () => !!g('tileFull'), close: () => tileToggleFull(g('tileFull')) },
{ on: () => !!g('molFull'), close: () => molToggleFull(g('molFull')) },
{ on: () => !!g('cnFull'), close: () => cnToggleFull(g('cnFull')) },
{ on: () => !!g('cpFull'), close: () => cpToggleFull(false) },
{ on: () => !!g('rlFull'), close: () => rulerToggleFull(false) },
{ on: () => isOpen('measurePanel') && !!g('rulerPick'), close: () => rulerCancelPick() },
{ on: () => isOpen('measurePanel', 'ruler-open'), close: () => rulerClose() },
{ on: () => isOpen('measurePanel'), close: () => requestCloseMeasure() },
{ on: () => curTab() === 'objects' && !!g('currentObjectId'), close: () => { closeObjectDetail(); renderObjects(); window.scrollTo(0, 0); } },
{ on: () => curTab() !== mainTab(), close: () => switchTab(mainTab()) },
];
const openLayers = () => appOn() ? LAYERS.filter(l => { try { return l.on(); } catch (e) { return false; } }) : [];

const nav = { skip: 0 };
const depthNow = () => (history.state && history.state.cabNav ? history.state.d : -1);
// Шаги истории = числу открытых окон (плюс один «сторожевой» на главном экране)
function sync() {
if (nav.skip > 0 || !appOn()) return;
const want = openLayers().length;
let d = depthNow();
if (d < 0) { history.pushState({ cabNav: true, d: 0 }, ''); d = 0; }
if (want > d) { for (let i = d + 1; i <= want; i++) history.pushState({ cabNav: true, d: i }, ''); }
else if (want < d) { nav.skip++; history.go(want - d); }   // окно закрыли кнопкой на экране
savePlace();
}
const later = () => setTimeout(sync, 0);
document.addEventListener('click', later, true);
document.addEventListener('change', later, true);
document.addEventListener('keyup', e => { if (e.key === 'Escape') later(); });

window.addEventListener('popstate', () => {
if (nav.skip > 0) { nav.skip--; return; }
if (!appOn()) return;
const d = depthNow();
const layers = openLayers();
if (d >= layers.length && d >= 0) { sync(); return; }   // «Вперёд» или уже закрыто
if (layers.length) {
try { layers[0].close(); } catch (e) { console.error('Назад:', e); }
setTimeout(sync, 0);
return;
}
// главный экран, дальше возвращаться некуда
if (confirm('Закрыть кабинет мастера?')) {
history.back();
setTimeout(() => { if (typeof showAddToast === 'function') showAddToast('Нажмите «Назад» ещё раз, чтобы выйти'); }, 400);
} else sync();
});

// ---------- то же место после перезагрузки ----------
const placeKey = () => 'cabPlace:' + (g('currentUser') || '');
function savePlace() {
if (!appOn()) return;
try {
const mOpen = isOpen('measurePanel');
const t = g('measureTarget') || {};
const room = mOpen && t.kind === 'room' ? { objectId: t.objectId, roomId: t.roomId || null, m: g('measure') } : null;
sessionStorage.setItem(placeKey(), JSON.stringify({
tab: curTab(), obj: g('currentObjectId') || null, y: window.scrollY,
measure: mOpen, mt: g('measureTab'), room,
rv: g('rlView'), ew: g('rlElevWall'), mw: g('molElevWall'), cw: g('cnElevWall'), tw: g('tileElevWall'),
my: mOpen && $('mpBody') ? $('mpBody').scrollTop : 0,
}));
} catch (e) { /* пусто */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePlace(); });
window.addEventListener('pagehide', savePlace);

let restored = false;
function restorePlace() {
let p = null;
try { p = JSON.parse(sessionStorage.getItem(placeKey()) || 'null'); } catch (e) { p = null; }
if (!p) return;
try {
const btn = { calc: 'tabCalcBtn', objects: 'tabObjectsBtn', history: 'tabHistoryBtn', profile: 'tabProfileBtn', users: 'tabUsersBtn', stats: 'tabStatsBtn' }[p.tab];
if (p.tab && p.tab !== curTab() && btn && $(btn) && $(btn).style.display !== 'none') switchTab(p.tab);
if (p.tab === 'objects' && p.obj && (cloudData.objects || []).some(o => o.id === p.obj)) openObjectDetail(p.obj);
if (p.measure) {
if (p.room && p.room.objectId && (cloudData.objects || []).some(o => o.id === p.room.objectId) &&
(!p.room.roomId || findObjectRoom(p.room.objectId, p.room.roomId))) {
openMeasure({ kind: 'room', objectId: p.room.objectId, roomId: p.room.roomId });
// несохранённые правки помещения — как были до перезагрузки
if (p.room.m) { measure = p.room.m; $('mpRoom').value = measure.room || ''; if (typeof updateRoomSaveBtn === 'function') updateRoomSaveBtn(); }
} else if (!p.room) openMeasure({ kind: 'none' });
if (isOpen('measurePanel')) {
if (p.rv === 'plan' || p.rv === 'elev') rlView = p.rv;
if (Number.isInteger(p.ew)) rlElevWall = p.ew;
if (Number.isInteger(p.mw)) molElevWall = p.mw;
if (Number.isInteger(p.cw)) cnElevWall = p.cw;
if (Number.isInteger(p.tw) && typeof tileElevWall !== 'undefined') tileElevWall = p.tw;
if (p.mt) setMeasureTab(p.mt); else renderMeasure();
setTimeout(() => { const b = $('mpBody'); if (b) b.scrollTop = p.my || 0; }, 50);
}
}
setTimeout(() => window.scrollTo(0, p.y || 0), 50);
} catch (e) { console.error('Не удалось вернуть место:', e); }
}
// после входа и загрузки данных — один раз за открытие страницы
const origShow = window.showAppScreen;
if (typeof origShow === 'function') {
window.showAppScreen = function () {
origShow.apply(this, arguments);
if (!restored) { restored = true; restorePlace(); }
setTimeout(sync, 0);
};
}
})();
