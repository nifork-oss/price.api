// Проверки «Помощника»: сервер (/assistant) и разбор предложений в калькуляторе.
// Запуск из корня репозитория: node --test
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { loadCalc } = require('./load.js');

const SECRET = 'test-secret';

// Хранилище в памяти вместо Durable Object: пользователи с доступом к платным функциям
function fakeStorage(users) {
  const m = new Map(Object.entries({ meta: { test: true }, services: [], users, history: [], objects: [], pirogHistory: [], revs: {} }));
  return {
    map: m,
    async get(k) { return Array.isArray(k) ? new Map(k.map(x => [x, m.get(x)])) : m.get(k); },
    async put(k, v) { if (typeof k === 'string') m.set(k, v); else Object.entries(k).forEach(([a, b]) => m.set(a, b)); },
    async list({ prefix }) { return new Map([...m].filter(([k]) => k.startsWith(prefix))); },
    async delete(keys) { [].concat(keys).forEach(k => m.delete(k)); },
  };
}
const OPEN = Date.now() + 3600e3;
const ivanWithAccess = () => [{ login: 'admin', role: 'admin' }, { login: 'ivan', role: 'master', aiBalance: 100000 }];
async function token(payload) {
  const b64 = buf => Buffer.from(buf).toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const body = b64(JSON.stringify({ ...payload, exp: Date.now() + 60000 }));
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return `${body}.${b64(sig)}`;
}

async function callAssistant(body, { role = 'master', env = {}, reply, status = 200, raw } = {}) {
  const worker = (await import('../worker.js')).default;
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sent.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    return new Response(raw != null ? raw : JSON.stringify(reply || { content: [{ type: 'text', text: 'ok' }] }), { status });
  };
  try {
    const req = new Request('https://x/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token({ login: 'ivan', role })) },
      body: JSON.stringify(body),
    });
    const res = await worker.fetch(req, { SESSION_SECRET: SECRET, ANTHROPIC_API_KEY: 'k', STORAGE: fakeStorage(ivanWithAccess()), ...env });
    return { status: res.status, data: await res.json(), sent };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('сервер: без ключа — 501, заказчику — нельзя, пустое сообщение — 400', async () => {
  const msg = { messages: [{ role: 'user', content: 'привет' }] };
  assert.strictEqual((await callAssistant(msg, { env: { ANTHROPIC_API_KEY: '' } })).status, 501);
  assert.strictEqual((await callAssistant(msg, { role: 'client' })).status, 403);
  assert.strictEqual((await callAssistant({ messages: [{ role: 'user', content: '' }] })).status, 400);
  assert.strictEqual((await callAssistant({ messages: [{ role: 'assistant', content: 'x' }] })).status, 400);
});

test('сервер: передаёт данные калькулятора и разбирает предложения', async () => {
  const reply = { content: [
    { type: 'text', text: 'Предлагаю покраску.' },
    { type: 'tool_use', name: 'propose_items', input: { items: [
      { service_index: 3, surface: 'walls', room_ids: ['r1'] },
      { service_index: 5, qty: 2, unit: 'шт.', note: 'розетки' },
      { service_index: -1, qty: 1 },
      { service_index: 'x' },
    ] } },
  ] };
  const { status, data, sent } = await callAssistant({
    messages: [{ role: 'user', content: 'покрась стены' }, { role: 'assistant', content: 'а' }, { role: 'user', content: 'и ещё' }],
    context: { services: [{ i: 3, name: 'Покраска' }] },
  }, { reply });
  assert.strictEqual(status, 200);
  assert.strictEqual(data.text, 'Предлагаю покраску.');
  assert.strictEqual(data.items.length, 2);
  assert.deepStrictEqual(data.items[0].room_ids, ['r1']);
  assert.strictEqual(data.items[1].qty, 2);
  assert.strictEqual(data.model, 'claude-sonnet-5-5'); // сервис модель не назвал — какую просили
  assert.strictEqual(sent[0].url, 'https://api.anthropic.com/v1/messages');
  assert.ok(sent[0].body.system[1].text.includes('"Покраска"'));
  // Метки кеша: инструкция, данные калькулятора, последнее сообщение
  assert.deepStrictEqual(sent[0].body.system.map(b => !!b.cache_control), [true, true]);
  const lastMsg = sent[0].body.messages[sent[0].body.messages.length - 1];
  assert.deepStrictEqual(lastMsg.content, [{ type: 'text', text: 'и ещё', cache_control: { type: 'ephemeral' } }]);
  assert.strictEqual(sent[0].body.tools[0].name, 'propose_items');
  assert.strictEqual(sent[0].body.messages.length, 3);
});

test('сервер: ключ посредника — свой адрес и Bearer-токен', async () => {
  const msg = { messages: [{ role: 'user', content: 'привет' }] };
  const { status, sent } = await callAssistant(msg, { env: { ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: 'tok', ANTHROPIC_BASE_URL: 'https://proxy.example/v1/' } });
  assert.strictEqual(status, 200);
  assert.strictEqual(sent[0].url, 'https://proxy.example/v1/messages');
  assert.strictEqual(sent[0].headers.authorization, 'Bearer tok');
  assert.strictEqual(sent[0].headers['x-api-key'], undefined);
  const direct = await callAssistant(msg);
  assert.strictEqual(direct.sent[0].headers['x-api-key'], 'k');
});

test('сервер: ошибка посредника — в сообщении код, адрес и текст ответа', async () => {
  const msg = { messages: [{ role: 'user', content: 'привет' }] };
  const env = { ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: 'tok', ANTHROPIC_BASE_URL: 'https://proxy.example/api' };
  const html = await callAssistant(msg, { env, status: 502, raw: '<html><h1>502 Bad Gateway</h1> nginx</html>' });
  assert.strictEqual(html.status, 502);
  assert.match(html.data.error, /proxy\.example ответил 502: 502 Bad Gateway nginx/);
  const js = await callAssistant(msg, { env, status: 400, raw: JSON.stringify({ error: { message: 'model not found' } }) });
  assert.match(js.data.error, /ответил 400: model not found/);
});

test('сервер: пробелы, переносы и кавычки вокруг значений из панели не мешают', async () => {
  const msg = { messages: [{ role: 'user', content: 'привет' }] };
  const { sent } = await callAssistant(msg, { env: { ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: ' tok\n', ANTHROPIC_BASE_URL: '"https://proxy.example/api" ', ANTHROPIC_MODEL: ' "claude-sonnet-5"\n' } });
  assert.strictEqual(sent[0].url, 'https://proxy.example/api/v1/messages');
  assert.strictEqual(sent[0].headers.authorization, 'Bearer tok');
  assert.strictEqual(sent[0].body.model, 'claude-sonnet-5');
});

// Калькулятор: квадратная комната 4×3 м, высота 2,7 м
function setupCalc() {
  const c = loadCalc(['calc-measure.js', 'calc-ruler.js', 'calc-molding.js', 'calc-tile.js', 'calc-mask.js', 'calc-rooms.js', 'calc-paid.js', 'calc-aichats.js', 'calc-assistant.js']);
  vm.runInContext(`
    var DEFAULT_UNITS = ['м²', 'пог. м', 'шт.', 'компл.', 'час', 'усл.'];
    var invoiceCart = [];
    var renderInvoice = function () {}, scheduleDraftSave = function () {}, renderAssistant = function () {};
    var room = { id: 'r1', measure: Object.assign(newMeasure(), { room: 'Спальня', shape: 'rect', height: '2,7', walls: ['4', '3', '4', '3'] }) };
    var cloudData = { services: [{ name: 'Стены', isCategory: true }, { name: 'Покраска стен', price: 300, unit: 'м²' }, { name: 'Розетка', price: 250, unit: 'шт.' }],
      objects: [{ id: 'o1', name: 'Дом', rooms: [room] }] };
    calcObject = function () { return cloudData.objects[0]; };
  `, c);
  return code => vm.runInContext(code, c);
}

test('калькулятор: объём по поверхности считает замер, цена — из прайса', () => {
  const run = setupCalc();
  const walls = run('roomSurfaces(room).walls.value');
  assert.ok(Math.abs(walls - 37.8) < 0.001, `стены ${walls}`);
  const items = run(`assistantPrepareItems([
    { service_index: 1, surface: 'walls', room_ids: ['r1'], qty: 999 },
    { service_index: 2, qty: 3, unit: 'шт.' },
    { service_index: 0, qty: 1 },
    { service_index: 9, qty: 1 },
    { service_index: 1, surface: 'walls', room_ids: ['нет'] },
  ])`);
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].qty, 37.8);
  assert.strictEqual(items[0].price, 300);
  assert.strictEqual(items[0].where, 'Спальня');
  assert.strictEqual(items[1].qty, 3);
  assert.strictEqual(items[1].price, 250);
});

test('калькулятор: «Добавить отмеченное» кладёт в счёт с разбивкой по помещениям', () => {
  const run = setupCalc();
  run(`assistantChat = [{ role: 'assistant', content: '', items: assistantPrepareItems([
    { service_index: 1, surface: 'walls', room_ids: ['r1'] }, { service_index: 2, qty: 2, unit: 'шт.' }]) }];
    assistantChat[0].items[1].checked = false;
    addAssistantItems(0);`);
  assert.strictEqual(run('invoiceCart.length'), 1);
  assert.strictEqual(run('invoiceCart[0].qty'), 37.8);
  assert.strictEqual(run('invoiceCart[0].surface'), 'walls');
  assert.strictEqual(run('invoiceCart[0].rooms[0].name'), 'Спальня');
  run('addAssistantItems(0)'); // повторно уже добавленное не дублируется
  assert.strictEqual(run('invoiceCart.length'), 1);
});

test('калькулятор: ответ без звёздочек, решёток и служебных номеров услуг', () => {
  const run = setupCalc();
  const html = run(`assistantTextHtml('**Нанесение Замши (i=25)** — 1000 ₽\\n## Итог\\n2*3 = 6')`);
  assert.strictEqual(html, '<b>Нанесение Замши</b> — 1000 ₽\nИтог\n2*3 = 6');
});

// Поток: сервис отвечает SSE, мастеру уходят строки JSON
function sse(events) {
  return events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

async function callStream(responses, env = {}) {
  const worker = (await import('../worker.js')).default;
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sent.push(JSON.parse(opts.body));
    const r = responses[Math.min(sent.length - 1, responses.length - 1)];
    return new Response(r.body, { status: r.status || 200, headers: { 'content-type': r.type || 'text/event-stream' } });
  };
  try {
    const req = new Request('https://x/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token({ login: 'ivan', role: 'master' })) },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'покрась' }], context: {}, stream: true }),
    });
    const res = await worker.fetch(req, { SESSION_SECRET: SECRET, ANTHROPIC_API_KEY: 'k', STORAGE: fakeStorage(ivanWithAccess()), ...env });
    const text = await res.text();
    return { status: res.status, type: res.headers.get('content-type'), text, sent };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const STREAM = sse([
  { type: 'message_start', message: { model: 'anthropic/claude-sonnet-5-5' } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Смотрю замеры' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Предлагаю ' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'покраску.' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', name: 'propose_items', input: {} } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"items":[{"service_index":3,' } },
  { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '"surface":"walls","room_ids":["r1"]}]}' } },
  { type: 'content_block_stop', index: 2 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
  { type: 'message_stop' },
]);

test('поток: размышления и текст по кусочкам, в конце — позиции', async () => {
  const { status, type, text, sent } = await callStream([{ body: STREAM }]);
  assert.strictEqual(status, 200);
  assert.match(type, /ndjson/);
  const lines = text.trim().split('\n').map(l => JSON.parse(l));
  assert.deepStrictEqual(lines.slice(0, 4), [
    { t: 'thinking', d: 'Смотрю замеры' }, { t: 'text', d: 'Предлагаю ' }, { t: 'text', d: 'покраску.' }, { t: 'tool' },
  ]);
  const done = lines[4];
  assert.strictEqual(done.t, 'done');
  assert.strictEqual(done.text, 'Предлагаю покраску.');
  assert.deepStrictEqual(done.items[0].room_ids, ['r1']);
  assert.strictEqual(done.model, 'anthropic/claude-sonnet-5-5');
  assert.strictEqual(sent[0].stream, true);
  assert.deepStrictEqual(sent[0].thinking, { type: 'adaptive', display: 'summarized' });
});

test('поток: посредник не принял размышления (400) — повтор без них', async () => {
  const { text, sent } = await callStream([
    { status: 400, type: 'application/json', body: JSON.stringify({ error: { message: 'thinking not supported' } }) },
    { body: STREAM },
  ]);
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(sent[1].thinking, undefined);
  assert.match(text, /"t":"done"/);
});

test('поток: посредник не принял и метки кеша (400, 400) — третий раз без них', async () => {
  const bad = { status: 400, type: 'application/json', body: JSON.stringify({ error: { message: 'unknown field cache_control' } }) };
  const { text, sent } = await callStream([bad, bad, { body: STREAM }]);
  assert.strictEqual(sent.length, 3);
  assert.ok(sent[1].system[0].cache_control);
  assert.ok(!JSON.stringify(sent[2]).includes('cache_control'));
  assert.match(text, /"t":"done"/);
});

test('поток: ошибка сервиса посреди ответа и ответ без потока', async () => {
  const broken = sse([
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Нач' } },
    { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
  ]);
  const a = await callStream([{ body: broken }]);
  const last = JSON.parse(a.text.trim().split('\n').pop());
  assert.strictEqual(last.t, 'error');
  assert.match(last.error, /Overloaded/);
  const b = await callStream([{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'целиком' }] }) }]);
  const { cost: _c, ...whole } = JSON.parse(b.text);
  assert.deepStrictEqual(whole, { text: 'целиком', items: [], model: 'claude-sonnet-5-5' });
  const c = await callStream([{ status: 502, type: 'text/plain', body: 'error code: 502' }]);
  assert.strictEqual(c.status, 502);
  assert.match(JSON.parse(c.text).error, /ответил 502/);
});

// Распознавание плана: поток, уточнение мастера, понятная ошибка
async function callPlan(body, responses, env = {}) {
  const worker = (await import('../worker.js')).default;
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sent.push(JSON.parse(opts.body));
    const r = responses[Math.min(sent.length - 1, responses.length - 1)];
    return new Response(r.body, { status: r.status || 200, headers: { 'content-type': r.type || 'text/event-stream' } });
  };
  try {
    const req = new Request('https://x/recognize-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token({ login: 'ivan', role: 'master' })) },
      body: JSON.stringify({ image: 'AAAA', mediaType: 'image/png', ...body }),
    });
    const res = await worker.fetch(req, { SESSION_SECRET: SECRET, ANTHROPIC_API_KEY: 'k', STORAGE: fakeStorage(ivanWithAccess()), ...env });
    return { status: res.status, text: await res.text(), sent };
  } finally {
    globalThis.fetch = realFetch;
  }
}

const PLAN_JSON = '{"rooms":[{"name":"Кухня","height_m":2.7,"walls":[{"length_m":3,"turn_after":"R"},{"length_m":2,"turn_after":"R"},{"length_m":3,"turn_after":"R"},{"length_m":2,"turn_after":"R"}],"openings":[]}],"warnings":[]}';

test('план: поток с размышлениями, уточнение уходит вместе с прошлым ответом', async () => {
  const stream = sse([
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Вижу кухню' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: PLAN_JSON.slice(0, 40) } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: PLAN_JSON.slice(40) } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
  ]);
  const { text, sent } = await callPlan({ stream: true, turns: [{ note: 'в мм', answer: '{"questions":["единицы?"]}' }, { note: 'высота 2,7', answer: '{"rooms":[]}' }] }, [{ body: stream }]);
  const lines = text.trim().split('\n').map(l => JSON.parse(l));
  assert.deepStrictEqual(lines[0], { t: 'thinking', d: 'Вижу кухню' });
  const done = lines.pop();
  assert.strictEqual(done.t, 'done');
  assert.strictEqual(done.rooms[0].name, 'Кухня');
  assert.strictEqual(done.rooms[0].walls.length, 4);
  const msgs = sent[0].messages;
  assert.strictEqual(msgs.length, 5);
  assert.strictEqual(msgs[0].content[0].source.media_type, 'image/png');
  assert.strictEqual(msgs[1].content, '{"questions":["единицы?"]}');
  assert.match(msgs[2].content[0].text, /в мм/);
  assert.strictEqual(msgs[3].content, '{"rooms":[]}');
  assert.match(msgs[4].content[0].text, /высота 2,7/);
  assert.ok(msgs[4].content[0].cache_control);
  assert.ok(msgs[0].content[1].cache_control); // картинка и инструкция — из кеша при уточнениях
  const first = await callPlan({ turns: [{ note: 'это одна комната' }] }, [{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: PLAN_JSON }] }) }]);
  assert.strictEqual(first.sent[0].messages.length, 1);
  assert.match(first.sent[0].messages[0].content[2].text, /одна комната/);
});

test('план: нейросеть ответила словами — в ошибке видно, что она написала', async () => {
  const { status, text } = await callPlan({}, [{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'Не вижу размеров на картинке.' }], stop_reason: 'end_turn' }) }]);
  assert.strictEqual(status, 502);
  assert.match(JSON.parse(text).error, /ответила не планом: «Не вижу размеров на картинке\.»/);
  const empty = await callPlan({}, [{ type: 'application/json', body: JSON.stringify({ content: [], stop_reason: 'refusal' }) }]);
  assert.match(JSON.parse(empty.text).error, /пустой ответ \(нет блоков, refusal\)/);
});

test('план: нейросеть может сначала задать вопросы', async () => {
  const { status, text } = await callPlan({}, [{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: '{"questions":["Размеры в мм или см?"]}' }] }) }]);
  assert.strictEqual(status, 200);
  const { cost: _c, ...asked } = JSON.parse(text);
  assert.deepStrictEqual(asked, { rooms: [], warnings: [], questions: ['Размеры в мм или см?'], model: 'claude-sonnet-5-5' });
  const both = await callPlan({}, [{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: PLAN_JSON.replace('"warnings":[]', '"warnings":[],"questions":["лишний"]') }] }) }]);
  assert.strictEqual(JSON.parse(both.text).questions, undefined);
});

test('план: вопросы и план внутри вызова инструмента тоже понимаем', async () => {
  const ask = await callPlan({}, [{ type: 'application/json', body: JSON.stringify({ content: [
    { type: 'tool_use', name: 'AskUserQuestion', input: { questions: [{ question: 'Размеры в мм?', options: [] }] } },
    { type: 'tool_use', name: 'Other', input: { foo: 1 } } ] }) }]);
  assert.deepStrictEqual(JSON.parse(ask.text).questions, ['Размеры в мм?']);
  const plan = await callPlan({}, [{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'tool_use', name: 'x', input: JSON.parse(PLAN_JSON) }] }) }]);
  assert.strictEqual(JSON.parse(plan.text).rooms[0].name, 'Кухня');
  const odd = await callPlan({}, [{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'tool_use', name: 'view_image', input: { path: 'a' } }] }) }]);
  assert.match(JSON.parse(odd.text).error, /вызов view_image \{"path":"a"\}/);
});

test('план: PDF уходит документом', async () => {
  const { sent } = await callPlan({ mediaType: 'application/pdf' }, [{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: PLAN_JSON }] }) }]);
  assert.deepStrictEqual(sent[0].messages[0].content[0], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'AAAA' } });
});

test('план: своя модель из ANTHROPIC_PLAN_MODEL', async () => {
  const worker = (await import('../worker.js')).default;
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ content: [{ type: 'text', text: PLAN_JSON }] }), { headers: { 'content-type': 'application/json' } }); };
  try {
    const req = new Request('https://x/recognize-plan', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token({ login: 'ivan', role: 'master' })) }, body: JSON.stringify({ image: 'AAAA' }) });
    await worker.fetch(req, { SESSION_SECRET: SECRET, ANTHROPIC_API_KEY: 'k', STORAGE: fakeStorage(ivanWithAccess()), ANTHROPIC_MODEL: 'claude-sonnet-5', ANTHROPIC_PLAN_MODEL: ' claude-opus-4-8 ' });
    assert.strictEqual(sent[0].model, 'claude-opus-4-8');
  } finally { globalThis.fetch = realFetch; }
});

test('план: правила мастера уходят нейросети, без правил — ничего лишнего', async () => {
  const ok = [{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: PLAN_JSON }] }) }];
  const withHints = await callPlan({ hints: 'Размеры всегда в мм\nКороба — отдельными стенами' }, ok);
  const text = withHints.sent[0].messages[0].content[1].text;
  assert.match(text, /<rules>\nРазмеры всегда в мм\nКороба — отдельными стенами\n<\/rules>/);
  const plain = await callPlan({}, ok);
  assert.ok(!plain.sent[0].messages[0].content[1].text.includes('<rules>'));
  const long = await callPlan({ hints: 'х'.repeat(5000) }, ok);
  assert.ok(long.sent[0].messages[0].content[1].text.length < withHints.sent[0].messages[0].content[1].text.length + 3100);
});

// Платные функции: доступ по времени, лимит токенов, запрос доступа, админ включает
async function call(path, { method = 'POST', body, login = 'ivan', role = 'master', storage, reply }) {
  const worker = (await import('../worker.js')).default;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(reply || { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1200, output_tokens: 300 } }), { status: 200 });
  try {
    const req = new Request('https://x' + path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (await token({ login, role })) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const res = await worker.fetch(req, { SESSION_SECRET: SECRET, ANTHROPIC_API_KEY: 'k', STORAGE: storage });
    return { status: res.status, data: await res.json() };
  } finally {
    globalThis.fetch = realFetch;
  }
}
const ask = { messages: [{ role: 'user', content: 'привет' }] };
const user = (st, login) => st.map.get('users').find(u => u.login === login);

test('баланс: без денег — 402, админу — можно', async () => {
  const st = fakeStorage([{ login: 'admin', role: 'admin' }, { login: 'ivan', role: 'master' }, { login: 'petr', role: 'master', aiBalance: -5 }]);
  const a = await call('/assistant', { body: ask, storage: st });
  assert.strictEqual(a.status, 402);
  assert.ok(a.data.noAccess);
  assert.strictEqual((await call('/recognize-plan', { body: { image: 'AAAA' }, storage: st })).status, 402);
  assert.strictEqual((await call('/assistant', { body: ask, storage: st, login: 'petr' })).status, 402);
  assert.strictEqual((await call('/assistant', { body: ask, storage: st, login: 'admin', role: 'admin' })).status, 200);
  // У админа расход считается, баланс не трогается
  const adm = user(st, 'admin');
  assert.strictEqual(adm.aiUse.assistant.req, 1);
  assert.strictEqual(adm.aiBalance, undefined);
});

test('баланс: каждый запрос списывает стоимость токенов по ценам из настроек', async () => {
  // 1200 токенов на вход × 500 ₽/млн = 0,60 ₽; 300 на выход × 2500 ₽/млн = 0,75 ₽ → 1,35 ₽
  const st = fakeStorage([{ login: 'admin', role: 'admin' }, { login: 'ivan', role: 'master', aiBalance: 200 }]);
  const first = await call('/assistant', { body: ask, storage: st });
  assert.strictEqual(first.status, 200);
  assert.deepStrictEqual(first.data.cost, { sent: 0.6, reply: 0.75, total: 1.35, balance: 0.65 });
  const u = user(st, 'ivan');
  assert.strictEqual(u.aiBalance, 200 - 135);
  assert.deepStrictEqual(u.aiUse.assistant, { req: 1, in: 1200, out: 300, kop: 135 });
  // Стоимость приходит вместе с ответом: отправлено, ответ, всего, остаток
  assert.strictEqual(u.aiUse.month, new Date().toISOString().slice(0, 7));
  // Хватило ещё на один (баланс уходит в минус), дальше — нет
  assert.strictEqual((await call('/assistant', { body: ask, storage: st })).status, 200);
  assert.strictEqual(u.aiBalance, 200 - 270);
  assert.strictEqual((await call('/assistant', { body: ask, storage: st })).status, 402);
  // Свои цены админа (с наценкой)
  user(st, 'admin').aiSettings = { prices: { in: 1000, out: 5000 } };
  u.aiBalance = 1000;
  await call('/assistant', { body: ask, storage: st });
  assert.strictEqual(u.aiBalance, 1000 - 270);
});

test('кеш: повтор из кеша — 10% цены отправки, запись — 125%; длинный чат — окно блоками', async () => {
  // 1000 обычных + 2000 запись в кеш + 10000 из кеша; 100 на выход:
  // (1000 + 2000×1,25 + 10000×0,1) × 500 / 1e6 = 2,25 ₽; 100 × 2500 / 1e6 = 0,25 ₽
  const st = fakeStorage([{ login: 'admin', role: 'admin' }, { login: 'ivan', role: 'master', aiBalance: 1000 }]);
  const reply = { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 10000, output_tokens: 100 } };
  const r = await call('/assistant', { body: ask, storage: st, reply });
  assert.deepStrictEqual(r.data.cost, { sent: 2.25, reply: 0.25, total: 2.5, balance: 7.5 });
  assert.strictEqual(user(st, 'ivan').aiUse.assistant.in, 13000);
  // Окно переписки: до 20 реплик — всё; дальше начало сдвигается по 10
  const chat = (n) => ({ messages: Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'м' + i })) });
  const firstSent = async (n) => { const { sent } = await callAssistant(chat(n)); return sent[0].body.messages[0].content; };
  assert.strictEqual(await firstSent(19), 'м0');
  assert.strictEqual(await firstSent(23), 'м10');
  assert.strictEqual(await firstSent(29), 'м10');
  assert.strictEqual(await firstSent(31), 'м20');
});

test('баланс: мастер просит пополнить, админ видит и пополняет', async () => {
  const st = fakeStorage([{ login: 'admin', role: 'admin' }, { login: 'ivan', role: 'master' }]);
  const r = await call('/ai-access-request', { body: {}, storage: st });
  assert.strictEqual(r.status, 200);
  assert.ok(r.data.ai.requestedAt > 0);
  assert.strictEqual((await call('/ai-access', { method: 'GET', storage: st })).status, 403);
  const admin = { storage: st, login: 'admin', role: 'admin' };
  const list = await call('/ai-access', { method: 'GET', ...admin });
  assert.strictEqual(list.data.users.length, 1);
  assert.ok(list.data.users[0].ai.requestedAt > 0);
  assert.deepStrictEqual(list.data.settings.prices, { in: 500, out: 2500 });
  const put = await call('/ai-access', { method: 'PUT', body: { login: 'ivan', add: 500 }, ...admin });
  assert.strictEqual(put.data.users[0].ai.balance, 500);
  assert.strictEqual(put.data.users[0].ai.requestedAt, 0);
  assert.strictEqual(put.data.users[0].ai.pays[0].amount, 500);
  const fix = await call('/ai-access', { method: 'PUT', body: { login: 'ivan', add: -120.5 }, ...admin });
  assert.strictEqual(fix.data.users[0].ai.balance, 379.5);
  assert.strictEqual((await call('/ai-access', { method: 'PUT', body: { login: 'ivan', add: 'abc' }, ...admin })).status, 400);
  const set = await call('/ai-access', { method: 'PUT', body: { settings: { offer: 'Перевод на карту', prices: { in: 700, out: 3000 }, effort: { plan: 'medium', assistant: 'бред' } } }, ...admin });
  assert.deepStrictEqual(set.data.settings, { offer: 'Перевод на карту', prices: { in: 700, out: 3000 }, effort: { plan: 'medium', assistant: 'high' } });
  // С деньгами на балансе — можно
  assert.strictEqual((await call('/assistant', { body: ask, storage: st })).status, 200);
});

test('план: уточнение к готовому плану — только изменения, сайт подставляет их в план', async () => {
  const patch = { partial: true, rooms: [{ name: 'Кухня', height_m: 2.7, walls: [{ length_m: 3, turn_after: 'R' }, { length_m: 2.5, turn_after: 'R' }, { length_m: 3, turn_after: 'R' }, { length_m: 2.5, turn_after: 'R' }] }], removed: ['Кладовка'], warnings: [] };
  const { text, sent } = await callPlan({ turns: [{ note: 'кухня 3 на 2,5', answer: PLAN_JSON }] }, [{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(patch) }] }) }]);
  assert.match(sent[0].messages[2].content[0].text, /только изменённые и новые помещения/);
  const data = JSON.parse(text);
  assert.strictEqual(data.partial, true);
  assert.deepStrictEqual(data.removed, ['Кладовка']);
  assert.strictEqual(data.rooms[0].walls[1].length_m, 2.5);
  // Ответ с вопросами (плана ещё нет) — уточнение просит весь план
  const q = await callPlan({ turns: [{ note: 'в мм', answer: '{"questions":["единицы?"]}' }] }, [{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: PLAN_JSON }] }) }]);
  assert.match(q.sent[0].messages[2].content[0].text, /весь план целиком/);

  const c = loadCalc(['calc-measure.js', 'calc-ruler.js', 'calc-molding.js', 'calc-tile.js', 'calc-mask.js', 'calc-import.js']);
  const merged = vm.runInContext(`aiMergePlan(
    { rooms: [{ name: 'Гостиная', walls: [1] }, { name: 'Кухня', walls: [2] }, { name: 'Кладовка', walls: [3] }], warnings: ['старое'] },
    { partial: true, rooms: [{ name: 'Кухня', walls: [9] }, { name: 'Балкон', walls: [4] }], removed: ['Кладовка'], warnings: [] })`, c.ctx || c);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(merged.rooms)), [{ name: 'Гостиная', walls: [1] }, { name: 'Кухня', walls: [9] }, { name: 'Балкон', walls: [4] }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(merged.patch)), { changed: ['Кухня'], added: ['Балкон'], removed: ['Кладовка'] });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(merged.warnings)), ['старое']);
});

test('план: стены коротко [длина, поворот, угол]; оборванный ответ — понятная ошибка', async () => {
  const compact = '{"rooms":[{"name":"Кухня","height_m":2.7,"walls":[[3,"R"],[2,"R"],[3,"L",135],[2,"R"]]}],"warnings":[]}';
  const ok = await callPlan({}, [{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: compact }] }) }]);
  const w = JSON.parse(ok.text).rooms[0].walls;
  assert.deepStrictEqual(w[2], { length_m: 3, turn_after: 'L', angle_deg: 135 });
  assert.deepStrictEqual(w[0], { length_m: 3, turn_after: 'R', angle_deg: null });
  assert.ok(ok.sent[0].max_tokens >= 24000);
  const cut = await callPlan({}, [{ type: 'application/json', body: JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'text', text: compact.slice(0, 60) + '}' }] }) }]);
  assert.match(JSON.parse(cut.text).error, /не поместился в лимит длины/);
  const broken = await callPlan({}, [{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: '{"rooms":[{"name":"К"' + '}' }] }) }]);
  assert.match(JSON.parse(broken.text).error, /неполный ответ/);
  // Все токены ушли на размышления, план не начат
  const thought = await callPlan({}, [{ type: 'application/json', body: JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '…' }] }) }]);
  assert.match(JSON.parse(thought.text).error, /не уложилась в лимит длины/);
});

test('план: выделенная часть PDF — картинка и текст размеров из этой части', async () => {
  const ok = [{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: PLAN_JSON }] }) }];
  const { sent } = await callPlan({ pageText: 'Кухня 3200 2450 S=7,8' }, ok);
  assert.match(sent[0].messages[0].content[1].text, /<pdf_text>\nКухня 3200 2450 S=7,8\n<\/pdf_text>/);
  const plain = await callPlan({}, ok);
  assert.ok(!plain.sent[0].messages[0].content[1].text.includes('<pdf_text>'));
});

test('план: дополнительный файл (перегородки) уходит картинкой вместе с уточнением', async () => {
  const ok = [{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: PLAN_JSON }] }) }];
  const { sent } = await callPlan({ turns: [{ note: 'добавь перегородки', answer: PLAN_JSON, image: 'BBBB', mediaType: 'image/png', pageText: 'Перегородка 1200' }] }, ok);
  const u = sent[0].messages[2].content;
  assert.deepStrictEqual(u[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BBBB' } });
  assert.match(u[1].text, /дополнительный чертёж[\s\S]*Перегородка 1200[\s\S]*добавь перегородки[\s\S]*только изменённые/);
  // Не больше трёх файлов — берутся последние
  const many = Array.from({ length: 5 }, (_, i) => ({ note: 'н' + i, answer: PLAN_JSON, image: 'I' + i }));
  const r = await callPlan({ turns: many }, ok);
  const imgs = r.sent[0].messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(b => b.type === 'image').map(b => b.source.data) : []);
  assert.deepStrictEqual(imgs, ['AAAA', 'I2', 'I3', 'I4']);
});

test('уровень размышлений: уходит нейросети, неизвестный — не уходит; посредник не знает — третий раз без него', async () => {
  const ok = [{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: PLAN_JSON }] }) }];
  const a = await callPlan({ effort: 'medium' }, ok);
  assert.deepStrictEqual(a.sent[0].output_config, { effort: 'medium' });
  const b = await callPlan({ effort: 'max!' }, ok);
  assert.strictEqual(b.sent[0].output_config, undefined);
  const { sent } = await callAssistant({ messages: [{ role: 'user', content: 'привет' }], effort: 'low' });
  assert.deepStrictEqual(sent[0].body.output_config, { effort: 'low' });
  const bad = { status: 400, type: 'application/json', body: JSON.stringify({ error: { message: 'unknown field output_config' } }) };
  const st = await callPlan({ stream: true, effort: 'low' }, [bad, bad, { type: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: PLAN_JSON }] }) }]);
  assert.strictEqual(st.sent.length, 3);
  assert.deepStrictEqual(st.sent[1].output_config, { effort: 'low' });
  assert.strictEqual(st.sent[2].output_config, undefined);
});

test('план квартиры: углы от нейросети → замер комнаты и её место; та же комната на том же месте', async () => {
  // сервер: углы в мм принимаются, проёмы в мм → метры
  const plan = '{"rooms":[{"name":"Кухня","height_mm":2700,"pts":[[100,200],[3300,200],[3300,2650],[100,2650]],"openings":[{"type":"window","wall":0,"offset_mm":800,"width_mm":1400,"height_mm":1500}]}],"warnings":[]}';
  const r = await callPlan({}, [{ type: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: plan }] }) }]);
  const room = JSON.parse(r.text).rooms[0];
  assert.deepStrictEqual(room.pts, [[100, 200], [3300, 200], [3300, 2650], [100, 2650]]);
  assert.deepStrictEqual(room.openings[0], { type: 'window', wall_index: 0, width_m: 1.4, height_m: 1.5, door_width_m: null, door_height_m: null, offset_m: 0.8 });
  assert.strictEqual(room.height_m, 2.7);

  const c = loadCalc(['calc-measure.js', 'calc-ruler.js', 'calc-molding.js', 'calc-tile.js', 'calc-mask.js', 'calc-flat.js']);
  const run = (code) => JSON.parse(JSON.stringify(vm.runInContext(code, c.ctx || c)));
  // Комната с коробом и скошенным углом, углы против часовой и не с верхнего левого угла
  const cw = [[5000, 1000], [5000, 4000], [2000, 4000], [1000, 3000], [1000, 1000], [2000, 1000], [2000, 1300], [2600, 1300], [2600, 1000]];
  const pts = cw.slice().reverse(); // против часовой
  const out = run(`(() => {
    const { measure: m, plan } = flatPtsToMeasure({ name: 'Гостиная', height_m: 2.7, pts: ${JSON.stringify(pts)},
      openings: [{ type: 'door', wall_index: 6, offset_m: 0.5, width_m: 0.9 }] }, 'o');
    const g = rulerGeometry(m);
    const abs = flatRoomPoints(m, plan).pts.map(p => p.map(v => Math.round(v * 1000)));
    return { closed: g.closed, walls: m.walls, turns: m.turns, angles: m.angles, plan, abs, door: m.openings[0] };
  })()`);
  assert.strictEqual(out.closed, true);
  assert.deepStrictEqual(out.plan, { x: 1, y: 1 }); // верхний левый угол
  // те же углы, что и на входе (в другом порядке обхода)
  const key = (a) => a.map(p => p.join(',')).sort();
  assert.deepStrictEqual(key(out.abs), key(pts));
  assert.strictEqual(out.walls.length, 9);
  assert.strictEqual(out.turns.filter(t => t === 'L').length, 2); // короб внутрь: два поворота налево
  assert.ok(out.angles.includes('135')); // скошенный угол
  // дверь на стороне (2000,4000)→(5000,4000) в 0,5 м от левого конца; после разворота обхода сторона
  // идёт справа налево — отступ от её начала 3 − 0,5 − 0,9
  assert.strictEqual(out.door.type, 'door');
  const doorWall = out.door.wall;
  const wallLen = Number(String(out.walls[doorWall]).replace(',', '.'));
  assert.strictEqual(wallLen, 3);
  assert.strictEqual(out.door.off, '1,6'); // 3 − 0,5 − 0,9
});

test('план квартиры: правка углов на плане → замер комнаты пересчитан, проёмы на месте', async () => {
  const c = loadCalc(['calc-measure.js', 'calc-ruler.js', 'calc-molding.js', 'calc-tile.js', 'calc-mask.js', 'calc-flat.js']);
  const out = JSON.parse(JSON.stringify(vm.runInContext(`(() => {
    const conv = flatPtsToMeasure({ name: 'Кухня', height_m: 2.7, pts: [[5120, 0], [8120, 0], [8120, 2900], [5120, 2900]],
      openings: [{ type: 'window', wall_index: 0, offset_m: 2, width_m: 0.9 }] }, 'o');
    const room = { id: 'r', measure: conv.measure, plan: conv.plan };
    // стену вниз до 4 м, верхнюю — короче до 2,5 м (окно в 2 м от начала шириной 0,9 — подвинется)
    flatApplyPolygon(room, [[5.12, 0], [7.62, 0], [7.62, 4], [5.12, 4]]);
    const g = rulerGeometry(room.measure);
    return { walls: room.measure.walls, closed: g.closed, plan: room.plan, win: room.measure.openings[0], abs: flatRoomPoints(room.measure, room.plan).pts };
  })()`, c.ctx || c)));
  assert.deepStrictEqual(out.walls, ['2,5', '4', '2,5', '4']);
  assert.strictEqual(out.closed, true);
  assert.deepStrictEqual(out.plan, { x: 5.12, y: 0 });
  assert.strictEqual(out.win.wall, 0);
  assert.strictEqual(out.win.off, '1,6'); // 2 + 0,9 > 2,5 → не дальше конца стены
  assert.deepStrictEqual(out.abs.map(p => p.map(v => Math.round(v * 1000))), [[5120, 0], [7620, 0], [7620, 4000], [5120, 4000]]);
});
