import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// On Vercel, /api/* requests are handled by Vercel's routing layer (see
// vercel.json), not a local backend server — so no dev proxy is configured.
export default defineConfig({
  plugins: [react()],
});
