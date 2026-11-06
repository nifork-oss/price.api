// API по ключам: выдача и отзыв ключей, сметы, объекты и замеры от ИИ-агента.
// worker.js запускается в Node как модуль, хранилище — в памяти.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function loadWorker() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'worker-')), 'worker.mjs');
  fs.copyFileSync(path.join(__dirname, '..', 'worker.js'), file);
  return (await import('file://' + file)).default;
}

function memoryStorage(initial) {
  const map = new Map(Object.entries(initial));
  const copy = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  return {
    map,
    async get(k) { return Array.isArray(k) ? new Map(k.map(x => [x, copy(map.get(x))])) : copy(map.get(k)); },
    async put(k, v) { const obj = typeof k === 'string' ? { [k]: v } : k; for (const [key, val] of Object.entries(obj)) map.set(key, copy(val)); },
    async list({ prefix }) { return new Map([...map].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, copy(v)])); },
    async delete(keys) { for (const k of [].concat(keys)) map.delete(k); },
  };
}

async function setup() {
  const worker = await loadWorker();
  const env = {
    SESSION_SECRET: 'test-secret',
    STORAGE: memoryStorage({
      meta: { source: 'test' },
      users: [{ login: 'admin', role: 'admin', pass: 'x' }],
      services: [{ name: 'Стены', isCategory: true }, { name: 'Шпаклёвка стен', price: 450 }, { name: 'Покраска стен', price: 300 }],
      history: [], objects: [], pirogHistory: [], revs: {},
    }),
  };
  const call = async (method, url, { body, token, key, origin } = {}) => {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    if (key) headers['X-API-Key'] = key;
    if (origin) headers.Origin = origin;
    const res = await worker.fetch(new Request('https://api.test' + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch (e) {}
    return { status: res.status, data, headers: res.headers };
  };
  const reg = await call('POST', '/register', { body: { login: 'ivan', email: 'i@x.ru', password: 'pw', mode: 'company' } });
  return { env, call, token: reg.data.token };
}

test('ключ: создаётся с инструкцией для агента, хранится только хэш, отзывается', async () => {
  const { env, call, token } = await setup();
  const made = await call('POST', '/api-keys', { token, body: { name: 'Мой сайт', site: 'https://nifork-oss.github.io/price.api/calc.html' } });
  assert.strictEqual(made.status, 200);
  assert.match(made.data.key, /^sk_[0-9a-f]{48}$/);
  assert.match(made.data.guide, /X-API-Key/);
  assert.ok(made.data.guide.includes(made.data.key));
  assert.strictEqual(made.data.keys[0].mode, 'company');
  assert.strictEqual(made.data.keys[0].tail, made.data.key.slice(-4));
  assert.ok(!JSON.stringify(made.data.keys).includes('hash'));
  const stored = JSON.stringify(env.STORAGE.map.get('users'));
  assert.ok(!stored.includes(made.data.key), 'сам ключ на сервере не хранится');

  const me = await call('GET', '/api/v1/me', { key: made.data.key });
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.data.login, 'ivan');

  const id = made.data.keys[0].id;
  const del = await call('DELETE', '/api-keys?id=' + id, { token });
  assert.deepStrictEqual(del.data.keys, []);
  assert.strictEqual((await call('GET', '/api/v1/me', { key: made.data.key })).status, 401);
});

test('без ключа или с чужим ключом — 401; заказчик ключей не создаёт', async () => {
  const { call } = await setup();
  assert.strictEqual((await call('GET', '/api/v1/services')).status, 401);
  assert.strictEqual((await call('GET', '/api/v1/services', { key: 'sk_' + '0'.repeat(48) })).status, 401);
  const client = await call('POST', '/register', { body: { login: 'zak', email: 'z@x.ru', password: 'pw', role: 'client' } });
  assert.strictEqual((await call('POST', '/api-keys', { token: client.data.token, body: { name: 'x' } })).status, 403);
});

test('смета по ключу: цены из прайса, сумма, ссылка; видна в кабинете и даёт 409 старой странице', async () => {
  const { call, token } = await setup();
  // прайс «своей компании»
  const page = await call('GET', '/appdata', { token });
  await call('PUT', '/appdata', { token, body: { baseRev: page.data.rev, services: [{ name: 'Шпаклёвка стен', price: 500 }] } });
  const before = await call('GET', '/appdata', { token });
  const { data: { key } } = await call('POST', '/api-keys', { token, body: { name: 'Агент', site: 'https://nifork-oss.github.io/price.api/calc.html' } });

  const services = await call('GET', '/api/v1/services', { key });
  assert.deepStrictEqual(services.data.services, [{ name: 'Шпаклёвка стен', price: 500, category: '' }]);

  const bad = await call('POST', '/api/v1/estimates', { key, body: { items: [{ service: 'Нет такой', qty: 1 }] } });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.data.error, /нет услуги/);

  const made = await call('POST', '/api/v1/estimates', { key, body: {
    client: 'Пётр', address: 'Ленина 5',
    items: [{ service: 'шпаклёвка стен', qty: 10, location: 'Гостиная' }, { name: 'Вынос мусора', price: 3000, qty: 1, unit: 'усл.' }],
  } });
  assert.strictEqual(made.status, 201);
  assert.strictEqual(made.data.total, 8000);
  assert.strictEqual(made.data.docType, 'estimate');
  assert.strictEqual(made.data.items[0].unit, 'м²');
  assert.strictEqual(made.data.url, `https://nifork-oss.github.io/price.api/view.html?id=${made.data.id}`);

  const after = await call('GET', '/appdata', { token });
  assert.strictEqual(after.data.data.history[0].id, made.data.id);
  assert.strictEqual(after.data.data.history[0].source, 'api');
  // страница, открытая до сметы, не затирает её
  const stale = await call('PUT', '/appdata', { token, body: { baseRev: before.data.rev, history: [] } });
  assert.strictEqual(stale.status, 409);

  const one = await call('GET', '/api/v1/estimates/' + made.data.id, { key });
  assert.strictEqual(one.data.client, 'Пётр');
  // счёт по ссылке открывается
  assert.strictEqual((await call('GET', '/invoice?id=' + made.data.id)).data.total, 8000);
});

test('объект и замеры от агента: ждут проверки у объекта', async () => {
  const { call, token } = await setup();
  const { data: { key } } = await call('POST', '/api-keys', { token, body: { name: 'Агент' } });
  const obj = await call('POST', '/api/v1/objects', { key, body: { name: 'Квартира', client: 'Пётр' } });
  assert.strictEqual(obj.status, 201);
  const noRooms = await call('POST', `/api/v1/objects/${obj.data.id}/plans`, { key, body: { rooms: [{ name: 'Кухня' }] } });
  assert.strictEqual(noRooms.status, 400);
  const plan = await call('POST', `/api/v1/objects/${obj.data.id}/plans`, { key, body: {
    title: 'Замер', rooms: [{ name: 'Кухня', height_mm: 2700, pts: [[0, 0], [3000, 0], [3000, 2500], [0, 2500]] }], warnings: ['нет окон'],
  } });
  assert.strictEqual(plan.status, 201);
  const list = await call('GET', '/api/v1/objects', { key });
  assert.strictEqual(list.data.objects[0].pendingPlans, 1);
  const page = await call('GET', '/appdata', { token });
  const saved = page.data.data.objects[0].agentPlans[0];
  assert.strictEqual(saved.from, 'Агент');
  assert.strictEqual(saved.rooms[0].name, 'Кухня');
  assert.deepStrictEqual(saved.warnings, ['нет окон']);
  assert.strictEqual((await call('POST', '/api/v1/objects/nope/plans', { key, body: { rooms: [] } })).status, 404);
});

test('API открыт для любых сайтов (CORS), инструкция — без ключа', async () => {
  const { call } = await setup();
  const pre = await call('OPTIONS', '/api/v1/estimates', { origin: 'https://example.com' });
  assert.strictEqual(pre.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(pre.headers.get('Access-Control-Allow-Headers'), /X-API-Key/);
  const help = await call('GET', '/api/v1/help');
  assert.strictEqual(help.status, 200);
  assert.match(help.data, /POST \/api\/v1\/estimates/);
  // остальной сайт — по-прежнему только свои адреса
  const other = await call('GET', '/public', { origin: 'https://example.com' });
  assert.notStrictEqual(other.headers.get('Access-Control-Allow-Origin'), '*');
});

test('подложка к замерам: хранится отдельно, отдаётся только своему мастеру и удаляется', async () => {
  const { env, call, token } = await setup();
  const { data: { key } } = await call('POST', '/api-keys', { token, body: { name: 'Агент' } });
  const obj = await call('POST', '/api/v1/objects', { key, body: { name: 'Квартира' } });
  const rooms = [{ name: 'Кухня', pts: [[0, 0], [3000, 0], [3000, 2500], [0, 2500]] }];
  const bad = await call('POST', `/api/v1/objects/${obj.data.id}/plans`, { key, body: { rooms, underlay: { image: 'http://x/1.png', x_mm: 0, y_mm: 0, width_mm: 5000 } } });
  assert.strictEqual(bad.status, 400);
  const noPos = await call('POST', `/api/v1/objects/${obj.data.id}/plans`, { key, body: { rooms, underlay: { image: 'data:image/png;base64,AAAA', width_mm: 5000 } } });
  assert.strictEqual(noPos.status, 400);
  const plan = await call('POST', `/api/v1/objects/${obj.data.id}/plans`, { key, body: { rooms, underlay: { image: 'data:image/png;base64,AAAA', x_mm: -500, y_mm: 250, width_mm: 5000 } } });
  assert.strictEqual(plan.status, 201);
  const page = await call('GET', '/appdata', { token });
  const saved = page.data.data.objects[0].agentPlans[0];
  assert.deepStrictEqual(saved.underlay, { x: -0.5, y: 0.25, w: 5 });
  assert.ok(!JSON.stringify(page.data).includes('AAAA'), 'картинка не лежит в данных объекта');
  const img = await call('GET', '/agent-plan-image?id=' + plan.data.id, { token });
  assert.strictEqual(img.data.image, 'data:image/png;base64,AAAA');
  const other = await call('POST', '/register', { body: { login: 'petr', email: 'p@x.ru', password: 'pw', mode: 'company' } });
  assert.strictEqual((await call('GET', '/agent-plan-image?id=' + plan.data.id, { token: other.data.token })).status, 404);
  await call('DELETE', '/agent-plan-image?id=' + plan.data.id, { token });
  assert.strictEqual(env.STORAGE.map.has('agentimg:' + plan.data.id), false);
});

test('инструкция для агента берётся и потом, без ключа', async () => {
  const { call, token } = await setup();
  await call('POST', '/api-keys', { token, body: { name: 'Агент' } });
  const list = await call('GET', '/api-keys', { token });
  assert.match(list.data.guide, /<ключ мастера>/);
  assert.match(list.data.guide, /PATCH \/api\/v1\/estimates/);
});

test('объём сметы — из посчитанных поверхностей помещений объекта', async () => {
  const { call, token } = await setup();
  const { data: { key } } = await call('POST', '/api-keys', { token, body: { name: 'Агент' } });
  const page = await call('GET', '/appdata', { token });
  const rooms = [
    { id: 'r1', measure: { room: 'Кухня', height: '2,7', walls: ['3'] }, surfaces: { walls: { v: 30.5, u: 'м²', l: 'Стены' }, slopes: { v: 0.4, u: 'пог. м', l: 'Откосы' } } },
    { id: 'r2', measure: { room: 'Спальня', walls: ['4'] }, surfaces: { walls: { v: 20, u: 'м²', l: 'Стены' } } },
  ];
  await call('PUT', '/appdata', { token, body: { baseRev: page.data.rev, services: [{ name: 'Шпаклёвка стен', price: 500 }, { name: 'Откосы', price: 100 }], objects: [{ id: 'o1', name: 'Квартира', rooms }] } });

  const detail = await call('GET', '/api/v1/objects/o1', { key });
  assert.strictEqual(detail.status, 200);
  assert.strictEqual(detail.data.rooms[0].name, 'Кухня');
  assert.strictEqual(detail.data.rooms[0].height_m, 2.7);
  assert.deepStrictEqual(detail.data.rooms[0].surfaces.walls, { value: 30.5, unit: 'м²', label: 'Стены' });
  assert.strictEqual(detail.data.editable, false);

  const noObj = await call('POST', '/api/v1/estimates', { key, body: { items: [{ service: 'Шпаклёвка стен', surface: 'walls', room_ids: ['r1'] }] } });
  assert.strictEqual(noObj.status, 400);
  const missing = await call('POST', '/api/v1/estimates', { key, body: { objectId: 'o1', items: [{ service: 'Откосы', surface: 'slopes', room_ids: ['r2'] }] } });
  assert.match(missing.data.error, /Спальня/);

  const made = await call('POST', '/api/v1/estimates', { key, body: { objectId: 'o1', items: [
    { service: 'Шпаклёвка стен', surface: 'walls', room_ids: ['r1', 'r2'] },
    { service: 'Откосы', surface: 'slopes', room_ids: ['r1'] },
  ] } });
  assert.strictEqual(made.status, 201);
  assert.strictEqual(made.data.items[0].qty, 50.5);
  assert.strictEqual(made.data.items[0].location, 'Кухня, Спальня');
  assert.deepStrictEqual(made.data.items[0].room_ids, ['r1', 'r2']);
  // погонные метры — не меньше 1, как на сайте
  assert.strictEqual(made.data.items[1].qty, 1);
  assert.strictEqual(made.data.items[1].unit, 'пог. м');
  assert.strictEqual(made.data.total, 50.5 * 500 + 100);
  const saved = (await call('GET', '/appdata', { token })).data.data.history[0];
  assert.deepStrictEqual(saved.items[0].rooms.map(r => r.roomId), ['r1', 'r2']);
  assert.strictEqual(saved.items[0].surface, 'walls');
});

test('агент правит и удаляет только то, что создал через API', async () => {
  const { call, token } = await setup();
  const { data: { key } } = await call('POST', '/api-keys', { token, body: { name: 'Агент' } });
  const page = await call('GET', '/appdata', { token });
  await call('PUT', '/appdata', { token, body: { baseRev: page.data.rev, services: [{ name: 'Шпаклёвка стен', price: 500 }],
    history: [{ id: 'inv_site', client: 'С сайта', total: 1, items: [] }], objects: [{ id: 'o_site', name: 'С сайта' }] } });

  const est = await call('POST', '/api/v1/estimates', { key, body: { client: 'Пётр', items: [{ service: 'Шпаклёвка стен', qty: 10 }] } });
  const patched = await call('PATCH', '/api/v1/estimates/' + est.data.id, { key, body: { client: 'Пётр Иванов', items: [{ service: 'Шпаклёвка стен', qty: 4 }] } });
  assert.strictEqual(patched.status, 200);
  assert.strictEqual(patched.data.client, 'Пётр Иванов');
  assert.strictEqual(patched.data.total, 2000);
  assert.strictEqual((await call('PATCH', '/api/v1/estimates/inv_site', { key, body: { client: 'x' } })).status, 403);
  assert.strictEqual((await call('DELETE', '/api/v1/estimates/inv_site', { key })).status, 403);
  assert.strictEqual((await call('DELETE', '/api/v1/estimates/' + est.data.id, { key })).status, 200);
  assert.strictEqual((await call('GET', '/api/v1/estimates/' + est.data.id, { key })).status, 404);

  const obj = await call('POST', '/api/v1/objects', { key, body: { name: 'Квартира' } });
  const op = await call('PATCH', '/api/v1/objects/' + obj.data.id, { key, body: { address: 'Ленина 5' } });
  assert.strictEqual(op.data.address, 'Ленина 5');
  assert.strictEqual((await call('PATCH', '/api/v1/objects/' + obj.data.id, { key, body: { name: ' ' } })).status, 400);
  assert.strictEqual((await call('PATCH', '/api/v1/objects/o_site', { key, body: { name: 'x' } })).status, 403);

  const plan = await call('POST', `/api/v1/objects/${obj.data.id}/plans`, { key, body: { rooms: [{ name: 'Кухня', pts: [[0, 0], [1, 0], [1, 1]] }] } });
  assert.strictEqual((await call('DELETE', `/api/v1/objects/${obj.data.id}/plans/${plan.data.id}`, { key })).status, 200);
  assert.strictEqual((await call('DELETE', `/api/v1/objects/${obj.data.id}/plans/${plan.data.id}`, { key })).status, 404);

  // объект со сметой удалить нельзя, пустой — можно
  const withEst = await call('POST', '/api/v1/estimates', { key, body: { objectId: obj.data.id, items: [{ service: 'Шпаклёвка стен', qty: 1 }] } });
  assert.strictEqual((await call('DELETE', '/api/v1/objects/' + obj.data.id, { key })).status, 409);
  await call('DELETE', '/api/v1/estimates/' + withEst.data.id, { key });
  assert.strictEqual((await call('DELETE', '/api/v1/objects/' + obj.data.id, { key })).status, 200);
  assert.strictEqual((await call('GET', '/api/v1/objects/' + obj.data.id, { key })).status, 404);
});

test('подложка плана в облаке: картинка и положение, своё пространство', async () => {
  const { env, call, token } = await setup();
  assert.deepStrictEqual((await call('GET', '/underlay?id=flat_o1', { token })).data, { view: null });
  assert.strictEqual((await call('PUT', '/underlay?id=flat_o1', { token, body: { view: { x: 1 } } })).status, 400, 'без картинки нельзя');
  assert.strictEqual((await call('PUT', '/underlay?id=flat_o1', { token, body: { view: { x: 1 }, image: 'http://x' } })).status, 400);
  const put = await call('PUT', '/underlay?id=flat_o1', { token, body: { view: { x: 1, w: 8, ar: 0.7 }, at: 100, image: 'data:image/jpeg;base64,AAAA' } });
  assert.strictEqual(put.status, 200);
  assert.strictEqual(put.data.at, 100);
  assert.ok(put.data.imgAt > 0);
  const moved = await call('PUT', '/underlay?id=flat_o1', { token, body: { view: { x: 2, w: 8, ar: 0.7 }, at: 200 } });
  assert.strictEqual(moved.data.imgAt, put.data.imgAt, 'картинка та же');
  const meta = await call('GET', '/underlay?id=flat_o1', { token });
  assert.deepStrictEqual(meta.data.view, { x: 2, w: 8, ar: 0.7 });
  assert.strictEqual((await call('GET', '/underlay?id=flat_o1&img=1', { token })).data.image, 'data:image/jpeg;base64,AAAA');
  // у другого мастера — своё пространство
  const other = await call('POST', '/register', { body: { login: 'petr', email: 'p@x.ru', password: 'pw', mode: 'company' } });
  assert.deepStrictEqual((await call('GET', '/underlay?id=flat_o1', { token: other.data.token })).data, { view: null });
  assert.strictEqual((await call('GET', '/underlay?id=../x', { token })).status, 400);
  await call('DELETE', '/underlay?id=flat_o1', { token });
  assert.deepStrictEqual([...env.STORAGE.map.keys()].filter(k => k.startsWith('ul')), []);
});

test('простые замеры: размеры и соседство — сервер раскладывает план, двери у обоих', async () => {
  const { call, token } = await setup();
  const { data: { key } } = await call('POST', '/api-keys', { token, body: { name: 'Агент' } });
  const obj = await call('POST', '/api/v1/objects', { key, body: { name: 'Квартира' } });
  const url = `/api/v1/objects/${obj.data.id}/plans`;
  const plan = await call('POST', url, { key, body: { rooms: [
    { name: 'Кухня', size_mm: [3000, 3200], next_to: { room: 'Гостиная', side: 'right' }, doors: [{ to: 'Гостиная', width_mm: 800 }] },
    { name: 'Гостиная', size_mm: [4600, 3200], height_mm: 2700, windows: [{ side: 'top', offset_mm: 800, width_mm: 1400, height_mm: 1500 }] },
    { name: 'Ванная', size_mm: [1700, 1500], next_to: { room: 'Кухня', side: 'bottom', offset_mm: 500, wall_mm: 120 } },
  ] } });
  assert.strictEqual(plan.status, 201, JSON.stringify(plan.data));
  const L = Object.fromEntries(plan.data.layout.map(r => [r.name, r.pts]));
  assert.deepStrictEqual(L['Гостиная'], [[0, 0], [4600, 0], [4600, 3200], [0, 3200]]);
  assert.deepStrictEqual(L['Кухня'][0], [4700, 0]);
  assert.deepStrictEqual(L['Ванная'][0], [5200, 3320]);
  const saved = (await call('GET', '/appdata', { token })).data.data.objects[0].agentPlans[0].rooms;
  const by = Object.fromEntries(saved.map(r => [r.name, r]));
  assert.ok(!('size_mm' in by['Кухня']) && !('next_to' in by['Кухня']));
  assert.deepStrictEqual(by['Гостиная'].openings.find(o => o.type === 'window').at, [[800, 0], [2200, 0]]);
  assert.deepStrictEqual(by['Гостиная'].openings.find(o => o.type === 'door').at, [[4600, 1200], [4600, 2000]]);
  assert.deepStrictEqual(by['Кухня'].openings.find(o => o.type === 'door').at, [[4700, 1200], [4700, 2000]]);

  const bad = async (rooms, re) => { const r = await call('POST', url, { key, body: { rooms } }); assert.strictEqual(r.status, 400); assert.match(r.data.error, re); };
  await bad([{ name: 'А', size_mm: [3000, 0] }], /size_mm/);
  await bad([{ name: 'А', size_mm: [3000, 3000] }, { name: 'Б', size_mm: [2000, 2000], next_to: { room: 'Нет', side: 'left' } }], /нет помещения «Нет»/);
  await bad([{ name: 'А', size_mm: [3000, 3000] }, { name: 'Б', size_mm: [2000, 2000] }], /укажите next_to/);
  await bad([{ name: 'А', size_mm: [3000, 3000], doors: [{ to: 'Б' }] }, { name: 'Б', size_mm: [2000, 2000], next_to: { room: 'А', side: 'right', offset_mm: 2900 } }], /нет общей стены/);
});

test('скидка на смету: процент или рубли, итог со скидкой, видна заказчику', async () => {
  const { call, token } = await setup();
  const { data: { key } } = await call('POST', '/api-keys', { token, body: { name: 'Агент' } });
  const page = await call('GET', '/appdata', { token });
  await call('PUT', '/appdata', { token, body: { baseRev: page.data.rev, services: [{ name: 'Шпаклёвка стен', price: 500 }] } });
  const made = await call('POST', '/api/v1/estimates', { key, body: { items: [{ service: 'Шпаклёвка стен', qty: 20 }], discount: { percent: 10 } } });
  assert.strictEqual(made.status, 201);
  assert.strictEqual(made.data.total, 9000);
  assert.strictEqual(made.data.subtotal, 10000);
  assert.deepStrictEqual(made.data.discount, { percent: 10 });
  const view = await call('GET', '/invoice?id=' + made.data.id);
  assert.strictEqual(view.data.total, 9000);
  assert.deepStrictEqual(view.data.discount, { kind: 'pct', value: 10 });
  const rub = await call('PATCH', '/api/v1/estimates/' + made.data.id, { key, body: { discount: { rub: 1500 } } });
  assert.strictEqual(rub.data.total, 8500);
  const none = await call('PATCH', '/api/v1/estimates/' + made.data.id, { key, body: { discount: null } });
  assert.strictEqual(none.data.total, 10000);
  assert.ok(!('discount' in none.data));
  assert.strictEqual((await call('POST', '/api/v1/estimates', { key, body: { items: [{ service: 'Шпаклёвка стен', qty: 1 }], discount: { percent: 150 } } })).status, 400);
});

test('связанные документы: работы ↔ материалы, ссылки в обе стороны, вкладки у заказчика', async () => {
  const { call, token } = await setup();
  const { data: { key } } = await call('POST', '/api-keys', { token, body: { name: 'Агент' } });
  const works = await call('POST', '/api/v1/estimates', { key, body: { title: 'Работы', items: [{ name: 'Шпаклёвка', price: 500, qty: 10 }] } });
  assert.strictEqual(works.data.title, 'Работы');
  const mat = await call('POST', '/api/v1/estimates', { key, body: { title: 'Материалы', related: [works.data.id], items: [{ name: 'Краска', price: 20000, qty: 1, unit: 'ведро' }] } });
  assert.strictEqual(mat.status, 201);
  assert.deepStrictEqual(mat.data.related, [works.data.id]);
  const back = await call('GET', '/api/v1/estimates/' + works.data.id, { key });
  assert.deepStrictEqual(back.data.related, [mat.data.id]);
  const view = await call('GET', '/invoice?id=' + works.data.id);
  assert.strictEqual(view.data.title, 'Работы');
  assert.deepStrictEqual(view.data.related.map(d => [d.id, d.title]), [[mat.data.id, 'Материалы']]);

  const bad = await call('PATCH', '/api/v1/estimates/' + works.data.id, { key, body: { related: ['inv_nope'] } });
  assert.strictEqual(bad.status, 400);
  assert.match(bad.data.error, /не найдена/);
  const cleared = await call('PATCH', '/api/v1/estimates/' + mat.data.id, { key, body: { related: [] } });
  assert.deepStrictEqual(cleared.data.related, []);
  assert.deepStrictEqual((await call('GET', '/invoice?id=' + works.data.id)).data.related, []);

  await call('PATCH', '/api/v1/estimates/' + works.data.id, { key, body: { related: [mat.data.id] } });
  assert.strictEqual((await call('GET', '/invoice?id=' + mat.data.id)).data.related.length, 1);
  await call('DELETE', '/api/v1/estimates/' + mat.data.id, { key });
  assert.deepStrictEqual((await call('GET', '/invoice?id=' + works.data.id)).data.related, []);
});

test('этаж — поле помещения: у плана целиком или у каждого помещения, виден в GET /objects', async () => {
  const { call, token } = await setup();
  const { data: { key } } = await call('POST', '/api-keys', { token, body: { name: 'Агент' } });
  const obj = await call('POST', '/api/v1/objects', { key, body: { name: 'Дом' } });
  const url = `/api/v1/objects/${obj.data.id}/plans`;
  const r1 = await call('POST', url, { key, body: { floor: 1, rooms: [
    { name: 'Кухня', size_mm: [3000, 3000] },
    { name: 'Подвал', floor: 'Цоколь', size_mm: [2000, 2000], next_to: { room: 'Кухня', side: 'right' } },
  ] } });
  assert.strictEqual(r1.status, 201, JSON.stringify(r1.data));
  assert.deepStrictEqual(r1.data.layout.map(r => r.floor), ['1', 'Цоколь']);
  const r2 = await call('POST', url, { key, body: { rooms: [{ name: 'Спальня', pts: [[0, 0], [3000, 0], [3000, 3000], [0, 3000]] }] } });
  assert.strictEqual(r2.data.layout[0].floor, '', 'без этажа — пустая строка');

  const saved = (await call('GET', '/appdata', { token })).data.data.objects[0].agentPlans[0].rooms;
  assert.strictEqual(saved.find(r => r.name === 'Кухня').floor, '1');

  const bad = async (body, re) => { const r = await call('POST', url, { key, body }); assert.strictEqual(r.status, 400); assert.match(r.data.error, re); };
  await bad({ rooms: [{ name: 'А', floor: { n: 1 }, size_mm: [1000, 1000] }] }, /«А».*floor/);
  await bad({ floor: 'x'.repeat(31), rooms: [{ name: 'А', size_mm: [1000, 1000] }] }, /floor/);

  // после проверки мастером этаж лежит в замере помещения и отдаётся наружу
  const page = await call('GET', '/appdata', { token });
  await call('PUT', '/appdata', { token, body: { baseRev: page.data.rev, objects: [{ id: 'o1', name: 'Дом', rooms: [
    { id: 'r1', measure: { room: 'Кухня', floor: '1' } }, { id: 'r2', measure: { room: 'Спальня', floor: '2' } }, { id: 'r3', measure: { room: 'Гараж' } },
  ] }] } });
  const list = await call('GET', '/api/v1/objects', { key });
  assert.deepStrictEqual(list.data.objects[0].rooms.map(r => r.floor), ['1', '2', '']);
  const detail = await call('GET', '/api/v1/objects/o1', { key });
  assert.deepStrictEqual(detail.data.rooms.map(r => r.floor), ['1', '2', '']);
});

test('прораб: ссылка-приглашение, одобрение и отклонение счетов только своего объекта', async () => {
  const { call, token } = await setup();
  const page = await call('GET', '/appdata', { token });
  const inv = (id, objectId, total) => ({ id, objectId, docType: 'invoice', date: '03.11.2026', client: 'Иван', total, items: [{ name: 'Шпаклёвка', price: 500, qty: 2, unit: 'м²' }] });
  await call('PUT', '/appdata', { token, body: { baseRev: page.data.rev, objects: [{ id: 'o1', name: 'Квартира', address: 'Ленина 5', foreman: 'Пётр', rooms: [] }, { id: 'o2', name: 'Другой', rooms: [] }],
    history: [inv('h1', 'o1', 1000), inv('h2', 'o1', 2000), inv('h3', 'o2', 5000), { ...inv('h4', 'o1', 700), shareDisabled: true }] } });

  assert.strictEqual((await call('POST', '/foreman-invite?objectId=nope', { token, body: {} })).status, 404);
  assert.strictEqual((await call('POST', '/foreman-invite?objectId=o1')).status, 401, 'без входа приглашение не выпустить');
  const made = await call('POST', '/foreman-invite?objectId=o1', { token, body: {} });
  assert.strictEqual(made.status, 201, JSON.stringify(made.data));
  const t = made.data.invite.token;
  assert.match(t, /^pr_[0-9a-f]{48}$/);
  assert.strictEqual(made.data.invite.name, 'Пётр', 'имя берётся из карточки объекта');

  // прораб без входа видит только счета своего объекта (без отключённых)
  const view = await call('GET', '/foreman?t=' + t);
  assert.strictEqual(view.status, 200);
  assert.strictEqual(view.data.object.name, 'Квартира');
  assert.deepStrictEqual(view.data.docs.map(d => d.id), ['h1', 'h2']);
  assert.strictEqual(view.data.docs[0].items[0].name, 'Шпаклёвка');
  assert.ok(!JSON.stringify(view.data).includes('payments'));
  assert.strictEqual((await call('GET', '/foreman?t=pr_' + '0'.repeat(48))).status, 404);
  assert.strictEqual((await call('GET', '/foreman?t=bad')).status, 404);

  const decide = (body) => call('POST', '/foreman/decision', { body: { t, ...body } });
  assert.strictEqual((await decide({ id: 'h3', decision: 'approved' })).status, 404, 'чужой объект — нельзя');
  assert.strictEqual((await decide({ id: 'h4', decision: 'approved' })).status, 404, 'отключённый счёт — нельзя');
  assert.strictEqual((await decide({ id: 'h1', decision: 'maybe' })).status, 400);
  assert.strictEqual((await decide({ id: 'h1', decision: 'rejected' })).status, 400, 'отказ — только с причиной');
  const rej = await decide({ id: 'h1', decision: 'rejected', comment: 'Не учтён вынос мусора' });
  assert.strictEqual(rej.status, 200);
  assert.strictEqual(rej.data.approval.status, 'rejected');
  assert.strictEqual((await decide({ id: 'h2', decision: 'approved' })).data.approval.by, 'Пётр');
  // решение можно изменить; прошлое остаётся в журнале на сервере
  assert.strictEqual((await decide({ id: 'h1', decision: 'approved' })).data.approval.status, 'approved');

  // мастер видит решения; если сумма потом изменилась — пометка changed
  let seen = await call('GET', '/foreman-invite?objectId=o1', { token });
  assert.strictEqual(seen.data.invite.token, t);
  assert.deepStrictEqual(seen.data.docs.map(d => [d.id, d.approval.status, d.approval.changed]), [['h1', 'approved', false], ['h2', 'approved', false]]);
  const page2 = await call('GET', '/appdata', { token });
  const hist = page2.data.data.history.map(r => (r.id === 'h2' ? { ...r, total: 2500 } : r));
  await call('PUT', '/appdata', { token, body: { baseRev: page2.data.rev, history: hist } });
  seen = await call('GET', '/foreman-invite?objectId=o1', { token });
  assert.strictEqual(seen.data.docs.find(d => d.id === 'h2').approval.changed, true);

  // новая ссылка отключает старую, отзыв отключает совсем
  const again = await call('POST', '/foreman-invite?objectId=o1', { token, body: { name: 'Сергей' } });
  assert.strictEqual((await call('GET', '/foreman?t=' + t)).status, 404);
  assert.strictEqual((await call('GET', '/foreman?t=' + again.data.invite.token)).data.foreman, 'Сергей');
  assert.strictEqual((await call('GET', '/foreman?t=' + again.data.invite.token)).data.docs[0].approval.status, 'approved', 'решения сохраняются');
  assert.strictEqual((await call('DELETE', '/foreman-invite?objectId=o1', { token })).status, 200);
  assert.strictEqual((await call('GET', '/foreman?t=' + again.data.invite.token)).status, 404);
  assert.strictEqual((await call('GET', '/foreman-invite?objectId=o1', { token })).data.invite, null);
});

test('сохранение без baseRev не стирает чужие объекты (слияние по id)', async () => {
  const { call, token } = await setup();
  const page = await call('GET', '/appdata', { token });
  await call('PUT', '/appdata', { token, body: { baseRev: page.data.rev, objects: [{ id: 'a', name: 'Старый' }, { id: 'b', name: 'Второй' }] } });
  // «пустая» страница, не загрузившая данные, добавляет один новый объект
  await call('PUT', '/appdata', { token, body: { objects: [{ id: 'c', name: 'Новый' }] } });
  const after = await call('GET', '/appdata', { token });
  assert.deepStrictEqual(after.data.data.objects.map(o => o.id).sort(), ['a', 'b', 'c']);
});

test('ежедневная копия: делается перед первой записью суток и скачивается через /backup?snap=', async () => {
  const { call, token, env } = await setup();
  const page = await call('GET', '/appdata', { token });
  await call('PUT', '/appdata', { token, body: { baseRev: page.data.rev, objects: [{ id: 'a', name: 'Первый' }] } });
  const day = new Date().toISOString().slice(0, 10);
  assert.ok(env.STORAGE.map.get('snap:' + day + ':_done'));
  await call('PUT', '/appdata', { token, body: { objects: [{ id: 'b', name: 'Второй' }] } });
  // копия суток снята один раз и не перезаписывается
  assert.deepStrictEqual(env.STORAGE.map.get('snap:' + day + ':objects'), []);
});

test('после отката базы страница с версией новее серверной получает 409', async () => {
  const { call, token, env } = await setup();
  const page = await call('GET', '/appdata', { token });
  await call('PUT', '/appdata', { token, body: { baseRev: page.data.rev, objects: [{ id: 'a' }] } });
  const fresh = await call('GET', '/appdata', { token });
  // имитация отката: версии на сервере вернулись назад
  const revs = env.STORAGE.map.get('revs');
  for (const k of Object.keys(revs)) { revs[k].rev = 1; for (const f of Object.keys(revs[k].fields || {})) revs[k].fields[f] = 1; }
  env.STORAGE.map.set('revs', revs);
  const stale = await call('PUT', '/appdata', { token, body: { baseRev: fresh.data.rev, objects: [] } });
  assert.strictEqual(stale.status, 409);
});

test('доступ аккаунта: новая регистрация — только своя компания; админ включает выбор или только сотрудника', async () => {
  const { call, token, env } = await setup();
  // ivan зарегистрирован в setup(): просит «сотрудник» — всё равно своя компания
  const l1 = await call('POST', '/login', { body: { login: 'ivan', password: 'pw', mode: 'employee' } });
  assert.strictEqual(l1.data.mode, 'company');
  assert.strictEqual(l1.data.access, 'company');
  const sw = await call('POST', '/switch-mode', { token, body: { mode: 'employee' } });
  assert.strictEqual(sw.status, 403);
  // админ добавляет в команду
  const users = env.STORAGE.map.get('users');
  users.find(u => u.login === 'ivan').access = 'both';
  env.STORAGE.map.set('users', users);
  const l2 = await call('POST', '/login', { body: { login: 'ivan', password: 'pw', mode: 'employee' } });
  assert.strictEqual(l2.data.mode, 'employee');
  // админ отключает свою компанию: старый токен «своя компания» больше не действует
  users.find(u => u.login === 'ivan').access = 'staff';
  env.STORAGE.map.set('users', users);
  const old = await call('GET', '/appdata', { token });
  assert.strictEqual(old.status, 401);
  const l3 = await call('POST', '/login', { body: { login: 'ivan', password: 'pw', mode: 'company' } });
  assert.strictEqual(l3.data.mode, 'employee');
});

test('перенос объекта со счетами из общего пространства в компанию мастера', async () => {
  const { call, env } = await setup();
  env.STORAGE.map.set('users', [...env.STORAGE.map.get('users').map(u => u.login === 'admin' ? { ...u, pass: 'x' } : u)]);
  env.STORAGE.map.set('objects', [{ id: 'o1', name: 'Квартира', visibleTo: ['ivan'] }, { id: 'o2', name: 'Дом' }]);
  env.STORAGE.map.set('history', [{ id: 1, objectId: 'o1' }, { id: 2, objectId: 'o2' }]);
  const admin = await call('POST', '/login', { body: { login: 'admin', password: 'x' } });
  const tok = admin.data.token;
  assert.ok(tok, 'вход админа');
  const r = await call('POST', '/move-object', { token: tok, body: { objectId: 'o1', toLogin: 'ivan' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.data.docs, 1);
  assert.deepStrictEqual(env.STORAGE.map.get('objects').map(o => o.id), ['o2']);
  assert.deepStrictEqual(env.STORAGE.map.get('history').map(h => h.id), [2]);
  const cd = env.STORAGE.map.get('cd:ivan');
  assert.deepStrictEqual(cd.objects.map(o => o.id), ['o1']);
  assert.strictEqual(cd.objects[0].visibleTo, undefined);
  assert.deepStrictEqual(cd.history.map(h => h.id), [1]);
  const ivanTok = (await call('POST', '/login', { body: { login: 'ivan', password: 'pw' } })).data.token;
  assert.strictEqual((await call('POST', '/move-object', { token: ivanTok, body: { objectId: 'o2', toLogin: 'ivan' } })).status, 403);
});
