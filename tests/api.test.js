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
    async delete(keys) { for (const k of keys) map.delete(k); },
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
