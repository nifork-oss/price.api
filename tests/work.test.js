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

test('строка работы: название, количество, единица, время; цена и единица — из прайса', () => {
  const run = setup();
  assert.deepStrictEqual(run('workParseLine("Шпаклёвка стен 12 м² 1:30")'), { name: 'Шпаклёвка стен', qty: '12', unit: 'м²', price: 500, sum: '', min: 90 });
  assert.deepStrictEqual(run('workParseLine("- Монтаж молдингов, 26,2 пм 2 ч")'), { name: 'Монтаж молдингов', qty: '26.2', unit: 'пог. м', price: 500, sum: '', min: 120 });
  assert.deepStrictEqual(run('workParseLine("Монтаж молдингов 8")'), { name: 'Монтаж молдингов', qty: '8', unit: 'пог. м', price: 500, sum: '', min: 0 });
  assert.deepStrictEqual(run('workParseLine("Уборка 40 мин")'), { name: 'Уборка', qty: '', unit: 'м²', price: '', sum: '', min: 40 });
  assert.strictEqual(run('workParseLine("Стены 5 м").unit'), 'м');
  assert.strictEqual(run('workParseLine("   ")'), null);
});

test('список: общее время делится по суммам между работами без своего времени', () => {
  const run = setup();
  const recs = run(`workDraftRecords({ date: "2026-11-26", min: 300, rows: [
    { name: "Шпаклёвка стен", qty: "20", unit: "м²", price: 500, sum: "", min: 0 },
    { name: "Монтаж молдингов", qty: "10", unit: "пог. м", price: 500, sum: "", min: 0 },
    { name: "Уборка", qty: "", unit: "усл.", price: "", sum: "1000", min: 45 },
    { name: "  ", qty: "1", unit: "м²", price: "", sum: "", min: 0 }] }, 1000)`);
  assert.strictEqual(recs.length, 3);
  assert.deepStrictEqual(recs.map(w => [w.date, w.min, !!w.shared, w.sum]), [['2026-11-26', 200, true, ''], ['2026-11-26', 100, true, ''], ['2026-11-26', 45, false, 1000]]);
  // без сумм — поровну, остаток минут — последней
  assert.deepStrictEqual(run('workShareTime([{ min: 0 }, { min: 0 }, { min: 0 }], 100).map(r => r.min)'), [33, 33, 34]);
});

test('виджет таймера: идущие таймеры и порядок объектов — недавние сверху, без архива', () => {
  const run = setup();
  const c = `cloudData.objects = [
    { id: "a", name: "А", works: [{ at: 100 }] },
    { id: "b", name: "Б", workTimer: { start: 500 } },
    { id: "c", name: "В", archived: 1, workTimer: { start: 900 } },
    { id: "d", name: "Г", works: [{ at: 300 }] }]`;
  assert.deepStrictEqual(run(`(${c}, workQuickObjects().map(o => o.id))`), ['b', 'd', 'a']);
  assert.deepStrictEqual(run('workRunning().map(o => o.id)'), ['b']);
});

test('работа по ходу таймера: отрезок от прошлой работы, своё время из строки — из отрезка', () => {
  const run = setup();
  const t0 = Date.UTC(2026, 10, 27, 6, 0);
  const recs = run(`workLapRecords({ start: ${t0}, last: ${t0 + 70 * 60000}, sid: 's1' }, "Шпаклёвка стен 10 м²\\nУборка 20 мин", ${t0 + 130 * 60000})`);
  assert.deepStrictEqual(recs.map(w => [w.name, w.min, w.sid, w.from, w.to]), [
    ['Шпаклёвка стен', 40, 's1', t0 + 70 * 60000, t0 + 130 * 60000],
    ['Уборка', 20, 's1', t0 + 70 * 60000, t0 + 130 * 60000]]);
  assert.deepStrictEqual(run('workLapRecords({ start: 1, sid: "s1" }, "  ", 100)'), []);
});

test('записи дня: работы смены — блоком с временем «с — до» и суммой', () => {
  const run = setup();
  const t0 = new Date(2026, 10, 27, 9, 0).getTime(), m = 60000;
  const html = run(`workDayRowsHtml({ id: "o1", workSessions: [{ id: "s1", from: ${t0}, to: ${t0 + 390 * m} }] }, [
    { id: "a", sid: "s1", at: 2, name: "Покраска стен", qty: 10, unit: "м²", price: 300, sum: "", min: 60, from: ${t0 + 70 * m}, to: ${t0 + 130 * m} },
    { id: "b", sid: "s1", at: 1, name: "Шпаклёвка стен", qty: 12, unit: "м²", price: 500, sum: "", min: 70, from: ${t0}, to: ${t0 + 70 * m} },
    { id: "c", at: 3, name: "Уборка", sum: 1000, min: 0 }])`);
  assert.match(html, /🕘 09:00–15:30 · 6 ч 30 мин · работ: 2<\/span><b>9[\s ]000 ₽/);
  assert.ok(html.indexOf('Шпаклёвка') < html.indexOf('Покраска'), 'внутри смены — по порядку');
  assert.match(html, /09:00–10:10 · 12 м² · 1 ч 10 мин/);
  assert.match(html, /Уборка/);
});

test('бригада: доход поровну, по процентам и сдельно', () => {
  const run = setup();
  const obj = mode => `({ id: "o1", workTeam: { mode: "${mode}", members: [{ id: "p1", name: "Саша", pct: 30 }, { id: "p2", name: "Миша", pct: 20 }] } })`;
  const w = '{ price: 500, qty: 12, sum: "" }', w2 = '{ price: 300, qty: 10, sum: "", who: "p1" }';
  assert.deepStrictEqual(run(`workShares(${obj('equal')}, ${w})`), { '': 2000, p1: 2000, p2: 2000 });
  assert.deepStrictEqual(run(`workShares(${obj('pct')}, ${w})`), { '': 3000, p1: 1800, p2: 1200 });
  assert.deepStrictEqual(run(`workShares(${obj('piece')}, ${w2})`), { p1: 3000 });
  assert.deepStrictEqual(run(`workShares({ id: "o1" }, ${w})`), { '': 6000 }, 'без бригады — всё мне');
  const rows = run(`(() => { const o = ${obj('piece')}; return workSharesTotal([${w}, ${w2}], () => o); })()`);
  assert.deepStrictEqual(rows.map(r => [r.name, r.sum]), [['Я', 6000], ['Саша', 3000]]);
  // работа по ходу записывается на того, кто сейчас делает
  const recs = run('workLapRecords({ start: 1, last: 1, sid: "s1", who: "p1" }, "Шпаклёвка стен 2 м²", 600000)');
  assert.strictEqual(recs[0].who, 'p1');
});
