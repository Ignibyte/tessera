// A frame with a kernel, a scheduler, the built-in registry and an attributes mount on its
// body, for the attributes and scopes tests.
import { vi } from "vitest";
import { createActionRecorder } from "../../src/actions.ts";
import { mountAttributes } from "../../src/attributes.ts";
import type { AttributeFailure, AttributesOptions } from "../../src/attributes.ts";
import { registerBuiltins } from "../../src/builtins.ts";
import { createDirectiveRegistry } from "../../src/directive.ts";
import { createTrustedExpressionEngine } from "../../src/expression.ts";
import { Kernel } from "../../src/kernel.ts";
import { Scheduler } from "../../src/reactivity.ts";

export const frames: { frame: HTMLIFrameElement; kernel: Kernel }[] = [];

/** Disposes every fixture's kernel and frame; call it from afterEach. */
export function disposeFixtures(): void {
  vi.useRealTimers();
  for (const { frame, kernel } of frames.splice(0)) {
    if (!kernel.disposed) kernel.dispose();
    frame.remove();
  }
}

export function setup(html: string, options: { signals?: Record<string, unknown>; report?: boolean } = {}) {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const window = frame.contentWindow as (Window & typeof globalThis) | null;
  const doc = frame.contentDocument;
  if (!window || !doc) throw new Error("no frame");
  doc.body.innerHTML = html;
  const scheduler = new Scheduler();
  const kernel = new Kernel(doc, { flush: () => scheduler.nextUpdate() });
  frames.push({ frame, kernel });
  const registry = createDirectiveRegistry();
  registerBuiltins(registry);
  const recorder = createActionRecorder();
  const failures: AttributeFailure[] = [];
  const mountOptions: AttributesOptions = {
    kernel,
    scheduler,
    expressions: createTrustedExpressionEngine(),
    registry,
    actions: recorder.seam,
    ...(options.signals ? { signals: options.signals } : {}),
    ...(options.report === false ? {} : { report: (failure: AttributeFailure) => failures.push(failure) }),
  };
  const mount = mountAttributes(doc.body, mountOptions);
  const find = (selector: string): HTMLElement => {
    const element = doc.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`no ${selector}`);
    return element;
  };
  const settle = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
    await kernel.whenEnhanced();
  };
  const owners = (): string[] => kernel.resourceSummary().map(({ owner }) => owner);
  return { window, doc, kernel, scheduler, mount, signals: mount.signals, failures, recorder, find, settle, owners };
}

