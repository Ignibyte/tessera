// The directive registry: matching attribute names with keys and modifiers, key rules,
// reserved names, ordering, and helpers. The helper cases follow jqstar `test/directive.test.ts`.
import { describe, expect, it } from "vitest";
import { createDirectiveRegistry, DirectiveSyntaxError, parseAttributeName } from "../../src/directive.ts";
import type { Directive } from "../../src/directive.ts";

function directive(name: string, overrides: Partial<Directive> = {}): Directive {
  return { name, key: "forbidden", mount: () => undefined, ...overrides };
}

function syntaxError(work: () => unknown): DirectiveSyntaxError {
  try {
    work();
  } catch (error) {
    if (error instanceof DirectiveSyntaxError) return error;
    throw error;
  }
  throw new Error("expected a DirectiveSyntaxError");
}

describe("attribute names", () => {
  it("splits the directive, the key and the modifiers with their arguments", () => {
    expect(parseAttributeName("data-on:click__debounce.500ms.leading__prevent", "$n++")).toEqual({
      name: "data-on:click__debounce.500ms.leading__prevent",
      directive: "on",
      key: "click",
      modifiers: [
        { name: "debounce", args: ["500ms", "leading"] },
        { name: "prevent", args: [] },
      ],
      value: "$n++",
    });
  });

  it("reads a modifier without a key, and a key holding dots, hyphens and colons", () => {
    expect(parseAttributeName("data-signals__document", "{}")).toMatchObject({
      directive: "signals",
      key: undefined,
      modifiers: [{ name: "document", args: [] }],
    });
    expect(parseAttributeName("data-bind:user.first-name", "")).toMatchObject({ key: "user.first-name" });
    expect(parseAttributeName("data-on:my-lib:ready", "")).toMatchObject({ directive: "on", key: "my-lib:ready" });
    expect(parseAttributeName("data-ignore-morph", "")).toMatchObject({ directive: "ignore-morph", key: undefined });
  });

  it("is undefined for anything that is not a data attribute", () => {
    expect(parseAttributeName("class", "x")).toBeUndefined();
    expect(parseAttributeName("aria-label", "x")).toBeUndefined();
  });

  it.each([
    ["an empty key", "data-on:"],
    ["an empty modifier", "data-on:click__"],
    ["an empty modifier argument", "data-on:click__debounce."],
    ["an uppercase key", "data-on:Click"],
    ["a bad directive name", "data-on-:click"],
    ["a key ending in an underscore before a modifier", "data-on:a___prevent"],
  ])("refuses %s", (_case, name) => {
    expect(syntaxError(() => parseAttributeName(name, "")).attribute).toBe(name);
  });
});

describe("matching", () => {
  it("matches a registered directive and leaves other data attributes alone", () => {
    const registry = createDirectiveRegistry();
    const on = directive("on", { key: "required", modifiers: ["prevent", "debounce"] });
    registry.register(on);

    const match = registry.match("data-on:submit__prevent", "@post('/x')");
    expect(match?.directive).toBe(registry.definitions()[0]);
    expect(match?.attribute).toMatchObject({ key: "submit", modifiers: [{ name: "prevent" }], parsed: "@post('/x')" });
    expect(registry.match("data-region", "content")).toBeUndefined();
    expect(registry.match("data-onward", "")).toBeUndefined();
    expect(registry.match("data-whatever__odd--", "")).toBeUndefined();
  });

  it("applies the key rule", () => {
    const registry = createDirectiveRegistry();
    registry.register(directive("on", { key: "required" }));
    registry.register(directive("text", { key: "forbidden" }));
    registry.register(directive("signals", { key: "optional" }));

    expect(syntaxError(() => registry.match("data-on", "")).message).toBe(
      "data-on: data-on needs a key, as in data-on:name",
    );
    expect(syntaxError(() => registry.match("data-text:x", "")).message).toBe("data-text:x: data-text takes no key");
    expect(registry.match("data-signals", "{}")?.attribute.key).toBeUndefined();
    expect(registry.match("data-signals:count", "1")?.attribute.key).toBe("count");
  });

  it("refuses a modifier the directive does not accept, naming the ones it does", () => {
    const registry = createDirectiveRegistry();
    registry.register(directive("on", { key: "required", modifiers: ["prevent", "stop"] }));
    registry.register(directive("text"));

    expect(syntaxError(() => registry.match("data-on:click__prevnet", "")).message).toBe(
      "data-on:click__prevnet: data-on has no modifier prevnet; it accepts prevent, stop",
    );
    expect(syntaxError(() => registry.match("data-text__trim", "")).message).toBe(
      "data-text__trim: data-text has no modifier trim",
    );
  });

  it("gives the directive's parse the attribute", () => {
    const registry = createDirectiveRegistry();
    registry.register<number>({
      name: "count",
      key: "forbidden",
      parse: (attribute) => Number(attribute.value),
      mount: () => undefined,
    });
    expect(registry.match("data-count", "41")?.attribute.parsed).toBe(41);
  });
});

describe("registration", () => {
  it("orders definitions by priority, then by registration", () => {
    const registry = createDirectiveRegistry();
    registry.register(directive("text"));
    registry.register(directive("signals", { priority: 100 }));
    registry.register(directive("show"));
    registry.register(directive("init", { priority: -10 }));
    expect(registry.definitions().map(({ name }) => name)).toEqual(["signals", "text", "show", "init"]);
  });

  it("refuses duplicates, protocol names, bad names and bad priorities", () => {
    const registry = createDirectiveRegistry();
    registry.register(directive("text"));
    expect(() => {
      registry.register(directive("text"));
    }).toThrow("Directive data-text is already registered.");
    for (const name of ["region", "target", "stream", "track"]) {
      expect(() => {
        registry.register(directive(name));
      }).toThrow(`data-${name} is a protocol attribute and cannot be a directive.`);
    }
    expect(() => {
      registry.register(directive("Text"));
    }).toThrow("lowercase words");
    expect(() => {
      registry.register(directive("show", { priority: 1.5 }));
    }).toThrow("priority must be an integer");
  });

  it("freezes what it registers", () => {
    const registry = createDirectiveRegistry();
    const modifiers = ["prevent"];
    registry.register(directive("on", { key: "required", modifiers }));
    modifiers.push("stop");
    expect(() => registry.match("data-on:click__stop", "")).toThrow(DirectiveSyntaxError);
    expect(Object.isFrozen(registry.definitions()[0])).toBe(true);
  });

  it("forgets everything on clear", () => {
    const registry = createDirectiveRegistry();
    registry.register(directive("text"));
    registry.registerHelper("format.money", () => "");
    registry.clear();
    expect(registry.definitions()).toEqual([]);
    expect(registry.match("data-text", "")).toBeUndefined();
    expect(registry.helpers()).toEqual({});
  });
});

describe("helpers", () => {
  it("builds a frozen nested scope from dotted names", () => {
    const registry = createDirectiveRegistry();
    const money = (value: number) => `$${value}`;
    registry.registerHelper("format.money", money);
    registry.registerHelper("format.date", () => "today");
    registry.registerHelper("slug", (text: string) => text.toLowerCase());

    const scope = registry.helpers() as { format: { money: unknown }; slug: unknown };
    expect(scope.format.money).toBe(money);
    expect(Object.keys(scope).sort()).toEqual(["format", "slug"]);
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Object.isFrozen(scope.format)).toBe(true);
    expect(registry.resolveHelper("format.money")).toEqual({ name: "format.money", value: money });
    expect(registry.resolveHelper("format")).toBeUndefined();
  });

  it.each([
    ["a reserved root", "el.thing", "Expression helper root el is reserved."],
    ["a built-in root", "parseInt.radix", "Expression helper root parseInt is reserved."],
    ["a prototype segment", "format.__proto__", "A helper name is a dotted JavaScript identifier"],
    ["a constructor segment", "format.constructor", "Expression helper segment constructor is reserved."],
    ["a hyphen", "my-helper", "A helper name is a dotted JavaScript identifier"],
  ])("refuses %s", (_case, name, message) => {
    const registry = createDirectiveRegistry();
    expect(() => {
      registry.registerHelper(name, () => undefined);
    }).toThrow(message);
  });

  it("refuses a helper overlapping another", () => {
    const registry = createDirectiveRegistry();
    registry.registerHelper("format.money", () => "");
    expect(() => {
      registry.registerHelper("format", () => "");
    }).toThrow("Expression helper format overlaps registered helper format.money.");
    expect(() => {
      registry.registerHelper("format.money.cents", () => "");
    }).toThrow("overlaps");
  });
});
