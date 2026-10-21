// The csp build: Tessera with the no-eval expression engine, for pages whose
// Content-Security-Policy refuses 'unsafe-eval'. The same API as src/index.ts.
import { createNoEvalExpressionEngine } from "./noeval/engine.ts";
import { startWith } from "./start.ts";
import type { Runtime, StartOptions } from "./start.ts";

export { version } from "./version.ts";
export { ERROR_EVENT } from "./attributes.ts";
export { EXPIRED_EVENT } from "./transport.ts";
export { INDETERMINATE_EVENT } from "./forms.ts";
export type { Runtime, StartOptions } from "./start.ts";
export type { Interceptor, RequestOutcome, TesseraRequest } from "./transport.ts";

/** Starts Tessera on the page. Call it once the document has a `<body>`. */
export function start(options?: StartOptions): Runtime {
  return startWith(createNoEvalExpressionEngine(), options);
}
