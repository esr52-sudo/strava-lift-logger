import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, proxy /api to the FastAPI backend on :8000 so the frontend can call
// it without CORS. In production the backend serves the built files directly.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Override with VITE_API_PROXY when the backend isn't on the default port.
      "/api": process.env.VITE_API_PROXY || "http://localhost:8000",
    },
  },
});
