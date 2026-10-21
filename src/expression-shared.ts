// What both expression engines share: the seam, the context an expression sees, the built-ins in
// scope, the error they raise and the action call. Neither engine is imported here, so a build
// that takes one engine never takes the other (docs/decisions.md, ticket #22).
import type { ActionMethod, ActionSeam } from "./actions.ts";

export type HelperScope = Readonly<Record<string, unknown>>;

/** What an expression evaluates against. */
export interface ExpressionContext {
  readonly element: Element;
  /** `$name` reads and writes `signals[name]`. */
  readonly signals: Record<string, unknown>;
  readonly event?: Event | undefined;
  readonly helpers?: HelperScope | undefined;
  readonly actions: ActionSeam;
}

export interface ExpressionLocation {
  readonly attribute?: string;
  readonly column?: number;
  readonly line?: number;
}

export type ValueEvaluator = (context: ExpressionContext) => unknown;
export type StatementEvaluator = (context: ExpressionContext) => unknown;

export interface ExpressionEngine {
  clearCache(): void;
  compileStatement(source: string, location?: ExpressionLocation): StatementEvaluator;
  compileValue(source: string, location?: ExpressionLocation): ValueEvaluator;
  dispose(): void;
}

/**
 * The page globals an expression may name: ECMAScript's own built-ins. Browser APIs
 * (`window`, `document`, `fetch`, `console`, timers) are not among them.
 */
export const EXPRESSION_BUILTINS: ReadonlySet<string> = new Set([
  "Array",
  "BigInt",
  "Boolean",
  "Date",
  "Error",
  "Infinity",
  "Intl",
  "JSON",
  "Map",
  "Math",
  "NaN",
  "Number",
  "Object",
  "Promise",
  "RegExp",
  "Set",
  "String",
  "Symbol",
  "decodeURI",
  "decodeURIComponent",
  "encodeURI",
  "encodeURIComponent",
  "isFinite",
  "isNaN",
  "parseFloat",
  "parseInt",
  "undefined",
]);

function describeElement(element: Element): string {
  const id = element.id ? ` id="${element.id}"` : "";
  return `<${element.localName}${id}>`;
}

export class ExpressionError extends Error {
  readonly location?: ExpressionLocation;
  readonly phase: "compile" | "evaluate";
  readonly source: string;
  readonly element?: Element;

  constructor(
    source: string,
    phase: "compile" | "evaluate",
    error: unknown,
    location?: ExpressionLocation,
    element?: Element,
  ) {
    const detail = error instanceof Error ? error.message : String(error);
    const at = location?.attribute ? ` at ${location.attribute}` : "";
    const on = element ? ` on ${describeElement(element)}` : "";
    const verb = phase === "compile" ? "compile" : "evaluate";
    super(`Could not ${verb} Tessera expression “${source}”${at}${on}: ${detail}`, { cause: error });
    this.name = "ExpressionError";
    this.source = source;
    this.phase = phase;
    if (location) this.location = location;
    if (element) this.element = element;
  }
}

export function unknownIdentifier(name: string): ReferenceError {
  return new ReferenceError(
    `${name} is not defined. Expressions see signals ($name), el, evt, registered helpers and ` +
      "JavaScript's built-ins; page globals such as window are not in scope.",
  );
}

export function invokeAction(context: ExpressionContext, method: ActionMethod, args: unknown[]): unknown {
  const [url, options, ...rest] = args;
  if (typeof url !== "string") throw new TypeError(`@${method} needs a URL string first.`);
  if (rest.length > 0) throw new TypeError(`@${method} takes a URL and an optional options object.`);
  if (options !== undefined && (typeof options !== "object" || options === null || Array.isArray(options))) {
    throw new TypeError(`@${method} options must be an object.`);
  }
  return context.actions({
    method,
    url,
    options: options as Readonly<Record<string, unknown>> | undefined,
    element: context.element,
    event: context.event,
  });
}
