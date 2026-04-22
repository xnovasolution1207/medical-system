import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    allowedHosts: [".modal.host"],
    hmr: {
      overlay: false,
    },
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      "/ws": { target: "ws://localhost:3001", ws: true, changeOrigin: true },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
