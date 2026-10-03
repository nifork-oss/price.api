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
let aiTarget = null;   // { objectId, result }

function startPlanRecognition(objectId) {
const obj = objectId ? (cloudData.objects || []).find(o => o.id === objectId) : calcObject();
if (!obj) { alert('Сначала выберите объект.'); return; }
aiTarget = { objectId: obj.id };
document.getElementById('aiFile').click();
}

async function handleAiFile(input) {
const file = input.files && input.files[0];
input.value = '';
if (!file || !aiTarget) return;
if (!confirm('Распознать план с помощью нейросети?\n\nЭто платная функция: картинка будет отправлена в сторонний сервис, каждое распознавание стоит денег по тарифу ключа API. Результат — черновик, его нужно проверить.')) return;
showAddToast('Распознаю план… обычно до минуты');
try {
const img = await fileToJpeg(file, 1568);
const res = await fetch(`${WORKER_URL}/recognize-plan`, {
method: 'POST',
headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
body: JSON.stringify({ image: img.dataUrl.split(',')[1], mediaType: 'image/jpeg' })
});
const data = await res.json().catch(() => null);
if (res.status === 501) {
alert('Распознавание пока не подключено.\n\nЧтобы включить: получите ключ API на console.anthropic.com и добавьте его в Cloudflare → ваш воркер → Settings → Variables and Secrets как секрет ANTHROPIC_API_KEY. Пока можно пользоваться подложкой — это бесплатно.');
return;
}
if (!res.ok || !data) { alert((data && data.error) || 'Не удалось распознать план'); return; }
if (!data.rooms || !data.rooms.length) { alert('Помещения на картинке не найдены. Попробуйте более чёткое фото или скриншот.'); return; }
aiTarget.result = data;
openAiReview();
} catch (err) {
alert('Ошибка: ' + (err && err.message ? err.message : err));
}
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

function openAiReview() {
const res = aiTarget.result;
const body = document.getElementById('aiBody');
const ms = res.rooms.map(r => aiRoomToMeasure(r, aiTarget.objectId));
aiTarget.measures = ms;
body.innerHTML = `<div class="mp-body-inner">
${res.warnings && res.warnings.length ? `<div class="ai-warn"><b>Нейросеть предупреждает:</b><br>${res.warnings.map(escapeHtml).join('<br>')}</div>` : ''}
<div class="ai-hint">Это черновик. Отметьте нужные помещения и проверьте размеры — после добавления каждое правится в замере, как обычно.</div>
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
document.getElementById('aiPanel').classList.add('open');
document.body.classList.add('measure-open');
}

function closeAiReview() {
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
