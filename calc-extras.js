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
