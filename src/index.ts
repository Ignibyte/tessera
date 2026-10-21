// The default build: Tessera with the trusted expression engine, which compiles expressions with
// `Function` and so needs a Content-Security-Policy that allows 'unsafe-eval'. src/csp.ts is the
// same runtime with the no-eval engine.
import { createTrustedExpressionEngine } from "./expression.ts";
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
  return startWith(createTrustedExpressionEngine(), options);
}
