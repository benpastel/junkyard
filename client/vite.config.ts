import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const port = Number(process.env.CLIENT_PORT ?? 4710);
const serverPort = Number(process.env.SERVER_PORT ?? 4711);

export default defineConfig({
  plugins: [react()],
  server: {
    port,
    strictPort: true,
    proxy: { "/ws": { target: `ws://localhost:${serverPort}`, ws: true } },
  },
  preview: { port, strictPort: true },
});
