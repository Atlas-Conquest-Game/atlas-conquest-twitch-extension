import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  // HTTPS with a self-signed certificate. Not optional: Twitch loads extension
  // pages in an iframe on an https origin, and a browser will refuse to embed an
  // http one. During Local Test the assets come straight from this server, so it
  // has to match the Testing Base URI byte for byte.
  //
  // The certificate is self-signed, so the first load must be accepted manually
  // in the browser — see the README. Until that happens the iframe fails
  // silently, which reads as "the extension is broken".
  plugins: [react(), basicSsl()],

  server: {
    // Twitch compares the Testing Base URI literally, so this port is fixed
    // rather than "whatever was free". strictPort makes a clash an error instead
    // of a silent move to 8444 and an extension that never loads.
    //
    // 8443 rather than the more usual 8080 because MCP for Unity binds
    // 127.0.0.1:8080 and starts with the project. Two servers on one port but
    // different interfaces is worse than a clash: the browser picks ::1 or
    // 127.0.0.1 on its own, so it can reach the plain-HTTP one and fail the TLS
    // handshake with an error that points nowhere near the cause.
    port: 8443,
    strictPort: true,
  },

  // Twitch serves the built files from a versioned path, so every asset
  // reference has to be relative.
  base: "./",
  build: {
    rollupOptions: {
      input: {
        video_overlay: "video_overlay.html",
        config: "config.html",
      },
    },
  },
});
