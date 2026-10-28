import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The app runs locally, so one 650 kB bundle is fine
  build: { chunkSizeWarningLimit: 1000 },
  server: {
    host: "127.0.0.1",
    // During development, API calls go to the Python server on port 8000
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
});
