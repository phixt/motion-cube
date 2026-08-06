import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
  },
  optimizeDeps: {
    // 预打包 cubing（体积大且入口多），避免 dev 首次加载时中途重优化返回 504
    include: ["cubing/twisty", "cubing/alg"],
  },
});
