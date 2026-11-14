import { alphaTab } from "@coderline/alphatab-vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const apiPort = Number(process.env.PORT ?? 5182);

export default defineConfig({
  root: "web",
  plugins: [react(), alphaTab()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: Number(process.env.WEB_PORT ?? 5183),
    proxy: { "/api": { target: `http://127.0.0.1:${apiPort}` } },
  },
});
