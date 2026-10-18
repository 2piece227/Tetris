import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (name: string): string => fileURLToPath(new URL(name, import.meta.url));

// base "./" keeps asset paths relative so the same build works on
// GitHub Pages (https://<user>.github.io/Tetris/) and any static host.
export default defineConfig({
  base: "./",
  server: {
    host: true, // expose on LAN so the Quest headset can reach the dev server
  },
  build: {
    // One site, one page per mode. Each page loads only its own mode's code,
    // so the headset never downloads the versus renderer and vice versa.
    rollupOptions: {
      input: {
        menu: page("index.html"),
        vr: page("vr.html"),
        versus: page("versus.html"),
        review: page("review.html"),
      },
    },
  },
});
