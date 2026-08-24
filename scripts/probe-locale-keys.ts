// 检查 GamePage 所有 t() key 在 en/zh 都存在（避免面板新 key 漏文案）。
// node scripts/probe-locale-keys.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const base = resolve(import.meta.dirname, "../src/i18n/locales");
const enRaw = readFileSync(resolve(base, "en.ts"), "utf8");
const zhRaw = readFileSync(resolve(base, "zh-CN.ts"), "utf8");

// 取 key 集合（字符串 key: "...")
const keysOf = (raw: string): Set<string> => {
  const out = new Set<string>();
  const re = /^\s*"([^"]+)":/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.add(m[1]);
  return out;
};
const enKeys = keysOf(enRaw);
const zhKeys = keysOf(zhRaw);
const diffEn = [...zhKeys].filter((k) => !enKeys.has(k));
const diffZh = [...enKeys].filter((k) => !zhKeys.has(k));
console.log("en 缺项（zh 有 en 无）:", diffEn.length ? diffEn : "无");
console.log("zh 缺项（en 有 zh 无）:", diffZh.length ? diffZh : "无");