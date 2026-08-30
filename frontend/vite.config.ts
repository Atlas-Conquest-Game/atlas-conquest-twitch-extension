import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Twitch serves the built files from a versioned path, so every asset
  // reference has to be relative.
  base: "./",
  build: {
    rollupOptions: {
      input: {
        video_overlay: "video_overlay.html",
      },
    },
  },
});
