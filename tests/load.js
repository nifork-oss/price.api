// Загружает части кабинета мастера (обычные скрипты для браузера) в песочницу Node,
// чтобы проверять расчёты замера без браузера. DOM здесь — пустые заглушки.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function stubEl() {
  return new Proxy(function () {}, {
    get(t, k) {
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains() { return false; } };
      if (k === 'style' || k === 'dataset') return {};
      if (k === 'value' || k === 'textContent' || k === 'innerHTML') return '';
      if (k === Symbol.toPrimitive) return () => '';
      return stubEl();
    },
    apply() { return stubEl(); },
    set() { return true; },
  });
}

function loadCalc(files) {
  const toasts = [];
  const doc = {
    addEventListener() {}, removeEventListener() {},
    getElementById() { return null; }, querySelector() { return null }, querySelectorAll() { return []; },
    createElement() { return stubEl(); }, body: stubEl(), documentElement: stubEl(),
  };
  const ctx = {
    console, Math, JSON, Date, String, Number, Array, Object, Set, Map, isFinite, isNaN, parseFloat, parseInt, Infinity, NaN, Symbol, Promise, Proxy,
    setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0,
    document: doc,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'node' },
    confirm: () => true, alert() {},
    showAddToast: msg => toasts.push(msg),
    escapeHtml: s => String(s),
  };
  ctx.window = ctx;
  ctx.window.addEventListener = () => {};
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  ctx.__toasts = toasts;
  return ctx;
}

module.exports = { loadCalc };
