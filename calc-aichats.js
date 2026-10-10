// Кабинет мастера — история чатов с нейросетью («Помощник» и распознавание
// плана). Хранится в этом браузере (IndexedDB): картинки и PDF планов
// слишком большие для localStorage. Краткий список (meta) держим в памяти,
// чтобы показывать его сразу, без ожидания; сам чат (data) читаем при открытии.
// Подключается из calc.html до calc-assistant.js и calc-import.js.

const AI_CHATS_DB = 'aiChats';
const AI_CHATS_KEEP = 30;          // сколько чатов каждого вида хранить на пользователя
let aiChatsMeta = [];              // [{ id, kind: 'assistant'|'plan', user, objectId, title, updatedAt }]
let aiChatsDbPromise = null;

function aiChatsDb() {
if (!aiChatsDbPromise) {
aiChatsDbPromise = new Promise((resolve, reject) => {
if (!window.indexedDB) { reject(new Error('IndexedDB недоступна')); return; }
const req = indexedDB.open(AI_CHATS_DB, 1);
req.onupgradeneeded = () => {
const db = req.result;
if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
if (!db.objectStoreNames.contains('data')) db.createObjectStore('data', { keyPath: 'id' });
};
req.onsuccess = () => resolve(req.result);
req.onerror = () => reject(req.error);
});
aiChatsDbPromise.catch(() => { /* без истории, остальное работает */ });
}
return aiChatsDbPromise;
}

function aiChatsTx(stores, mode, fn) {
return aiChatsDb().then(db => new Promise((resolve, reject) => {
const tx = db.transaction(stores, mode);
let out;
tx.oncomplete = () => resolve(out);
tx.onerror = () => reject(tx.error);
tx.onabort = () => reject(tx.error);
out = fn(tx);
}));
}

function aiChatsUser() {
return typeof currentUser !== 'undefined' && currentUser ? currentUser : '';
}

function aiChatsLoad() {
return aiChatsTx(['meta'], 'readonly', tx => {
const req = tx.objectStore('meta').getAll();
req.onsuccess = () => { aiChatsMeta = req.result || []; };
}).catch(() => { aiChatsMeta = []; });
}

// Чаты этого вида у вошедшего мастера, свежие сверху
function aiChatsList(kind, objectId) {
return aiChatsMeta
.filter(m => m.kind === kind && m.user === aiChatsUser() && (!objectId || m.objectId === objectId))
.sort((a, b) => b.updatedAt - a.updatedAt);
}

function aiChatNewId() {
return 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
}

function aiChatGet(id) {
return aiChatsTx(['data'], 'readonly', tx => {
const holder = {};
const req = tx.objectStore('data').get(id);
req.onsuccess = () => { holder.v = req.result ? req.result.payload : null; };
return holder;
}).then(h => h.v || null).catch(() => null);
}

function aiChatSave(meta, payload) {
const m = { ...meta, user: aiChatsUser(), updatedAt: Date.now() };
aiChatsMeta = aiChatsMeta.filter(x => x.id !== m.id).concat(m);
// Старые сверх лимита — удаляем
const extra = aiChatsList(m.kind).slice(AI_CHATS_KEEP).map(x => x.id);
aiChatsMeta = aiChatsMeta.filter(x => !extra.includes(x.id));
return aiChatsTx(['meta', 'data'], 'readwrite', tx => {
tx.objectStore('meta').put(m);
tx.objectStore('data').put({ id: m.id, payload });
extra.forEach(id => { tx.objectStore('meta').delete(id); tx.objectStore('data').delete(id); });
}).catch(err => console.warn('История чатов не сохранилась:', err));
}

function aiChatDelete(id) {
aiChatsMeta = aiChatsMeta.filter(x => x.id !== id);
return aiChatsTx(['meta', 'data'], 'readwrite', tx => {
tx.objectStore('meta').delete(id);
tx.objectStore('data').delete(id);
}).catch(() => { /* пусто */ });
}

function aiChatDate(ts) {
const d = new Date(ts);
const today = new Date();
const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
if (d.toDateString() === today.toDateString()) return 'сегодня ' + time;
return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) }) + ' ' + time;
}

// Список чатов: onOpen / onDelete — имена глобальных функций, получают id
function aiChatsListHtml(list, onOpen, onDelete) {
return '<div class="ai-hist">' + list.map(m => `
<div class="ai-hist-row">
<button type="button" class="ai-hist-open" onclick="${onOpen}('${m.id}')">
<span>${escapeHtml(m.title || 'Без названия')}</span>
<small>${aiChatDate(m.updatedAt)}</small>
</button>
<button type="button" class="ai-hist-del" onclick="${onDelete}('${m.id}')" aria-label="Удалить">✕</button>
</div>`).join('') + '</div>';
}

aiChatsLoad();
