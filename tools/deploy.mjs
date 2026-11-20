#!/usr/bin/env node
/**
 * Публикация сайта «НЕ КЛЮЙ» на surge.sh.
 *
 *   npm run deploy                 → собирает dist и заливает на домен по умолчанию
 *   npm run deploy -- --domain ne-kluy.surge.sh
 *
 * Учётные данные берутся из окружения (или из ~/.netrc, который пишет `npx surge login`):
 *   SURGE_LOGIN=адрес@почта
 *   SURGE_TOKEN=токен   (получить: npx surge token)
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_DOMAIN = "nekluy.surge.sh";
const args = process.argv.slice(2);
const domainArg = args.indexOf("--domain");
const domain = domainArg !== -1 ? args[domainArg + 1] : DEFAULT_DOMAIN;

const run = (cmd, cmdArgs) => {
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) process.exit(res.status ?? 1);
};

const dist = resolve("dist");
if (!existsSync(resolve(dist, "index.html"))) {
  console.log("→ dist/index.html нет, собираю");
  run("npm", ["run", "build"]);
}

console.log(`→ публикую ${dist} на https://${domain}`);
run("npx", ["surge", dist, domain]);
console.log(`\nГотово: https://${domain}`);
