// The csp IIFE (`tessera.csp.iife.js`, global `Tessera`): src/csp.ts, started by itself.
import { autoStart } from "./auto.ts";
import { start } from "./csp.ts";

export * from "./csp.ts";

autoStart(start);
