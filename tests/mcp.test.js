// MCP-сервер: /api/mcp/<ключ> — те же данные, что у API по ключу, только чтение.
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
      services: [], history: [], objects: [], pirogHistory: [], revs: {},
    }),
  };
  const call = async (method, url, { body, token, key, raw } = {}) => {
    const headers = {};
    if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    if (key) headers['X-API-Key'] = key;
    const payload = raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body);
    const res = await worker.fetch(new Request('https://api.test' + url, { method, headers, body: payload }), env);
    const text = await res.text();
    let data = text;
    try { data = JSON.parse(text); } catch (e) {}
    return { status: res.status, data, headers: res.headers };
  };
  const reg = await call('POST', '/register', { body: { login: 'ivan', email: 'i@x.ru', password: 'pw', mode: 'company' } });
  const token = reg.data.token;
  const page = await call('GET', '/appdata', { token });
  await call('PUT', '/appdata', { token, body: { baseRev: page.data.rev, services: [{ name: 'Шпаклёвка стен', price: 500 }] } });
  const { data: { key } } = await call('POST', '/api-keys', { token, body: { name: 'Claude', site: 'https://nifork-oss.github.io/price.api/calc.html' } });
  let n = 0;
  const rpc = (method, params, url = '/api/mcp/' + key) => call('POST', url, { body: { jsonrpc: '2.0', id: ++n, method, params } });
  const tool = async (name, args) => {
    const r = await rpc('tools/call', { name, arguments: args || {} });
    return { ...r.data.result, data: JSON.parse(r.data.result.content[0].text) };
  };
  return { call, key, token, rpc, tool };
}

test('MCP: initialize, список инструментов — все только для чтения', async () => {
  const { rpc, call, key } = await setup();
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.strictEqual(init.status, 200);
  assert.strictEqual(init.data.result.protocolVersion, '2025-06-18');
  assert.ok(init.data.result.capabilities.tools);
  const unknown = await rpc('initialize', { protocolVersion: '1999-01-01' });
  assert.strictEqual(unknown.data.result.protocolVersion, '2025-11-25');

  const note = await call('POST', '/api/mcp/' + key, { body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.strictEqual(note.status, 202);

  const list = await rpc('tools/list', {});
  const names = list.data.result.tools.map(t => t.name).sort();
  assert.deepStrictEqual(names, ['get_estimate', 'get_object', 'list_estimates', 'list_objects', 'list_services', 'whoami']);
  assert.ok(list.data.result.tools.every(t => t.annotations.readOnlyHint === true && t.inputSchema.type === 'object' && !('path' in t)));

  assert.strictEqual((await rpc('nope', {})).data.error.code, -32601);
  assert.strictEqual((await call('GET', '/api/mcp/' + key)).status, 405);
});

test('MCP: без ключа или с отозванным ключом — 401', async () => {
  const { call, rpc, key, token } = await setup();
  assert.strictEqual((await rpc('tools/list', {}, '/api/mcp')).status, 401);
  assert.strictEqual((await rpc('tools/list', {}, '/api/mcp/sk_' + '0'.repeat(48))).status, 401);
  // ключ можно передать и заголовком
  const viaHeader = await call('POST', '/api/mcp', { key, body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
  assert.strictEqual(viaHeader.status, 200);
  const keys = await call('GET', '/api-keys', { token });
  await call('DELETE', '/api-keys?id=' + keys.data.keys[0].id, { token });
  assert.strictEqual((await rpc('tools/list', {})).status, 401);
});

test('MCP: объекты, сметы и прайс — те же, что у API', async () => {
  const { call, key, tool } = await setup();
  assert.strictEqual((await tool('whoami')).data.login, 'ivan');
  assert.deepStrictEqual((await tool('list_services')).data.services, [{ name: 'Шпаклёвка стен', price: 500, category: '' }]);

  const obj = await call('POST', '/api/v1/objects', { key, body: { name: 'Квартира', client: 'Пётр' } });
  const est = await call('POST', '/api/v1/estimates', { key, body: { client: 'Пётр', objectId: obj.data.id, items: [{ service: 'Шпаклёвка стен', qty: 10 }] } });

  const objects = (await tool('list_objects')).data.objects;
  assert.strictEqual(objects[0].name, 'Квартира');
  const one = await tool('get_object', { id: obj.data.id });
  assert.strictEqual(one.data.client, 'Пётр');
  assert.ok(Array.isArray(one.data.rooms));

  const missing = await tool('get_object', { id: 'нет такого' });
  assert.strictEqual(missing.isError, true);
  const noId = await tool('get_object', {});
  assert.strictEqual(noId.isError, true);

  assert.strictEqual((await tool('list_estimates', { docType: 'invoice' })).data.estimates.length, 0);
  assert.strictEqual((await tool('list_estimates', { docType: 'estimate' })).data.estimates[0].total, 5000);
  const e = await tool('get_estimate', { id: est.data.id });
  assert.strictEqual(e.data.total, 5000);
  assert.match(e.data.url, /view\.html\?id=/);
});

test('MCP: пакет запросов и битый JSON', async () => {
  const { call, key } = await setup();
  const batch = await call('POST', '/api/mcp/' + key, { body: [
    { jsonrpc: '2.0', id: 1, method: 'ping' },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ] });
  assert.strictEqual(batch.data.length, 2);
  assert.strictEqual((await call('POST', '/api/mcp/' + key, { raw: '{oops' })).data.error.code, -32700);
});
