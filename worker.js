/**
 * Кабинет мастера — защищённый прокси-сервер (Cloudflare Worker)
 * ----------------------------------------------------------------
 * Задача этого файла: спрятать секретный ключ JSONBin.io от браузера
 * и добавить настоящую проверку пароля на сервере (а не в коде страницы).
 *
 * ПЕРЕД ДЕПЛОЕМ настройте в Cloudflare Dashboard -> ваш Worker ->
 * Settings -> Variables and Secrets два СЕКРЕТА (тип "Secret", не "Text"):
 *   JSONBIN_KEY     — ваш X-Master-Key от JSONBin.io
 *                     (тот самый, что раньше был виден в calc.html/index.html)
 *   SESSION_SECRET  — любая длинная случайная строка (например, 40+ символов),
 *                     придумайте сами — она подписывает токены входа.
 *
 * BIN_ID и разрешённый источник (домен сайта) ниже захардкожены —
 * поменяйте, если у вас другой BIN_ID или другой домен/поддомен.
 */

const BIN_ID = "6a98820eda38895dfe310361";
const ALLOWED_ORIGIN = "https://nifork-oss.github.io";
const TOKEN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

/* ============== крипто-утилиты ============== */

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(len = 16) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return toHex(arr.buffer);
}

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return toHex(buf);
}

async function hashPassword(password) {
  const salt = randomHex();
  const hash = await sha256Hex(salt + password);
  return `s2$${salt}$${hash}`;
}

async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (typeof stored === "string" && stored.startsWith("s2$")) {
    const [, salt, hash] = stored.split("$");
    const check = await sha256Hex(salt + password);
    return check === hash;
  }
  // Старый пароль в открытом виде (ещё не мигрировал) — сравниваем как есть.
  return stored === password;
}

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64urlToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

async function hmacKey(env) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signToken(payload, env) {
  const key = await hmacKey(env);
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${b64url(sig)}`;
}

async function verifyToken(token, env) {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const key = await hmacKey(env);
    const valid = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig), new TextEncoder().encode(body));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body)));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

async function getAuthUser(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  return await verifyToken(token, env);
}

/* ============== доступ к JSONBin ============== */

async function readBin(env) {
  const res = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
    headers: { "X-Master-Key": env.JSONBIN_KEY },
  });
  const data = await res.json();
  const record = data.record || {};
  if (!Array.isArray(record.services)) record.services = [];
  if (!Array.isArray(record.users))
    record.users = [{ login: "admin", email: "admin@mail.ru", pass: "12345", role: "admin" }];
  if (!Array.isArray(record.history)) record.history = [];
  if (!Array.isArray(record.objects)) record.objects = [];
  if (!Array.isArray(record.pirogHistory)) record.pirogHistory = [];
  return record;
}

async function writeBin(env, data) {
  await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Master-Key": env.JSONBIN_KEY },
    body: JSON.stringify(data),
  });
}

function stripPasswords(record) {
  const clone = JSON.parse(JSON.stringify(record));
  clone.users = (clone.users || []).map((u) => ({
    login: u.login,
    email: u.email || "",
    role: u.role || "master",
  }));
  return clone;
}

/* ============== обработчик запросов ============== */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      // Публичный прайс-лист (без входа) — для index.html
      if (path === "/public" && request.method === "GET") {
        const record = await readBin(env);
        return json({ services: record.services });
      }

      // Публичное сохранение расчёта "1м² / пирог" (доступно без входа —
      // так уже было устроено на сайте: посетитель считает смету без логина)
      if (path === "/pirog" && request.method === "POST") {
        const body = await request.json();
        const record = await readBin(env);
        const newRecord = {
          id: "pirog_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
          date: new Date().toLocaleString("ru-RU"),
          object: String(body.object || "Без названия").slice(0, 200),
          total: Number(body.total) || 0,
          items: Array.isArray(body.items) ? body.items.slice(0, 100) : [],
          extraTotal: Number(body.extraTotal) || 0,
          extraItems: Array.isArray(body.extraItems) ? body.extraItems.slice(0, 100) : [],
          viewed: false,
        };
        record.pirogHistory.unshift(newRecord);
        if (record.pirogHistory.length > 50) record.pirogHistory.pop();
        await writeBin(env, record);
        return json({ ok: true });
      }

      // Регистрация нового мастера
      if (path === "/register" && request.method === "POST") {
        const body = await request.json();
        const login = String(body.login || "").trim();
        const email = String(body.email || "").trim();
        const password = String(body.password || "").trim();
        if (!login || !email || !password) return json({ error: "Заполните все поля" }, 400);
        const record = await readBin(env);
        if (record.users.some((u) => u.login.toLowerCase() === login.toLowerCase()))
          return json({ error: "Такой логин уже занят!" }, 400);
        if (record.users.some((u) => u.email && u.email.toLowerCase() === email.toLowerCase()))
          return json({ error: "Этот email уже используется другим аккаунтом!" }, 400);
        const pass = await hashPassword(password);
        record.users.push({ login, email, pass, role: "master" });
        await writeBin(env, record);
        const token = await signToken({ login, role: "master", exp: Date.now() + TOKEN_LIFETIME_MS }, env);
        return json({ token, login, role: "master" });
      }

      // Вход
      if (path === "/login" && request.method === "POST") {
        const body = await request.json();
        const idVal = String(body.login || "").trim().toLowerCase();
        const password = String(body.password || "").trim();
        const record = await readBin(env);
        const user = record.users.find(
          (u) => u.login.toLowerCase() === idVal || (u.email && u.email.toLowerCase() === idVal)
        );
        if (!user || !(await verifyPassword(password, user.pass))) {
          return json({ error: "Неверный логин/email или пароль" }, 401);
        }
        // Мягкая миграция: если пароль ещё хранился в открытом виде — хэшируем при первом входе.
        if (!(typeof user.pass === "string" && user.pass.startsWith("s2$"))) {
          user.pass = await hashPassword(password);
          await writeBin(env, record);
        }
        const role = user.role === "admin" || user.login === "admin" ? "admin" : "master";
        const token = await signToken({ login: user.login, role, exp: Date.now() + TOKEN_LIFETIME_MS }, env);
        return json({ token, login: user.login, role });
      }

      // Восстановление пароля по email
      if (path === "/recover" && request.method === "POST") {
        const body = await request.json();
        const email = String(body.email || "").trim().toLowerCase();
        const record = await readBin(env);
        const user = record.users.find((u) => u.email && u.email.toLowerCase() === email);
        if (!user) return json({ error: "Пользователь с таким email не найден" }, 404);
        const tempPass = Math.random().toString(36).slice(-8);
        user.pass = await hashPassword(tempPass);
        await writeBin(env, record);
        return json({ tempPassword: tempPass });
      }

      // Всё, что ниже, требует действительного токена входа
      const auth = await getAuthUser(request, env);
      if (!auth) return json({ error: "Требуется вход" }, 401);

      // Получение данных приложения (пароли никогда не отдаются клиенту)
      if (path === "/appdata" && request.method === "GET") {
        const record = await readBin(env);
        return json({ data: stripPasswords(record), role: auth.role, login: auth.login });
      }

      // Сохранение данных приложения
      if (path === "/appdata" && request.method === "PUT") {
        const incoming = await request.json();
        const record = await readBin(env);
        const isAdmin = auth.role === "admin";

        if (Array.isArray(incoming.services)) {
          if (!isAdmin) return json({ error: "Только администратор может менять прайс-лист" }, 403);
          record.services = incoming.services;
        }

        if (Array.isArray(incoming.users)) {
          const byLogin = Object.fromEntries(record.users.map((u) => [u.login, u]));
          const newUsersList = [];
          for (const incUser of incoming.users) {
            const existing = byLogin[incUser.login];
            if (!isAdmin && incUser.login !== auth.login) {
              if (existing) newUsersList.push(existing);
              continue;
            }
            if (incUser.pass) {
              const pass = await hashPassword(incUser.pass);
              newUsersList.push({
                login: incUser.login,
                email: incUser.email || "",
                role: incUser.role || "master",
                pass,
              });
            } else if (existing) {
              newUsersList.push({
                ...existing,
                email: incUser.email ?? existing.email,
                role: incUser.role ?? existing.role,
                login: incUser.login,
              });
            }
          }
          record.users = newUsersList;
        }

        if (Array.isArray(incoming.history)) record.history = incoming.history;
        if (Array.isArray(incoming.objects)) record.objects = incoming.objects;
        if (Array.isArray(incoming.pirogHistory)) {
          if (!isAdmin) return json({ error: "Недостаточно прав" }, 403);
          record.pirogHistory = incoming.pirogHistory;
        }

        await writeBin(env, record);
        return json({ data: stripPasswords(record) });
      }

      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: "Внутренняя ошибка сервера: " + e.message }, 500);
    }
  },
};
