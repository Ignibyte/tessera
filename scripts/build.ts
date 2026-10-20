// Builds src/index.ts three ways into dist/: an ES module (tessera.js), the same
// minified (tessera.min.js) and a minified IIFE for a plain <script> tag
// (tessera.iife.js, global `Tessera`). Idiomorph is bundled into each.
import { resolve } from "node:path";
import { build } from "vite";
import type { LibraryFormats } from "vite";

const root = resolve(import.meta.dirname, "..");

interface Output {
  fileName: string;
  format: LibraryFormats;
  minify: boolean;
}

const outputs: Output[] = [
  { fileName: "tessera.js", format: "es", minify: false },
  { fileName: "tessera.min.js", format: "es", minify: true },
  { fileName: "tessera.iife.js", format: "iife", minify: true },
];

for (const [index, output] of outputs.entries()) {
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
        entry: resolve(root, "src/index.ts"),
        name: "Tessera",
        formats: [output.format],
        fileName: () => output.fileName,
      },
    },
  });
  console.log(`built dist/${output.fileName}`);
}
