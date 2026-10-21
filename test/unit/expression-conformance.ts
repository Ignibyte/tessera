// The behaviour every engine behind the ExpressionEngine seam must share, so the no-eval engine
// can be held to the trusted one. Ported from jqstar `test/expression-engine-conformance.ts`,
// with Tessera's scope (signals, el, evt, helpers, actions) in place of jqstar's jQuery context.
import { describe, expect, it, vi } from "vitest";
import type { ActionCall } from "../../src/actions.ts";
import type { ExpressionContext, ExpressionEngine, ExpressionError, ExpressionLocation, HelperScope } from "../../src/expression.ts";

export const expressionEngineConformanceCaseIds = [
  "values-and-statements",
  "element-and-event",
  "helpers-and-fixed-bindings",
  "actions",
  "asynchronous-results",
  "location-aware-errors",
  "closed-scope",
] as const;

interface Harness {
  readonly context: ExpressionContext;
  readonly element: HTMLElement;
  readonly actions: ReturnType<typeof vi.fn<(call: ActionCall) => unknown>>;
}

function harness(signals: Record<string, unknown> = {}): Harness {
  const root = document.createElement("section");
  const element = document.createElement("button");
  element.dataset.role = "save";
  root.append(element);
  const actions = vi.fn<(call: ActionCall) => unknown>(() => Promise.resolve("action-result"));
  const context: ExpressionContext = { element, signals, event: new Event("click"), actions };
  return { context, element, actions };
}

function thrown(work: () => unknown): ExpressionError {
  try {
    work();
  } catch (error) {
    return error as ExpressionError;
  }
  throw new Error("Expected an expression failure.");
}

/**
 * Where an engine's grammar is narrower than JavaScript, a case may say the same thing another
 * way: the adaptation, with its reason. jqstar called these cases "csp-equivalent".
 */
export interface ConformanceAdaptations {
  /** location-aware-errors: an asynchronous failure inside a statement. */
  readonly asyncFailure?: { readonly source: string; readonly helpers: HelperScope; readonly reason: string };
}

const ASYNC_FAILURE = { source: 'await Promise.resolve(); throw new Error("async expression failure")', helpers: {} };

/** Declares the conformance cases for an engine; each case gets a fresh engine. */
export function runExpressionEngineConformance(name: string, createEngine: () => ExpressionEngine, adaptations: ConformanceAdaptations = {}): void {
  describe(`${name} expression-engine conformance`, () => {
    it("values-and-statements", async () => {
      const engine = createEngine();
      try {
        const current = harness({ count: 3, double: 6 });
        expect(engine.compileValue("$count + $double")(current.context)).toBe(9);
        await engine.compileStatement("$count += 2")(current.context);
        expect(current.context.signals.count).toBe(5);
      } finally {
        engine.dispose();
      }
    });

    it("element-and-event", () => {
      const engine = createEngine();
      try {
        const current = harness();
        const result = engine.compileValue(`[el.dataset.role, evt.type, this === el, el.parentElement.localName]`)(
          current.context,
        );
        expect(result).toEqual(["save", "click", true, "section"]);
      } finally {
        engine.dispose();
      }
    });

    it("helpers-and-fixed-bindings", () => {
      const engine = createEngine();
      try {
        const current = harness({ count: 3 });
        const sum = vi.fn((left: number, right: number) => left + right);
        const result = engine.compileValue(`[el === shadow, format.sum($count, 6)]`)({
          ...current.context,
          helpers: { el: "shadowed helper", shadow: current.element, format: { sum } },
        });
        expect(result).toEqual([true, 9]);
        expect(sum).toHaveBeenCalledWith(3, 6);
      } finally {
        engine.dispose();
      }
    });

    it("actions", async () => {
      const engine = createEngine();
      try {
        const current = harness({ id: 7 });
        await expect(engine.compileStatement("@post('/save/' + $id, { form: true })")(current.context)).resolves.toBe(
          undefined,
        );
        await expect(engine.compileValue("@get('/items')")(current.context)).resolves.toBe("action-result");
        expect(current.actions).toHaveBeenNthCalledWith(1, {
          method: "post",
          url: "/save/7",
          options: { form: true },
          element: current.element,
          event: current.context.event,
        });
        expect(current.actions).toHaveBeenNthCalledWith(2, expect.objectContaining({ method: "get", url: "/items", options: undefined }));
      } finally {
        engine.dispose();
      }
    });

    it("asynchronous-results", async () => {
      const engine = createEngine();
      try {
        const current = harness({ count: 1 });
        await expect(engine.compileValue("Promise.resolve($count)")(current.context)).resolves.toBe(1);
        await expect(
          engine.compileStatement("await Promise.resolve(); $count += 2; return $count")(current.context),
        ).resolves.toBe(3);
        expect(current.context.signals.count).toBe(3);
      } finally {
        engine.dispose();
      }
    });

    it("location-aware-errors", async () => {
      const engine = createEngine();
      try {
        const current = harness();
        const location: ExpressionLocation = { attribute: "data-text", line: 2, column: 4 };
        expect(thrown(() => engine.compileValue(")", location))).toMatchObject({
          name: "ExpressionError",
          phase: "compile",
          source: ")",
          location,
        });
        expect(thrown(() => engine.compileStatement("if (", location))).toMatchObject({
          name: "ExpressionError",
          phase: "compile",
          source: "if (",
          location,
        });
        const failure = thrown(() => engine.compileValue("$missing.call()", location)(current.context));
        expect(failure).toMatchObject({ name: "ExpressionError", phase: "evaluate", source: "$missing.call()", location });
        expect(failure.message).toContain("at data-text");
        expect(failure.message).toContain("on <button>");
        const asyncFailure = adaptations.asyncFailure ?? ASYNC_FAILURE;
        await expect(
          engine.compileStatement(asyncFailure.source, location)({ ...current.context, helpers: asyncFailure.helpers }),
        ).rejects.toMatchObject({ name: "ExpressionError", phase: "evaluate", location });
      } finally {
        engine.dispose();
      }
    });

    it("closed-scope", () => {
      const engine = createEngine();
      try {
        const current = harness();
        for (const source of ["window", "document.title", "fetch('/x')", "$", "unknownName + 1"]) {
          const failure = thrown(() => engine.compileValue(source)(current.context));
          expect(failure).toMatchObject({ name: "ExpressionError", phase: "evaluate", source, element: current.element });
          expect(failure.message).toContain("is not defined");
        }
      } finally {
        engine.dispose();
      }
    });
  });
}
