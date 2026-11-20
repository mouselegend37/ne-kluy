/**
 * Тренажёр-КИМ: по одному вопросу, без таймера, с объяснением после ответа.
 * Прогресс не сохраняется на сервере — состояние только в памяти страницы.
 */
import { SCENARIOS } from "./data/quiz.js";

const KEYS = ["А", "Б", "В", "Г"];

const escapeHtml = (value) =>
  String(value).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

function resultText(correct, total) {
  const share = correct / total;
  if (share === 1) return "Идеально. Схемы, которые вы разобрали, теперь узнаются на первом признаке.";
  if (share >= 0.8) return "Сильный результат. Осталось закрепить пару формулировок — вернитесь к ним через неделю.";
  if (share >= 0.5) return "Половина — это уже лучше, чем ничего, но схемы пока узнаются не сразу. Пройдите тренажёр ещё раз.";
  return "Пока тяжело. Начните с раздела «Как обманывают» — там четыре шага, которые повторяются в любой схеме.";
}

export function initTrainer(root) {
  if (!root) return;

  let index = 0;
  let correct = 0;
  let answered = false;

  function render() {
    const item = SCENARIOS[index];
    const progress = Math.round(((index + (answered ? 1 : 0)) / SCENARIOS.length) * 100);

    root.innerHTML = `
      <div class="trainer__bar">
        <span class="trainer__step">Ситуация ${index + 1} / ${SCENARIOS.length}</span>
        <div class="trainer__progress"><i style="width:${progress}%"></i></div>
        <span class="trainer__score">Верно: ${correct}</span>
      </div>
      <span class="trainer__tag">${escapeHtml(item.audience)} · ${escapeHtml(item.tag)}</span>
      <p class="trainer__scenario">${escapeHtml(item.scenario)}</p>
      <div class="trainer__options" role="group" aria-label="Варианты ответа">
        ${item.options
          .map(
            (option, position) =>
              `<button class="option" type="button" data-index="${position}">
                 <span class="option__key">${KEYS[position]}</span>
                 <span>${escapeHtml(option)}</span>
               </button>`,
          )
          .join("")}
      </div>
      <div id="trainer-feedback" aria-live="polite"></div>
      <div class="trainer__nav">
        <button class="btn btn--primary" type="button" id="trainer-next" hidden>
          ${index === SCENARIOS.length - 1 ? "Показать результат" : "Следующая ситуация"}
        </button>
      </div>`;
  }

  function answer(choice) {
    if (answered) return;
    answered = true;
    const item = SCENARIOS[index];
    const isRight = choice === item.correct;
    if (isRight) correct += 1;

    root.querySelectorAll(".option").forEach((button, position) => {
      button.disabled = true;
      if (position === item.correct) button.classList.add("option--correct");
      else if (position === choice) button.classList.add("option--wrong");
    });

    const feedback = root.querySelector("#trainer-feedback");
    feedback.innerHTML = `
      <div class="trainer__feedback" data-ok="${isRight}">
        <p class="trainer__verdict">${isRight ? "Верно" : "Неверно"}</p>
        <p class="trainer__why">${escapeHtml(item.why)}</p>
        <p class="trainer__signal">Признак: ${escapeHtml(item.signal)}</p>
      </div>`;

    const score = root.querySelector(".trainer__score");
    if (score) score.textContent = `Верно: ${correct}`;

    const next = root.querySelector("#trainer-next");
    next.hidden = false;
    next.focus({ preventScroll: true });
  }

  function finish() {
    const share = correct / SCENARIOS.length;
    root.innerHTML = `
      <div class="trainer__result">
        <p class="trainer__ring">${correct} / ${SCENARIOS.length}</p>
        <h3>${share === 1 ? "Чисто" : share >= 0.5 ? "Есть над чем работать" : "Нужно повторить"}</h3>
        <p>${escapeHtml(resultText(correct, SCENARIOS.length))}</p>
        <div class="trainer__again">
          <button class="btn btn--primary" type="button" id="trainer-restart">Пройти заново</button>
          <a class="btn btn--ghost" href="#check">Разобрать своё сообщение</a>
        </div>
      </div>`;

    root.querySelector("#trainer-restart").addEventListener("click", () => {
      index = 0;
      correct = 0;
      answered = false;
      render();
      root.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  root.addEventListener("click", (event) => {
    const option = event.target.closest(".option");
    if (option) {
      answer(Number(option.dataset.index));
      return;
    }
    if (event.target.closest("#trainer-next")) {
      if (index === SCENARIOS.length - 1) {
        finish();
        return;
      }
      index += 1;
      answered = false;
      render();
    }
  });

  render();
}
