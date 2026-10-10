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

async function callAssistant(body, { role = 'master', env = {}, reply } = {}) {
  const worker = (await import('../worker.js')).default;
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    sent.push({ url, body: JSON.parse(opts.body) });
    return new Response(JSON.stringify(reply || { content: [{ type: 'text', text: 'ok' }] }), { status: 200 });
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
  assert.strictEqual(sent[0].url, 'https://api.anthropic.com/v1/messages');
  assert.ok(sent[0].body.system.includes('"Покраска"'));
  assert.strictEqual(sent[0].body.tools[0].name, 'propose_items');
  assert.strictEqual(sent[0].body.messages.length, 3);
});

// Калькулятор: квадратная комната 4×3 м, высота 2,7 м
function setupCalc() {
  const c = loadCalc(['calc-measure.js', 'calc-ruler.js', 'calc-molding.js', 'calc-tile.js', 'calc-mask.js', 'calc-rooms.js', 'calc-assistant.js']);
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
