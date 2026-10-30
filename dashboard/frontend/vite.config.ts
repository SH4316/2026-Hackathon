import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const target = env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8080";
  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: true,
      proxy: {
        "/api": target,
        "/swagger-ui": target,
        "/v3": target,
      },
    },
    preview: { host: "127.0.0.1", port: 4173 },
    test: {
      environment: "jsdom",
      restoreMocks: true,
      clearMocks: true,
    },
  };
});
