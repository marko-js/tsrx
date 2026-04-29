import { defineConfig } from "vite";
import marko from "@marko/vite";
import tsrx from "@marko/vite-plugin-tsrx";

export default defineConfig({
  plugins: [
    // tsrx must run before @marko/vite so it can compile .tsrx → .marko
    // before Marko's own plugin sees the file.
    tsrx(),
    marko({ linked: false }),
  ],
});
