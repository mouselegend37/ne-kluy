#!/usr/bin/env node
/* Макет экрана вызова — сразу в двух форматах для Figma.
 *
 * Значения берутся из src/phone.js (DESIGN, BUTTONS, ISLAND, COLOR), поэтому
 * макет не расходится с тем, что нарисовано на сайте: поменялся радиус кнопки
 * в коде — поменялся и во Figma.
 *
 *   node tools/figma-mockup.mjs
 *   → tools/figma-out/call-screen.json   (для плагина: «Собрать во Figma»)
 *   → tools/figma-out/call-screen.svg    (перетащить файл в Figma)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SRC = path.resolve("src/phone.js");
const OUT = path.resolve("tools/figma-out");

const source = await readFile(SRC, "utf8");

/* Разбор без регулярок: значения берём по подстрокам — так не зависит от экранирования. */
const readNumbers = (marker, count) => {
  const at = source.indexOf(marker);
  if (at < 0) throw new Error(`не нашёл "${marker}" в src/phone.js`);
  const chunk = source.slice(at + marker.length, at + marker.length + 120);
  const numbers = chunk.match(/\d+/g) || [];
  if (numbers.length < count) throw new Error(`в "${marker}" меньше ${count} чисел`);
  return numbers.slice(0, count).map(Number);
};

const [W, H] = readNumbers('const DESIGN = { w: ', 2);
const [islandW, islandH, islandTop] = readNumbers('const ISLAND = { w: ', 3);
const ISLAND = { w: islandW, h: islandH, top: islandTop };

const button = (id) => {
  const [x, y, r] = readNumbers(`${id}: { x: `, 3);
  const labelAt = source.indexOf(`${id}: { x: `);
  const labelMatch = /label: "([^"]+)"/.exec(source.slice(labelAt, labelAt + 120));
  return { x, y, r, label: labelMatch ? labelMatch[1] : id };
};
const decline = button("decline");
const answer = button("answer");

const colorBlockStart = source.indexOf("const COLOR = {");
const colorBlock = source.slice(colorBlockStart, source.indexOf("};", colorBlockStart));
const color = (key) => {
  const at = colorBlock.indexOf(`${key}: "`);
  if (at < 0) return null;
  const rest = colorBlock.slice(at + key.length + 3);
  return rest.slice(0, rest.indexOf('"'));
};

const C = {
  top: color("screenTop") || "#101a26",
  bottom: color("screenBottom") || "#04060b",
  text: color("text") || "#f3f6fb",
  decline: color("decline") || "#ff453a",
  accept: color("accept") || "#30d158",
  island: color("island") || "#000000",
};

const radius = 74; // скругление экрана в дизайн-сетке
const islandX = (W - ISLAND.w) / 2;
const cx = W / 2;

/* ── дерево для плагина ───────────────────────────────────────────── */

const text = (name, x, y, width, height, value, options = {}) => ({
  type: "TEXT",
  name,
  x,
  y,
  width,
  height,
  text: value,
  fontSize: options.size || 24,
  align: options.align || "CENTER",
  color: options.color || C.text,
  font: options.font,
});

const circle = (name, x, y, d, fill) => ({
  type: "RECTANGLE",
  name,
  x: x - d / 2,
  y: y - d / 2,
  width: d,
  height: d,
  fill,
  radius: d / 2,
});

const screen = {
  name: "Экран вызова · iPhone",
  type: "FRAME",
  x: 0,
  y: 0,
  width: W,
  height: H,
  fill: C.bottom,
  radius,
  children: [
    { type: "RECTANGLE", name: "фон · верх", x: 0, y: 0, width: W, height: Math.round(H * 0.55), fill: C.top },
    { type: "RECTANGLE", name: "фон · низ", x: 0, y: Math.round(H * 0.45), width: W, height: Math.round(H * 0.55), fill: C.bottom },
    circle("аватар", cx, 322, 166, "#1b2433"),
    text("аватар · знак", cx - 166 / 2, 322 - 30, 166, 60, "?", { size: 64, color: C.text }),
    text("имя", 0, 430, W, 56, "Неизвестный", { size: 44 }),
    text("номер", 0, 478, W, 34, "+7 900 •••-14-14", { size: 27 }),
    text("тип номера", 0, 512, W, 26, "мобильный", { size: 20, color: "#8b97a9" }),
    text("часы", 24, 44, 90, 30, "18:54", { size: 26, align: "LEFT" }),
    {
      type: "FRAME",
      name: "значок VPN",
      x: 120,
      y: 46,
      width: 58,
      height: 24,
      fill: "#123243",
      radius: 12,
      children: [text("VPN", 120, 49, 58, 18, "VPN", { size: 13, color: "#7ee4ff" })],
    },
    { type: "RECTANGLE", name: "сигнал", x: W - 108, y: 52, width: 22, height: 14, fill: C.text, radius: 2 },
    { type: "RECTANGLE", name: "wifi", x: W - 78, y: 52, width: 18, height: 14, fill: C.text, radius: 3 },
    { type: "RECTANGLE", name: "батарея", x: W - 50, y: 50, width: 28, height: 16, fill: C.text, radius: 4 },
    {
      type: "FRAME",
      name: "динамический остров",
      x: islandX,
      y: ISLAND.top,
      width: ISLAND.w,
      height: ISLAND.h,
      fill: C.island,
      radius: ISLAND.h / 2,
      children: [
        circle("камера Face ID", islandX + ISLAND.w - 40, ISLAND.top + ISLAND.h / 2, 14, "#101318"),
      ],
    },
    circle("кнопка · отклонить", decline.x, decline.y, decline.r * 2, C.decline),
    text("подпись · отклонить", decline.x - 70, decline.y + decline.r + 22, 140, 28, decline.label, { size: 21 }),
    circle("кнопка · ответить", answer.x, answer.y, answer.r * 2, C.accept),
    text("подпись · ответить", answer.x - 70, answer.y + answer.r + 22, 140, 28, answer.label, { size: 21 }),
  ],
};

const payload = {
  file: "НЕ КЛЮЙ",
  page: "Экран телефона",
  generated: new Date().toISOString(),
  nodes: [screen],
};

/* ── SVG ──────────────────────────────────────────────────────────── */

const esc = (value) => String(value).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]);
const svgText = (x, y, value, size, fill, weight = 600, family = "Golos Text, Inter, sans-serif") =>
  `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="middle">${esc(value)}</text>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="wall" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.top}"/><stop offset="1" stop-color="${C.bottom}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.32" r="0.55">
      <stop offset="0" stop-color="#37e0bd" stop-opacity="0.30"/>
      <stop offset="0.55" stop-color="#ff6157" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="screen"><rect width="${W}" height="${H}" rx="${radius}"/></clipPath>
  </defs>
  <g clip-path="url(#screen)">
    <rect width="${W}" height="${H}" fill="url(#wall)"/>
    <rect width="${W}" height="${H}" fill="url(#glow)"/>
    <circle cx="${cx}" cy="322" r="${166 / 2}" fill="#1b2433" stroke="#2b3648"/>
    ${svgText(cx, 344, "?", 64, C.text)}
    ${svgText(cx, 470, "Неизвестный", 44, C.text)}
    ${svgText(cx, 506, "+7 900 •••-14-14", 27, C.text, 500, "JetBrains Mono, ui-monospace, monospace")}
    ${svgText(cx, 536, "мобильный", 20, "#8b97a9", 400)}
    <rect x="${islandX}" y="${ISLAND.top}" width="${ISLAND.w}" height="${ISLAND.h}" rx="${ISLAND.h / 2}" fill="${C.island}"/>
    <circle cx="${islandX + ISLAND.w - 40}" cy="${ISLAND.top + ISLAND.h / 2}" r="7" fill="#101318"/>
    <!-- строка состояния -->
    ${svgText(70, 62, "18:54", 26, C.text, 600)}
    <rect x="106" y="46" width="58" height="24" rx="12" fill="#123243"/>
    ${svgText(135, 63, "VPN", 13, "#7ee4ff", 700)}
    <rect x="${W - 108}" y="52" width="22" height="14" rx="2" fill="${C.text}" opacity="0.92"/>
    <rect x="${W - 78}" y="52" width="18" height="14" rx="3" fill="${C.text}" opacity="0.92"/>
    <rect x="${W - 50}" y="50" width="26" height="16" rx="5" fill="none" stroke="${C.text}" stroke-opacity="0.8" stroke-width="2"/>
    <rect x="${W - 47}" y="53" width="18" height="10" rx="2" fill="${C.text}"/>
    <!-- кнопки с трубкой -->
    <circle cx="${decline.x}" cy="${decline.y}" r="${decline.r}" fill="${C.decline}"/>
    <g transform="translate(${decline.x} ${decline.y}) rotate(135) scale(1.9)" fill="#ffffff">
      <path d="M-7-9c-2 0-4 2-4 4 0 9 7 16 16 16 2 0 4-2 4-4v-4l-6-2-3 3c-3-2-5-4-6-7l3-3-2-6z"/>
    </g>
    ${svgText(decline.x, decline.y + decline.r + 34, decline.label, 21, C.text, 400)}
    <circle cx="${answer.x}" cy="${answer.y}" r="${answer.r}" fill="${C.accept}"/>
    <g transform="translate(${answer.x} ${answer.y}) scale(1.9)" fill="#ffffff">
      <path d="M-7-9c-2 0-4 2-4 4 0 9 7 16 16 16 2 0 4-2 4-4v-4l-6-2-3 3c-3-2-5-4-6-7l3-3-2-6z"/>
    </g>
    ${svgText(answer.x, answer.y + answer.r + 34, answer.label, 21, C.text, 400)}
  </g>
</svg>`;

await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, "call-screen.json"), JSON.stringify(payload, null, 2), "utf8");
await writeFile(path.join(OUT, "call-screen.svg"), svg, "utf8");

console.log(`сетка ${W}×${H}, остров ${ISLAND.w}×${ISLAND.h}, кнопки r=${decline.r}`);
console.log("tools/figma-out/call-screen.json — плагин: «Собрать во Figma»");
console.log("tools/figma-out/call-screen.svg — перетащить в Figma");
