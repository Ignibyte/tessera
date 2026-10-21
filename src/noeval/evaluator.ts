// The no-eval engine's evaluator: walks the syntax tree against an expression's context, and lets
// each value do only what its capability allows. Ported from jqstar `src/csp/evaluator.ts`: the
// tracked values, the step budget, the asynchronous continuation and the operator rules (finite
// arithmetic, `+` joining strings, strict equality, no coercion). Rebuilt for Tessera's scope:
// signals, `el`, `evt`, helpers, a table of built-ins, actions through the action seam; jqstar's
// jQuery island, its bindings and its call runtime are gone. docs/decisions.md lists what an
// expression can and cannot do here.
import type { ActionMethod } from "../actions.ts";
import { EXPRESSION_BUILTINS, invokeAction, unknownIdentifier } from "../expression-shared.ts";
import type { ExpressionContext, ExpressionLocation } from "../expression-shared.ts";
import type { BinaryOperator, ExpressionNode, MemberNode, ProgramNode, SignalNode } from "./ast.ts";
import { NOEVAL_LIMITS, NoEvalError, sourceSpan } from "./diagnostics.ts";
import type { NoEvalDiagnostic, SourceSpan } from "./diagnostics.ts";
import { MAGIC_KEYS } from "./parser.ts";

type Kind =
  /** null, undefined, a boolean, a number, a string */
  | "primitive"
  /** a plain object or an array */
  | "data"
  | "dom"
  | "event"
  /** something a helper registered: a function, or an object of them */
  | "helper"
  | "builtin"
  /** a value that can be passed on and compared, but not looked into: a Date, a Map, a symbol */
  | "opaque"
  /** a native promise, from an action, a helper or `Promise.resolve` */
  | "async";

interface Value {
  readonly kind: Kind;
  readonly value: unknown;
  /** Data reached from a signal: its properties may be written. */
  readonly writable?: boolean;
  readonly builtin?: Builtin;
}

interface Builtin {
  readonly call?: (...args: unknown[]) => unknown;
  readonly members?: Readonly<Record<string, Builtin>>;
  readonly constant?: number;
}

/** A value an `await` is still waiting for. */
class Pending {
  readonly promise: Promise<Value>;

  constructor(promise: Promise<Value>) {
    this.promise = promise;
  }
}

type Result = Value | Pending;

function then(result: Result, next: (value: Value) => Result): Result {
  if (!(result instanceof Pending)) return next(result);
  return new Pending(
    result.promise.then((value) => {
      const continued = next(value);
      return continued instanceof Pending ? continued.promise : continued;
    }),
  );
}

const value = (kind: Kind, raw: unknown, fields: Partial<Value> = {}): Value => Object.freeze({ kind, value: raw, ...fields });
const UNDEFINED = value("primitive", undefined);

const call = (fn: (...args: never[]) => unknown): Builtin => ({ call: fn as (...args: unknown[]) => unknown });

/**
 * The built-ins the no-eval engine offers: pure functions of data. The other names in
 * EXPRESSION_BUILTINS are in scope, as with the trusted engine, but fail as not available here.
 */
const BUILTINS: Readonly<Record<string, Builtin>> = Object.freeze({
  Math: {
    members: {
      abs: call(Math.abs),
      ceil: call(Math.ceil),
      floor: call(Math.floor),
      max: call(Math.max),
      min: call(Math.min),
      pow: call(Math.pow),
      random: call(Math.random),
      round: call(Math.round),
      sign: call(Math.sign),
      sqrt: call(Math.sqrt),
      trunc: call(Math.trunc),
      PI: { constant: Math.PI },
      E: { constant: Math.E },
    },
  },
  JSON: {
    members: {
      parse: call((text: string) => JSON.parse(text) as unknown),
      // No replacer: a function cannot be passed. An indent may follow a null replacer.
      stringify: call((data: unknown, replacer?: unknown, space?: number | string) =>
        replacer === undefined || replacer === null ? JSON.stringify(data, null, space) : undefined,
      ),
    },
  },
  Number: {
    call: Number,
    members: {
      isFinite: call(Number.isFinite),
      isInteger: call(Number.isInteger),
      isNaN: call(Number.isNaN),
      parseFloat: call(Number.parseFloat),
      parseInt: call(Number.parseInt),
    },
  },
  String: { call: String },
  Boolean: { call: Boolean },
  Array: { members: { isArray: call(Array.isArray) } },
  Object: { members: { entries: call(Object.entries), keys: call(Object.keys), values: call(Object.values) } },
  Promise: { members: { resolve: call((data: unknown) => Promise.resolve(data)) } },
  Date: { members: { now: call(Date.now) } },
  parseInt: call(Number.parseInt),
  parseFloat: call(Number.parseFloat),
  isFinite: call(Number.isFinite),
  isNaN: call(Number.isNaN),
  encodeURI: call(encodeURI),
  encodeURIComponent: call(encodeURIComponent),
  decodeURI: call(decodeURI),
  decodeURIComponent: call(decodeURIComponent),
});

const STRING_METHODS = new Set(["charAt", "endsWith", "includes", "indexOf", "slice", "split", "startsWith", "substring", "toLowerCase", "toUpperCase", "trim"]);
const ARRAY_METHODS = new Set(["at", "includes", "indexOf", "join", "slice"]);
/** Methods that change an array, for arrays reached from a signal only. */
const ARRAY_MUTATORS = new Set(["pop", "push", "shift", "unshift"]);
const EVENT_MEMBERS = new Set([
  "altKey",
  "button",
  "buttons",
  "code",
  "ctrlKey",
  "currentTarget",
  "defaultPrevented",
  "detail",
  "key",
  "metaKey",
  "repeat",
  "shiftKey",
  "submitter",
  "target",
  "timeStamp",
  "type",
]);
const EVENT_METHODS = new Set(["preventDefault", "stopImmediatePropagation", "stopPropagation"]);
const DOM_MEMBERS = new Set([
  "checked",
  "className",
  "dataset",
  "disabled",
  "form",
  "hidden",
  "href",
  "id",
  "localName",
  "name",
  "open",
  "parentElement",
  "placeholder",
  "readOnly",
  "required",
  "selectedIndex",
  "tagName",
  "textContent",
  "title",
  "type",
  "value",
]);
/** What an expression may write on an element: text and form state, never markup. */
const DOM_WRITABLE = new Set(["checked", "disabled", "hidden", "textContent", "value"]);
const DOM_ELEMENT_RESULTS = new Set(["form", "parentElement"]);
/** Element methods: focus and form actions take no arguments; the others one string. */
const DOM_ACTIONS = new Set(["blur", "click", "focus", "requestSubmit", "reset", "scrollIntoView", "select"]);
const DOM_QUERIES = new Set(["closest", "getAttribute", "hasAttribute", "matches"]);
const EVENT_ELEMENT_RESULTS = new Set(["currentTarget", "submitter", "target"]);

function isObject(raw: unknown): raw is object {
  return (typeof raw === "object" && raw !== null) || typeof raw === "function";
}

function finite(raw: unknown): raw is number {
  return typeof raw === "number" && Number.isFinite(raw);
}

function isPlainData(raw: object): boolean {
  if (Array.isArray(raw)) return true;
  const prototype = Object.getPrototypeOf(raw) as unknown;
  return prototype === Object.prototype || prototype === null;
}

class Frame {
  readonly #source: string;
  readonly #location: ExpressionLocation | undefined;
  readonly #context: ExpressionContext;
  readonly #active: () => boolean;
  readonly #window: Window & typeof globalThis;
  #steps = 0;
  #awaits = 0;

  constructor(source: string, location: ExpressionLocation | undefined, context: ExpressionContext, active: () => boolean) {
    this.#source = source;
    this.#location = location;
    this.#context = context;
    this.#active = active;
    const view = context.element.ownerDocument.defaultView;
    if (!view) throw new Error("An expression's element must belong to a document with a window.");
    this.#window = view;
  }

  run(root: ExpressionNode | ProgramNode): unknown {
    const result = root.kind === "program" ? this.#program(root) : this.#evaluate(root);
    if (result instanceof Pending) return result.promise.then((resolved) => this.#boundary(resolved, root.span));
    return this.#boundary(result, root.span);
  }

  /** What leaves the expression: the raw value, or the promise of one. */
  #boundary(result: Value, span: SourceSpan): unknown {
    if (result.kind === "builtin" || (result.kind === "helper" && typeof result.value === "function")) this.#fail("deniedValue", span);
    return result.value;
  }

  #program(node: ProgramNode): Result {
    this.#step(node.span);
    let result: Result = UNDEFINED;
    let returned = false;
    for (const statement of node.body) {
      result = then(result, () => {
        if (returned) return UNDEFINED;
        if (statement.kind === "return-statement") {
          returned = true;
          return statement.argument ? this.#evaluate(statement.argument) : UNDEFINED;
        }
        return then(this.#evaluate(statement.expression), () => UNDEFINED);
      });
    }
    return result;
  }

  #evaluate(node: ExpressionNode): Result {
    this.#step(node.span);
    switch (node.kind) {
      case "literal":
        return value("primitive", node.value);
      case "this":
        return value("dom", this.#context.element);
      case "signal":
        return this.#classify(this.#context.signals[node.name], true, node.span);
      case "identifier":
        return this.#identifier(node.name, node.span);
      case "array":
        return then(this.#list(node.elements), (items) => value("data", [...(items.value as unknown[])]));
      case "object": {
        let result: Result = value("data", {});
        for (const property of node.properties) {
          result = then(result, (holder) =>
            then(this.#evaluate(property.value), (entry) => {
              Object.defineProperty(holder.value, property.key, { value: this.#raw(entry, property.span, true), enumerable: true, writable: true, configurable: true });
              return holder;
            }),
          );
        }
        return result;
      }
      case "member":
        return then(this.#evaluate(node.object), (object) =>
          typeof node.property === "string"
            ? this.#member(object, node.property, node)
            : then(this.#evaluate(node.property), (key) => this.#member(object, this.#key(key, node.propertySpan), node)),
        );
      case "call":
        return this.#call(node.callee, node.arguments, node.span);
      case "action":
        return then(this.#list(node.arguments), (args) => this.#action(node.method, args.value as unknown[], node.span));
      case "unary":
        return then(this.#evaluate(node.argument), (argument) => {
          const raw = this.#raw(argument, node.span);
          if (node.operator === "!") return value("primitive", !raw);
          if (!finite(raw)) this.#fail("numericResult", node.span);
          return value("primitive", node.operator === "-" ? -raw : raw);
        });
      case "binary":
        return then(this.#evaluate(node.left), (left) =>
          then(this.#evaluate(node.right), (right) => this.#binary(node.operator, this.#raw(left, node.left.span), this.#raw(right, node.right.span), node.span)),
        );
      case "logical":
        return then(this.#evaluate(node.left), (left) => {
          const raw = this.#raw(left, node.left.span);
          const takeRight = node.operator === "&&" ? Boolean(raw) : node.operator === "||" ? !raw : raw === null || raw === undefined;
          return takeRight ? this.#evaluate(node.right) : left;
        });
      case "conditional":
        return then(this.#evaluate(node.test), (test) => this.#evaluate(this.#raw(test, node.test.span) ? node.consequent : node.alternate));
      case "assignment":
        return this.#assign(node.target, node.operator, node.value, node.span);
      case "update":
        return this.#update(node.target, node.operator, node.span);
      case "await":
        return then(this.#evaluate(node.argument), (argument) => {
          if (argument.kind !== "async") this.#fail("asyncValue", node.span);
          if (++this.#awaits > NOEVAL_LIMITS.asyncChain) this.#fail("asyncLimit", node.span);
          return new Pending(
            (argument.value as Promise<unknown>).then((resolved) => {
              if (!this.#active()) this.#fail("engineDisposed", node.span);
              return this.#classify(resolved, false, node.span);
            }),
          );
        });
    }
  }

  /** Evaluates a list left to right into a data value holding the raw values; a promise may be one. */
  #list(nodes: readonly ExpressionNode[]): Result {
    let result: Result = value("data", []);
    for (const node of nodes) {
      result = then(result, (holder) =>
        then(this.#evaluate(node), (item) => {
          (holder.value as unknown[]).push(this.#raw(item, node.span, true));
          return holder;
        }),
      );
    }
    return result;
  }

  /**
   * The raw value to compute with. A promise must be awaited first, except where it is only held:
   * in an array or object literal and as an argument.
   */
  #raw(item: Value, span: SourceSpan, held = false): unknown {
    if (item.kind === "async" && !held) this.#fail("asyncValue", span);
    if (item.kind === "builtin") this.#fail("deniedValue", span);
    return item.value;
  }

  // --- Names ---------------------------------------------------------------------------------

  #identifier(name: string, span: SourceSpan): Value {
    const context = this.#context;
    if (name === "el") return value("dom", context.element);
    if (name === "evt") return context.event === undefined ? UNDEFINED : value("event", context.event);
    if (context.helpers && Object.hasOwn(context.helpers, name)) return this.#helper(context.helpers[name], span);
    if (name === "undefined") return UNDEFINED;
    if (EXPRESSION_BUILTINS.has(name)) {
      const builtin = BUILTINS[name];
      if (!builtin) this.#fail("unavailableBuiltin", span, `${name} is not available in Tessera's no-eval engine.`);
      return value("builtin", undefined, { builtin });
    }
    return this.#fail("unknownIdentifier", span, unknownIdentifier(name).message);
  }

  #helper(raw: unknown, span: SourceSpan): Value {
    if (typeof raw === "function" || (isObject(raw) && isPlainData(raw) && !Array.isArray(raw))) return value("helper", raw);
    return this.#classify(raw, false, span);
  }

  /** Classifies a value read from a signal, a helper or a call's result. */
  #classify(raw: unknown, writable: boolean, span: SourceSpan): Value {
    if (!isObject(raw)) return typeof raw === "bigint" || typeof raw === "symbol" ? value("opaque", raw) : value("primitive", raw);
    const window = this.#window;
    if (raw instanceof window.Element) return value("dom", raw);
    if (raw instanceof window.Event) return value("event", raw);
    if (raw instanceof Promise) return value("async", raw);
    if (typeof raw === "function") return value("opaque", raw);
    if (!isPlainData(raw)) return value("opaque", raw);
    if (Array.isArray(raw) && raw.length > NOEVAL_LIMITS.collectionSize) this.#fail("collectionLimit", span);
    return value("data", raw, { writable });
  }

  // --- Members -------------------------------------------------------------------------------

  #key(key: Value, span: SourceSpan): string {
    const raw = key.value;
    if (typeof raw === "string") return raw;
    if (finite(raw) && Number.isInteger(raw) && raw >= 0) return String(raw);
    return this.#fail("deniedProperty", span);
  }

  #member(object: Value, key: string, node: MemberNode): Value {
    const span = node.propertySpan;
    if (MAGIC_KEYS.has(key)) this.#fail("deniedProperty", span, `${key} is never readable in an expression.`);
    const raw = object.value;
    if (object.kind !== "builtin" && (raw === null || raw === undefined)) {
      this.#fail("propertyAbsent", span, `Cannot read ${key} of ${String(raw)}.`);
    }
    switch (object.kind) {
      case "primitive":
        if (typeof raw === "string" && (key === "length" || /^\d+$/.test(key))) return value("primitive", key === "length" ? raw.length : raw[Number(key)]);
        return this.#fail("deniedProperty", span);
      case "data":
        return this.#data(raw as object, key, object.writable === true, span);
      case "dom": {
        if (!DOM_MEMBERS.has(key)) this.#fail("deniedProperty", span, `An element offers ${[...DOM_MEMBERS].join(", ")}; not ${key}.`);
        const element = raw as Element & Record<string, unknown>;
        if (key === "dataset") return value("data", Object.fromEntries(Object.entries((element as unknown as HTMLElement).dataset)));
        const read = element[key];
        if (DOM_ELEMENT_RESULTS.has(key)) return read instanceof this.#window.Element ? value("dom", read) : UNDEFINED;
        return isObject(read) ? value("opaque", read) : value("primitive", read);
      }
      case "event": {
        if (!EVENT_MEMBERS.has(key)) this.#fail("deniedProperty", span, `An event offers ${[...EVENT_MEMBERS].join(", ")}; not ${key}.`);
        const read = (raw as Record<string, unknown>)[key];
        if (EVENT_ELEMENT_RESULTS.has(key)) return read instanceof this.#window.Element ? value("dom", read) : value("primitive", read ?? null);
        return this.#classify(read, false, span);
      }
      case "helper": {
        if (!Object.hasOwn(raw as object, key)) return UNDEFINED;
        return this.#helper((raw as Record<string, unknown>)[key], span);
      }
      case "builtin": {
        const member = object.builtin?.members?.[key];
        if (!member) return this.#fail("unavailableBuiltin", span, `${key} is not available in Tessera's no-eval engine.`);
        return member.constant === undefined ? value("builtin", undefined, { builtin: member }) : value("primitive", member.constant);
      }
      case "opaque":
      case "async":
        return this.#fail("deniedProperty", span);
    }
  }

  /** An own data property of plain data; the read goes through the object, so signals track it. */
  #data(object: object, key: string, writable: boolean, span: SourceSpan): Value {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor && !("value" in descriptor)) this.#fail("deniedAccessor", span);
    const read = (object as Record<string, unknown>)[key];
    if (!descriptor) return UNDEFINED;
    if (Array.isArray(object) && key === "length") return value("primitive", read);
    return this.#classify(read, writable, span);
  }

  // --- Calls ---------------------------------------------------------------------------------

  #call(callee: ExpressionNode, args: readonly ExpressionNode[], span: SourceSpan): Result {
    if (callee.kind === "member") {
      return then(this.#evaluate(callee.object), (object) =>
        then(typeof callee.property === "string" ? value("primitive", callee.property) : this.#evaluate(callee.property), (name) =>
          then(this.#list(args), (list) => this.#method(object, this.#key(name, callee.propertySpan), list.value as unknown[], span)),
        ),
      );
    }
    return then(this.#evaluate(callee), (target) =>
      then(this.#list(args), (list) => {
        const values = list.value as unknown[];
        if (target.kind === "helper" && typeof target.value === "function") return this.#result((target.value as (...input: unknown[]) => unknown)(...values), span);
        if (target.kind === "builtin" && target.builtin?.call) return this.#result(target.builtin.call(...values), span);
        return this.#fail("deniedCall", span);
      }),
    );
  }

  #method(object: Value, name: string, args: unknown[], span: SourceSpan): Value {
    if (MAGIC_KEYS.has(name)) this.#fail("deniedCall", span, `${name} is never callable in an expression.`);
    const raw = object.value;
    const deny = (): never => this.#fail("deniedCall", span, `This value offers no method ${name}.`);
    switch (object.kind) {
      case "primitive": {
        if (typeof raw !== "string" || !STRING_METHODS.has(name)) return deny();
        return this.#result((String.prototype[name as keyof string] as (...input: unknown[]) => unknown).apply(raw, args), span);
      }
      case "data": {
        if (!Array.isArray(raw)) return deny();
        if (ARRAY_MUTATORS.has(name) && object.writable === true) {
          if (name === "push" || name === "unshift") {
            if (raw.length + args.length > NOEVAL_LIMITS.collectionSize) this.#fail("collectionLimit", span);
          }
          return this.#result((raw as unknown as Record<string, (...input: unknown[]) => unknown>)[name]?.(...args), span);
        }
        if (!ARRAY_METHODS.has(name)) return deny();
        return this.#result((Array.prototype[name as keyof unknown[]] as (...input: unknown[]) => unknown).apply(raw, args), span);
      }
      case "event": {
        if (!EVENT_METHODS.has(name) || args.length > 0) return deny();
        (raw as Record<string, () => void>)[name]?.call(raw);
        return UNDEFINED;
      }
      case "dom": {
        const element = raw as Element & Record<string, unknown>;
        if (DOM_ACTIONS.has(name) && args.length === 0) {
          const method = element[name];
          if (typeof method !== "function") return deny();
          (method as () => void).call(element);
          return UNDEFINED;
        }
        if (DOM_QUERIES.has(name) && args.length === 1 && typeof args[0] === "string") {
          const result: unknown = (element[name] as (input: string) => unknown).call(element, args[0]);
          return result instanceof this.#window.Element ? value("dom", result) : value("primitive", result);
        }
        return deny();
      }
      case "helper": {
        const method = Object.hasOwn(raw as object, name) ? (raw as Record<string, unknown>)[name] : undefined;
        if (typeof method !== "function") return deny();
        return this.#result((method as (...input: unknown[]) => unknown).apply(raw, args), span);
      }
      case "builtin": {
        const member = object.builtin?.members?.[name];
        if (!member?.call) return this.#fail("unavailableBuiltin", span, `${name} is not available in Tessera's no-eval engine.`);
        return this.#result(member.call(...args), span);
      }
      case "opaque":
      case "async":
        return deny();
    }
  }

  /** A call's result: data comes back read-only, and a function never comes back. */
  #result(raw: unknown, span: SourceSpan): Value {
    if (typeof raw === "function") this.#fail("deniedValue", span, "A call returned a function, which an expression cannot hold.");
    return this.#classify(raw, false, span);
  }

  #action(method: ActionMethod, args: unknown[], span: SourceSpan): Value {
    return this.#result(invokeAction(this.#context, method, args), span);
  }

  // --- Writes --------------------------------------------------------------------------------

  /** Where an assignment or update writes: a signal, a property of signal data, or an element's. */
  #reference(target: SignalNode | MemberNode): Result {
    if (target.kind === "signal") {
      const signals = this.#context.signals;
      return value("primitive", {
        read: () => this.#classify(signals[target.name], true, target.span),
        write: (raw: unknown) => {
          signals[target.name] = raw;
        },
      });
    }
    return then(this.#evaluate(target.object), (object) =>
      then(typeof target.property === "string" ? value("primitive", target.property) : this.#evaluate(target.property), (keyValue) => {
        const key = this.#key(keyValue, target.propertySpan);
        if (MAGIC_KEYS.has(key)) this.#fail("deniedProperty", target.propertySpan);
        const raw = object.value as Record<string, unknown>;
        if (object.kind === "data" && object.writable === true) {
          const descriptor = Object.getOwnPropertyDescriptor(raw, key);
          if (descriptor && !("value" in descriptor)) this.#fail("deniedAccessor", target.propertySpan);
          return value("primitive", {
            read: () => this.#member(object, key, target),
            write: (next: unknown) => {
              raw[key] = next;
            },
          });
        }
        if (object.kind === "dom" && DOM_WRITABLE.has(key)) {
          return value("primitive", {
            read: () => this.#member(object, key, target),
            write: (next: unknown) => {
              raw[key] = next;
            },
          });
        }
        return this.#fail("deniedWrite", target.span, `${key} cannot be written here: an expression writes signals, their data, and an element's ${[...DOM_WRITABLE].join(", ")}.`);
      }),
    );
  }

  #assign(target: SignalNode | MemberNode, operator: string, node: ExpressionNode, span: SourceSpan): Result {
    return then(this.#reference(target), (holder) => {
      const reference = holder.value as { read(): Value; write(raw: unknown): void };
      const previous = operator === "=" ? undefined : this.#raw(reference.read(), span);
      return then(this.#evaluate(node), (right) => {
        const raw = this.#raw(right, node.span);
        const next = operator === "=" ? right : this.#binary(operator.slice(0, -1) as BinaryOperator, previous, raw, span);
        reference.write(next.value);
        return next;
      });
    });
  }

  #update(target: SignalNode | MemberNode, operator: "++" | "--", span: SourceSpan): Result {
    return then(this.#reference(target), (holder) => {
      const reference = holder.value as { read(): Value; write(raw: unknown): void };
      const previous = reference.read().value;
      if (!finite(previous)) this.#fail("numericResult", span);
      const next = previous + (operator === "++" ? 1 : -1);
      if (!Number.isFinite(next)) this.#fail("numericResult", span);
      reference.write(next);
      return value("primitive", previous);
    });
  }

  // --- Operators -----------------------------------------------------------------------------

  #binary(operator: BinaryOperator, left: unknown, right: unknown, span: SourceSpan): Value {
    if (operator === "===") return value("primitive", left === right);
    if (operator === "!==") return value("primitive", left !== right);
    if (operator === "<" || operator === "<=" || operator === ">" || operator === ">=") {
      const compare = <Operand extends number | string>(a: Operand, b: Operand): boolean =>
        operator === "<" ? a < b : operator === "<=" ? a <= b : operator === ">" ? a > b : a >= b;
      if (finite(left) && finite(right)) return value("primitive", compare(left, right));
      if (typeof left === "string" && typeof right === "string") return value("primitive", compare(left, right));
      return this.#fail("operandType", span, `${operator} compares two finite numbers or two strings.`);
    }
    if (operator === "+" && (typeof left === "string" || typeof right === "string")) {
      return value("primitive", this.#text(left, span) + this.#text(right, span));
    }
    if (!finite(left) || !finite(right)) this.#fail("numericResult", span, `${operator} needs two finite numbers.`);
    const result =
      operator === "+" ? left + right : operator === "-" ? left - right : operator === "*" ? left * right : operator === "/" ? left / right : left % right;
    if (!Number.isFinite(result)) this.#fail("numericResult", span, `${operator} gave a number that is not finite.`);
    return value("primitive", result);
  }

  #text(raw: unknown, span: SourceSpan): string {
    if (raw === null || raw === undefined || typeof raw === "string" || typeof raw === "boolean" || finite(raw)) return String(raw);
    return this.#fail("operandType", span, "+ joins strings with strings, numbers, booleans, null or undefined.");
  }

  // --- Budget and failures -------------------------------------------------------------------

  #step(span: SourceSpan): void {
    if (!this.#active()) this.#fail("engineDisposed", span);
    if (++this.#steps > NOEVAL_LIMITS.evaluationSteps) this.#fail("stepLimit", sourceSpan(this.#source, 0, this.#source.length, this.#location));
  }

  #fail(diagnostic: NoEvalDiagnostic, span: SourceSpan, detail?: string): never {
    throw new NoEvalError(diagnostic, span, detail);
  }
}

/** Evaluates a parsed expression; a statement's or an awaited value's result is a promise. */
export function evaluate(
  root: ExpressionNode | ProgramNode,
  source: string,
  context: ExpressionContext,
  location: ExpressionLocation | undefined,
  active: () => boolean,
): unknown {
  return new Frame(source, location, context, active).run(root);
}
