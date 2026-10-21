// The default IIFE (`tessera.iife.js`, global `Tessera`): src/index.ts, started by itself.
import { autoStart } from "./auto.ts";
import { start } from "./index.ts";

export * from "./index.ts";

autoStart(start);
