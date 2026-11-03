// The built-in directives, Datastar's vocabulary, each a registry definition. Rewritten from
// jqstar `src/declarative.ts` (`bindEvent`, `bindModel`, `bindValue`, `loadSignals`,
// `initializeComputed` and the attribute branches of `initializeDirective`) against the DOM.
// `data-html` is left out: server HTML arrives through fragments, never through a signal.
import { DirectiveSyntaxError } from "./directive.ts";
import type { Directive, DirectiveAttribute, DirectiveContext, DirectiveRegistry } from "./directive.ts";
import { computed, notifyPropertyChange, toRaw } from "./reactivity.ts";
import { cloneValue, isPlainRecord, isThenable, toText } from "./values.ts";

const location = (attribute: DirectiveAttribute) => ({ attribute: attribute.name });

function camelCase(value: string): string {
  return value.replace(/-([a-z0-9])/g, (_match, character: string) => character.toUpperCase());
}

/**
 * HTML lowercases attribute names, so a key arrives in kebab case; `__case.NAME` (Datastar's
 * modifier) names the spelling it stands for. Only hyphens change: `.` and `:` stay as written.
 */
const CASES = {
  camel: camelCase,
  kebab: (value: string) => value,
  snake: (value: string) => value.replace(/-/g, "_"),
  pascal: (value: string) => camelCase(value).replace(/^[a-z]/, (character) => character.toUpperCase()),
} as const;

type CaseName = keyof typeof CASES;

/** The conversion an attribute's `__case` modifier asks for, or `fallback` without one. */
function keyCase(attribute: DirectiveAttribute, fallback: CaseName): (key: string) => string {
  const named = attribute.modifiers.filter(({ name }) => name === "case");
  if (named.length === 0) return CASES[fallback];
  const fail = (detail: string): never => {
    throw new DirectiveSyntaxError(attribute.name, detail);
  };
  if (named.length > 1) fail("one __case per attribute");
  const [spelling, ...rest] = named[0]?.args ?? [];
  if (spelling === undefined || rest.length > 0) fail("__case takes one case name, as in __case.camel");
  if (!Object.hasOwn(CASES, spelling ?? "")) fail(`__case.${spelling ?? ""} is not a case; use camel, kebab, snake or pascal`);
  return CASES[spelling as CaseName];
}

/** Reports a promise's failure; anything else needs nothing. */
function settle(result: unknown, report: (error: unknown) => void): void {
  if (isThenable(result)) Promise.resolve(result).catch(report);
}

/** Runs `apply` with the attribute's value now and whenever what it read changes. */
function bindValue(context: DirectiveContext<unknown>, apply: (value: unknown) => void): void {
  const { attribute, expressions, report } = context;
  const evaluate = expressions.compileValue(attribute.value, location(attribute));
  context.effect(() => {
    try {
      apply(evaluate(context.context));
    } catch (error) {
      report(error);
    }
  });
}

function styled(element: Element, directive: string): CSSStyleDeclaration {
  const style = (element as Partial<ElementCSSInlineStyle>).style;
  if (!style) throw new TypeError(`data-${directive} needs an element with a style, such as an HTML element.`);
  return style;
}

function mergeSignals(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (isPlainRecord(existing) && isPlainRecord(value)) mergeSignals(existing, value);
    else target[key] = cloneValue(value);
  }
}

// --- Signals, computed values, refs -------------------------------------------------------

const signals: Directive = {
  name: "signals",
  key: "forbidden",
  modifiers: ["region", "document"],
  priority: 300,
  mount({ attribute, context, expressions, scope }) {
    const names = new Set(attribute.modifiers.map(({ name }) => name));
    if (names.size > 1) throw new TypeError("data-signals takes __region or __document, not both.");
    const value = expressions.compileValue(attribute.value, location(attribute))(context);
    if (!isPlainRecord(value)) {
      throw new TypeError('data-signals must evaluate to an object, as in data-signals="{count: 0}".');
    }
    // Declaring goes to one scope, never through the chain, so a name declared here shadows
    // the same name further out.
    mergeSignals(scope(names.has("region") ? "region" : names.has("document") ? "document" : "nearest"), value);
    return undefined;
  },
};

const computedSignal: Directive = {
  name: "computed",
  key: "required",
  modifiers: ["case"],
  priority: 200,
  mount({ attribute, context, expressions, scope }) {
    const name = keyCase(attribute, "camel")(attribute.key ?? "");
    const evaluate = expressions.compileValue(attribute.value, location(attribute));
    const value = computed(() => evaluate(context));
    const target = scope();
    const previous = Object.getOwnPropertyDescriptor(toRaw(target), name);
    Object.defineProperty(target, name, { configurable: true, enumerable: true, get: () => value.value });
    notifyPropertyChange(target, name);
    return () => {
      value.stop();
      if (previous) Object.defineProperty(target, name, previous);
      else Reflect.deleteProperty(target, name);
      notifyPropertyChange(target, name);
    };
  },
};

const ref: Directive = {
  name: "ref",
  key: "optional",
  modifiers: ["case"],
  priority: 150,
  mount({ attribute, element, scope }) {
    const spell = keyCase(attribute, "camel");
    const name = attribute.key === undefined ? attribute.value.trim() : spell(attribute.key);
    if (!/^[A-Za-z_][\w]*$/.test(name)) {
      throw new TypeError('data-ref names a signal: data-ref:name or data-ref="name".');
    }
    const target = scope();
    target[name] = element;
    return () => {
      if (toRaw(target)[name] === element) Reflect.deleteProperty(target, name);
    };
  },
};

// --- Showing values -----------------------------------------------------------------------

const text: Directive = {
  name: "text",
  key: "forbidden",
  mount(context) {
    bindValue(context, (value) => {
      context.element.textContent = toText(value);
    });
    return undefined;
  },
};

const show: Directive = {
  name: "show",
  key: "forbidden",
  mount(context) {
    const style = styled(context.element, "show");
    const display = style.getPropertyValue("display");
    const priority = style.getPropertyPriority("display");
    const restore = (): void => {
      if (display) style.setProperty("display", display, priority);
      else style.removeProperty("display");
    };
    bindValue(context, (value) => {
      if (value) restore();
      else style.setProperty("display", "none");
    });
    return restore;
  },
};

const classes: Directive = {
  name: "class",
  key: "forbidden",
  mount(context) {
    const { classList } = context.element;
    const original = new Set(Array.from(classList));
    const touched = new Set<string>();
    let listed = new Set<string>();
    bindValue(context, (value) => {
      if (!isPlainRecord(value)) throw new TypeError('data-class must evaluate to an object, as in data-class="{active: $on}".');
      const next = new Map<string, boolean>();
      for (const [names, enabled] of Object.entries(value)) {
        for (const name of names.split(/\s+/).filter(Boolean)) next.set(name, Boolean(enabled) || next.get(name) === true);
      }
      for (const name of listed) if (!next.has(name)) classList.remove(name);
      for (const [name, enabled] of next) {
        touched.add(name);
        classList.toggle(name, enabled);
      }
      listed = new Set(next.keys());
    });
    return () => {
      for (const name of touched) classList.toggle(name, original.has(name));
    };
  },
};

const attr: Directive = {
  name: "attr",
  key: "required",
  modifiers: ["case"],
  mount(context) {
    const { element } = context;
    // `__case.camel` writes what HTML cannot spell in an attribute name, such as SVG's viewBox.
    const name = keyCase(context.attribute, "kebab")(context.attribute.key ?? "");
    const original = element.getAttribute(name);
    bindValue(context, (value) => {
      if (value === null || value === undefined || value === false) element.removeAttribute(name);
      else if (value === true) element.setAttribute(name, "");
      else element.setAttribute(name, toText(value));
    });
    return () => {
      if (original === null) element.removeAttribute(name);
      else element.setAttribute(name, original);
    };
  },
};

const style: Directive = {
  name: "style",
  key: "required",
  mount(context) {
    const declaration = styled(context.element, "style");
    const property = context.attribute.key ?? "";
    const original = declaration.getPropertyValue(property);
    const priority = declaration.getPropertyPriority(property);
    const restore = (): void => {
      if (original) declaration.setProperty(property, original, priority);
      else declaration.removeProperty(property);
    };
    bindValue(context, (value) => {
      if (value === null || value === undefined || value === false) restore();
      else declaration.setProperty(property, toText(value));
    });
    return restore;
  },
};

// --- Two-way binding ----------------------------------------------------------------------

/** An unchecked radio leaves the bound value as it is. */
const SKIP = Symbol("skip");

type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function formField(element: Element): FormField {
  if (["input", "select", "textarea"].includes(element.localName)) return element as FormField;
  throw new TypeError("data-bind works on input, select and textarea elements.");
}

function isInput(field: FormField): field is HTMLInputElement {
  return field.localName === "input";
}

function isMultipleSelect(field: FormField): field is HTMLSelectElement {
  return field.localName === "select" && (field as HTMLSelectElement).multiple;
}

function readField(field: FormField, current: unknown): unknown {
  if (isInput(field) && field.type === "checkbox") {
    if (!Array.isArray(current)) return field.checked;
    const values = current.map(String);
    return field.checked ? [...new Set([...values, field.value])] : values.filter((value) => value !== field.value);
  }
  if (isInput(field) && field.type === "radio") return field.checked ? field.value : SKIP;
  if (isMultipleSelect(field)) return Array.from(field.selectedOptions, (option) => option.value);
  const numeric = (isInput(field) && (field.type === "number" || field.type === "range")) || typeof current === "number";
  if (numeric) return field.value === "" ? null : Number(field.value);
  return field.value;
}

function writeField(field: FormField, value: unknown): void {
  if (isInput(field) && field.type === "checkbox") {
    field.checked = Array.isArray(value) ? value.map(String).includes(field.value) : Boolean(value);
    return;
  }
  if (isInput(field) && field.type === "radio") {
    field.checked = toText(value) === field.value;
    return;
  }
  if (isMultipleSelect(field)) {
    const selected = new Set(Array.isArray(value) ? value.map(String) : []);
    for (const option of Array.from(field.options)) option.selected = selected.has(option.value);
    return;
  }
  const next = toText(value);
  if (field.value !== next) field.value = next;
}

function readPath(target: Record<string, unknown>, path: readonly string[]): unknown {
  let value: unknown = target;
  for (const key of path) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function writePath(target: Record<string, unknown>, path: readonly string[], value: unknown): void {
  let parent = target;
  for (const key of path.slice(0, -1)) {
    if (!isPlainRecord(toRaw(parent[key]))) parent[key] = {};
    parent = parent[key] as Record<string, unknown>;
  }
  parent[path[path.length - 1] ?? ""] = value;
}

const bind: Directive = {
  name: "bind",
  key: "required",
  modifiers: ["case"],
  priority: 100,
  mount({ attribute, context, effect, element, listen, report }) {
    const field = formField(element);
    const path = (attribute.key ?? "").split(".").map(keyCase(attribute, "camel"));
    if (path.some((key) => key === "")) throw new TypeError("data-bind needs a signal path, such as data-bind:user.name.");
    const { signals: target } = context;
    if (readPath(target, path) === undefined) {
      const initial = readField(field, undefined);
      if (initial !== SKIP) writePath(target, path, initial);
    }
    effect(() => {
      try {
        writeField(field, readPath(target, path));
      } catch (error) {
        report(error);
      }
    });
    const update = (): void => {
      const value = readField(field, readPath(target, path));
      if (value !== SKIP) writePath(target, path, value);
    };
    listen(field, "input", update);
    listen(field, "change", update);
    return undefined;
  },
};

// --- Statements ---------------------------------------------------------------------------

const effectStatement: Directive = {
  name: "effect",
  key: "forbidden",
  mount({ attribute, context, effect, expressions, report }) {
    const execute = expressions.compileStatement(attribute.value, location(attribute));
    effect(() => {
      settle(execute(context), report);
    });
    return undefined;
  },
};

const init: Directive = {
  name: "init",
  key: "forbidden",
  priority: -100,
  mount({ attribute, context, expressions, report }) {
    settle(expressions.compileStatement(attribute.value, location(attribute))(context), report);
    return undefined;
  },
};

// --- Events -------------------------------------------------------------------------------

const KEYS: Readonly<Record<string, string>> = {
  enter: "Enter",
  escape: "Escape",
  space: " ",
  tab: "Tab",
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};

const FLAGS = ["prevent", "stop", "once", "self", "outside", "window", "document", "capture", "passive"] as const;

interface EventOptions {
  readonly event: string;
  readonly flags: ReadonlySet<(typeof FLAGS)[number]>;
  readonly key: string | undefined;
  readonly debounce: number | undefined;
  readonly throttle: number | undefined;
}

function parseEvent(attribute: DirectiveAttribute): EventOptions {
  const fail = (detail: string): never => {
    throw new DirectiveSyntaxError(attribute.name, detail);
  };
  const flags = new Set<(typeof FLAGS)[number]>();
  let key: string | undefined;
  let debounce: number | undefined;
  let throttle: number | undefined;
  const spell = keyCase(attribute, "kebab");
  for (const { name, args } of attribute.modifiers) {
    if (name === "case") continue;
    if (name === "debounce" || name === "throttle") {
      if (args.length > 1) fail(`${name} takes one duration, as in __${name}.250ms`);
      const match = /^(\d+)(ms|s)?$/.exec(args[0] ?? "250ms");
      if (!match) fail(`${name} takes a duration such as 250, 250ms or 1s`);
      const amount = Number(match?.[1]) * (match?.[2] === "s" ? 1000 : 1);
      if (name === "debounce") debounce = amount;
      else throttle = amount;
      continue;
    }
    if (args.length > 0) fail(`${name} takes no argument`);
    if (name in KEYS) {
      if (key !== undefined) fail("one key filter per listener");
      key = KEYS[name];
    } else {
      flags.add(name as (typeof FLAGS)[number]);
    }
  }
  if (flags.has("prevent") && flags.has("passive")) fail("prevent and passive cannot be combined");
  if (debounce !== undefined && throttle !== undefined) fail("debounce and throttle cannot be combined");
  if ([flags.has("window"), flags.has("document"), flags.has("outside")].filter(Boolean).length > 1) {
    fail("window, document and outside cannot be combined");
  }
  return { event: spell(attribute.key ?? ""), flags, key, debounce, throttle };
}

/**
 * Firefox starts an HTML5 drag only when its dragstart sets some data, and an expression cannot
 * call `dataTransfer.setData()` (#40): a drag that carries none yet carries an empty `text/plain`.
 */
function startDrag(event: Event): void {
  const transfer = (event as DragEvent).dataTransfer as DataTransfer | null | undefined;
  if (transfer && transfer.types.length === 0) transfer.setData("text/plain", "");
}

const on: Directive<EventOptions> = {
  name: "on",
  key: "required",
  modifiers: [...FLAGS, "debounce", "throttle", "case", ...Object.keys(KEYS)],
  parse: parseEvent,
  mount({ attribute, cleanup, context, element, expressions, listen, report }) {
    const { event: type, flags, key, debounce, throttle } = attribute.parsed;
    const execute = expressions.compileStatement(attribute.value, location(attribute));
    const document = element.ownerDocument;
    let invoked = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = -Infinity;

    const run = (event: Event): void => {
      invoked = true;
      last = Date.now();
      settle(execute({ ...context, event }), report);
    };
    const handle = (event: Event): void => {
      if (flags.has("once") && invoked) return;
      const target = event.target as Node | null;
      if (flags.has("self") && target !== element) return;
      if (flags.has("outside") && target !== null && element.contains(target)) return;
      if (key !== undefined && (event as KeyboardEvent).key !== key) return;
      if (flags.has("prevent")) event.preventDefault();
      if (flags.has("stop")) event.stopPropagation();
      if (type === "dragstart") startDrag(event);
      if (debounce !== undefined) {
        clearTimeout(timer);
        timer = setTimeout(() => {
          run(event);
        }, debounce);
        return;
      }
      if (throttle !== undefined && Date.now() - last < throttle) return;
      run(event);
    };

    const target: EventTarget = flags.has("window")
      ? (document.defaultView ?? document)
      : flags.has("document") || flags.has("outside")
        ? document
        : element;
    cleanup(() => {
      clearTimeout(timer);
    });
    listen(target, type, handle, { capture: flags.has("capture"), passive: flags.has("passive") });
    return undefined;
  },
};

// --- Markers ------------------------------------------------------------------------------

/** `data-ignore` and `data-ignore__self` are read by the scanner; the directive reserves them. */
const ignore: Directive = { name: "ignore", key: "forbidden", modifiers: ["self"], mount: () => undefined };

/** `data-ignore-morph` is read by the patcher (#9). */
const ignoreMorph: Directive = { name: "ignore-morph", key: "forbidden", mount: () => undefined };

export const BUILTIN_DIRECTIVES: readonly Directive<unknown>[] = [
  signals,
  computedSignal,
  ref,
  bind,
  text,
  show,
  classes,
  attr,
  style,
  on as Directive<unknown>,
  effectStatement,
  init,
  ignore,
  ignoreMorph,
] as Directive<unknown>[];

export function registerBuiltins(registry: DirectiveRegistry): void {
  for (const directive of BUILTIN_DIRECTIVES) registry.register(directive);
}
