import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

// A certificate issued by a locally-installed CA (mkcert), rather than a
// self-signed one.
//
// This is not a preference. Twitch loads the config page in an iframe, and Chrome
// refuses an untrusted certificate in a subframe with no way to click through --
// the request fails with ERR_CERT_AUTHORITY_INVALID and the panel renders empty,
// with nothing in the page console to say why. Accepting the certificate in a
// top-level tab does not help, and --ignore-certificate-errors is no longer
// honoured (Chrome 151 ignores it silently).
//
// Generate with:
//   mkcert -install
//   mkcert -key-file certs/localhost-key.pem -cert-file certs/localhost.pem localhost 127.0.0.1 ::1
const certDir = path.resolve(__dirname, "certs");
const keyPath = path.join(certDir, "localhost-key.pem");
const certPath = path.join(certDir, "localhost.pem");
const hasCert = fs.existsSync(keyPath) && fs.existsSync(certPath);

if (!hasCert) {
  // Loud, because the failure it prevents is silent.
  console.warn(
    "\n[vite] No certificate in frontend/certs — HTTPS will be self-signed and\n" +
    "       Twitch's config iframe will fail with ERR_CERT_AUTHORITY_INVALID.\n" +
    "       See the README section 'Running the frontend locally'.\n",
  );
}

export default defineConfig({
  plugins: [react()],

  server: {
    // Twitch compares the Testing Base URI literally, so this port is fixed
    // rather than "whatever was free". strictPort makes a clash an error instead
    // of a silent move to 8444 and an extension that never loads.
    //
    // 8443 rather than the more usual 8080 because MCP for Unity binds
    // 127.0.0.1:8080 and starts with the project.
    port: 8443,
    strictPort: true,

    // Dual-stack. Left to itself vite binds whichever loopback Node's resolver
    // returns first, which was ::1 alone: curl reached it, Chrome asked for
    // 127.0.0.1, got connection refused, and rendered a blank iframe.
    host: "::",

    https: hasCert
      ? { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }
      : undefined,
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
