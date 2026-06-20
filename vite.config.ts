import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { APP_SHORT_DISPLAY_NAME, APP_SHORT_VERSION } from "./src/lib/app-metadata";

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(APP_SHORT_VERSION),
    "import.meta.env.VITE_APP_TITLE": JSON.stringify(APP_SHORT_DISPLAY_NAME),
  },
  plugins: [react(), tailwindcss()],
});
