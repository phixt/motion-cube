// 探针：打开 /render-demo，抓 console/pageerror 与 DOM 状态（排查白屏）
import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const executablePath = existsSync(CHROME) ? CHROME : EDGE;
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--window-size=1280,800"],
  defaultViewport: { width: 1280, height: 800 },
});
const page = await browser.newPage();
page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 500)));
await page.goto("http://localhost:5174/#/render-demo", { waitUntil: "networkidle0", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));
const info = await page.evaluate(() => ({
  hash: location.hash,
  rdemo: !!document.querySelector(".rdemo"),
  rstage: !!document.querySelector(".rstage"),
  canvas: !!document.querySelector(".rstage canvas"),
  rbar: !!document.querySelector(".rbar"),
  bodyHtml: document.body.innerHTML.slice(0, 400),
}));
console.log("STATE:", JSON.stringify(info, null, 2));
await page.screenshot({ path: "spike-shots/probe-render.png" });
await browser.close();