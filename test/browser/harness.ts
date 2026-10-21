// Boots the attributes, a patcher, the transport, links, forms, streams, lazy regions and polls
// on every fixture page (the layouts load it) for the browser tests, with the action recorder as
// the action seam.
// test/browser/global-setup.ts builds it; the reference server serves it as /assets/harness.js.
// It is test tooling, not a public entry.
import { createActionRecorder } from "../../src/actions.ts";
import { mountAttributes } from "../../src/attributes.ts";
import { registerBuiltins } from "../../src/builtins.ts";
import { createDirectiveRegistry } from "../../src/directive.ts";
import { createTrustedExpressionEngine } from "../../src/expression.ts";
import { interceptForms } from "../../src/forms.ts";
import { createHistory } from "../../src/history.ts";
import { Kernel } from "../../src/kernel.ts";
import { createDocumentCommitter, interceptLinks } from "../../src/navigation.ts";
import { createPatcher } from "../../src/patch.ts";
import type { PatchMode } from "../../src/patch.ts";
import { createTransport } from "../../src/transport.ts";
import type { HistoryMode, RequestInput } from "../../src/transport.ts";
import { createProgressBar } from "../../src/progress.ts";
import { connectStreams } from "../../src/streams.ts";
import { loadLazyRegions } from "../../src/lazy.ts";
import { startPolling } from "../../src/polling.ts";
import { Scheduler } from "../../src/reactivity.ts";

const scheduler = new Scheduler();
const kernel = new Kernel(document, { flush: () => scheduler.nextUpdate() });
const registry = createDirectiveRegistry();
registerBuiltins(registry);
const recorder = createActionRecorder();
const failures: string[] = [];
const mount = mountAttributes(document.body, {
  kernel,
  scheduler,
  expressions: createTrustedExpressionEngine(),
  registry,
  actions: recorder.seam,
  report: ({ attribute, error }) => failures.push(`${attribute}: ${error instanceof Error ? error.message : String(error)}`),
});

const patcher = createPatcher({
  kernel,
  scopes: mount.scopes,
  refresh: (elements) => {
    mount.refresh(elements);
  },
});

const requestErrors: string[] = [];
const history = createHistory({ kernel });
const transport = createTransport({
  kernel,
  patcher,
  scopes: mount.scopes,
  history,
  commitDocument: createDocumentCommitter({ kernel, patcher }),
  report: (error) => requestErrors.push(error instanceof Error ? error.message : String(error)),
});

history.attach(transport);
const navigation = interceptLinks({ kernel, transport, progress: createProgressBar(document) });
interceptForms({ kernel, transport });
const reportRequest = (error: unknown): void => {
  requestErrors.push(error instanceof Error ? error.message : String(error));
};
const streams = connectStreams({ kernel, transport, patcher, report: reportRequest });
loadLazyRegions({ kernel, transport, report: reportRequest });
startPolling({ kernel, transport, report: reportRequest });

/** Submits a form through the transport and returns what can cross into the test. */
async function submit(form: string, submitter?: string): Promise<{ status: string; httpStatus?: number; redirectedTo?: string }> {
  const element = document.querySelector<HTMLFormElement>(form);
  if (!element) throw new Error(`no form ${form}`);
  const button = submitter === undefined ? null : document.querySelector<HTMLElement>(submitter);
  const { status, httpStatus, redirectedTo } = await transport.submit(element, button);
  return { status, ...(httpStatus === undefined ? {} : { httpStatus }), ...(redirectedTo === undefined ? {} : { redirectedTo }) };
}

Object.assign(window, {
  tesseraHarness: {
    signals: mount.signals,
    scopes: mount.scopes,
    calls: recorder.calls,
    failures,
    settle: () => kernel.whenEnhanced(),
    requestErrors,
    submit,
    request: async (input: RequestInput) => ({ status: (await transport.request(input)).status }),
    visit: async (url: string, targets?: string[], mode?: HistoryMode) => ({
      status: (await navigation.visit(url, { ...(targets ? { targets } : {}), ...(mode ? { history: mode } : {}) })).status,
    }),
    patch: (target: string, markup: string, mode?: PatchMode) => {
      patcher.patchElements(target, markup, mode);
    },
    streams: () => streams.urls(),
    resources: () => kernel.resourceSummary().map(({ kind, owner }) => `${kind} ${owner}`),
    /** Disposes the kernel; what failed or stayed, and what is left in the ledger. */
    dispose: () => {
      const report = kernel.dispose();
      return { failed: report.failed.length, remaining: report.remaining.length, left: kernel.resourceSummary().length };
    },
    mounts: () => kernel.mountCount(),
  },
});
