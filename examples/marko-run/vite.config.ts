import { defineConfig } from "vite";
import marko from "@marko/run/vite";
import tsrx from "@marko/vite-plugin-tsrx";

export default defineConfig({
  plugins: [marko(), tsrx()],
});
