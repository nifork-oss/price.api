// Проверки «Помощника»: сервер (/assistant) и разбор предложений в калькуляторе.
// Запуск из корня репозитория: node --test
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { loadCalc } = require('./load.js');

const SECRET = 'test-secret';
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
    const res = await worker.fetch(req, { SESSION_SECRET: SECRET, ANTHROPIC_API_KEY: 'k', ...env });
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
  assert.ok(sent[0].body.system.includes('"Покраска"'));
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
  const c = loadCalc(['calc-measure.js', 'calc-ruler.js', 'calc-molding.js', 'calc-tile.js', 'calc-mask.js', 'calc-rooms.js', 'calc-aichats.js', 'calc-assistant.js']);
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
    const res = await worker.fetch(req, { SESSION_SECRET: SECRET, ANTHROPIC_API_KEY: 'k', ...env });
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
  assert.deepStrictEqual(JSON.parse(b.text), { text: 'целиком', items: [], model: 'claude-sonnet-5-5' });
  const c = await callStream([{ status: 502, type: 'text/plain', body: 'error code: 502' }]);
  assert.strictEqual(c.status, 502);
  assert.match(JSON.parse(c.text).error, /ответил 502/);
});

// Распознавание плана: поток, уточнение мастера, понятная ошибка
async function callPlan(body, responses) {
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
    const res = await worker.fetch(req, { SESSION_SECRET: SECRET, ANTHROPIC_API_KEY: 'k' });
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
  assert.match(msgs[2].content, /в мм/);
  assert.strictEqual(msgs[3].content, '{"rooms":[]}');
  assert.match(msgs[4].content, /высота 2,7/);
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
  assert.deepStrictEqual(JSON.parse(text), { rooms: [], warnings: [], questions: ['Размеры в мм или см?'], model: 'claude-sonnet-5-5' });
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
    await worker.fetch(req, { SESSION_SECRET: SECRET, ANTHROPIC_API_KEY: 'k', ANTHROPIC_MODEL: 'claude-sonnet-5', ANTHROPIC_PLAN_MODEL: ' claude-opus-4-8 ' });
    assert.strictEqual(sent[0].model, 'claude-opus-4-8');
  } finally { globalThis.fetch = realFetch; }
});
