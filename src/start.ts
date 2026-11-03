// The public entry: `start` boots every part on the document, as one runtime the page can stop.
// Each build supplies its expression engine (src/index.ts the trusted one, src/csp.ts the no-eval
// one), so a build holds only the engine it starts with.
import type { ActionSeam } from "./actions.ts";
import { mountAttributes } from "./attributes.ts";
import { registerBuiltins } from "./builtins.ts";
import { createDirectiveRegistry } from "./directive.ts";
import type { ExpressionEngine } from "./expression-shared.ts";
import { interceptForms } from "./forms.ts";
import { createHistory } from "./history.ts";
import { Kernel, kernelFor } from "./kernel.ts";
import { loadLazyRegions } from "./lazy.ts";
import { createDocumentCommitter, interceptLinks } from "./navigation.ts";
import { createPatcher } from "./patch.ts";
import { startPolling } from "./polling.ts";
import { createProgressBar } from "./progress.ts";
import { Scheduler } from "./reactivity.ts";
import { connectStreams } from "./streams.ts";
import { createTransport } from "./transport.ts";
import type { Interceptor, RequestOutcome, Transport } from "./transport.ts";

export interface StartOptions {
  /**
   * Values expressions may use by name, functions or plain objects: `{ money }` makes
   * `data-text="money.format($total)"` work. Registered before the page is scanned.
   */
  readonly helpers?: Readonly<Record<string, unknown>>;
}

/** A started Tessera. */
export interface Runtime {
  /** The document's signal scope, reactive: a write here updates every directive reading it. */
  readonly signals: Record<string, unknown>;
  /**
   * Visits `url` as a click on a link to it would: `targets` names the regions or components to
   * update (none: the page), `history` is `push` (the default), `replace` (the current entry,
   * with focus and scroll left where they are) or `none`.
   */
  visit(url: string, options?: { readonly targets?: readonly string[]; readonly history?: "push" | "replace" | "none" }): Promise<RequestOutcome>;
  /** Adds an interceptor to every request; the function returned removes it. */
  intercept(interceptor: Interceptor): () => void;
  /** Stops everything Tessera started on the document and lets the page go back to the browser. */
  stop(): void;
}

/** Starts Tessera on `document` with `expressions`; the builds bind the engine. */
export function startWith(expressions: ExpressionEngine, options: StartOptions = {}, document: Document = globalThis.document): Runtime {
  if (kernelFor(document)) throw new Error("Tessera has already started on this document.");
  // A script in <head> without `defer` runs before the parser makes <body>.
  const body = document.querySelector("body");
  if (!body) throw new Error("Tessera starts once the document has a <body>.");
  const scheduler = new Scheduler();
  const kernel = new Kernel(document, { flush: () => scheduler.nextUpdate() });
  try {
    const registry = createDirectiveRegistry();
    registerBuiltins(registry);
    for (const [name, value] of Object.entries(options.helpers ?? {})) registry.registerHelper(name, value);
    // Directives run during the first scan, before the transport exists, so an action they start
    // waits one microtask for it.
    const late: { transport?: Transport } = {};
    const actions: ActionSeam = (call) =>
      late.transport ? late.transport.actions(call) : Promise.resolve().then(() => (late.transport as Transport).actions(call));
    const mount = mountAttributes(body, { kernel, scheduler, expressions, registry, actions });
    const patcher = createPatcher({
      kernel,
      scopes: mount.scopes,
      refresh: (elements) => {
        mount.refresh(elements);
      },
    });
    const history = createHistory({ kernel });
    const transport = createTransport({ kernel, patcher, scopes: mount.scopes, history, commitDocument: createDocumentCommitter({ kernel, patcher }) });
    late.transport = transport;
    history.attach(transport);
    const navigation = interceptLinks({ kernel, transport, progress: createProgressBar(document) });
    interceptForms({ kernel, transport });
    connectStreams({ kernel, transport, patcher });
    loadLazyRegions({ kernel, transport });
    startPolling({ kernel, transport });
    const intercept = transport.intercept.bind(transport);
    return {
      signals: mount.signals,
      visit: (url, visitOptions = {}) =>
        navigation.visit(url, {
          ...(visitOptions.targets ? { targets: visitOptions.targets } : {}),
          ...(visitOptions.history ? { history: visitOptions.history } : {}),
        }),
      intercept,
      stop: () => {
        kernel.dispose();
      },
    };
  } catch (error) {
    kernel.dispose();
    throw error;
  }
}
