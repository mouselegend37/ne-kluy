#!/usr/bin/env node
/* Figma REST API: чтение файла и выгрузка макетов картинками.
 *
 * Токен (бесплатный аккаунт Figma): Settings → Security → Personal access tokens.
 * Положить в переменную окружения FIGMA_TOKEN или в файл tools/.figma-token
 * (одна строка, файл в .gitignore — в репозиторий не попадает).
 *
 *   node tools/figma.mjs info   <fileKey>
 *   node tools/figma.mjs render <fileKey> <id,id,...> [--format png|svg] [--scale 2]
 *
 * fileKey — кусок адреса: figma.com/design/<fileKey>/<имя>?node-id=<id>
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const API = "https://api.figma.com/v1";
const OUT = path.resolve("tools/figma-out");

async function token() {
  if (process.env.FIGMA_TOKEN) return process.env.FIGMA_TOKEN.trim();
  try {
    return (await readFile("tools/.figma-token", "utf8")).trim();
  } catch {
    console.error("Нет токена. Положите его в FIGMA_TOKEN или tools/.figma-token.");
    console.error("Figma → Settings → Security → Personal access tokens (нужен scope file_content:read).");
    process.exit(1);
  }
}

// Персональные токены (figd_…) Figma принимает только в X-Figma-Token.
// OAuth-токены (eyJ…) — в Authorization: Bearer.
function authHeaders(token) {
  return token.startsWith("figd_") ? { "X-Figma-Token": token } : { Authorization: `Bearer ${token}` };
}

async function call(url, bearer) {
  const response = await fetch(url, { headers: authHeaders(bearer) });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${(await response.text()).slice(0, 300)}`);
  }
  return response.json();
}

function walk(node, depth = 0, sink = []) {
  if (["FRAME", "COMPONENT", "SECTION"].includes(node.type)) {
    sink.push({
      id: node.id,
      name: node.name,
      type: node.type,
      size: `${Math.round(node.absoluteBoundingBox?.width ?? 0)}×${Math.round(node.absoluteBoundingBox?.height ?? 0)}`,
      depth,
    });
    for (const child of node.children ?? []) walk(child, depth + 1, sink);
  } else {
    for (const child of node.children ?? []) walk(child, depth, sink);
  }
  return sink;
}

async function info(fileKey, bearer) {
  const file = await call(`${API}/files/${fileKey}?depth=3`, bearer);
  console.log(`${file.name} · изменён ${new Date(file.lastModified).toLocaleString("ru-RU")}`);
  for (const page of file.document.children) {
    console.log(`\nстраница «${page.name}»`);
    for (const frame of walk(page)) {
      console.log(`  ${"  ".repeat(frame.depth)}${frame.name}  ${frame.size}  ${frame.id}`);
    }
  }
}

async function render(fileKey, ids, format, scale, bearer) {
  const params = new URLSearchParams({ ids, format, scale: String(scale) });
  const { images, err } = await call(`${API}/images/${fileKey}?${params}`, bearer);
  if (err) throw new Error(err);
  await mkdir(OUT, { recursive: true });
  for (const [id, url] of Object.entries(images)) {
    if (!url) {
      console.warn(`${id}: Figma не отдала картинку`);
      continue;
    }
    const response = await fetch(url);
    const bytes = Buffer.from(await response.arrayBuffer());
    const name = `${id.replace(":", "-")}.${format}`;
    await writeFile(path.join(OUT, name), bytes);
    console.log(`${name}  ${(bytes.length / 1024).toFixed(0)} КБ`);
  }
  console.log(`всё в ${OUT}`);
}

/* Можно передать не только ключ, но и ссылку целиком — так удобнее:
   https://www.figma.com/design/AbCdEf123/Name?node-id=12-345&t=… */
function parseTarget(value) {
  if (!value) return { key: null, nodes: null };
  if (!value.includes("figma.com")) return { key: value, nodes: null };
  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);
  const kind = parts[0]; // design | file | board | proto
  const key = parts[1] || null;
  const nodeParam = url.searchParams.get("node-id");
  return { key, nodes: nodeParam ? nodeParam.replace(/-/g, ":") : null, kind };
}

const [command, rawTarget, ...rest] = process.argv.slice(2);
const target = parseTarget(rawTarget);
const fileKey = target.key;
if (!command || !fileKey) {
  console.log("node tools/figma.mjs info <fileKey>\nnode tools/figma.mjs render <fileKey> <ids> [--format png|svg] [--scale 2]");
  process.exit(1);
}

const bearer = await token();

try {
  if (command === "info") {
    await info(fileKey, bearer);
  } else if (command === "render") {
    const format = rest.includes("--format") ? rest[rest.indexOf("--format") + 1] : "png";
    const scale = rest.includes("--scale") ? Number(rest[rest.indexOf("--scale") + 1]) : 2;
    await render(fileKey, rest[0], format, scale, bearer);
  } else {
    console.error(`неизвестная команда: ${command}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Figma ответила ошибкой: ${error.message}`);
  console.error("Проверьте ключ файла (из адреса figma.com/design/<ключ>/…) и права токена.");
  process.exitCode = 1;
}
