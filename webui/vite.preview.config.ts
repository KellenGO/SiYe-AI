import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// 静态预览构建：产物可以直接用 file:// 打开，不需要监听端口。
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: { "siye-host": path.resolve(process.cwd(), "dev/host.ts") },
  },
  build: {
    outDir: "../.preview/site",
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(process.cwd(), "dev/index.html") },
  },
});
