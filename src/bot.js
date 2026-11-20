/**
 * Дозор — разбор подозрительного сообщения.
 *
 * Всё считается локально: текст не покидает страницу, запросов нет.
 * Оценка эвристическая (сумма весов признаков), поэтому в интерфейсе
 * прямо сказано, что это не заключение эксперта.
 */
import { EXAMPLES, SIGNALS, WEIGHT_POINTS } from "./data/signals.js";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeHtml = (value) => value.replace(/[&<>"]/g, (ch) => ESCAPES[ch]);

/**
 * Приводит текст к виду для поиска, сохраняя длину 1:1 —
 * иначе индексы находок не совпадут с исходной строкой.
 */
function normalize(text) {
  return text.replace(/[Ёё]/g, (ch) => (ch === "Ё" ? "Е" : "е")).toLowerCase()
    .replace(/[\r\n\t\u00a0]/g, " ");
}

const LEVELS = [
  { max: 19, level: "low", label: "Признаков не видно" },
  { max: 44, level: "mid", label: "Есть тревожные признаки" },
  { max: 69, level: "high", label: "Похоже на мошенничество" },
  { max: Infinity, level: "critical", label: "Это мошенничество" },
];

const VERDICTS = {
  low:
    "Явных признаков обмана в тексте нет. Это не гарантия: мошенник может писать коротко и без давления. " +
    "Проверьте отправителя и не переходите по ссылкам, если не ждали сообщения.",
  mid:
    "В сообщении есть признаки, которые встречаются в схемах обмана. Сами по себе они не приговор, " +
    "но продолжать разговор на условиях отправителя нельзя.",
  high:
    "Совпадает несколько элементов известной схемы. Скорее всего, цель сообщения — ваши деньги или доступ к аккаунту.",
  critical:
    "Совпадает решающий признак схемы. Такие сообщения не обсуждают и не уточняют — их закрывают и блокируют отправителя.",
};

export function analyze(rawText) {
  const text = String(rawText ?? "");
  const haystack = normalize(text);

  const matches = [];
  const hitSignals = new Map();

  for (const signal of SIGNALS) {
    for (const pattern of signal.patterns) {
      const scan = new RegExp(pattern.source, "g");
      let found = scan.exec(haystack);
      while (found !== null) {
        if (found[0].length > 0) {
          matches.push({ start: found.index, end: found.index + found[0].length, signal: signal.id });
          if (!hitSignals.has(signal.id)) hitSignals.set(signal.id, signal);
        }
        if (scan.lastIndex === found.index) scan.lastIndex += 1;
        found = scan.exec(haystack);
      }
    }
  }

  const signals = [...hitSignals.values()].sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label, "ru"));
  const total = signals.reduce((sum, signal) => sum + signal.weight, 0);
  const score = Math.min(100, total * WEIGHT_POINTS);
  const { level, label } = LEVELS.find((row) => score <= row.max);

  const decisive = signals.filter((signal) => signal.weight >= 4).length;
  const advice = [];
  for (const signal of signals) {
    if (advice.length >= 4) break;
    if (!advice.includes(signal.advice)) advice.push(signal.advice);
  }

  return {
    score,
    level,
    levelLabel: label,
    verdict: VERDICTS[level],
    signals,
    matches,
    decisive,
    advice,
    length: text.trim().length,
  };
}

/** Подсвечивает находки в исходном тексте, экранируя HTML по кускам. */
export function highlight(text, matches) {
  if (!matches.length) return escapeHtml(text);
  const sorted = [...matches].sort((a, b) => a.start - b.start || b.end - a.end);
  let cursor = 0;
  let html = "";
  for (const match of sorted) {
    if (match.start < cursor) continue;
    const severe = SIGNALS.find((signal) => signal.id === match.signal)?.weight >= 4;
    html += escapeHtml(text.slice(cursor, match.start));
    html += `<mark class="marked" data-severe="${severe}">${escapeHtml(text.slice(match.start, match.end))}</mark>`;
    cursor = match.end;
  }
  html += escapeHtml(text.slice(cursor));
  return html;
}

export function initBot() {
  const form = document.getElementById("bot-form");
  const input = document.getElementById("bot-input");
  const clear = document.getElementById("bot-clear");
  const counter = document.getElementById("bot-counter");
  const examples = document.getElementById("bot-examples");
  const result = document.getElementById("bot-result");
  if (!form || !input || !result) return;

  const syncCounter = () => {
    const length = input.value.trim().length;
    counter.textContent = `${length} ${length % 10 === 1 && length % 100 !== 11 ? "символ" : "символов"}`;
  };

  if (examples) {
    for (const example of EXAMPLES) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = example.title;
      chip.addEventListener("click", () => {
        input.value = example.text;
        syncCounter();
        input.focus();
        run();
      });
      examples.append(chip);
    }
  }

  function run() {
    const text = input.value.trim();
    if (text.length < 12) {
      result.hidden = false;
      result.innerHTML =
        '<div class="verdict__clean"><p class="verdict__text">Слишком короткий фрагмент — по нему нечего разбирать. ' +
        "Вставьте сообщение целиком: приветствие, требование и подпись обычно и выдают схему.</p></div>";
      return;
    }

    const report = analyze(text);
    result.hidden = false;

    const signalsHtml = report.signals
      .map(
        (signal) => `
        <li class="signal" data-weight="${signal.weight}">
          <span class="signal__mark">${signal.weight >= 4 ? "!!" : "+"}</span>
          <span>
            <span class="signal__label">${escapeHtml(signal.label)}</span>
            <span class="signal__why">${escapeHtml(signal.why)}</span>
            <span class="signal__advice">${escapeHtml(signal.advice)}</span>
          </span>
        </li>`,
      )
      .join("");

    const adviceHtml = report.advice
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");

    const body =
      report.signals.length === 0
        ? `<div class="verdict__clean"><p class="verdict__text">${escapeHtml(report.verdict)}</p></div>
           <div class="verdict__actions">
             <a class="btn btn--ghost" href="#trainer">Проверить себя в тренажёре</a>
             <a class="btn btn--ghost" href="#help">Куда обращаться</a>
           </div>`
        : `<p class="verdict__text">${escapeHtml(report.verdict)}${
            report.decisive > 0
              ? ` Решающих признаков: ${report.decisive}.`
              : ""
          }</p>
           <pre class="marked-text" aria-label="Найденные признаки в тексте">${highlight(text, report.matches)}</pre>
           <ul class="signals" role="list">${signalsHtml}</ul>
           <div class="verdict__actions">
             <a class="btn btn--ghost" href="#trainer">Тренажёр: 10 ситуаций</a>
             <a class="btn btn--ghost" href="#help">Если деньги уже ушли</a>
           </div>`;

    result.innerHTML = `
      <div class="verdict__head">
        <p class="verdict__level" data-level="${report.level}">${escapeHtml(report.levelLabel)}</p>
        <span class="verdict__score">риск ${report.score} / 100 · признаков: ${report.signals.length}</span>
      </div>
      <div class="meter" role="img" aria-label="Уровень риска ${report.score} из 100">
        <div class="meter__fill" style="width:${report.score}%"></div>
      </div>
      <div class="verdict__body">
        ${body}
        ${
          report.signals.length
            ? `<div><p class="eyebrow" style="margin:0 0 .4rem">Что делать</p><ol class="signals" role="list" style="list-style:decimal;padding-left:1.2rem;color:#c9d5e6;font-size:.92rem">${adviceHtml}</ol></div>`
            : ""
        }
        <p class="about__disclaimer" style="margin:0">
          Оценка эвристическая: движок ищет 30+ формальных признаков и не понимает смысл.
          Решение всегда за вами — при сомнении звоните в банк по номеру с карты.
        </p>
      </div>`;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run();
  });

  input.addEventListener("input", syncCounter);

  clear?.addEventListener("click", () => {
    input.value = "";
    result.hidden = true;
    result.innerHTML = "";
    syncCounter();
    input.focus();
  });

  syncCounter();
}
