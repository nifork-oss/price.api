// Кабинет мастера — план объекта в файле .json: сохранить на устройство,
// загрузить обратно из файла или вставить скопированный текст.
// Понимает свой файл (замеры помещений целиком, с местом на плане квартиры)
// и план углами в миллиметрах — в том же виде, как отвечает нейросеть
// при распознавании. После загрузки — тот же экран проверки, что после
// распознавания: отметить помещения, «обновить, а не добавлять заново».
// Подключается из calc.html после calc-import.js.

const PLAN_FILE_FORMAT = 'kabinet-plan';

function planFileObj(objectId) {
return (cloudData.objects || []).find(o => o.id === objectId);
}

function openPlanFile(objectId) {
const obj = planFileObj(objectId);
if (!obj) return;
const has = objectRooms(obj).some(r => r.measure);
openSheet('План в файле (.json)', [
...(has ? [{ icon: '⬇️', label: 'Сохранить на устройство', onClick: () => savePlanFile(objectId) }] : []),
{ icon: '➕', label: 'Загрузить из файла', onClick: () => pickPlanFile(objectId) },
{ icon: '📋', label: 'Вставить скопированный текст', onClick: () => pastePlanText(objectId) },
]);
}

// Свой файл: замеры целиком + место на плане; углы в мм — чтобы файл
// можно было прочитать и поправить и без сайта
function planFileData(obj) {
const rooms = objectRooms(obj).filter(r => r.measure).map(r => {
const out = { name: roomName(r) };
if (r.plan) out.pts = flatRoomPoints(r.measure, r.plan).pts.map(p => p.map(v => Math.round(v * 1000)));
out.measure = r.measure;
if (r.plan) out.plan = r.plan;
return out;
});
return { format: PLAN_FILE_FORMAT, version: 1, object: obj.name || '', savedAt: new Date().toISOString(), rooms };
}

function savePlanFile(objectId) {
const obj = planFileObj(objectId);
if (!obj) return;
const text = JSON.stringify(planFileData(obj), null, 1);
// имя латиницей: с русскими буквами некоторые браузеры сохраняют файл как «download»
const lat = 'a b v g d e zh z i y k l m n o p r s t u f h ts ch sh sch  y  e yu ya'.split(' ');
const tr = String(obj.name || '').toLowerCase().replace(/ё/g, 'е').replace(/[а-я]/g, c => lat[c.charCodeAt(0) - 1072])
.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const name = `plan${tr ? '-' + tr : ''}-${new Date().toISOString().slice(0, 10)}.json`;
const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
const a = document.createElement('a');
a.href = url;
a.download = name;
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickPlanFile(objectId) {
const inp = document.createElement('input');
inp.type = 'file';
inp.accept = '.json,application/json,text/plain';
inp.onchange = async () => {
const file = inp.files && inp.files[0];
if (!file) return;
try { showPlanImport(objectId, await file.text(), `Из файла «${file.name}»`); }
catch (e) { alert('Не удалось прочитать файл: ' + e.message); }
};
inp.click();
}

async function pastePlanText(objectId) {
let text = '';
try { text = navigator.clipboard && navigator.clipboard.readText ? await navigator.clipboard.readText() : ''; } catch (e) { text = ''; }
if (!/[{[]/.test(text)) text = prompt('Вставьте текст плана (JSON):', '') || '';
if (!text.trim()) return;
showPlanImport(objectId, text, 'Из вставленного текста');
}

// Текст → помещения для экрана проверки; из чата текст бывает в ```json … ```
// или с пояснениями вокруг — берём от первой скобки до последней
function parsePlanText(text) {
const s = String(text || '');
const a = s.search(/[{[]/), b = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
if (a < 0 || b <= a) throw new Error('в тексте нет плана (JSON)');
let data;
try { data = JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new Error('текст не похож на JSON — проверьте, что скопирован целиком'); }
const list = Array.isArray(data) ? data : data && Array.isArray(data.rooms) ? data.rooms : null;
if (!list) throw new Error('нет списка помещений (rooms)');
const rooms = list.map(planFileRoom).filter(Boolean);
if (!rooms.length) throw new Error('ни одного помещения не удалось прочитать');
return { rooms, warnings: (data && Array.isArray(data.warnings) ? data.warnings : []).map(String), skipped: list.length - rooms.length };
}

const PF_NUM = v => (v == null || v === '' ? null : Number(String(v).replace(',', '.')));
const PF_M = (o, key) => {
const m = PF_NUM(o[key + '_m']), mm = PF_NUM(o[key + '_mm']);
return Number.isFinite(m) && m > 0 ? m : Number.isFinite(mm) && mm > 0 ? mm / 1000 : null;
};

function planFileRoom(r) {
if (!r || typeof r !== 'object') return null;
const name = String(r.name || (r.measure && r.measure.room) || 'Помещение').trim().slice(0, 80);
// свой файл: замер целиком
if (r.measure && Array.isArray(r.measure.walls) && r.measure.walls.length) {
const plan = r.plan && Number.isFinite(Number(r.plan.x)) && Number.isFinite(Number(r.plan.y)) ? { x: Number(r.plan.x), y: Number(r.plan.y) } : null;
return { name, measure: r.measure, plan };
}
const height_m = PF_M(r, 'height');
// углами (мм; если все числа маленькие — это метры)
if (Array.isArray(r.pts) && r.pts.length >= 3) {
let pts = r.pts.map(p => (Array.isArray(p) ? [PF_NUM(p[0]), PF_NUM(p[1])] : p && typeof p === 'object' ? [PF_NUM(p.x), PF_NUM(p.y)] : null));
if (!pts.every(p => p && p.every(Number.isFinite))) return null;
const k = Math.max(...pts.flat().map(Math.abs)) < 100 ? 1000 : 1;
pts = pts.map(p => p.map(v => Math.round(v * k)));
const openings = (Array.isArray(r.openings) ? r.openings : []).map(o => planFileOpening(o, k)).filter(Boolean);
return { name, height_m, pts, openings };
}
// стенами по порядку (длина и поворот после стены)
if (Array.isArray(r.walls) && r.walls.length >= 2) {
const walls = r.walls.map(w => ({ ...w, length_m: PF_M(w, 'length') }));
if (!walls.every(w => w.length_m)) return null;
const openings = (Array.isArray(r.openings) ? r.openings : []).map(o => planFileOpening(o, 1)).filter(Boolean);
return { name, height_m, walls, openings };
}
return null;
}

function planFileOpening(o, k) {
if (!o || typeof o !== 'object') return null;
const type = ['window', 'door', 'balcony'].includes(o.type) ? o.type : 'window';
let at = Array.isArray(o.at) && o.at.length === 2 ? o.at.map(p => (Array.isArray(p) ? [PF_NUM(p[0]) * k, PF_NUM(p[1]) * k] : null)) : null;
if (at && !at.every(p => p && p.every(Number.isFinite))) at = null;
const atLen = at ? Math.hypot(at[1][0] - at[0][0], at[1][1] - at[0][1]) / 1000 : null;
const wall = PF_NUM(o.wall_index != null ? o.wall_index : o.wall);
const width_m = PF_M(o, 'width') || atLen;
if (!width_m) return null;
return {
...(at ? { at } : {}), type, width_m,
height_m: PF_M(o, 'height'), door_width_m: PF_M(o, 'door_width'), door_height_m: PF_M(o, 'door_height'),
wall_index: Number.isInteger(wall) && wall >= 0 ? wall : null,
offset_m: Number.isFinite(PF_NUM(o.offset_m)) ? PF_NUM(o.offset_m) : Number.isFinite(PF_NUM(o.offset_mm)) ? PF_NUM(o.offset_mm) / 1000 : null,
};
}

function showPlanImport(objectId, text, label) {
if (typeof aiBusy === 'function' && aiBusy()) { alert('Дождитесь, пока закончится распознавание.'); return; }
let res;
try { res = parsePlanText(text); }
catch (e) { alert('Не удалось загрузить план: ' + e.message); return; }
if (res.skipped) res.warnings.push(`Не удалось прочитать помещений: ${res.skipped} — их нет в списке.`);
aiTarget = { objectId, imported: label, runs: [{ done: true, imported: label, result: { rooms: res.rooms, warnings: res.warnings } }] };
document.getElementById('aiPanel').classList.add('open');
document.body.classList.add('measure-open');
renderAiPanel();
}
