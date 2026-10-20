// Boots the attributes and a patcher on a fixture page for the browser tests, with the action
// recorder as the action seam. test/browser/global-setup.ts builds it; the reference server serves it as
// /assets/harness.js. It is test tooling, not a public entry.
import { createActionRecorder } from "../../src/actions.ts";
import { mountAttributes } from "../../src/attributes.ts";
import { registerBuiltins } from "../../src/builtins.ts";
import { createDirectiveRegistry } from "../../src/directive.ts";
import { createTrustedExpressionEngine } from "../../src/expression.ts";
import { Kernel } from "../../src/kernel.ts";
import { createPatcher } from "../../src/patch.ts";
import type { PatchMode } from "../../src/patch.ts";
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

Object.assign(window, {
  tesseraHarness: {
    signals: mount.signals,
    scopes: mount.scopes,
    calls: recorder.calls,
    failures,
    settle: () => kernel.whenEnhanced(),
    patch: (target: string, markup: string, mode?: PatchMode) => {
      patcher.patchElements(target, markup, mode);
    },
  },
});
