#!/usr/bin/env node
/**
 * 同步 WinUIonWeb 控件源码到 src/vendor/winui-on-web（GPL-3.0，见 THIRD_PARTY_NOTICES.md）。
 *
 * 用法：
 *   node scripts/sync-winui.mjs                     # 浅克隆上游最新 master
 *   node scripts/sync-winui.mjs --source <dir>      # 复用本地已有克隆（不联网）
 *   node scripts/sync-winui.mjs --ref <commit|branch>  # 固定上游引用
 *
 * 脚本职责：
 *   1. 取得上游源码（本地克隆或重新浅克隆）并记录 commit。
 *   2. 整目录复制 components / styles / utils / 字体 / LICENSE 到 vendor 目录。
 *   3. 给所有复制进来的 .vue/.ts/.js 注入 @ts-nocheck 与来源头注释：
 *      - .vue：@ts-nocheck 写在每个 <script> 块首行（vue-tsc 只认 script 块内的指令）；
 *      - .ts/.js：@ts-nocheck 写在文件首行。
 *   4. 生成 VENDOR.json（上游 commit / 日期 / 文件清单摘要）与根目录 THIRD_PARTY_NOTICES.md。
 */

import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const UPSTREAM_URL = "https://github.com/Furry-Xiyi/WinUIonWeb.git";
const DEFAULT_REF = "master";
const VENDOR_DIR = join(REPO_ROOT, "src", "vendor", "winui-on-web");
const NOTICES_PATH = join(REPO_ROOT, "THIRD_PARTY_NOTICES.md");

const parseArgs = () => {
  const args = process.argv.slice(2);
  const get = (name) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  return { source: get("--source"), ref: get("--ref") ?? DEFAULT_REF };
};

const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();

const git = (args, cwd) => run("git", args, { cwd });

const getCommit = async (sourceDir) => {
  const hash = git(["rev-parse", "HEAD"], sourceDir);
  const date = git(["log", "-1", "--format=%cI"], sourceDir);
  const subject = git(["log", "-1", "--format=%s"], sourceDir);
  return { hash, date, subject };
};

const prepareSource = async ({ source, ref }) => {
  if (source) {
    const resolved = resolve(source);
    const commit = await getCommit(resolved);
    return { dir: resolved, commit, reused: true };
  }
  const dir = await mkdtemp(join(tmpdir(), "winui-sync-"));
  git(["clone", "--depth", "1", "--branch", ref, UPSTREAM_URL, dir]);
  const commit = await getCommit(dir);
  return { dir, commit, reused: false };
};

const mkdtemp = async (prefix) => {
  const dir = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await mkdir(dir, { recursive: true });
  return dir;
};

const ensureTsNoCheck = (content, isVue) => {
  if (isVue) {
    // 每个 <script ...> 块首行注入 @ts-nocheck（vue-tsc 不认 SFC 顶部注释）
    return content.replace(/(<script[^>]*>)(\r?\n)/g, (m, open, nl) => {
      if (content.slice(0, m.length).includes("@ts-nocheck")) return m; // 已注入过（首个块）
      return `${open}${nl}// @ts-nocheck${nl}`;
    });
  }
  return content.startsWith("// @ts-nocheck") ? content : `// @ts-nocheck\n${content}`;
};

const HEADER = (commit, fileRel) =>
  [
    "// Vendored from WinUIonWeb (https://github.com/Furry-Xiyi/WinUIonWeb)",
    `// commit ${commit.hash} (${commit.date}) - ${fileRel}`,
    "// License: GPL-3.0 (see src/vendor/winui-on-web/LICENSE and THIRD_PARTY_NOTICES.md)",
    "// Managed by scripts/sync-winui.mjs - do not edit by hand.",
    "",
  ].join("\n");

const collectFiles = async (dir) => {
  const out = [];
  const walk = async (d) => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(full);
    }
  };
  await walk(dir);
  return out;
};

const injectHeaders = async (commit) => {
  const files = await collectFiles(VENDOR_DIR);
  let injected = 0;
  for (const file of files) {
    const rel = relative(VENDOR_DIR, file).split(sep).join("/");
    if (/\.(vue|ts|js|mjs|json)$/.test(file) === false) continue;
    let content = await readFile(file, "utf8");
    const isVue = file.endsWith(".vue");
    const needsNoCheck = isVue || /\.(ts|js|mjs)$/.test(file);
    if (needsNoCheck) content = ensureTsNoCheck(content, isVue);
    if (!isVue && !content.startsWith("// Vendored from WinUIonWeb")) {
      content = HEADER(commit, rel) + content;
    }
    await writeFile(file, content, "utf8");
    injected += 1;
  }
  return { files: files.length, injected };
};

const main = async () => {
  const { source, ref } = parseArgs();
  const { dir: srcRoot, commit, reused } = await prepareSource({ source, ref });
  const src = join(srcRoot, "WinUIonWeb");

  console.log(`[sync-winui] upstream commit: ${commit.hash} (${commit.date}) ${reused ? "[reused local clone]" : "[fresh shallow clone]"}`);

  // 1) 整目录复制
  await rm(VENDOR_DIR, { recursive: true, force: true });
  await mkdir(join(VENDOR_DIR, "assets", "Fonts"), { recursive: true });
  const copies = [
    [join(src, "src", "components"), join(VENDOR_DIR, "components")],
    [join(src, "src", "styles"), join(VENDOR_DIR, "styles")],
    [join(src, "src", "utils"), join(VENDOR_DIR, "utils")],
    [join(src, "src", "assets", "Fonts", "SEGOEICONS.TTF"), join(VENDOR_DIR, "assets", "Fonts", "SEGOEICONS.TTF")],
    [join(srcRoot, "LICENSE"), join(VENDOR_DIR, "LICENSE")],
  ];
  for (const [from, to] of copies) {
    const st = await stat(from);
    if (st.isDirectory()) await cp(from, to, { recursive: true });
    else await cp(from, to);
  }

  // 2) 注入 @ts-nocheck 与来源头
  const { files, injected } = await injectHeaders(commit);

  // 3) VENDOR.json
  const vendorJson = {
    name: "winui-on-web",
    upstream: UPSTREAM_URL,
    ref: reused ? undefined : ref,
    commit: commit.hash,
    date: commit.date,
    subject: commit.subject,
    license: "GPL-3.0",
    copiedDirs: ["components", "styles", "utils", "assets/Fonts"],
    files: files,
    headerInjectedFiles: injected,
    syncCommand: "node scripts/sync-winui.mjs",
  };
  await writeFile(join(VENDOR_DIR, "VENDOR.json"), JSON.stringify(vendorJson, null, 2) + "\n", "utf8");

  // 4) THIRD_PARTY_NOTICES.md
  const notices = `# Third-Party Notices

## WinUIonWeb (Vue WinUI 控件库)

- 项目：https://github.com/Furry-Xiyi/WinUIonWeb
- 许可证：GNU GPL v3（见 [src/vendor/winui-on-web/LICENSE](src/vendor/winui-on-web/LICENSE)）
- 上游 commit：\`${commit.hash}\`（${commit.date}，${commit.subject}）
- 用途：motion-cube 的 WinUI 风格 UI 控件（Vue 组件 + 主题样式 + 图标字体）
- 同步方式：\`node scripts/sync-winui.mjs\`（清单见 src/vendor/winui-on-web/VENDOR.json）
- 本地修改：仅自动注入 \`// @ts-nocheck\` 与来源头注释，未改动业务逻辑。

> 依据 GPL-3.0，motion-cube 若对外分发（如公开托管 / 发布），整体须以 GPL-3.0 授权。
`;
  await writeFile(NOTICES_PATH, notices, "utf8");

  console.log(`[sync-winui] done: ${files} files copied, ${injected} header-injected`);
  console.log(`[sync-winui] vendored at src/vendor/winui-on-web, notices at THIRD_PARTY_NOTICES.md`);
};

main().catch((err) => {
  console.error("[sync-winui] failed:", err.message);
  process.exitCode = 1;
});
