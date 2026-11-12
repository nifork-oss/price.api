// Кабинет мастера — закупки по объекту.
// У объекта рядом со «Счета» и «Расчёты» — вкладка «Закупки»: список материалов с количеством, который отправляют
// снабженцу или прорабу (кому — указывать не обязательно). По списку потом ставят галочки «куплено», вписывают сумму
// за весь закуп или за отдельные позиции, прикладывают фото товаров и чеки, в конце — «Доставлено на объект».
// Суммы (если отмечено) идут в статистику объекта: «На материал потрачено».
// Хранится в самом объекте: obj.purchases = [{ id, title, to, note, createdAt, author, items: [{ id, name, qty, unit,
// done, price }], total, files: [{ url, name, type, … }], delivered, deliveredAt, inStats, share }].
// «Отправить список» добавляет в сообщение ссылку на purchase.html?k=<share> — страницу закупки без входа
// (только список и объект, без сумм и чеков; сервер — GET /purchase). У ссылки своя картинка-превью (og-purchase.png).
// Подключается из calc.html после calc-foreman.js.

const PURCHASE_UNITS = ['шт.', 'уп.', 'кг', 'л', 'м', 'м²', 'м³', 'пог. м', 'меш.', 'компл.'];
let purchaseOpenId = null;          // открытая закупка (id) или null — список закупок
const purchaseUploads = new Map();  // tempId → { name, progress, error } — файлы, которые сейчас загружаются
let purchaseSaveTimer = null;

function purchaseId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function purchaseNum(v) { const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; }
function purchaseMoney(n) { return Number(n || 0).toLocaleString('ru-RU') + ' ₽'; }
function purchaseList(obj) { return Array.isArray(obj && obj.purchases) ? obj.purchases : []; }

// сумма по позициям и итог закупки: вписана сумма за весь закуп — она, иначе — сумма позиций
function purchaseItemsSum(p) { return Math.round((p.items || []).reduce((s, it) => s + purchaseNum(it.price), 0) * 100) / 100; }
function purchaseTotal(p) { return purchaseNum(p.total) || purchaseItemsSum(p); }
function purchaseProgress(p) { const items = p.items || []; return { done: items.filter(it => it.done).length, all: items.length }; }
// «На материал потрачено» по объекту: закупки, у которых отмечено «учитывать в статистике»
function objectMaterialsSpent(obj) {
return Math.round(purchaseList(obj).filter(p => p.inStats !== false).reduce((s, p) => s + purchaseTotal(p), 0) * 100) / 100;
}

// «Грунтовка 10 л», «Саморезы 3.5x25 — 200 шт», «Профиль 12» → { name, qty, unit }
function parsePurchaseLine(text) {
const t = String(text || '').replace(/\s+/g, ' ').trim().replace(/^(?:[-•*]\s*|\d+[.)]\s+)/, ''); // без «1.», «-», «•» в начале
if (!t) return null;
const m = /^(.*?)[\s,;:—–-]+(\d+(?:[.,]\d+)?)\s*([^\d\s]{1,8})?$/.exec(t);
if (!m || !m[1].trim()) return { name: t.slice(0, 120), qty: '', unit: 'шт.' };
return { name: m[1].trim().slice(0, 120), qty: m[2].replace(',', '.'), unit: (m[3] || 'шт.').slice(0, 8) };
}

// ссылка на закупку для того, кому её отправляют (ключ создаётся при первой отправке)
function purchaseUrl(p) {
if (!p || !p.share) return '';
const base = window.location.href.replace(/calc\.html.*$/, '').replace(/[?#].*$/, '');
return `${base}purchase.html?k=${encodeURIComponent(p.share)}`;
}
function purchaseShareKey() {
const a = new Uint8Array(15);
(window.crypto || crypto).getRandomValues(a);
return Array.from(a, (b) => (b % 36).toString(36)).join('') + Date.now().toString(36);
}
// текст для отправки снабженцу или прорабу; url — ссылка на страницу закупки (с неё мессенджер берёт превью)
function purchaseMessageText(obj, p, url) {
const lines = [`Закупка: ${p.title || 'материалы'}`];
if (obj && obj.name) lines.push(`Объект: ${obj.name}${obj.address ? ', ' + obj.address : ''}`);
if (p.to) lines.push(`Кому: ${p.to}`);
lines.push('');
(p.items || []).forEach((it, i) => lines.push(`${i + 1}. ${it.name}${it.qty ? ' — ' + it.qty + ' ' + (it.unit || '') : ''}`.trim()));
if (p.note) lines.push('', p.note);
if (url) lines.push('', 'Список по ссылке: ' + url);
return lines.join('\n');
}

function purchaseObj() { return (cloudData.objects || []).find(o => o.id === currentObjectId) || null; }
function purchaseCur() { const obj = purchaseObj(); return obj ? purchaseList(obj).find(p => p.id === purchaseOpenId) || null : null; }
// сохранить (чуть погодя — правки идут подряд) и, если нужно, перерисовать
function purchaseChanged(rerender) {
clearTimeout(purchaseSaveTimer);
purchaseSaveTimer = setTimeout(() => { saveCloudData(); }, 900);
if (rerender) renderObjectDetail(); else purchaseRefreshTotals();
}

/* ---- вкладка у объекта ---- */
function purchasesTabHtml(obj) {
if (purchaseOpenId && purchaseList(obj).some(p => p.id === purchaseOpenId)) return purchaseEditorHtml(obj, purchaseCur());
purchaseOpenId = null;
const list = purchaseList(obj).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
const spent = objectMaterialsSpent(obj);
return `<button type="button" class="btn btn-primary" id="purchaseNewBtn" onclick="purchaseNew()">Новая закупка</button>
${spent > 0 ? `<div class="purchase-spent">На материал потрачено: <b>${purchaseMoney(spent)}</b></div>` : ''}
${list.length === 0 ? '<div style="text-align:center; color:#8d97a5; padding: 16px 0; font-size:13px;">Закупок по этому объекту пока нет. Составьте список материалов и отправьте его снабженцу или прорабу.</div>'
: list.map(p => {
const pr = purchaseProgress(p), total = purchaseTotal(p);
return `<button type="button" class="purchase-card" data-id="${p.id}" onclick="purchaseOpen('${p.id}')">
<span class="purchase-card-title">${escapeHtml(p.title || 'Закупка')}${p.delivered ? ' <span class="purchase-badge">доставлено</span>' : ''}</span>
<span class="purchase-card-sub">${new Date(p.createdAt || Date.now()).toLocaleDateString('ru-RU')}${p.to ? ' · ' + escapeHtml(p.to) : ''} · куплено ${pr.done} из ${pr.all}${total ? ' · ' + purchaseMoney(total) : ''}${(p.files || []).length ? ' · файлов: ' + p.files.length : ''}</span>
</button>`;
}).join('')}`;
}

function purchaseNew() {
const obj = purchaseObj();
if (!obj) return;
const p = { id: purchaseId(), title: 'Закупка от ' + new Date().toLocaleDateString('ru-RU'), to: '', note: '', createdAt: Date.now(), author: typeof currentUser === 'string' ? currentUser : '', items: [], total: '', files: [], delivered: false, inStats: true };
obj.purchases = [...purchaseList(obj), p];
purchaseOpenId = p.id;
purchaseChanged(true);
const inp = document.getElementById('purchaseAddName');
if (inp) inp.focus();
}
function purchaseOpen(id) { purchaseOpenId = id; renderObjectDetail(); }
function purchaseBack() { purchaseOpenId = null; renderObjectDetail(); }

function purchaseEditorHtml(obj, p) {
const pr = purchaseProgress(p), itemsSum = purchaseItemsSum(p);
const units = (cur) => [...new Set([cur || 'шт.', ...PURCHASE_UNITS])].map(u => `<option ${u === (cur || 'шт.') ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('');
const rows = (p.items || []).map(it => `<div class="purchase-row${it.done ? ' done' : ''}" data-item="${it.id}">
<input type="checkbox" class="purchase-check" ${it.done ? 'checked' : ''} onchange="purchaseToggle('${it.id}', this.checked)" aria-label="Куплено">
<input type="text" class="purchase-name" value="${escapeHtml(it.name)}" maxlength="120" onchange="purchaseItemSet('${it.id}', 'name', this.value)" aria-label="Материал">
<input type="text" class="purchase-qty" inputmode="decimal" value="${escapeHtml(String(it.qty ?? ''))}" placeholder="кол-во" onchange="purchaseItemSet('${it.id}', 'qty', this.value)" aria-label="Количество">
<select class="purchase-unit" onchange="purchaseItemSet('${it.id}', 'unit', this.value)" aria-label="Единица">${units(it.unit)}</select>
<input type="text" class="purchase-price" inputmode="decimal" value="${it.price ? escapeHtml(String(it.price)) : ''}" placeholder="сумма, ₽" onchange="purchaseItemSet('${it.id}', 'price', this.value)" aria-label="Сумма за позицию, необязательно">
<button type="button" class="purchase-del" onclick="purchaseItemDel('${it.id}')" aria-label="Убрать позицию">✕</button>
</div>`).join('');
const files = (p.files || []).map((f, i) => {
const img = /^image\//.test(f.type || '') || f.resourceType === 'image';
return `<div class="purchase-file">${img ? `<a href="${escapeHtml(f.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(f.url)}" alt="${escapeHtml(f.name || 'фото')}" loading="lazy"></a>` : `<a class="purchase-file-doc" href="${escapeHtml(f.url)}" target="_blank" rel="noopener">📄 ${escapeHtml(f.name || 'файл')}</a>`}
<button type="button" class="purchase-file-del" onclick="purchaseFileDel(${i})" aria-label="Убрать файл">✕</button></div>`;
}).join('');
const uploading = [...purchaseUploads.entries()].filter(([, u]) => u.purchase === p.id).map(([id, u]) => `<div class="purchase-file purchase-file-up" data-up="${id}">${u.error ? `<span class="purchase-up-err">${escapeHtml(u.name)}: ${escapeHtml(u.error)}</span><button type="button" class="purchase-file-del" onclick="purchaseUploadDrop('${id}')" aria-label="Убрать">✕</button>` : `<span>${escapeHtml(u.name)}</span><span class="purchase-up-pct">${Math.round((u.progress || 0) * 100)}%</span>`}</div>`).join('');
return `<span class="link-text" onclick="purchaseBack()">← К закупкам</span>
<div class="purchase-editor" data-purchase="${p.id}">
<div class="form-group"><label>Название закупки</label><input type="text" id="purchaseTitle" value="${escapeHtml(p.title || '')}" maxlength="80" onchange="purchaseSet('title', this.value)"></div>
<div class="form-group"><label>Кому (необязательно)</label><input type="text" id="purchaseTo" value="${escapeHtml(p.to || '')}" maxlength="60" placeholder="Снабженец, прораб…" onchange="purchaseSet('to', this.value)"></div>

<label>Материалы <span id="purchaseProgress" style="font-weight:400; text-transform:none; letter-spacing:0; color:#8d97a5;">${pr.all ? `· куплено ${pr.done} из ${pr.all}` : ''}</span></label>
<div id="purchaseRows">${rows || '<div class="purchase-empty">Список пуст — добавьте материалы ниже.</div>'}</div>
<div class="purchase-add">
<textarea id="purchaseAddName" rows="1" placeholder="Материал и количество: Грунтовка 10 л" onkeydown="if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); purchaseAdd(); }"></textarea>
<button type="button" class="hc-btn" id="purchaseAddBtn" onclick="purchaseAdd()">Добавить</button>
</div>
<div class="purchase-hint">Можно вставить сразу несколько строк — каждая станет позицией. Количество и единица в конце строки распознаются сами.</div>

<div class="form-group" style="margin-top:14px;"><label>Сумма за весь закуп, ₽ (необязательно)</label>
<input type="text" id="purchaseTotalInput" inputmode="decimal" value="${p.total ? escapeHtml(String(p.total)) : ''}" placeholder="${itemsSum ? 'по позициям: ' + itemsSum.toLocaleString('ru-RU') : 'например, 12500'}" onchange="purchaseSet('total', this.value)">
<div class="purchase-hint" id="purchaseTotalsLine">${purchaseTotalsLine(p)}</div></div>

<label>Фото товаров и чеки</label>
<div class="purchase-files" id="purchaseFiles">${files}${uploading}</div>
<label class="hc-btn purchase-upload-btn">Добавить фото или чек<input type="file" id="purchaseFileInput" accept="image/*,application/pdf" multiple style="display:none" onchange="purchaseFilesPicked(this)"></label>

<div class="form-group" style="margin-top:14px;"><label>Заметка (необязательно)</label><textarea id="purchaseNote" rows="2" maxlength="1000" placeholder="Магазин, сроки, куда везти…" onchange="purchaseSet('note', this.value)">${escapeHtml(p.note || '')}</textarea></div>

<label class="purchase-flag"><input type="checkbox" id="purchaseInStats" ${p.inStats !== false ? 'checked' : ''} onchange="purchaseSet('inStats', this.checked)"> Учитывать сумму в статистике объекта («На материал потрачено»)</label>
<label class="purchase-flag purchase-delivered${p.delivered ? ' on' : ''}"><input type="checkbox" id="purchaseDelivered" ${p.delivered ? 'checked' : ''} onchange="purchaseSet('delivered', this.checked)"> Доставлено на объект${p.delivered && p.deliveredAt ? ` <span style="color:#8d97a5;">· ${new Date(p.deliveredAt).toLocaleDateString('ru-RU')}</span>` : ''}</label>

<div class="obj-actions">
<button type="button" class="btn btn-primary" id="purchaseSendBtn" onclick="purchaseSend()">Отправить список</button>
<button type="button" class="hc-btn" style="flex:0 0 auto; color:#c2361f;" id="purchaseRemoveBtn" onclick="purchaseRemove()">Удалить</button>
</div>
</div>`;
}
function purchaseTotalsLine(p) {
const itemsSum = purchaseItemsSum(p), total = purchaseTotal(p);
if (!total) return 'Сумму можно вписать за весь закуп или отдельно у позиций (поле «сумма, ₽»).';
return `Итого по закупке: <b>${purchaseMoney(total)}</b>${purchaseNum(p.total) && itemsSum ? ` (по позициям — ${purchaseMoney(itemsSum)})` : ''}`;
}
// после правки поля — обновить только итоги (без перерисовки: курсор остаётся в поле)
function purchaseRefreshTotals() {
const p = purchaseCur();
if (!p) return;
const line = document.getElementById('purchaseTotalsLine'), pr = purchaseProgress(p), prog = document.getElementById('purchaseProgress');
if (line) line.innerHTML = purchaseTotalsLine(p);
if (prog) prog.textContent = pr.all ? `· куплено ${pr.done} из ${pr.all}` : '';
}

/* ---- правки ---- */
function purchaseSet(field, value) {
const p = purchaseCur();
if (!p) return;
if (field === 'total') p.total = purchaseNum(value) || '';
else if (field === 'delivered') { p.delivered = !!value; p.deliveredAt = value ? Date.now() : null; }
else if (field === 'inStats') p.inStats = !!value;
else p[field] = String(value || '').trim().slice(0, field === 'note' ? 1000 : 80);
purchaseChanged(field === 'delivered');
}
function purchaseAdd() {
const p = purchaseCur(), inp = document.getElementById('purchaseAddName');
if (!p || !inp) return;
const added = String(inp.value || '').split('\n').map(parsePurchaseLine).filter(Boolean);
if (!added.length) { showAddToast('Впишите материал'); return; }
p.items = [...(p.items || []), ...added.map(it => ({ id: purchaseId(), ...it, done: false, price: '' }))].slice(0, 200);
purchaseChanged(true);
const again = document.getElementById('purchaseAddName');
if (again) again.focus();
}
function purchaseItemSet(itemId, field, value) {
const p = purchaseCur(), it = p && (p.items || []).find(x => x.id === itemId);
if (!it) return;
if (field === 'price') it.price = purchaseNum(value) || '';
else if (field === 'qty') it.qty = String(value || '').replace(',', '.').trim().slice(0, 12);
else it[field] = String(value || '').trim().slice(0, field === 'name' ? 120 : 8);
purchaseChanged(false);
}
function purchaseToggle(itemId, on) {
const p = purchaseCur(), it = p && (p.items || []).find(x => x.id === itemId);
if (!it) return;
it.done = !!on;
const row = document.querySelector(`.purchase-row[data-item="${itemId}"]`);
if (row) row.classList.toggle('done', it.done);
purchaseChanged(false);
}
function purchaseItemDel(itemId) {
const p = purchaseCur();
if (!p) return;
p.items = (p.items || []).filter(x => x.id !== itemId);
purchaseChanged(true);
}
function purchaseRemove() {
const obj = purchaseObj(), p = purchaseCur();
if (!obj || !p || !confirm(`Удалить закупку «${p.title || 'без названия'}»?`)) return;
obj.purchases = purchaseList(obj).filter(x => x.id !== p.id);
purchaseOpenId = null;
purchaseChanged(true);
}

/* ---- отправить снабженцу или прорабу ---- */
async function purchaseSend() {
const obj = purchaseObj(), p = purchaseCur();
if (!p) return;
if (!(p.items || []).length) { showAddToast('Сначала добавьте материалы'); return; }
// ссылка откроется у получателя, только когда закупка уже на сервере: сохраняем до отправки
if (!p.share) p.share = purchaseShareKey();
clearTimeout(purchaseSaveTimer);
const saved = await saveCloudData();
const url = saved && cloudLoaded === true && !(typeof hasUnsentChanges === 'function' && hasUnsentChanges()) ? purchaseUrl(p) : '';
if (!url) showAddToast('Нет связи — отправляю список без ссылки');
const text = purchaseMessageText(obj, p, url), plain = purchaseMessageText(obj, p, '');
const copy = async (value, done) => { try { await navigator.clipboard.writeText(value); showAddToast(done); } catch (e) { prompt('Скопируйте:', value); } };
const items = [
{ icon: '💬', label: 'WhatsApp', onClick: () => window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener') },
{ icon: '📤', label: 'Telegram', onClick: () => window.open('https://t.me/share/url?url=' + encodeURIComponent(url || ' ') + '&text=' + encodeURIComponent(plain), '_blank', 'noopener') },
];
if (navigator.share) items.push({ icon: '📤', label: 'Другое приложение…', onClick: () => navigator.share({ text }).catch(() => {}) });
items.push({ icon: '📋', label: 'Скопировать список', onClick: () => copy(text, 'Список скопирован') });
if (url) items.push({ icon: '🔗', label: 'Скопировать только ссылку', onClick: () => copy(url, 'Ссылка скопирована') });
openSheet(`Отправить закупку${p.to ? ' · ' + p.to : ''}`, items);
}

/* ---- фото товаров и чеки ---- */
function purchaseFilesPicked(input) {
const p = purchaseCur(), files = [...(input.files || [])];
input.value = '';
if (!p || !files.length) return;
files.slice(0, 10).forEach(file => {
const tempId = purchaseId();
purchaseUploads.set(tempId, { purchase: p.id, object: currentObjectId, name: file.name, progress: 0, error: '' });
purchaseUpload(tempId, file);
});
renderObjectDetail();
}
async function purchaseUpload(tempId, file) {
const up = purchaseUploads.get(tempId);
if (!up) return;
const paint = () => { const el = document.querySelector(`[data-up="${tempId}"] .purchase-up-pct`); if (el) el.textContent = Math.round((up.progress || 0) * 100) + '%'; };
try {
const ready = typeof compressImageWithTimeout === 'function' ? await compressImageWithTimeout(file) : file;
const { ok, status, result } = await uploadFileToServer(ready, (pr) => { up.progress = pr; paint(); }, up);
if (!ok) throw new Error((result && result.error) || ('ошибка ' + status));
const obj = (cloudData.objects || []).find(o => o.id === up.object), p = obj && purchaseList(obj).find(x => x.id === up.purchase);
purchaseUploads.delete(tempId);
if (p) {
p.files = [...(p.files || []), { url: result.url, publicId: result.publicId, resourceType: result.resourceType, name: result.name, size: result.size, type: result.type }];
clearTimeout(purchaseSaveTimer);
purchaseSaveTimer = setTimeout(() => { saveCloudData(); }, 900);
}
} catch (e) {
up.error = e.message === 'stall' ? 'загрузка зависла' : e.message === 'network' ? 'нет связи' : (e.message || 'не загрузился');
}
if (currentObjectId === up.object && purchaseOpenId === up.purchase) renderObjectDetail();
}
function purchaseUploadDrop(tempId) { purchaseUploads.delete(tempId); renderObjectDetail(); }
function purchaseFileDel(index) {
const p = purchaseCur();
if (!p || !(p.files || [])[index] || !confirm('Убрать этот файл из закупки?')) return;
p.files = p.files.filter((f, i) => i !== index);
purchaseChanged(true);
}
