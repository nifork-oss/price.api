// Проверки расчётов замера: площади, чертёж комнаты, подправка плана замерами от углов.
// Запуск из корня репозитория: node --test
const test = require('node:test');
const assert = require('node:assert');
const vm = require('vm');
const { loadCalc } = require('./load.js');

const FILES = ['calc-measure.js', 'calc-ruler.js', 'calc-molding.js', 'calc-tile.js', 'calc-mask.js', 'calc-import.js'];

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

test('материалы к плитке: клей, затирка, грунт, гидроизоляция', () => {
  const { run } = setup({ shape: 'rect', height: '2,7', walls: ['2', '2', '2', '2'],
    tile: { floor: { on: true, w: '300', l: '300', joint: '2', layout: 'straight', mat: true, th: '9', hydro: true } } });
  const t = run('tileCompute(measure, computeMeasure(measure))');
  near(t.matFloor.glue, 4 * 4);                         // плитка 300 — 4 кг/м²
  near(t.matFloor.grout, 4 * (600 / 90000) * 9 * 2 * 1.6);
  near(t.matFloor.primer, 4 * 0.15);
  near(t.matFloor.hydro, (4 + 8 * 0.2) * 2);            // заход на стены 20 см, два слоя
  near(t.matFloor.tape, 8);
  assert.match(t.lines.matFloor, /16 кг = 1 меш\. по 25 кг/);
  // без галочки материалы не считаются
  run('measure.tile.floor.mat = false');
  assert.strictEqual(run('tileCompute(measure, computeMeasure(measure))').matFloor, null);
});

test('подбор раскладки: меньше узких кусков', () => {
  // пол 1 × 0,95, плитка 300×300 от угла — узкие полосы 100 и 50 мм; со швом по центру их нет
  const { run } = setup({ shape: 'rect', height: '2,7', walls: ['1', '0,95', '1', '0,95'],
    tile: { floor: { on: true, w: '300', l: '300', joint: '0', layout: 'straight', ax: 'start', ay: 'start' } } });
  assert.ok(run('tileCompute(measure, computeMeasure(measure)).floorLayout.narrow') > 0);
  const best = run('tileAutoPick(measure, "floor")');
  assert.strictEqual(best.score[0], 0);
});

test('наружные углы под плитку: углы стен и короба, уголок или запил', () => {
  // Г-образная комната — один наружный угол; короб у стены 1 в углу — один открытый бок
  const { run } = setup({ shape: 'free', height: '2,7', walls: ['4', '2', '2', '3', '2', '5'], turns: ['R', 'R', 'L', 'R', 'R', 'R'], angles: [],
    tile: { walls: { on: true, walls: null, w: '300', l: '600', joint: '2' } },
    blocks: [{ type: 'box', wall: 0, off: '0', from: 'start', w: '0,3', d: '0,25', h: '' }] });
  const t = run('tileCompute(measure, computeMeasure(measure))');
  near(t.edges.len, 2.7 + 2.7);
  assert.strictEqual(t.edges.profiles, 3);
  assert.match(t.lines.edges, /уголок: 3 шт\. по 2,5 м/);
  run('measure.tile.walls.edge = "cut45"');
  assert.match(run('tileCompute(measure, computeMeasure(measure))').lines.edges, /запил 45°/);
});

test('укрывка: периметр примыкания, общие участки один раз', () => {
  // комната 4 × 3, высота 2,7; окно 1,5 × 1,4 на стене 1, дверь 0,8 × 2 на стене 3
  const { run } = setup({ shape: 'rect', height: '2,7', walls: ['4', '3', '4', '3'],
    openings: [{ type: 'window', w: '1,5', h: '1,4', n: '1', wall: 0 }, { type: 'door', w: '0,8', h: '2', n: '1', wall: 2 }],
    mask: { windows: true, doors: true, floor: true } });
  let k = run('maskCompute(measure)');
  near(k.len, 5.8 + 5 + 14);                           // рамка окна, дверь без порога (верх 0,8 — как 1 м), пол по стенам
  near(k.area, 2.1 + 1.6 + 12);
  // шкаф 1 × 2 на полу у стены 2: низ шкафа совпадает с линией пола
  run('measure.covers = [{ wall: 1, w: "1", h: "2", off: "1" }]; measure.mask.covers = true');
  k = run('maskCompute(measure)');
  near(k.len, 24.8 + 6 - 1);
  assert.match(k.lines.len, /общие участки 1 пог\. м посчитаны один раз/);
  // в счёт по видам: общий низ шкафа достаётся полу, сумма видов — итог
  near(k.kinds.maskFloor.len, 14);
  near(k.kinds.maskCovers.len, 5);
  near(k.kinds.maskWindows.len + k.kinds.maskDoors.len + k.kinds.maskCovers.len + k.kinds.maskFloor.len, k.len);
  // готовые стены 1 и 2: общий угол и низ по полу — один раз
  run('measure.covers = []; measure.mask.covers = false; measure.mask.walls = [0, 1]');
  k = run('maskCompute(measure)');
  near(k.len, 24.8 + (13.4 + 11.4 - 2.7) - 7);
  // теневой профиль у потолка на стенах 1 и 3 — своя строка в счёте
  run('measure.mask.shadowCeil = [0, 2]');
  k = run('maskCompute(measure)');
  near(k.kinds.maskShadow.len, 8);
  near(k.len, 24.8 + (13.4 + 11.4 - 2.7) - 7 + 4);    // верх стены 1 уже у теневого, стены — на 4 меньше
  near(k.kinds.maskWalls.len, 13.4 + 11.4 - 2.7 - 4);   // низ готовых стен — у стен, пол без него
  near(k.kinds.maskFloor.len, 14 - 7);
  near(run('measureValueForTab(computeMeasure(measure), "maskShadow").value'), 8);
  // во вкладке и в счёт: пог. м и м²
  const r = run('computeMeasure(measure)');
  near(run('measureValueForTab(computeMeasure(measure), "mask").value'), r.maskLen);
  assert.strictEqual(run('measureValueForTab(computeMeasure(measure), "maskArea").unit'), 'м²');
});

test('укрывка: встроенный шкаф до потолка — скотч по фасаду, не за шкафом', () => {
  // шкаф 2 м шириной, глубиной 0,6, от пола до потолка, не в углу — у стены 1
  const { run } = setup({ shape: 'rect', height: '2,7', walls: ['4', '3', '4', '3'],
    covers: [{ wall: 0, w: '2', d: '0,6', off: '1', h: '' }],
    mask: { ceiling: true } });
  let k = run('maskCompute(measure)');
  near(k.len, 14 - 2 + 2 + 2 * 1);                      // за шкафом — нет, фасад и два бока (по 0,6 — как 1 м) — да
  // в углу: один бок прижат к стене 4, за ним линии тоже нет
  run('measure.covers[0].off = "0"');
  near(run('maskCompute(measure)').len, 14 - 2 - 0.6 + 2 + 1);
  // укрываем и сам шкаф: по стене — только боковые стыки, верх и низ — по фасаду, общему с потолком и полом
  run('measure.covers[0].off = "1"; measure.mask.floor = true; measure.mask.covers = true');
  k = run('maskCompute(measure)');
  near(k.kinds.maskCovers.len, 2 * 2.7);
  assert.match(k.lines.len, /меньше 1 м — считается как 1 пог\. м/);
  near(k.kinds.maskCeiling.len, 16);
  near(k.kinds.maskFloor.len, 16);
  // теневой профиль у потолка на всех стенах тоже идёт по фасаду: столько же, сколько потолок
  run('measure.mask = { shadowCeil: [0, 1, 2, 3] }');
  near(run('maskCompute(measure)').kinds.maskShadow.len, 16);
});
