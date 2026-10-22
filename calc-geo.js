// Кабинет мастера — объект на карте: точка (obj.geo = { lat, lon }) и маршрут в Яндекс Картах.
// Карта для выбора точки — Leaflet с подложкой OpenStreetMap (без ключей), поиск адреса —
// Nominatim (OpenStreetMap). Подключается из calc.html после calc-app.js.

// Ссылки в Яндекс Карты: на телефоне с приложением откроются в нём
function geoRouteUrl(obj) {
const g = obj && obj.geo;
if (g && isFinite(g.lat) && isFinite(g.lon)) return `https://yandex.ru/maps/?rtext=~${g.lat},${g.lon}&rtt=auto`;
return obj && obj.address ? `https://yandex.ru/maps/?rtext=~${encodeURIComponent(obj.address)}&rtt=auto` : '';
}
function geoMapUrl(obj) {
const g = obj && obj.geo;
if (g && isFinite(g.lat) && isFinite(g.lon)) return `https://yandex.ru/maps/?pt=${g.lon},${g.lat}&z=17&l=map`;
return obj && obj.address ? `https://yandex.ru/maps/?text=${encodeURIComponent(obj.address)}` : '';
}
const geoHas = obj => !!(obj && obj.geo && isFinite(obj.geo.lat) && isFinite(obj.geo.lon));

// Кнопки под адресом в карточке объекта
function geoButtonsHtml(obj, canEdit) {
const route = geoRouteUrl(obj), map = geoMapUrl(obj);
if (!route && !canEdit) return '';
const ic = id => `<svg class="ic"><use href="#i-${id}"/></svg>`;
return `${route ? `<div class="geo-btns">
<a class="hc-btn geo-btn" href="${route}" target="_blank" rel="noopener">${ic('route')}Маршрут</a>
<a class="hc-btn geo-btn" href="${map}" target="_blank" rel="noopener">${ic('map')}Карта</a>
<button type="button" class="hc-btn geo-btn" onclick="geoShare('${obj.id}')">${ic('send')}Отправить</button>
</div>` : ''}
${canEdit ? `<span class="link-text geo-pick" onclick="geoPickOpen('${obj.id}')">${geoHas(obj) ? 'Поправить точку на карте' : 'Указать точку на карте'}</span>` : ''}
${!geoHas(obj) && route ? '<div class="geo-note">Маршрут — по тексту адреса. Точнее — с точкой на карте.</div>' : ''}`;
}

// Поделиться адресом и доступом на объект: системное меню телефона (мессенджеры, почта), иначе — скопировать текст.
// Ссылка — маршрут в Яндекс Картах: у получателя он построится от того места, где он сейчас
async function geoShare(objId) {
const obj = (cloudData.objects || []).find(o => o.id === objId);
const url = obj && geoRouteUrl(obj);
if (!url) return;
const text = [obj.name, obj.address ? 'Адрес: ' + obj.address : '', obj.access ? 'Доступ на объект: ' + obj.access : '', obj.foreman || obj.foremanPhone ? 'Прораб: ' + [obj.foreman, obj.foremanPhone].filter(Boolean).join(', ') : '', obj.designer || obj.designerPhone ? 'Дизайнер: ' + [obj.designer, obj.designerPhone].filter(Boolean).join(', ') : '', 'Маршрут в Яндекс Картах:'].filter(Boolean).join('\n');
if (navigator.share) {
try { await navigator.share({ title: obj.name || 'Объект', text, url }); return; }
catch (e) { if (e && e.name === 'AbortError') return; }
}
const all = text + '\n' + url;
try { await navigator.clipboard.writeText(all); showAddToast('Адрес и маршрут скопированы — вставьте в мессенджер'); }
catch (e) { prompt('Скопируйте и отправьте:', all); }
}

/* ---------- выбор точки на карте ---------- */
let geoPick = null;   // { objId, lat, lon, map, marker }

function geoLoadLeaflet() {
if (window.L) return Promise.resolve();
if (geoLoadLeaflet.p) return geoLoadLeaflet.p;
geoLoadLeaflet.p = new Promise((res, rej) => {
const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';
document.head.appendChild(css);
const s = document.createElement('script');
s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
s.onload = () => res();
s.onerror = () => { geoLoadLeaflet.p = null; rej(new Error('leaflet')); };
document.head.appendChild(s);
});
return geoLoadLeaflet.p;
}

async function geoSearch(q) {
const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ru&q=' + encodeURIComponent(q));
if (!r.ok) throw new Error('search');
const a = await r.json();
return a && a[0] ? { lat: +a[0].lat, lon: +a[0].lon } : null;
}

async function geoPickOpen(objId) {
const obj = (cloudData.objects || []).find(o => o.id === objId);
if (!obj) return;
const panel = document.getElementById('geoPanel');
panel.classList.add('open');
document.body.classList.add('measure-open');
document.getElementById('geoAddr').value = obj.address || '';
document.getElementById('geoHint').textContent = 'Загружаю карту…';
geoPick = { objId, lat: geoHas(obj) ? obj.geo.lat : null, lon: geoHas(obj) ? obj.geo.lon : null, map: null, marker: null };
document.getElementById('geoClearBtn').style.display = geoHas(obj) ? '' : 'none';
try { await geoLoadLeaflet(); } catch (e) { document.getElementById('geoHint').textContent = 'Карта не загрузилась — проверьте интернет. Можно найти по адресу или взять, где вы сейчас.'; }
if (!geoPick || geoPick.objId !== objId) return;
if (window.L) {
const box = document.getElementById('geoMap');
box.innerHTML = '';
const map = L.map(box, { zoomControl: true }).setView([55.751, 37.618], 10);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
map.on('click', ev => geoSet(ev.latlng.lat, ev.latlng.lng, true));
geoPick.map = map;
setTimeout(() => map.invalidateSize(), 50);
}
if (geoPick.lat != null) geoSet(geoPick.lat, geoPick.lon, false, 17);
else if (obj.address) geoFind();
else document.getElementById('geoHint').textContent = 'Нажмите на карте, где объект, — или найдите по адресу.';
}

// Поставить точку: метка на карте, подпись с координатами
function geoSet(lat, lon, byTap, zoom) {
if (!geoPick) return;
geoPick.lat = Math.round(lat * 1e6) / 1e6;
geoPick.lon = Math.round(lon * 1e6) / 1e6;
if (geoPick.map) {
if (geoPick.marker) geoPick.marker.setLatLng([lat, lon]);
else geoPick.marker = L.marker([lat, lon], { draggable: true }).addTo(geoPick.map).on('dragend', e => { const p = e.target.getLatLng(); geoSet(p.lat, p.lng, true); });
if (!byTap) geoPick.map.setView([lat, lon], zoom || 17);
}
document.getElementById('geoHint').textContent = `Точка: ${geoPick.lat}, ${geoPick.lon}. Если не там — нажмите на карте в нужное место или перетащите метку.`;
document.getElementById('geoSave').disabled = false;
}

async function geoFind() {
const q = document.getElementById('geoAddr').value.trim();
if (!q) { document.getElementById('geoAddr').focus(); return; }
document.getElementById('geoHint').textContent = 'Ищу адрес…';
try {
const p = await geoSearch(q);
if (p) geoSet(p.lat, p.lon, false, 17);
else document.getElementById('geoHint').textContent = 'Адрес не нашёлся. Уберите квартиру и подъезд (оставьте город, улицу, дом) — или просто нажмите на карте.';
} catch (e) {
document.getElementById('geoHint').textContent = 'Поиск не ответил. Нажмите на карте, где объект.';
}
}

function geoHere() {
if (!navigator.geolocation) { alert('Телефон не даёт местоположение.'); return; }
document.getElementById('geoHint').textContent = 'Определяю, где вы…';
navigator.geolocation.getCurrentPosition(
pos => geoSet(pos.coords.latitude, pos.coords.longitude, false, 18),
() => { document.getElementById('geoHint').textContent = 'Не получилось — разрешите сайту доступ к местоположению или нажмите на карте.'; },
{ enableHighAccuracy: true, timeout: 15000 });
}

async function geoSave() {
const obj = geoPick && (cloudData.objects || []).find(o => o.id === geoPick.objId);
if (!obj || geoPick.lat == null) return;
obj.geo = { lat: geoPick.lat, lon: geoPick.lon };
geoClose();
if (typeof renderObjectDetail === 'function') renderObjectDetail();
if ((await saveCloudData()) !== false) showAddToast('Точка на карте сохранена — «Маршрут» откроет Яндекс Карты');
}

async function geoClear() {
const obj = geoPick && (cloudData.objects || []).find(o => o.id === geoPick.objId);
if (!obj || !geoHas(obj) || !confirm('Убрать точку на карте? Маршрут будет строиться по тексту адреса.')) return;
delete obj.geo;
geoClose();
if (typeof renderObjectDetail === 'function') renderObjectDetail();
await saveCloudData();
}

function geoClose() {
if (geoPick && geoPick.map) geoPick.map.remove();
geoPick = null;
document.getElementById('geoMap').innerHTML = '';
document.getElementById('geoSave').disabled = true;
document.getElementById('geoPanel').classList.remove('open');
document.body.classList.remove('measure-open');
}
