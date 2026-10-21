// Builds the two releases into dist/, each three ways: an ES module, the same minified, and a
// minified IIFE for a plain <script> tag that sets the global `Tessera` and starts by itself
// (src/auto.ts). `tessera.*` holds the trusted expression engine, `tessera.csp.*` the no-eval
// one. Idiomorph is bundled into each, and each has a source map.
import { resolve } from "node:path";
import { build } from "vite";
import { OUTPUTS } from "./release-files.ts";

const root = resolve(import.meta.dirname, "..");

for (const [index, output] of OUTPUTS.entries()) {
  await build({
    configFile: false,
    root,
    logLevel: "warn",
    build: {
      outDir: "dist",
      emptyOutDir: index === 0,
      target: "es2022",
      minify: output.minify ? "terser" : false,
      sourcemap: true,
      lib: {
        entry: resolve(root, output.entry),
        name: "Tessera",
        formats: [output.format],
        fileName: () => output.fileName,
      },
    },
  });
  console.log(`built dist/${output.fileName}`);
}
