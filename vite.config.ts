import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Empty prefix → load every var, including non-VITE_ ones if needed.
  const env = loadEnv(mode, process.cwd(), "");

  // Backend origin for /api and /ws proxies. WS target swaps http(s) → ws(s)
  // so callers only configure one URL.
  const backendHttp = env.VITE_BACKEND_URL || "http://localhost:3001";
  const backendWs = backendHttp.replace(/^http/i, "ws");

  return {
    server: {
      host: env.VITE_HOST || "::",
      port: Number(env.VITE_PORT) || 8080,
      allowedHosts: [".modal.host"],
      hmr: {
        overlay: false,
      },
      proxy: {
        "/api": { target: backendHttp, changeOrigin: true },
        "/ws": { target: backendWs, ws: true, changeOrigin: true },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
