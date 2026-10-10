// Кабинет мастера — план по картинке: подложка под чертёж и распознавание нейросетью.
// Подключается из calc.html; порядок подключения важен.

/* ===================== ПЛАН ПО КАРТИНКЕ ===================== */
// 1) Подложка: фото, скриншот или PDF обмерного плана лежит полупрозрачно
//    под чертежом рулетки — по нему удобно вводить размеры. Хранится
//    только на этом телефоне (картинка тяжёлая), привязана к метрам комнаты.
// 2) Распознавание (платно, через воркер и нейросеть): из картинки сразу
//    строятся помещения, дальше их можно править как обычный замер.

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let pdfJsLoading = null;
function loadPdfJs() {
if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
if (!pdfJsLoading) pdfJsLoading = new Promise((resolve, reject) => {
const sc = document.createElement('script');
sc.src = PDFJS_URL;
sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; resolve(window.pdfjsLib); };
sc.onerror = () => { pdfJsLoading = null; reject(new Error('не удалось загрузить чтение PDF — нужен интернет')); };
document.head.appendChild(sc);
});
return pdfJsLoading;
}

// Картинка или первая страница PDF → JPEG не больше maxSide точек по длинной стороне
async function fileToJpeg(file, maxSide = 1800) {
let source, w, h;
if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
const pdfjs = await loadPdfJs();
const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
const page = await pdf.getPage(1);
const vp0 = page.getViewport({ scale: 1 });
const scale = maxSide / Math.max(vp0.width, vp0.height);
const vp = page.getViewport({ scale });
const c = document.createElement('canvas');
c.width = Math.round(vp.width); c.height = Math.round(vp.height);
const ctx = c.getContext('2d');
ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
await page.render({ canvasContext: ctx, viewport: vp }).promise;
return { dataUrl: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height };
}
const url = URL.createObjectURL(file);
try {
const img = new Image();
img.src = url;
await img.decode();
source = img; w = img.naturalWidth; h = img.naturalHeight;
} finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
const k = Math.min(1, maxSide / Math.max(w, h));
const c = document.createElement('canvas');
c.width = Math.round(w * k); c.height = Math.round(h * k);
const ctx = c.getContext('2d');
ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
ctx.drawImage(source, 0, 0, c.width, c.height);
return { dataUrl: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height };
}

/* ---------- подложка ---------- */
let rlUnderlayAdjust = false;
let rlLastFit = null;     // { k, ox, oy } — масштаб чертежа на момент подстройки
const ulCache = {};
const ulBlobUrls = {};
function underlayHref(id, dataUrl) {
if (ulBlobUrls[id] && ulBlobUrls[id].src === dataUrl) return ulBlobUrls[id].url;
try {
const [head, b64] = dataUrl.split(',');
const bin = atob(b64); const arr = new Uint8Array(bin.length);
for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
const url = URL.createObjectURL(new Blob([arr], { type: (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg' }));
if (ulBlobUrls[id]) URL.revokeObjectURL(ulBlobUrls[id].url);
ulBlobUrls[id] = { src: dataUrl, url };
return url;
} catch (e) { return dataUrl; }
}
function ulImgKey(id) { return 'underlayImg:' + id; }
function ulViewKey(id) { return 'underlayView:' + id; }
function getUnderlay(id) {
if (!id) return null;
try {
const view = JSON.parse(localStorage.getItem(ulViewKey(id)) || 'null');
if (!view) return null;
if (!(id in ulCache)) ulCache[id] = localStorage.getItem(ulImgKey(id));
return ulCache[id] ? { ...view, src: ulCache[id] } : null;
} catch (e) { return null; }
}
function saveUnderlayView(id, view) {
const { src, ...rest } = view;
try { localStorage.setItem(ulViewKey(id), JSON.stringify(rest)); } catch (e) { /* пусто */ }
}
function removeUnderlay(id) {
try { localStorage.removeItem(ulImgKey(id)); localStorage.removeItem(ulViewKey(id)); } catch (e) { /* пусто */ }
delete ulCache[id];
}

function pickUnderlayFile() {
document.getElementById('ulFile').click();
}

async function handleUnderlayFile(input) {
const file = input.files && input.files[0];
input.value = '';
if (!file) return;
showAddToast('Готовлю подложку…');
try {
const img = await fileToJpeg(file, 1600);
const id = measure.id;
try { localStorage.setItem(ulImgKey(id), img.dataUrl); }
catch (e) { alert('Не хватает места на телефоне для подложки. Удалите подложки у других комнат.'); return; }
ulCache[id] = img.dataUrl;
// по умолчанию — поверх уже введённых стен, иначе 8 м шириной
const g = rulerGeometry(measure);
const xs = [0, ...g.segs.map(s => s.x2)], ys = [0, ...g.segs.map(s => s.y2)];
const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
const ar = img.h / img.w;
const wM = g.realCount ? Math.max(bw, bh / ar) * 1.15 : 8;
const view = { x: (Math.min(...xs) + Math.max(...xs)) / 2 - wM / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 - wM * ar / 2, w: wM, ar, rot: 0, op: 0.45, hidden: false };
saveUnderlayView(id, view);
rlUnderlayAdjust = true;
rlLastFit = null;
renderMeasure();
showAddToast('Подложка добавлена — совместите её со стенами');
} catch (err) {
alert('Не удалось открыть файл: ' + (err && err.message ? err.message : err));
}
}

function underlayAction(act) {
const id = measure.id;
const u = getUnderlay(id);
if (act === 'add') { pickUnderlayFile(); return; }
if (!u) return;
if (act === 'adjust') { rlUnderlayAdjust = !rlUnderlayAdjust; rlLastFit = null; if (rlUnderlayAdjust) u.hidden = false; saveUnderlayView(id, u); renderMeasure(); return; }
if (act === 'done') { rlUnderlayAdjust = false; rlLastFit = null; renderMeasure(); return; }
if (act === 'rotate') u.rot = ((u.rot || 0) + 90) % 360;
if (act === 'lighter') u.op = Math.max(0.12, (u.op || 0.45) - 0.12);
if (act === 'darker') u.op = Math.min(0.9, (u.op || 0.45) + 0.12);
if (act === 'toggle') u.hidden = !u.hidden;
if (act === 'remove') {
if (!confirm('Убрать подложку у этого помещения?')) return;
removeUnderlay(id); rlUnderlayAdjust = false; rlLastFit = null; renderMeasure(); return;
}
saveUnderlayView(id, u);
renderRulerSketch();
}

function underlayBarHtml() {
const u = measure && getUnderlay(measure.id);
if (!u) return `<button type="button" class="rl-ul-add" onclick="underlayAction('add')">Подложка: фото плана</button>`;
if (!rlUnderlayAdjust) {
return `<div class="rl-ul-row">
<button type="button" class="rl-tool" onclick="underlayAction('adjust')">Подложка: подстроить</button>
<button type="button" class="rl-tool" onclick="underlayAction('toggle')">${u.hidden ? 'Показать' : 'Скрыть'}</button>
</div>`;
}
return `<div class="rl-ul-panel">
<div class="rl-ul-hint">Двигайте подложку пальцем, щипком — размер. Совместите её со стенами.</div>
<div class="rl-ul-row">
<button type="button" class="rl-tool" onclick="underlayAction('rotate')">↻ Повернуть</button>
<button type="button" class="rl-tool" onclick="underlayAction('lighter')">Светлее</button>
<button type="button" class="rl-tool" onclick="underlayAction('darker')">Темнее</button>
<button type="button" class="rl-tool" onclick="underlayAction('add')">Заменить</button>
<button type="button" class="rl-tool rl-tool-del" onclick="underlayAction('remove')">Убрать</button>
<button type="button" class="rl-tool rl-tool-close" onclick="underlayAction('done')">Готово</button>
</div>
</div>`;
}

// Углы подложки (в метрах) — чтобы чертёж вписывал и её
function underlayCorners(u) {
const h = u.w * u.ar, cx = u.x + u.w / 2, cy = u.y + h / 2;
const r = (u.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
return [[-u.w / 2, -h / 2], [u.w / 2, -h / 2], [u.w / 2, h / 2], [-u.w / 2, h / 2]].map(([px, py]) => [cx + px * c - py * s, cy + px * s + py * c]);
}

/* ---------- распознавание ---------- */
// Окно распознавания — как чат: картинка, ход рассуждений нейросети,
// найденные помещения; мастер может написать уточнение («высота 2,7»,
// «добавь балкон»), и нейросеть переделает план с учётом поправки.
let aiTarget = null;   // { objectId, image, preview, runs: [{ note, thinking, text, status, error, done, result }], abort, measures }

function startPlanRecognition(objectId) {
const obj = objectId ? (cloudData.objects || []).find(o => o.id === objectId) : calcObject();
if (!obj) { alert('Сначала выберите объект.'); return; }
aiTarget = { objectId: obj.id, runs: [] };
document.getElementById('aiFile').click();
}

// Ответ нейросети строками JSON (воркер передаёт поток): по ходу —
// размышления и текст, в конце done/error. Общая часть для помощника и плана.
async function readAiStream(body, onEvent) {
const reader = body.getReader();
const dec = new TextDecoder();
let buf = '';
const line = (l) => {
if (!l.trim()) return;
let ev;
try { ev = JSON.parse(l); } catch (e) { return; }
onEvent(ev);
};
for (;;) {
const { done, value } = await reader.read();
if (done) break;
buf += dec.decode(value, { stream: true });
let i;
while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
}
line(buf);
}

async function handleAiFile(input) {
const file = input.files && input.files[0];
input.value = '';
if (!file || !aiTarget) return;
if (!confirm('Распознать план с помощью нейросети?\n\nЭто платная функция: картинка будет отправлена в сторонний сервис, каждое распознавание стоит денег по тарифу ключа API. Результат — черновик, его нужно проверить.')) return;
const target = aiTarget;
target.runs = [{ thinking: '', text: '', status: 'Готовлю картинку…' }];
target.preview = null;
document.getElementById('aiNote').value = '';
document.getElementById('aiPanel').classList.add('open');
document.body.classList.add('measure-open');
renderAiPanel();
try {
const img = await fileToJpeg(file, 1568);
if (aiTarget !== target) return;
target.preview = img.dataUrl;
target.image = img.dataUrl.split(',')[1];
target.runs = [];
runAiRecognition('');
} catch (err) {
target.runs[0].error = 'Не удалось открыть картинку: ' + (err && err.message ? err.message : err);
target.runs[0].done = true;
renderAiPanel();
}
}

// Один заход нейросети; note — уточнение мастера к прошлому результату
async function runAiRecognition(note) {
const target = aiTarget;
if (!target || !target.image || aiBusy()) return;
const run = { note, thinking: '', text: '', status: 'Отправляю в нейросеть…' };
target.runs.push(run);
target.abort = new AbortController();
renderAiPanel();
try {
const res = await fetch(`${WORKER_URL}/recognize-plan`, {
method: 'POST',
headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
body: JSON.stringify({ image: target.image, mediaType: 'image/jpeg', stream: true,
turns: aiTurns(target.runs) }),
signal: target.abort.signal
});
let data = null;
if (/ndjson/.test(res.headers.get('content-type') || '') && res.body) {
run.status = 'Рассматриваю план…';
renderAiPanel();
await readAiStream(res.body, ev => {
if (ev.t === 'thinking') run.thinking += ev.d || '';
else if (ev.t === 'text') { run.text += ev.d || ''; run.status = 'Пишу ответ…'; }
else if (ev.t === 'done') data = ev;
else if (ev.t === 'error') run.error = ev.error || 'Не удалось распознать план';
scheduleAiPanel();
});
if (!data && !run.error) run.error = 'Ответ оборвался. Попробуйте ещё раз.';
} else {
data = await res.json().catch(() => null);
if (res.status === 501) run.error = 'Распознавание пока не подключено. Чтобы включить: получите ключ API на console.anthropic.com и добавьте его в Cloudflare → ваш воркер → Settings → Variables and Secrets как секрет ANTHROPIC_API_KEY. Пока можно пользоваться подложкой — это бесплатно.';
else if (!res.ok || !data) run.error = (data && data.error) || 'Не удалось распознать план';
}
if (!run.error && data.questions && data.questions.length && !(data.rooms && data.rooms.length)) {
run.questions = data.questions;
} else if (!run.error && (!data.rooms || !data.rooms.length)) run.error = 'Помещения не распознаны' + (data.warnings && data.warnings.length ? ': ' + data.warnings.join(' ') : '.') + ' Напишите внизу, что на плане (например, «это квартира из 3 комнат, размеры в мм»), или попробуйте более чёткое фото.';
if (!run.error && !run.questions) run.result = { rooms: data.rooms, warnings: data.warnings || [] };
} catch (err) {
if (err && err.name === 'AbortError') {
// Остановили — убираем заход, уточнение возвращаем в поле
target.runs = target.runs.filter(r => r !== run);
if (note) document.getElementById('aiNote').value = note;
} else {
run.error = 'Ошибка: ' + (err && err.message ? err.message : err);
}
}
run.done = true;
target.abort = null;
if (aiTarget === target) renderAiPanel();
}

// Переписка для нейросети: на каждую реплику мастера — что она ответила перед этим
function aiTurns(runs) {
const turns = [];
runs.forEach((r, i) => {
if (!r.note) return;
const prev = runs[i - 1];
const answer = prev && (prev.result || prev.questions) ? JSON.stringify(prev.result || { questions: prev.questions }) : '';
turns.push({ note: r.note, answer });
});
return turns;
}

function aiBusy() {
return !!(aiTarget && aiTarget.runs.some(r => !r.done));
}

function sendAiNote() {
const el = document.getElementById('aiNote');
const note = el.value.trim();
if (!note || aiBusy()) return;
el.value = '';
runAiRecognition(note);
}

let aiPanelQueued = false;
function scheduleAiPanel() {
if (aiPanelQueued) return;
aiPanelQueued = true;
(window.requestAnimationFrame || setTimeout)(() => { aiPanelQueued = false; renderAiPanel(); });
}

// Помещения, которые нейросеть уже записала, — по ещё недописанному JSON
function aiFoundRooms(text) {
return [...String(text || '').matchAll(/"name"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(m => m[1].replace(/\\(.)/g, '$1'));
}

function renderAiPanel() {
if (!aiTarget) return;
const body = document.getElementById('aiBody');
const box = body.querySelector('.ai-chat');
const stick = !box || body.scrollHeight - body.scrollTop - body.clientHeight < 80;
const busy = aiBusy();
const last = aiTarget.runs[aiTarget.runs.length - 1];
const showReview = !busy && last && last.result;
let html = '<div class="mp-body-inner ai-chat">';
if (aiTarget.preview) html += `<img class="ai-preview" src="${aiTarget.preview}" alt="План">`;
aiTarget.runs.forEach((run, ri) => {
if (run.note) html += `<div class="as-msg as-user ai-note"><div class="as-text">${escapeHtml(run.note)}</div></div>`;
const live = !run.done;
const rooms = run.result ? run.result.rooms.map(r => r.name) : aiFoundRooms(run.text);
html += `<div class="as-msg as-bot ai-run${run.error ? ' as-error' : ''}">`;
if (run.thinking) html += `<details class="as-think"${live ? ' open' : ''}><summary>${live ? 'Размышляю…' : 'Ход рассуждений'}</summary><div>${escapeHtml(run.thinking)}</div></details>`;
if (rooms.length) html += `<div class="as-text"><b>${run.result ? 'Распознал' : 'Нашёл'} помещений: ${rooms.length}</b>\n${rooms.map(escapeHtml).join(', ')}</div>`;
if (run.questions) html += `<div class="as-text"><b>Чтобы не ошибиться, уточните:</b>\n${run.questions.map((q, qi) => (run.questions.length > 1 ? (qi + 1) + '. ' : '') + escapeHtml(q)).join('\n')}</div>`;
if (run.error) html += `<div class="as-text">${escapeHtml(run.error)}</div>`;
else if (live) html += `<div class="as-status">${escapeHtml(run.status)}</div>`;
else if (run.result && ri < aiTarget.runs.length - 1) html += '<div class="as-status">заменено следующим вариантом</div>';
html += '</div>';
});
if (showReview) html += aiReviewHtml(last.result);
html += '</div>';
body.innerHTML = html;
const t = body.querySelector('.as-think[open] > div');
if (t) t.scrollTop = t.scrollHeight;
if (stick) body.scrollTop = body.scrollHeight;
const apply = document.getElementById('aiApply');
const cancel = document.getElementById('aiCancel');
apply.style.display = showReview ? '' : 'none';
cancel.textContent = busy ? 'Стоп' : showReview ? 'Отмена' : 'Закрыть';
cancel.classList.toggle('ai-stop', busy);
const form = document.getElementById('aiNoteForm');
form.style.display = aiTarget.image ? '' : 'none';
document.getElementById('aiNoteSend').disabled = busy;
document.getElementById('aiNote').placeholder = last && last.questions ? 'Ваш ответ' : last && last.result ? 'Уточнение, например: высота 2,7' : 'Что на плане? Подскажите — попробую ещё раз';
if (last && last.questions && last.done && !busy) setTimeout(() => document.getElementById('aiNote').focus(), 0);
}

// Ответ нейросети → обычный замер «своей формы»
function aiRoomToMeasure(r, objectId) {
const fmt = v => (v == null ? '' : String(Math.round(v * 1000) / 1000).replace('.', ','));
const m = newMeasure(objectId);
m.room = r.name;
m.height = fmt(r.height_m);
m.shape = 'free';
m.walls = r.walls.map(w => fmt(w.length_m));
m.wallHeights = r.walls.map(() => '');
m.turns = r.walls.map(w => w.turn_after === 'L' ? 'L' : 'R');
m.angles = r.walls.map(w => (w.angle_deg && Math.abs(w.angle_deg - 90) > 0.5 ? fmt(w.angle_deg) : ''));
m.openings = (r.openings || []).map(o => {
const base = { type: o.type, w: fmt(o.width_m), h: fmt(o.height_m), n: '1', slopes: true };
if (o.type === 'balcony') Object.assign(base, { dw: fmt(o.door_width_m), dh: fmt(o.door_height_m), side: 'start' });
if (o.wall_index != null) Object.assign(base, { wall: o.wall_index, off: fmt(o.offset_m), from: 'start' });
return base;
});
return m;
}

function miniSketchSvg(m, W = 150, H = 100) {
const g = rulerGeometry(m);
const xs = [0, ...g.segs.map(s => s.x2)], ys = [0, ...g.segs.map(s => s.y2)];
const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
const k = Math.min((W - 16) / Math.max(maxX - minX, 0.5), (H - 16) / Math.max(maxY - minY, 0.5));
const ox = (W - (maxX - minX) * k) / 2 - minX * k, oy = (H - (maxY - minY) * k) / 2 - minY * k;
const pts = [[0, 0], ...g.segs.map(s => [s.x2, s.y2])].map(([x, y]) => `${ox + x * k} ${oy + y * k}`);
return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
<path d="M${pts.join('L')}${g.closed ? 'Z' : ''}" fill="${g.closed ? '#fff4d1' : 'none'}" stroke="#14181f" stroke-width="2.5" stroke-linejoin="miter"/>
${g.closed ? '' : `<path d="M${pts[pts.length - 1]}L${pts[0]}" stroke="#c2361f" stroke-width="1.5" stroke-dasharray="3 3"/>`}
</svg>`;
}

// Последний результат — помещения с галочками, как раньше
function aiReviewHtml(res) {
const ms = res.rooms.map(r => aiRoomToMeasure(r, aiTarget.objectId));
aiTarget.measures = ms;
return `<div class="ai-review">
${res.warnings && res.warnings.length ? `<div class="ai-warn"><b>Нейросеть предупреждает:</b><br>${res.warnings.map(escapeHtml).join('<br>')}</div>` : ''}
<div class="ai-hint">Это черновик. Отметьте нужные помещения и проверьте размеры — после добавления каждое правится в замере, как обычно. Если что-то не так — напишите уточнение внизу.</div>
${ms.map((m, i) => {
const g = rulerGeometry(m);
const ops = m.openings.length;
return `<label class="ai-room">
<input type="checkbox" checked data-ai="${i}">
<div class="ai-sketch">${miniSketchSvg(m)}</div>
<div class="ai-info">
<input type="text" class="mp-name-in" value="${escapeHtml(m.room)}" data-ai-name="${i}" aria-label="Название помещения">
<div class="ai-meta">${m.walls.length} ${pluralRu(m.walls.length, 'стена', 'стены', 'стен')}${ops ? ` · проёмов ${ops}` : ''}${mNum(m.height) ? ` · h ${mFmt(mNum(m.height))}` : ''}</div>
<div class="${g.closed ? 'rl-ok' : 'rl-bad'}">${g.closed ? 'Комната сошлась' : `Не сходится на ${mFmt(g.gap)} м — поправите в замере`}</div>
</div>
</label>`;
}).join('')}
</div>`;
}

// «Стоп» во время распознавания, иначе — закрыть окно
function aiCancel() {
if (aiBusy()) { if (aiTarget.abort) aiTarget.abort.abort(); return; }
closeAiReview();
}

function closeAiReview() {
if (aiTarget && aiTarget.abort) aiTarget.abort.abort();
aiTarget = null;
document.getElementById('aiPanel').classList.remove('open');
document.body.classList.remove('measure-open');
}

async function applyAiRooms() {
const obj = (cloudData.objects || []).find(o => o.id === aiTarget.objectId);
if (!obj) return;
const picked = [...document.querySelectorAll('#aiBody input[data-ai]')].filter(c => c.checked).map(c => Number(c.dataset.ai));
if (!picked.length) { alert('Не выбрано ни одного помещения.'); return; }
if (!Array.isArray(obj.rooms)) obj.rooms = [];
picked.forEach(i => {
const m = aiTarget.measures[i];
const nameEl = document.querySelector(`#aiBody input[data-ai-name="${i}"]`);
if (nameEl && nameEl.value.trim()) m.room = nameEl.value.trim();
obj.rooms.push({ id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), measure: m });
});
closeAiReview();
await saveCloudData();
renderInvoice();
if (typeof currentObjectId !== 'undefined' && currentObjectId === obj.id) renderObjectDetail();
showAddToast(`Добавлено помещений: ${picked.length} — проверьте замеры`);
}
