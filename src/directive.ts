// The directive and helper registry: which `data-*` attributes are directives, how their names
// split into a key and modifiers, and the helpers expressions may call. Ported from jqstar
// `src/directive.ts`, without the plugin install, `$element` and jqstar's built-ins; the
// key and modifier grammar is new (jqstar parsed `data-on` modifiers in `src/declarative.ts`).
import type { ExpressionContext, ExpressionEngine, HelperScope } from "./expression.ts";
import { EXPRESSION_BUILTINS } from "./expression.ts";

export type DirectiveCleanup = () => void;
export type DirectiveTask = (signal: AbortSignal) => PromiseLike<unknown>;

/** Whether a directive's attribute carries a key: `data-on:click` must, `data-text` must not. */
export type KeyRule = "required" | "forbidden" | "optional";

export interface DirectiveModifier {
  readonly name: string;
  readonly args: readonly string[];
}

/** `data-on:click__debounce.500ms`: directive `on`, key `click`, modifier `debounce` ["500ms"]. */
export interface DirectiveAttribute {
  readonly name: string;
  readonly directive: string;
  readonly key: string | undefined;
  readonly modifiers: readonly DirectiveModifier[];
  readonly value: string;
}

export interface ParsedDirectiveAttribute<Parsed = string> extends DirectiveAttribute {
  readonly parsed: Parsed;
}

/** What a directive's `mount` and `update` get; #7 builds it. */
export interface DirectiveContext<Parsed = string> {
  readonly attribute: ParsedDirectiveAttribute<Parsed>;
  readonly context: ExpressionContext;
  readonly element: Element;
  readonly expressions: ExpressionEngine;
  readonly previous?: ParsedDirectiveAttribute<Parsed>;
  readonly cleanup: (cleanup: DirectiveCleanup) => DirectiveCleanup;
  readonly effect: (run: () => void) => DirectiveCleanup;
  readonly report: (error: unknown) => void;
  readonly task: (task: DirectiveTask) => DirectiveCleanup;
}

export interface Directive<Parsed = string> {
  /** The attribute name without `data-`: `on` matches `data-on:click`. */
  readonly name: string;
  readonly key: KeyRule;
  /** The modifier names this directive accepts; any other is an error. */
  readonly modifiers?: readonly string[];
  /** Higher runs first; the default is 0. */
  readonly priority?: number;
  /** Starts the directive on an element; may return its cleanup. */
  readonly mount: (context: DirectiveContext<Parsed>) => DirectiveCleanup | undefined;
  readonly parse?: (attribute: DirectiveAttribute) => Parsed;
  /** Applies a changed attribute value; without it, a change remounts. */
  readonly update?: (context: DirectiveContext<Parsed>) => DirectiveCleanup | undefined;
}

export interface DirectiveMatch<Parsed = string> {
  readonly directive: Directive<Parsed>;
  readonly attribute: ParsedDirectiveAttribute<Parsed>;
}

export interface HelperRecord {
  readonly name: string;
  readonly value: unknown;
}

export interface DirectiveRegistry {
  register<Parsed>(directive: Directive<Parsed>): void;
  registerHelper(name: string, value: unknown): void;
  /**
   * The directive claiming `attributeName`, with the name parsed; undefined when no directive
   * claims it. Throws `DirectiveSyntaxError` for a claimed name with a bad key or modifier.
   */
  match(attributeName: string, value: string): DirectiveMatch<unknown> | undefined;
  /** Every directive, highest priority first, then in registration order. */
  definitions(): readonly Directive<unknown>[];
  helpers(): HelperScope;
  resolveHelper(name: string): HelperRecord | undefined;
  clear(): void;
}

export class DirectiveSyntaxError extends Error {
  readonly attribute: string;

  constructor(attribute: string, detail: string) {
    super(`${attribute}: ${detail}`);
    this.name = "DirectiveSyntaxError";
    this.attribute = attribute;
  }
}

const directiveNamePattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// A key's underscores are single and inside it, so `__` always starts a modifier.
const keyPattern = /^[a-z0-9](?:[a-z0-9.:-]|_(?=[a-z0-9.:-]))*$/;
const modifierPattern = /^[a-z0-9][a-z0-9-]*$/;
const helperPathPattern = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/;

/** Attribute names the protocol already gives a meaning (docs/protocol.md, section 3). */
const reservedDirectiveNames = new Set([
  "enhance",
  "error-summary",
  "lazy",
  "mode",
  "permanent",
  "poll",
  "region",
  "scope",
  "stream",
  "target",
  "track",
]);
const reservedHelperRoots = new Set(["el", "evt", "this", "__tesseraAction", ...EXPRESSION_BUILTINS]);
const reservedHelperSegments = new Set(["__proto__", "constructor", "prototype"]);

/** The directive name of a `data-*` attribute: up to the first `:` or `__`. */
function directiveNameOf(attributeName: string): string | undefined {
  if (!attributeName.startsWith("data-")) return undefined;
  const rest = attributeName.slice("data-".length);
  const end = rest.search(/:|__/);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Splits `data-NAME[:KEY][__MOD[.ARG…]…]`, checking each part against the grammar. */
export function parseAttributeName(
  attributeName: string,
  value: string,
): DirectiveAttribute | undefined {
  const directive = directiveNameOf(attributeName);
  if (directive === undefined) return undefined;
  const fail = (detail: string): never => {
    throw new DirectiveSyntaxError(attributeName, detail);
  };
  if (!directiveNamePattern.test(directive)) fail(`"${directive}" is not a directive name`);
  const [head = "", ...modifierParts] = attributeName.slice("data-".length).split("__");
  const colon = head.indexOf(":");
  const key = colon < 0 ? undefined : head.slice(colon + 1);
  if (key !== undefined && !keyPattern.test(key)) fail(`"${key}" is not a key`);
  const modifiers = modifierParts.map((part): DirectiveModifier => {
    const [name = "", ...args] = part.split(".");
    if (!modifierPattern.test(name)) fail(`"${part}" is not a modifier`);
    for (const argument of args) if (!modifierPattern.test(argument)) fail(`"${part}" has an empty or bad argument`);
    return Object.freeze({ name, args: Object.freeze(args) });
  });
  return Object.freeze({ name: attributeName, directive, key, modifiers: Object.freeze(modifiers), value });
}

function checkAgainst(directive: Directive<unknown>, attribute: DirectiveAttribute): void {
  const fail = (detail: string): never => {
    throw new DirectiveSyntaxError(attribute.name, detail);
  };
  if (directive.key === "required" && attribute.key === undefined) {
    fail(`data-${directive.name} needs a key, as in data-${directive.name}:name`);
  }
  if (directive.key === "forbidden" && attribute.key !== undefined) {
    fail(`data-${directive.name} takes no key`);
  }
  const allowed = directive.modifiers ?? [];
  for (const modifier of attribute.modifiers) {
    if (!allowed.includes(modifier.name)) {
      const known = allowed.length > 0 ? `; it accepts ${allowed.join(", ")}` : "";
      fail(`data-${directive.name} has no modifier ${modifier.name}${known}`);
    }
  }
}

function snapshotDirective<Parsed>(directive: Directive<Parsed>): Directive<Parsed> {
  if (!directiveNamePattern.test(directive.name)) {
    throw new Error(`A directive name is lowercase words joined by hyphens: ${directive.name}.`);
  }
  if (reservedDirectiveNames.has(directive.name)) {
    throw new Error(`data-${directive.name} is a protocol attribute and cannot be a directive.`);
  }
  const priority = directive.priority ?? 0;
  if (!Number.isInteger(priority) || priority < -1000 || priority > 1000) {
    throw new Error(`Directive ${directive.name} priority must be an integer from -1000 through 1000.`);
  }
  for (const modifier of directive.modifiers ?? []) {
    if (!modifierPattern.test(modifier)) throw new Error(`Directive ${directive.name} lists a bad modifier: ${modifier}.`);
  }
  return Object.freeze({
    ...directive,
    modifiers: Object.freeze([...(directive.modifiers ?? [])]),
    priority,
  });
}

function assertHelper(name: string): void {
  if (!helperPathPattern.test(name)) throw new Error(`A helper name is a dotted JavaScript identifier: ${name}.`);
  const segments = name.split(".");
  const root = segments[0] ?? "";
  if (reservedHelperRoots.has(root)) throw new Error(`Expression helper root ${root} is reserved.`);
  const unsafe = segments.find((segment) => reservedHelperSegments.has(segment));
  if (unsafe) throw new Error(`Expression helper segment ${unsafe} is reserved.`);
}

function overlappingPath(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right}.`) || right.startsWith(`${left}.`);
}

function buildHelperScope(entries: ReadonlyMap<string, unknown>): HelperScope {
  const root = Object.create(null) as Record<string, unknown>;
  const containers: Record<string, unknown>[] = [root];
  for (const [name, value] of entries) {
    const segments = name.split(".");
    const leaf = segments.pop() ?? name;
    let parent = root;
    for (const segment of segments) {
      const child = parent[segment];
      if (child && typeof child === "object") {
        parent = child as Record<string, unknown>;
      } else {
        const created = Object.create(null) as Record<string, unknown>;
        parent[segment] = created;
        containers.push(created);
        parent = created;
      }
    }
    parent[leaf] = value;
  }
  for (const container of [...containers].reverse()) Object.freeze(container);
  return root;
}

export function createDirectiveRegistry(): DirectiveRegistry {
  let directives: Directive<unknown>[] = [];
  const helperEntries = new Map<string, unknown>();
  let helperScope = buildHelperScope(helperEntries);

  return {
    register(directive) {
      const snapshot = snapshotDirective(directive) as Directive<unknown>;
      if (directives.some((current) => current.name === snapshot.name)) {
        throw new Error(`Directive data-${snapshot.name} is already registered.`);
      }
      directives.push(snapshot);
    },
    registerHelper(name, value) {
      assertHelper(name);
      const overlap = [...helperEntries.keys()].find((current) => overlappingPath(current, name));
      if (overlap) throw new Error(`Expression helper ${name} overlaps registered helper ${overlap}.`);
      helperEntries.set(name, value);
      helperScope = buildHelperScope(helperEntries);
    },
    match(attributeName, value) {
      const name = directiveNameOf(attributeName);
      const directive = directives.find((current) => current.name === name);
      if (!directive) return undefined;
      const attribute = parseAttributeName(attributeName, value);
      if (!attribute) return undefined;
      checkAgainst(directive, attribute);
      const parsed = directive.parse ? directive.parse(attribute) : attribute.value;
      return { directive, attribute: Object.freeze({ ...attribute, parsed }) };
    },
    definitions: () =>
      Object.freeze(
        directives
          .map((directive, index) => ({ directive, index }))
          .sort((left, right) => (right.directive.priority ?? 0) - (left.directive.priority ?? 0) || left.index - right.index)
          .map(({ directive }) => directive),
      ),
    helpers: () => helperScope,
    resolveHelper: (name) => (helperEntries.has(name) ? Object.freeze({ name, value: helperEntries.get(name) }) : undefined),
    clear() {
      directives = [];
      helperEntries.clear();
      helperScope = buildHelperScope(helperEntries);
    },
  };
}
