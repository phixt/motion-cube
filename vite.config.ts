import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
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
