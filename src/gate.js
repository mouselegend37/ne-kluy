/**
 * Вход на сайт.
 *
 * Выглядит и ведёт себя как обычный вход через Госуслуги или Google: окно,
 * кнопки, проверка учётной записи. Разница только в одном — после «входа»
 * видно, что именно такой сайт о вас уже знает.
 *
 * Что здесь настоящее: IP-адрес, провайдер, город, характеристики устройства,
 * экран, язык, часовой пояс — всё, что получает любой сервер и любой скрипт.
 * Что сгенерировано: паспортные данные «аккаунта» — их у нас, естественно, нет.
 *
 * Единственный сетевой запрос — определение IP и провайдера (ipwho.is, резерв
 * ipinfo.io). Ничего никуда не отправляется и не сохраняется.
 */

import gosLogo from "./assets/gosuslugi.png";

const SESSION_KEY = "ne-kluy:gate-shown";

/* Браузер по умолчанию восстанавливает прокрутку после перезагрузки — и тогда
   вход открывается поверх страницы, уже прокрученной вниз. После «Продолжить»
   человек оказывался в середине сайта. Отключаем восстановление и сами
   возвращаем ту позицию, где окно открылось. */
try {
  history.scrollRestoration = "manual";
} catch {
  /* старый браузер — не критично */
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

/* ── что говорит сам браузер ─────────────────────────────────────── */

const systemInfo = () => {
  const ua = navigator.userAgent;
  const os =
    /Windows NT 10/.test(ua) ? "Windows 11"
    : /Windows NT 6\.3/.test(ua) ? "Windows 8.1"
    : /Windows/.test(ua) ? "Windows"
    : /Android (\d+)/.test(ua) ? `Android ${ua.match(/Android (\d+)/)[1]}`
    : /iPhone|iPad/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : "неизвестная система";
  const browser =
    /YaBrowser\/(\d+)/.test(ua) ? `Яндекс Браузер ${ua.match(/YaBrowser\/(\d+)/)[1]}`
    : /Edg\/(\d+)/.test(ua) ? `Edge ${ua.match(/Edg\/(\d+)/)[1]}`
    : /OPR\/(\d+)/.test(ua) ? `Opera ${ua.match(/OPR\/(\d+)/)[1]}`
    : /Firefox\/(\d+)/.test(ua) ? `Firefox ${ua.match(/Firefox\/(\d+)/)[1]}`
    : /Chrome\/(\d+)/.test(ua) ? `Chrome ${ua.match(/Chrome\/(\d+)/)[1]}`
    : /Version\/(\d+).*Safari/.test(ua) ? `Safari ${ua.match(/Version\/(\d+)/)[1]}`
    : "браузер";
  return `${os} · ${browser}`;
};

const gpuName = () => {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return null;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    if (!info) return null;
    let renderer = gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    if (typeof renderer !== "string") return null;
    renderer = renderer
      .replace(/^ANGLE \(/i, "")
      .replace(/\)$/, "")
      .replace(/\(0x[0-9a-f]+\)/gi, "")
      .replace(/\b(Direct3D|D3D)\d+/gi, "")
      .replace(/vs_\d_\d ps_\d_\d/gi, "")
      .replace(/NVIDIA,\s*NVIDIA/gi, "NVIDIA")
      .replace(/AMD,\s*AMD/gi, "AMD")
      .replace(/[\s,]+$/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    return renderer ? renderer.slice(0, 64) : null;
  } catch {
    return null;
  }
};

const timeZone = () => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offset = -new Date().getTimezoneOffset() / 60;
    return `${zone}, UTC${offset >= 0 ? "+" : ""}${offset}`;
  } catch {
    return "неизвестно";
  }
};

const localTime = () =>
  new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "medium" }).format(new Date());

/* ── сеть: настоящий адрес и провайдер ───────────────────────────── */

/**
 * Локальный адрес устройства. Публичный адрес при включённом VPN узнать нельзя
 * физически — трафик уже вышел из туннеля на чужой стороне, и никакой сайт
 * «настоящий» адрес не увидит. А вот адрес в домашней сети (или его mDNS-имя)
 * VPN не меняет: он виден по ICE-кандидатам WebRTC. Это и есть честный ответ
 * на вопрос «где я на самом деле».
 */
let localAddressPromise = null;

function lookupLocalAddress() {
  if (localAddressPromise) return localAddressPromise;

  localAddressPromise = new Promise((resolve) => {
    const result = { lan: null, stun: null };
    if (typeof RTCPeerConnection !== "function") {
      resolve(result);
      return;
    }

    let peer;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try {
        peer.close();
      } catch {
        /* уже закрыт */
      }
      resolve(result);
    };
    const timer = setTimeout(finish, 2600);

    try {
      peer = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }],
      });
    } catch {
      clearTimeout(timer);
      finish();
      return;
    }

    const take = (candidate, type) => {
      const match = /(?:^|[\s:])((?:\d{1,3}\.){3}\d{1,3}|[0-9a-f-]+\.local)(?:\s|$)/i.exec(candidate);
      if (!match) return;
      const value = match[1];
      if (type === "srflx" && !result.stun) result.stun = value;
      if (type === "host" && !result.lan) {
        if (/\.local$/i.test(value)) result.lan = value.replace(/\.local$/i, "") + " (mDNS)";
        else if (!value.startsWith("0.")) result.lan = value;
      }
    };

    peer.onicecandidate = (event) => {
      if (!event.candidate) {
        clearTimeout(timer);
        finish();
        return;
      }
      take(event.candidate.candidate, event.candidate.type || "");
    };

    try {
      peer.createDataChannel("probe");
      peer.createOffer().then((offer) => peer.setLocalDescription(offer)).catch(finish);
    } catch {
      clearTimeout(timer);
      finish();
    }
  });

  return localAddressPromise;
}

let networkPromise = null;

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

function lookupNetwork() {
  if (networkPromise) return networkPromise;

  const primary = withTimeout(
    fetch("https://ipwho.is/", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) =>
        data && data.success !== false && data.ip
          ? {
              ip: data.ip,
              provider: data.connection?.isp || data.connection?.org || data.connection?.domain || null,
              city: [data.city, data.region].filter(Boolean).join(", ") || null,
              country: data.country || null,
            }
          : null,
      )
      .catch(() => null),
    5500,
  );

  networkPromise = primary.then(async (data) => {
    if (data) return data;
    const fallback = await withTimeout(
      fetch("https://ipinfo.io/json", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((json) =>
          json && json.ip
            ? {
                ip: json.ip,
                provider: json.org || null,
                city: [json.city, json.region].filter(Boolean).join(", ") || null,
                country: json.country || null,
              }
            : null,
        )
        .catch(() => null),
      5500,
    );
    return fallback ?? null;
  });

  return networkPromise;
}

/* ── «профиль», который приходит вместе с кнопкой входа ──────────── */

const PEOPLE = [
  { first: "Анна", middle: "Олеговна", surnames: ["Демидова", "Ковалёва", "Шевцова", "Литвинова", "Пономарёва"] },
  { first: "Ирина", middle: "Викторовна", surnames: ["Ткаченко", "Мельник", "Гордиенко", "Савченко", "Руденко"] },
  { first: "Наталья", middle: "Сергеевна", surnames: ["Ковалёва", "Шевцова", "Литвинова", "Демидова", "Савченко"] },
  { first: "Сергей", middle: "Петрович", surnames: ["Ковалёв", "Шевцов", "Литвинов", "Пономарёв", "Демидов"] },
  { first: "Алексей", middle: "Николаевич", surnames: ["Ткаченко", "Мельник", "Гордиенко", "Савченко", "Руденко"] },
  { first: "Дмитрий", middle: "Андреевич", surnames: ["Ковалёв", "Литвинов", "Шевцов", "Пономарёв", "Демидов"] },
];
const STREETS = ["ул. Красная", "ул. Северная", "ул. Ставропольская", "ул. Тургенева", "ул. Чехова", "ул. Гагарина", "ул. 40-летия Победы"];
const BANKS = ["ПАО Сбербанк", "Банк ВТБ", "Альфа-Банк", "Т-Банк"];

const makeIdentity = () => {
  const person = pick(PEOPLE);
  const { first, middle } = person;
  const surname = pick(person.surnames);
  const year = 1960 + Math.floor(Math.random() * 44);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const day = String(1 + Math.floor(Math.random() * 28)).padStart(2, "0");
  const income = (280 + Math.floor(Math.random() * 45) * 10) * 1000;

  return [
    { key: "ФИО", value: `${surname} ${first} ${middle}` },
    { key: "Дата рождения", value: `${day}.${month}.${year}` },
    { key: "СНИЛС", value: `${digits(3)}-${digits(3)}-${digits(3)} ${digits(2)}` },
    {
      key: "Паспорт",
      value: `03 ${digits(2)} № ${digits(6)}`,
      note: "выдан ГУ МВД России по Краснодарскому краю",
    },
    { key: "Адрес", value: `г. Краснодар, ${pick(STREETS)}, д. ${1 + Math.floor(Math.random() * 80)}, кв. ${1 + Math.floor(Math.random() * 120)}` },
    { key: "Годовой доход", value: `${income.toLocaleString("ru-RU")} ₽` },
    { key: "Банк", value: pick(BANKS) },
    { key: "Телефон", value: `+7 9${digits(2)} ${digits(3)}-${digits(2)}-${digits(2)}` },
  ];
};

const IDP_ICONS = {
  gosuslugi: `<img class="idp__logo" src="${gosLogo}" width="45" height="49" alt="" aria-hidden="true">`,
  google: `<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><rect width="30" height="30" rx="8" fill="#fff"/><path fill="#4285F4" d="M22.6 15.2c0-.6-.05-1.2-.16-1.7H15v3.3h4.3a3.7 3.7 0 0 1-1.6 2.4v2h2.6c1.5-1.4 2.3-3.4 2.3-6z"/><path fill="#34A853" d="M15 23c2.1 0 3.9-.7 5.2-1.9l-2.6-2c-.7.5-1.6.8-2.6.8-2 0-3.7-1.3-4.3-3.2H8v2.1A7.6 7.6 0 0 0 15 23z"/><path fill="#FBBC05" d="M10.7 16.7a4.6 4.6 0 0 1 0-2.9V11.7H8a7.6 7.6 0 0 0 0 6.8l2.7-1.8z"/><path fill="#EA4335" d="M15 10.5c1.1 0 2.1.4 2.9 1.1l2.1-2.1A7.5 7.5 0 0 0 8 11.7l2.7 2.1c.6-1.9 2.3-3.3 4.3-3.3z"/></svg>`,
};

/* ── окно ────────────────────────────────────────────────────────── */

export function initGate() {
  const gate = document.getElementById("gate");
  const card = document.getElementById("gate-card");
  if (!gate || !card) return;

  let lastFocus = null;
  let savedScroll = 0;

  // Адрес и провайдера узнаём сразу: так это делает любой сайт — до «входа».
  lookupNetwork();

  const rowHtml = (row) => `<li class="leak">
      <span class="leak__key">${escapeHtml(row.key)}</span>
      <span class="leak__value">${escapeHtml(row.value)}${
        row.note ? `<small>${escapeHtml(row.note)}</small>` : ""
      }</span>
    </li>`;

  const open = () => {
    lastFocus = document.activeElement;
    savedScroll = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.classList.add("gated");
    gate.hidden = false;
    render();
    card.querySelector("button")?.focus({ preventScroll: true });
  };

  const close = () => {
    gate.hidden = true;
    document.body.classList.remove("gated");
    card.scrollTop = 0;
    // Возвращаем ровно ту позицию, с которой окно открылось: без этого после
    // входа страница «прыгала» в середину.
    window.scrollTo(0, savedScroll);
    document.documentElement.scrollTop = savedScroll;
    document.body.scrollTop = savedScroll;
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      /* приватный режим — окно просто покажется снова */
    }
    lastFocus?.focus?.({ preventScroll: true });
  };

  const render = () => {
    card.innerHTML = `
      <p class="gate__brand"><span class="brand__mark" aria-hidden="true"></span> НЕ КЛЮЙ</p>
      <h2 class="gate__title" id="gate-title">Вход на сайт</h2>
      <p class="gate__text">
        Материалы доступны после подтверждения учётной записи — так мы
        понимаем, кому показываем тренажёр и какие сценарии вам ближе.
      </p>
      <div class="gate__providers">
        <button class="idp" type="button" data-idp="gosuslugi">
          ${IDP_ICONS.gosuslugi}
          <span><b>Войти через Госуслуги</b><span>подтверждённая учётная запись</span></span>
          <span class="idp__arrow" aria-hidden="true">→</span>
        </button>
        <button class="idp" type="button" data-idp="google">
          ${IDP_ICONS.google}
          <span><b>Войти через Google</b><span>почта и профиль</span></span>
          <span class="idp__arrow" aria-hidden="true">→</span>
        </button>
      </div>
      <p class="gate__fine">
        Продолжая, вы принимаете <u>условия использования</u> и
        <u>политику конфиденциальности</u> сайта.
      </p>`;

    card.querySelectorAll("[data-idp]").forEach((button) => {
      button.addEventListener("click", () => showLoading(button.dataset.idp));
    });
  };

  const showLoading = (provider) => {
    const name = provider === "google" ? "Google" : "Госуслуги";
    card.querySelectorAll("[data-idp]").forEach((button) => {
      button.disabled = true;
    });
    const loader = document.createElement("div");
    loader.className = "gate__loader";
    loader.innerHTML = `<i aria-hidden="true"></i> Проверяем учётную запись ${escapeHtml(name)}…`;
    card.querySelector(".gate__providers").after(loader);

    const started = performance.now();
    Promise.all([lookupNetwork(), lookupLocalAddress()]).then(([network, local]) => {
      const wait = Math.max(0, 1500 - (performance.now() - started));
      setTimeout(() => showResult(network, local), wait);
    });
  };

  const showResult = (network, local = {}) => {
    const device = [
      { key: "Система", value: systemInfo() },
      { key: "Экран", value: `${screen.width}×${screen.height}` },
      { key: "Окно браузера", value: `${window.innerWidth}×${window.innerHeight}` },
      { key: "Язык", value: navigator.language + (navigator.languages?.length > 1 ? ` (+${navigator.languages.length - 1})` : "") },
      { key: "Часовой пояс", value: timeZone() },
      { key: "Процессор", value: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} ядер` : "скрыто" },
    ];
    if (navigator.deviceMemory) device.push({ key: "Память", value: `${navigator.deviceMemory} ГБ` });
    const gpu = gpuName();
    if (gpu) device.push({ key: "Видеокарта", value: gpu });

    const net = [];
    if (network) {
      net.push({ key: "IP-адрес", value: network.ip, note: "этот адрес видит любой сайт" });
      if (network.provider) net.push({ key: "Провайдер", value: network.provider });
      if (network.city) net.push({ key: "Город", value: network.city });
    }
    if (local.lan) {
      const named = /\(mDNS\)$/.test(local.lan);
      net.push({
        key: named ? "Имя в локальной сети" : "Адрес в локальной сети",
        value: local.lan,
        note: named
          ? "браузер показал имя устройства, а не номер — VPN на это не влияет"
          : "это адрес самого устройства, VPN его не меняет",
      });
    } else {
      net.push({
        key: "Адрес в локальной сети",
        value: "скрыт браузером",
        note: "браузер не отдал его без разрешения на камеру или микрофон",
      });
    }
    if (local.stun && network?.ip && local.stun !== network.ip) {
      net.push({
        key: "Второй адрес (STUN)",
        value: local.stun,
        note: "не совпал с первым — трафик идёт через VPN или прокси",
      });
    }
    net.push({ key: "Время входа", value: localTime() });

    card.innerHTML = `
      <p class="gate__brand"><span class="brand__mark" aria-hidden="true"></span> вход выполнен</p>
      <h2 class="gate__title" id="gate-title">Профиль посетителя</h2>
      <p class="gate__text">
        ${
          network
            ? "Сервер получил это сам, до всяких кнопок:"
            : "Локальная копия: сервер недоступен, но браузер сообщил это:"
        }
      </p>
      <ul class="gate__leak" role="list">${net.map(rowHtml).join("")}</ul>
      <p class="gate__verdict">Устройство и настройки</p>
      <ul class="gate__leak" role="list">${device.map(rowHtml).join("")}</ul>
      <p class="gate__verdict">Что добавилось от аккаунта</p>
      <ul class="gate__leak" role="list">${makeIdentity().map(rowHtml).join("")}</ul>
      <div class="gate__actions">
        <button class="btn btn--primary" type="button" id="gate-continue">Продолжить</button>
      </div>`;

    const closeBtn = card.querySelector("#gate-continue");
    closeBtn.addEventListener("click", close);
    closeBtn.focus({ preventScroll: true });
  };

  // Esc не закрывает окно: смысл в том, что выход — отдельное решение.
  gate.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      const focusable = [...card.querySelectorAll("button:not([disabled])")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  let shown = "0";
  try {
    shown = sessionStorage.getItem(SESSION_KEY) || "0";
  } catch {
    shown = "0";
  }

  if (shown === "1") {
    // Возвращающийся читатель: окно не показываем. Но класс-«замок» стоит в разметке
    // с самого начала (чтобы содержимое не мигало до отрисовки шлюза), поэтому его
    // обязательно надо снять — иначе страница останется без прокрутки.
    document.body.classList.remove("gated");
  } else {
    open();
  }

  document.getElementById("replay-gate")?.addEventListener("click", open);
}
