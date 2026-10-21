// What a release ships (docs/decisions.md, #19): two builds, each three ways, each with its
// source map, and SHA256SUMS over them. The build, the sums and the reference server read it here.
import type { LibraryFormats } from "vite";

export interface Output {
  readonly fileName: string;
  readonly entry: string;
  readonly format: LibraryFormats;
  readonly minify: boolean;
}

export const OUTPUTS: readonly Output[] = [
  { fileName: "tessera.js", entry: "src/index.ts", format: "es", minify: false },
  { fileName: "tessera.min.js", entry: "src/index.ts", format: "es", minify: true },
  { fileName: "tessera.iife.js", entry: "src/iife.ts", format: "iife", minify: true },
  { fileName: "tessera.csp.js", entry: "src/csp.ts", format: "es", minify: false },
  { fileName: "tessera.csp.min.js", entry: "src/csp.ts", format: "es", minify: true },
  { fileName: "tessera.csp.iife.js", entry: "src/csp-iife.ts", format: "iife", minify: true },
];

/** The twelve files SHA256SUMS covers, in its order. */
export const RELEASE_FILES: readonly string[] = OUTPUTS.flatMap(({ fileName }) => [fileName, `${fileName}.map`]);
