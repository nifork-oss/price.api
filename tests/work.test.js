// Учёт работ по объекту (calc-work.js): время, суммы, заработок в час, выработка, сравнение со сметой.
// Запуск из корня репозитория: node --test
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { loadCalc } = require('./load.js');

function setup() {
  const c = loadCalc(['calc-work.js']);
  vm.runInContext('var escapeHtml = s => String(s); var cloudData = { services: [{ name: "Шпаклёвка стен", price: 500 }, { name: "Монтаж молдингов", price: 500, unit: "пог. м" }], history: [] };', c);
  return code => JSON.parse(vm.runInContext('JSON.stringify(' + code + ')', c));
}

test('время: «1:30», «1,5», «45», «2ч 15м» → минуты', () => {
  const run = setup();
  assert.deepStrictEqual(run('["1:30", "1,5", "45", "2ч 15м", "3", "", "abc"].map(workParseTime)'), [90, 90, 45, 135, 180, 0, 0]);
});

test('сумма: цена × количество, вписанная вручную — важнее', () => {
  const run = setup();
  assert.strictEqual(run('workSum({ price: 500, qty: "12,5" })'), 6250);
  assert.strictEqual(run('workSum({ price: 500, qty: 10, sum: "4 000" })'), 4000);
});

test('статистика: заработок, время, в час — только по записям со временем, выработка по видам работ', () => {
  const run = setup();
  const st = run(`workStats([
    { name: "Шпаклёвка стен", unit: "м²", qty: 20, price: 500, min: 240 },
    { name: "Шпаклёвка стен", unit: "м²", qty: 10, price: 500, min: 120 },
    { name: "Монтаж молдингов", unit: "пог. м", qty: 12, price: 500, sum: 5000, min: 0 }])`);
  assert.strictEqual(st.total, 15000 + 5000);
  assert.strictEqual(st.min, 360);
  assert.strictEqual(st.perHour, 15000 / 6, 'запись без времени не завышает заработок в час');
  const sh = st.rows.find(r => r.name === 'Шпаклёвка стен');
  assert.strictEqual(sh.qty, 30);
  assert.strictEqual(sh.tQty / (sh.min / 60), 5, 'выработка: 5 м² в час');
});

test('период: сегодня, этот и прошлый месяц', () => {
  const run = setup();
  const [a, b] = run('workRange("prev")');
  assert.match(a, /^\d{4}-\d{2}-01$/);
  assert.ok(b < run('workRange("month")[0]'));
  assert.deepStrictEqual(run('workInPeriod([{ date: workDay() }, { date: "2000-01-01" }], "today").length'), 1);
});

test('сравнение со сметой: по счетам объекта, сделано и осталось', () => {
  const run = setup();
  const c = run(`(cloudData.history = [
      { objectId: "o1", docType: "invoice", items: [{ name: "Шпаклёвка стен", unit: "м²", qty: 40, price: 500 }, { name: "Монтаж молдингов", unit: "пог. м", qty: 24, price: 500 }] },
      { objectId: "o1", docType: "estimate", items: [{ name: "Другое", unit: "м²", qty: 1, price: 1 }] }],
    workCompare({ id: "o1", works: [{ name: "шпаклёвка стен", unit: "м²", qty: 10, price: 500 }, { name: "Монтаж молдингов", unit: "пог. м", qty: 24, price: 500 }] }))`);
  assert.strictEqual(c.kind, 'по счетам', 'есть счета — расчёты не берутся');
  assert.strictEqual(c.planSum, 40 * 500 + 24 * 500);
  assert.strictEqual(c.doneSum, 10 * 500 + 24 * 500);
  assert.deepStrictEqual(c.rows.map(r => [r.name, r.qty, r.done.qty]), [['Шпаклёвка стен', 40, 10], ['Монтаж молдингов', 24, 24]]);
});
