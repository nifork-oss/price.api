// Проверки закупок по объекту: разбор строк, суммы, статистика «на материал потрачено», текст для отправки, правки.
// Запуск из корня репозитория: node --test
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { loadCalc } = require('./load.js');

function setup() {
  const c = loadCalc(['calc-purchases.js']);
  vm.runInContext(`
    var cloudData = { objects: [{ id: 'o1', name: 'Квартира на Ленина', address: 'ул. Ленина, 5' }] };
    var currentObjectId = 'o1', currentUser = 'master', __saves = 0, __renders = 0;
    function saveCloudData() { __saves++; }
    function renderObjectDetail() { __renders++; }
  `, c);
  return { c, run: (code) => vm.runInContext(code, c) };
}

test('строка «материал количество единица» разбирается; без количества — только название', () => {
  const { run } = setup();
  const p = (t) => JSON.parse(JSON.stringify(run(`parsePurchaseLine(${JSON.stringify(t)})`)));
  assert.deepStrictEqual(p('Грунтовка 10 л'), { name: 'Грунтовка', qty: '10', unit: 'л' });
  assert.deepStrictEqual(p('Саморезы 3.5x25 — 200 шт'), { name: 'Саморезы 3.5x25', qty: '200', unit: 'шт' });
  assert.deepStrictEqual(p('2. Профиль 27х28, 12'), { name: 'Профиль 27х28', qty: '12', unit: 'шт.' });
  assert.deepStrictEqual(p('- Шпаклёвка 2,5 кг'), { name: 'Шпаклёвка', qty: '2.5', unit: 'кг' });
  assert.deepStrictEqual(p('Малярный скотч'), { name: 'Малярный скотч', qty: '', unit: 'шт.' });
  assert.strictEqual(run(`parsePurchaseLine('   ')`), null);
});

test('итог закупки: сумма за весь закуп важнее суммы позиций; в статистику объекта идут только отмеченные', () => {
  const { run } = setup();
  run(`cloudData.objects[0].purchases = [
    { id: 'a', items: [{ id: 'i1', name: 'Клей', price: 1200 }, { id: 'i2', name: 'Затирка', price: '350,5' }, { id: 'i3', name: 'Крестики' }] },
    { id: 'b', total: '5 000', items: [{ id: 'i4', name: 'Плитка', price: 4100 }] },
    { id: 'c', total: 900, inStats: false, items: [] },
  ]`);
  assert.strictEqual(run(`purchaseTotal(cloudData.objects[0].purchases[0])`), 1550.5);
  assert.strictEqual(run(`purchaseTotal(cloudData.objects[0].purchases[1])`), 5000);
  assert.strictEqual(run(`objectMaterialsSpent(cloudData.objects[0])`), 6550.5, 'закупка «не учитывать» — не в счёт');
  assert.strictEqual(run(`objectMaterialsSpent({})`), 0);
});

test('новая закупка, позиции списком, галочки, сумма, «доставлено» — всё сохраняется в объекте', () => {
  const { c, run } = setup();
  let field = '';
  c.document.getElementById = (id) => (id === 'purchaseAddName' ? { get value() { return field; }, focus() {} } : null);
  run(`purchaseNew()`);
  field = 'Грунтовка 10 л\nВалик 2 шт\n\nПлёнка';
  run(`purchaseAdd()`);
  const p = () => JSON.parse(JSON.stringify(run(`cloudData.objects[0].purchases[0]`)));
  assert.deepStrictEqual(p().items.map((it) => [it.name, it.qty, it.unit, it.done]), [['Грунтовка', '10', 'л', false], ['Валик', '2', 'шт', false], ['Плёнка', '', 'шт.', false]]);
  const [a, b] = p().items.map((it) => it.id);
  run(`purchaseToggle('${a}', true); purchaseItemSet('${a}', 'price', '1 250'); purchaseItemSet('${b}', 'qty', '3')`);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(run(`purchaseProgress(purchaseCur())`))), { done: 1, all: 3 });
  assert.strictEqual(run(`purchaseTotal(purchaseCur())`), 1250);
  run(`purchaseSet('total', '1400'); purchaseSet('delivered', true); purchaseSet('to', 'Снабженец Олег')`);
  assert.strictEqual(p().delivered, true);
  assert.ok(p().deliveredAt > 0);
  assert.strictEqual(run(`objectMaterialsSpent(cloudData.objects[0])`), 1400);
  run(`purchaseSet('inStats', false)`);
  assert.strictEqual(run(`objectMaterialsSpent(cloudData.objects[0])`), 0);
  // текст для снабженца: объект, кому, нумерованный список с количеством
  assert.strictEqual(run(`purchaseMessageText(purchaseObj(), purchaseCur())`),
    `${p().title.replace(/^/, 'Закупка: ')}\nОбъект: Квартира на Ленина, ул. Ленина, 5\nКому: Снабженец Олег\n\n1. Грунтовка — 10 л\n2. Валик — 3 шт\n3. Плёнка`);
  run(`purchaseItemDel('${b}')`);
  assert.strictEqual(p().items.length, 2);
  run(`purchaseRemove()`);
  assert.strictEqual(run(`cloudData.objects[0].purchases.length`), 0);
});
