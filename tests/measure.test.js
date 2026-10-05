// Проверки расчётов замера: площади, чертёж комнаты, подправка плана замерами от углов.
// Запуск из корня репозитория: node --test
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { loadCalc } = require('./load.js');

const FILES = ['calc-measure.js', 'calc-ruler.js', 'calc-molding.js', 'calc-tile.js', 'calc-import.js'];

// Новая песочница на каждую проверку: замер — глобальная переменная страницы
function setup(m) {
  const c = loadCalc(FILES);
  c.__m = m;
  vm.runInContext('measure = Object.assign(newMeasure(), __m);', c);
  return { c, run: code => vm.runInContext(code, c) };
}
const near = (a, b, eps = 0.001) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`);
// rulerEdit / rulerClose трогают страницу — в проверках только выставляем цель
const QUIET = `rulerClose = function () { rulerTarget = null; };
rulerEdit = function (kind, idx, field) { if (kind === 'chk') rulerCheckEnsure(idx); rulerTarget = { kind, idx, field: field || 'a' }; };
renderRulerSketch = function () {}; renderRulerPad = function () {};`;

test('выражения в полях', () => {
  const { run } = setup({});
  near(run('evalMeasureExpr("3,2+0,4")'), 3.6);
  near(run('evalMeasureExpr("2×1,5")'), 3);
  near(run('evalMeasureExpr("(3+4)*2")'), 14);
  assert.ok(Number.isNaN(run('evalMeasureExpr("abc")')));
});

test('прямоугольная комната: периметр, стены, окно', () => {
  const { run } = setup({ shape: 'rect', height: '2,7', walls: ['4', '3', '4', '3'],
    openings: [{ type: 'window', w: '1,5', h: '1,4', n: '1', wall: 0 }] });
  const r = run('computeMeasure(measure)');
  near(r.perimeter, 14);
  near(r.wallsGross, 37.8);
  near(r.openingsArea, 2.1);
  near(r.wallsNet, 35.7);
});

test('своя форма: Г-образная комната сходится, угол не по 90° — нет', () => {
  const { run } = setup({ shape: 'free', walls: ['4', '2', '2', '3', '2', '5'], turns: ['R', 'R', 'L', 'R', 'R', 'R'], angles: [] });
  assert.strictEqual(run('rulerGeometry(measure).closed'), true);
  run('measure.angles = ["", "", "", "", "95", ""]');
  assert.strictEqual(run('rulerGeometry(measure).closed'), false);
  assert.match(run('rulerPlanWarning(measure)'), /не сходится/);
});

test('замер от угла до стены напротив: двигается только выбранная стена', () => {
  const { run } = setup({ shape: 'rect', walls: ['4', '3', '4', '3'] });
  run(QUIET);
  run('rulerEdit("chk", 0, "a"); measure.wallChecks[0].a = "2,951"; rulerCheckApply();');
  const m = run('measure');
  assert.deepStrictEqual([...m.walls], ['4', '3', '4', '2,951']);
  // углы поменялись только у стены 1, нижние остались прямыми
  assert.strictEqual(m.angles[1], '');
  assert.strictEqual(m.angles[2], '');
  assert.ok(run('rulerGeometry(measure).closed'));
  assert.strictEqual(run('rulerPlanWarning(measure)'), '');
});

test('стена напротив короче: замер переезжает напротив её угла', () => {
  const { run } = setup({ shape: 'free', walls: ['4', '2', '2', '3', '2', '5'], turns: ['R', 'R', 'L', 'R', 'R', 'R'], angles: [] });
  run(QUIET);
  run('rulerEdit("chk", 5, "b"); rulerCheckSetOpp(3);');
  assert.match(run('rulerCheckLabel(rulerTarget)'), /до угла стены 4/);
  run('measure.wallChecks[0].b = "2,03"; rulerCheckApply();');
  near(run('rulerCheckSpotFor(rlCheckGeom(measure).P, rlCheckGeom(measure).h, rlCheckGeom(measure).L, measure.wallChecks[0], "b").dist'), 2.03, 0.002);
  // стены, кроме стены 1 (соседней) и самой выбранной, не изменились
  assert.deepStrictEqual([...run('measure.walls')].slice(1, 5), ['2', '2', '3', '2']);
});

test('диагональ: от угла до угла напротив, окна на соседних стенах на месте', () => {
  const { run } = setup({ shape: 'rect', walls: ['4', '3', '4', '3'], openings: [
    { type: 'window', w: '1', h: '1', wall: 3, off: '0,5', from: 'end' },  // отступ от сдвигаемого угла
    { type: 'door', w: '0,9', h: '2', wall: 3, off: '0,3', from: 'start' }, // от неподвижного угла
  ] });
  run(QUIET);
  run('rulerEdit("chk", 0, "a"); rulerCheckSetDiag(2); measure.wallChecks[0].a = "5,05"; rulerCheckApply();');
  near(run('rulerCheckSpotFor(rlCheckGeom(measure).P, rlCheckGeom(measure).h, rlCheckGeom(measure).L, measure.wallChecks[0], "a").dist'), 5.05, 0.002);
  const ops = run('measure.openings');
  const grow = run('mNum(measure.walls[3])') - 3;
  near(run(`evalMeasureExpr(measure.openings[0].off)`), 0.5 + grow);
  assert.strictEqual(ops[1].off, '0,3');
});

test('невозможный замер (диагональ короче, чем до стены) не портит план', () => {
  const { run } = setup({ shape: 'rect', walls: ['4', '3', '4', '3'] });
  run(QUIET);
  run('rulerEdit("chk", 0, "a"); rulerCheckSetDiag(2); measure.wallChecks[0].a = "3,5"; rulerCheckApply();');
  assert.deepStrictEqual([...run('measure.walls')], ['4', '3', '4', '3']);
  assert.strictEqual(run('measure.shape'), 'rect');
});

test('подиум и короб: облицовка, стена за ними и пол под ними', () => {
  const { run } = setup({ shape: 'rect', height: '2,7', walls: ['4', '3', '4', '3'],
    tile: { walls: { on: true, walls: null, h: '' }, floor: { on: true } },
    blocks: [
      { type: 'podium', wall: 0, off: '0', from: 'start', w: '1,7', d: '0,7', h: '0,15' }, // в углу у стены 4
      { type: 'box', wall: 1, off: '0', from: 'end', w: '0,3', d: '0,25', h: '' },        // в углу у стены 3, до потолка
    ] });
  const bl = run('blocksCompute(measure)');
  const [p, k] = bl.list;
  assert.strictEqual(p.code, 'П-1');
  assert.strictEqual(p.openSides, 1);
  near(p.area, 1.7 * 0.15 + 0.7 * 0.15 + 1.7 * 0.7);
  near(p.edges, 0.15 + 1.7 + 0.7);
  assert.strictEqual(k.code, 'К-1');
  near(k.h, 2.7);
  near(k.top, 0);
  near(k.area, 0.3 * 2.7 + 0.25 * 2.7);
  const t = run('tileCompute(measure, computeMeasure(measure))');
  // стены: за подиумом и его прижатым боком, за коробом и его боком; плюс облицовка короба
  near(t.walls, 37.8 - (1.7 + 0.7) * 0.15 - (0.3 + 0.25) * 2.7 + k.area);
  // пол: минус под подиумом и коробом, плюс облицовка подиума
  near(t.floor, 12 - 1.7 * 0.7 - 0.3 * 0.25 + p.area);
  assert.match(t.lines.floor, /под П-1, К-1/);
  // экран ванны без верха, отдельно стоящий подиум — со всех сторон
  run('measure.blocks = [{ type: "screen", wall: 2, w: "", d: "0,7", h: "0,6" }, { type: "podium", w: "1", d: "1", h: "0,2" }]');
  const [e, q] = run('blocksCompute(measure)').list;
  assert.strictEqual(e.openSides, 0);
  near(e.area, 4 * 0.6);
  near(q.area, 4 * 0.2 + 1);
});

test('плитка по раскладке: целые, подрезные и узкие куски', () => {
  // стена 1 м × 0,7 м, плитка 300×300 без шва от левого нижнего угла:
  // по ширине 3 целых + кусок 100 мм, по высоте 2 целых + кусок 100 мм
  const { run } = setup({ shape: 'rect', height: '0,7', walls: ['1', '0,9', '1', '0,9'],
    tile: { walls: { on: true, walls: [0], w: '300', l: '300', joint: '0', layout: 'straight', ax: 'start', ay: 'start' },
            floor: { on: true, w: '300', l: '300', joint: '0', layout: 'straight', ax: 'start', ay: 'start' } } });
  const t = run('tileCompute(measure, computeMeasure(measure))');
  const pick = c => ({ whole: c.whole, cut: c.cut, narrow: c.narrow, pcs: c.pcs });
  assert.deepStrictEqual(pick(t.wallsLayout), { whole: 6, cut: 6, narrow: 6, pcs: 12 });
  // пол 1 × 0,9: 3 × 3 целых и полоса из трёх кусков по 100 мм
  assert.deepStrictEqual(pick(t.floorLayout), { whole: 9, cut: 3, narrow: 3, pcs: 12 });
  assert.match(t.lines.floorLayout, /9 целых \+ 3 подрезных = 12 шт\. без запаса на бой; узких кусков \(до трети плитки\): 3/);
  // окно 0,6 × 0,3 вырезает две целые плитки
  run('measure.openings = [{ type: "window", w: "0,6", h: "0,3", sill: "0", wall: 0, off: "0", from: "start" }]');
  const t2 = run('tileCompute(measure, computeMeasure(measure))');
  assert.strictEqual(t2.wallsLayout.whole, 4);
});

test('плитка по раскладке с обрезками', () => {
  // пол 0,95 × 0,9, плитка 300×300: полоса из трёх кусков по 50 мм — из одной плитки
  const { run } = setup({ shape: 'rect', height: '2,7', walls: ['0,95', '0,9', '0,95', '0,9'],
    tile: { floor: { on: true, w: '300', l: '300', joint: '0', layout: 'straight', ax: 'start', ay: 'start', reuse: true } } });
  const t = run('tileCompute(measure, computeMeasure(measure))');
  assert.strictEqual(t.floorLayout.reuseTiles, 1);
  assert.match(t.lines.floorLayout, /с обрезками: 9 целых \+ 1 на 3 подрезных = 10 шт\./);
  // без галочки обрезки не учитываются
  run('measure.tile.floor.reuse = false');
  assert.doesNotMatch(run('tileCompute(measure, computeMeasure(measure))').lines.floorLayout, /с обрезками/);
});
