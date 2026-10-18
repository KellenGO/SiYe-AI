import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { mockApi } from "./dev/mockApi";

// 本地预览台：不依赖四野主程序，用 mock 数据渲染 Panel，便于截图与迭代。
export default defineConfig({
  plugins: [react(), mockApi()],
  resolve: {
    alias: { "siye-host": path.resolve(process.cwd(), "dev/host.ts") },
  },
  server: { port: 5288, strictPort: true },
});
