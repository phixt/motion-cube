// _browser.mjs — 跨平台 Headless Chrome/Edge 启动与稳定导航工具（零额外依赖）。
//
// 解决 docs/audit/infra.md F3 三个阻塞点：
//   1. 跨平台浏览器路径解析（CHROME_PATH / Win Chrome+Edge / Linux chrome+chromium / macOS Chrome）；
//   2. 临时 userDataDir 自动回收；
//   3. openApp() 用 domcontentloaded + 显式 selector 等待（淘汰 networkidle0 假卡死与手工 reload）。
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const WIN_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const LINUX_CANDIDATES = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

const MAC_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];

export function resolveBrowserPath() {
  const fromEnv = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const list =
    process.platform === "win32"
      ? WIN_CANDIDATES
      : process.platform === "darwin"
        ? MAC_CANDIDATES
        : LINUX_CANDIDATES;
  for (const p of list) {
    if (existsSync(p)) return p;
  }
  throw new Error(
    `未找到可用的 Chrome/Edge 可执行文件（platform=${process.platform}）。请设置环境变量 CHROME_PATH。`,
  );
}

export async function launchBrowser(opts = {}) {
  const {
    prefix = "motion-cube-",
    width = 1280,
    height = 800,
    protocolTimeout = 120000,
    extraArgs = [],
  } = opts;
  const executablePath = resolveBrowserPath();
  const userDataDir = mkdtempSync(join(tmpdir(), prefix));
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
      `--user-data-dir=${userDataDir}`,
      `--window-size=${width},${height}`,
      ...extraArgs,
    ],
    defaultViewport: { width, height },
    protocolTimeout,
  });

  const origClose = browser.close.bind(browser);
  browser.close = async () => {
    try {
      await origClose();
    } finally {
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        /* 忽略 Windows 文件锁残留 */
      }
    }
  };
  return browser;
}

/**
 * 稳定打开应用页面：使用 domcontentloaded + 显式 selector 等待，
 * 避免 networkidle0 在 Vite 冷启动预打包 reload 竞态下 30s 超时。
 */
export async function openApp(page, url, readySelector = ".start-page", timeout = 30000) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.waitForSelector(readySelector, { timeout });
      return;
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      if (attempt === 0 && /context was destroyed|navigation|detached/i.test(msg)) {
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      throw err;
    }
  }
}
