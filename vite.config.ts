import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    watch: {
      // 忽略编辑器原子写临时目录（.<name>.<pid>.<uuid>.tmpdir\）——目录段名以 .tmpdir 结尾，
      // chokidar 对这类目录建 watch 时 Windows 上 EBUSY，导致 dev 每次编辑崩溃。
      // 模式须为 "*" .tmpdir（段名后缀），不是 ".tmpdir" 段。
      ignored: ["**/*.tmpdir/**", "**/*.tmp"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        preview: fileURLToPath(new URL("./preview.html", import.meta.url)),
      },
    },
  },
  optimizeDeps: {
    // 预打包 cubing（体积大且入口多），避免 dev 首次加载时中途重优化返回 504
    include: ["cubing/twisty", "cubing/alg"],
  },
});
