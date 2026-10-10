// Service worker — нужен, чтобы сайт можно было установить как приложение
// и чтобы уже открывавшиеся страницы открывались без интернета.
// Данные (API-запросы к price-api) НЕ кэшируются — всегда идут в сеть,
// чтобы расчёты были актуальными.
//
// При каждом заметном обновлении сайта меняйте номер версии ниже —
// старый кэш удалится, и у всех подтянутся новые файлы.
const CACHE_NAME = 'prise-shell-v33';
const SHELL_FILES = [
  './calc.html',
  './calc.css',
  './calc-app.js',
  './calc-measure.js',
  './calc-rooms.js',
  './calc-wpview.js',
  './calc-ruler.js',
  './calc-molding.js',
  './calc-tile.js',
  './calc-mask.js',
  './calc-plan.js',
  './calc-import.js',
  './calc-paid.js',
  './calc-aichats.js',
  './calc-assistant.js',
  './calc-extras.js',
  './index.html',
  './view.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // Если какого-то файла нет, установка всё равно не срывается
      Promise.all(SHELL_FILES.map((f) => cache.add(new Request(f, { cache: 'reload' })).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Кэшировать можно только GET. Остальное (POST, PUT, DELETE) — мимо.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Запросы к API (workers.dev) — всегда только из сети, никогда не кэшируем.
  if (url.hostname.includes('workers.dev')) return;

  // Страницы сайта: всегда спрашиваем сервер о свежей версии (в обход
  // 10-минутного кэша GitHub Pages), без сети — отдаём сохранённую копию.
  // Важно: из запроса перехода (mode = navigate) нельзя создавать новый
  // Request с другими настройками — браузер выбрасывает ошибку. Поэтому для
  // страниц делаем обычный запрос по адресу с cache: 'no-cache'.
  const isPage = req.mode === 'navigate';
  // Свои файлы сайта (страницы и части calc-*.js / calc.css) всегда сверяем
  // с сервером — иначе новая страница могла бы взять старый кусок скрипта.
  const own = url.origin === self.location.origin;
  const doFetch = isPage || own
    ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
    : fetch(req);

  event.respondWith(
    doFetch
      .then((response) => {
        // Сохраняем только успешные ответы — ошибки 404/500 в кэш не кладём.
        if (response.ok && (url.origin === self.location.origin || response.type === 'cors')) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: isPage || own }).then((cached) => cached || Response.error())
      )
  );
});
