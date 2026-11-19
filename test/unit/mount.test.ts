// data-mount (#45): a same-origin module script mounted on its element, with data-mount-data;
// its cleanup and unmount before the element leaves, a remount when either attribute changes,
// and the element's children kept through a morph. These run in jsdom's own document, as the
// patch tests do, with a fake module loader in place of import().
import { afterEach, describe, expect, it, vi } from "vitest";
import { createActionRecorder } from "../../src/actions.ts";
import { mountAttributes } from "../../src/attributes.ts";
import type { AttributeFailure } from "../../src/attributes.ts";
import { registerBuiltins } from "../../src/builtins.ts";
import { createDirectiveRegistry } from "../../src/directive.ts";
import { createTrustedExpressionEngine } from "../../src/expression.ts";
import { Kernel } from "../../src/kernel.ts";
import { createPatcher } from "../../src/patch.ts";
import { Scheduler } from "../../src/reactivity.ts";

let kernel: Kernel | undefined;

afterEach(() => {
  if (kernel && !kernel.disposed) kernel.dispose();
  kernel = undefined;
  document.body.innerHTML = "";
});

/** A widget module that writes its own DOM into the element and logs each call. */
function widget(log: string[], name: string): Record<string, unknown> {
  return {
    mount(element: Element, data: unknown) {
      log.push(`${name} mount ${element.id} ${JSON.stringify(data)}`);
      const canvas = element.ownerDocument.createElement("canvas");
      canvas.className = "library";
      element.append(canvas);
      return () => {
        log.push(`${name} cleanup ${element.id}`);
      };
    },
    unmount(element: Element) {
      log.push(`${name} unmount ${element.id} ${element.isConnected ? "connected" : "gone"}`);
      element.replaceChildren();
    },
  };
}

function fixture(html: string, modules: Record<string, unknown> = {}) {
  document.body.innerHTML = html;
  const log: string[] = [];
  const available: Record<string, unknown> = { "/widgets/chart.js": widget(log, "chart"), "/widgets/map.js": widget(log, "map"), ...modules };
  const load = vi.fn((url: string): Promise<unknown> => {
    const module = available[new URL(url).pathname];
    return module === undefined ? Promise.reject(new Error(`404 ${url}`)) : Promise.resolve(module);
  });
  const scheduler = new Scheduler();
  const current = new Kernel(document, { flush: () => scheduler.nextUpdate() });
  kernel = current;
  const registry = createDirectiveRegistry();
  registerBuiltins(registry, load);
  const failures: AttributeFailure[] = [];
  const mount = mountAttributes(document.body, {
    kernel: current,
    scheduler,
    expressions: createTrustedExpressionEngine(),
    registry,
    actions: createActionRecorder().seam,
    report: (failure) => failures.push(failure),
  });
  const patcher = createPatcher({
    kernel: current,
    scopes: mount.scopes,
    refresh: (elements) => {
      mount.refresh(elements);
    },
    release: (element, attribute) => {
      mount.release(element, attribute);
    },
  });
  const find = (selector: string): HTMLElement => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`no ${selector}`);
    return element;
  };
  // A failed task also rejects whenEnhanced; the failures array is what the tests read.
  const settle = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    await current.whenEnhanced().catch(() => undefined);
  };
  const messages = (): string[] => failures.map(({ error }) => (error instanceof Error ? error.message : String(error)));
  return { log, load, patcher, failures, messages, find, settle };
}

const region = (inner: string): string => `<div data-region="content">${inner}</div>`;

describe("mounting", () => {
  it("imports the module once per URL and mounts each element with its data, or null", async () => {
    const { log, load, find, settle, messages } = fixture(
      region(`<div id="a" data-mount="/widgets/chart.js" data-mount-data='{"points":[1,2]}'></div><div id="b" data-mount="widgets/chart.js"></div>`),
    );
    await settle();
    expect(log).toEqual(['chart mount a {"points":[1,2]}', "chart mount b null"]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith("http://localhost:3000/widgets/chart.js");
    expect(find("#a canvas.library")).toBeTruthy();
    expect(messages()).toEqual([]);
  });

  it("mounts an element a patch brings, importing nothing again", async () => {
    const { log, load, patcher, settle } = fixture(region(`<div id="a" data-mount="/widgets/chart.js"></div>`));
    await settle();
    patcher.patchElements("content", `<div id="b" data-mount="/widgets/chart.js" data-mount-data="7"></div>`, "append");
    await settle();
    expect(log).toEqual(["chart mount a null", "chart mount b 7"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("calls nothing when the element goes before the import settles", async () => {
    const { log, find, settle } = fixture(region(`<div id="a" data-mount="/widgets/chart.js"></div>`));
    find("#a").remove();
    await settle();
    expect(log).toEqual([]);
  });
});

describe("leaving the page", () => {
  it("calls the cleanup, then unmount, before a morph removes the element", async () => {
    const { log, patcher, settle } = fixture(region(`<div id="a" data-mount="/widgets/chart.js"></div><p>text</p>`));
    await settle();
    patcher.patchElements("content", region(`<p>text</p>`));
    expect(log).toEqual(["chart mount a null", "chart cleanup a", "chart unmount a connected"]);
  });

  it("calls them before a remove and before an inner patch drops the element", async () => {
    const { log, patcher, settle } = fixture(
      region(`<div data-t-c="card"><div id="a" data-mount="/widgets/chart.js"></div></div><div id="b" data-mount="/widgets/map.js"></div>`),
    );
    await settle();
    patcher.patchElements("content/card", "", "remove");
    patcher.patchElements("content", `<p>empty</p>`, "inner");
    expect(log.slice(2)).toEqual(["chart cleanup a", "chart unmount a connected", "map cleanup b", "map unmount b connected"]);
  });

  it("calls them once the element is gone when a script removes it", async () => {
    const { log, find, settle } = fixture(region(`<div id="a" data-mount="/widgets/chart.js"></div>`));
    await settle();
    find("#a").remove();
    await settle();
    expect(log).toEqual(["chart mount a null", "chart cleanup a", "chart unmount a gone"]);
  });

  it("calls unmount even when the cleanup throws, and reports the throw", async () => {
    const log: string[] = [];
    const { messages, patcher, settle } = fixture(region(`<div id="a" data-mount="/widgets/brittle.js"></div>`), {
      "/widgets/brittle.js": {
        mount: () => () => {
          throw new Error("cleanup broke");
        },
        unmount: () => log.push("unmount"),
      },
    });
    await settle();
    expect(() => {
      patcher.patchElements("content", region(""));
    }).toThrow("cleanup broke");
    expect(log).toEqual(["unmount"]);
    expect(messages()).toEqual([]);
  });
});

describe("remounting", () => {
  it("unmounts and mounts again with the new data when a morph changes data-mount-data", async () => {
    const { log, patcher, settle } = fixture(region(`<div id="a" data-mount="/widgets/chart.js" data-mount-data="1"></div>`));
    await settle();
    patcher.patchElements("content", region(`<div id="a" data-mount="/widgets/chart.js" data-mount-data="2"></div>`));
    await settle();
    expect(log).toEqual(["chart mount a 1", "chart cleanup a", "chart unmount a connected", "chart mount a 2"]);
  });

  it("remounts when a script adds, changes or removes data-mount-data, and not on the same value", async () => {
    const { log, find, settle } = fixture(region(`<div id="a" data-mount="/widgets/chart.js"></div>`));
    await settle();
    const element = find("#a");
    element.setAttribute("data-mount-data", '"x"');
    await settle();
    element.setAttribute("data-mount-data", '"x"');
    await settle();
    element.removeAttribute("data-mount-data");
    await settle();
    expect(log.filter((line) => line.includes("mount ") && !line.includes("unmount"))).toEqual([
      "chart mount a null",
      'chart mount a "x"',
      "chart mount a null",
    ]);
  });

  it("unmounts the old module and mounts the new one when data-mount changes", async () => {
    const { log, patcher, settle } = fixture(region(`<div id="a" data-mount="/widgets/chart.js"></div>`));
    await settle();
    patcher.patchElements("content", region(`<div id="a" data-mount="/widgets/map.js" data-mount-data="3"></div>`));
    await settle();
    expect(log).toEqual(["chart mount a null", "chart cleanup a", "chart unmount a connected", "map mount a 3"]);
  });

  it("unmounts when the markup drops data-mount, and the element takes the server's children", async () => {
    const { log, find, patcher, settle } = fixture(region(`<div id="a" data-mount="/widgets/chart.js"></div>`));
    await settle();
    patcher.patchElements("content", region(`<div id="a"><p>static</p></div>`));
    await settle();
    expect(log).toEqual(["chart mount a null", "chart cleanup a", "chart unmount a connected"]);
    expect(find("#a").innerHTML).toBe("<p>static</p>");
  });
});

describe("morphing a mounted element", () => {
  it("keeps its children and takes the incoming attributes, without a remount", async () => {
    const { log, find, patcher, settle } = fixture(
      region(`<h1>Old</h1><div id="a" class="old" title="t" data-mount="/widgets/chart.js" data-mount-data="1"></div>`),
    );
    await settle();
    const element = find("#a");
    const canvas = find("#a canvas");
    patcher.patchElements("content", region(`<h1>New</h1><div id="a" class="new" data-mount="/widgets/chart.js" data-mount-data="1"><span>fallback</span></div>`));
    await settle();
    expect(find("#a")).toBe(element);
    expect(find("#a canvas")).toBe(canvas);
    expect(element.children).toHaveLength(1);
    expect(element.className).toBe("new");
    expect(element.hasAttribute("title")).toBe(false);
    expect(find("h1").textContent).toBe("New");
    expect(log).toEqual(["chart mount a 1"]);
  });

  it("keeps them through an inner patch of the region and a whole-document morph", async () => {
    const { log, find, patcher, settle } = fixture(region(`<div id="a" data-mount="/widgets/chart.js"></div>`));
    await settle();
    const canvas = find("#a canvas");
    patcher.patchElements("content", `<div id="a" data-mount="/widgets/chart.js" lang="en"></div><p>more</p>`, "inner");
    const incoming = document.implementation.createHTMLDocument("next").body as HTMLBodyElement;
    incoming.innerHTML = region(`<div id="a" data-mount="/widgets/chart.js" lang="fr"></div>`);
    patcher.patchBody(incoming);
    await settle();
    expect(find("#a canvas")).toBe(canvas);
    expect(find("#a").getAttribute("lang")).toBe("fr");
    expect(log).toEqual(["chart mount a null"]);
  });

  it("keeps them when the mounted element is the morph's target", async () => {
    const { find, patcher, settle } = fixture(region(`<div data-t-c="chart" data-mount="/widgets/chart.js"></div>`));
    await settle();
    const canvas = find("canvas");
    patcher.patchElements("content/chart", `<div data-t-c="chart" data-mount="/widgets/chart.js" class="wide"></div>`);
    expect(find("canvas")).toBe(canvas);
    expect(find("[data-t-c]").className).toBe("wide");
  });
});

describe("errors", () => {
  it("reports a module without a mount export, and mounts the rest of the page", async () => {
    const { log, messages, failures, settle } = fixture(region(`<div id="a" data-mount="/widgets/empty.js"></div><div id="b" data-mount="/widgets/chart.js"></div>`), {
      "/widgets/empty.js": { unmount: () => undefined },
    });
    await settle();
    expect(messages()).toEqual(["http://localhost:3000/widgets/empty.js has no mount export."]);
    expect(failures[0]?.attribute).toBe("data-mount");
    expect(log).toEqual(["chart mount b null"]);
  });

  it("reports a failed import, and imports again for a later element", async () => {
    const { load, messages, patcher, settle } = fixture(region(`<div id="a" data-mount="/widgets/missing.js"></div>`));
    await settle();
    patcher.patchElements("content", `<div id="b" data-mount="/widgets/missing.js"></div>`, "append");
    await settle();
    expect(messages()).toEqual(["404 http://localhost:3000/widgets/missing.js", "404 http://localhost:3000/widgets/missing.js"]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("refuses another origin, an empty URL and data that is not JSON without importing", async () => {
    const { load, messages, settle } = fixture(
      region(`<div data-mount="https://cdn.example/chart.js"></div><div data-mount=" "></div><div data-mount="/widgets/chart.js" data-mount-data="{nope}"></div>`),
    );
    await settle();
    expect(messages()[0]).toBe("data-mount takes a same-origin module script: https://cdn.example/chart.js");
    expect(messages()[1]).toBe("data-mount names a module script URL.");
    expect(messages()[2]).toMatch(/^data-mount-data is not JSON: /);
    expect(load).not.toHaveBeenCalled();
  });

  it("reports a mount that throws or returns something other than a cleanup", async () => {
    const log: string[] = [];
    const { messages, patcher, settle } = fixture(region(`<div id="a" data-mount="/widgets/throws.js"></div><div id="b" data-mount="/widgets/odd.js"></div>`), {
      "/widgets/throws.js": {
        mount: () => {
          throw new Error("no canvas");
        },
        unmount: () => log.push("throws unmount"),
      },
      "/widgets/odd.js": { mount: () => 42, unmount: () => log.push("odd unmount") },
    });
    await settle();
    expect(messages().sort()).toEqual(["The mount of http://localhost:3000/widgets/odd.js must return a cleanup function or nothing.", "no canvas"]);
    patcher.patchElements("content", region(""));
    expect(log).toEqual(["odd unmount"]);
  });
});
