// The kernel's claim, ledger, render transactions, barrier and disposal. Ported from jqstar
// `test/kernel.test.ts`, without the plugin, expression, action and operation-hub cases; the
// focus, boot and flush cases are new.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDisposalReport, DisposalError } from "../../src/disposal.ts";
import { compareElementDepth, Kernel, kernelFor } from "../../src/kernel.ts";
import type { Mount } from "../../src/kernel.ts";

const realms: HTMLIFrameElement[] = [];

function realm(): Window {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const owner = frame.contentWindow;
  if (!owner) throw new Error("the iframe has no window");
  owner.document.body.innerHTML = "<main></main>";
  realms.push(frame);
  return owner;
}

function main(owner: Window): HTMLElement {
  const element = owner.document.querySelector("main");
  if (!element) throw new Error("no main");
  return element;
}

function find(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`no ${selector}`);
  return element;
}

function event(owner: Window, type: string): Event {
  return new (owner as Window & typeof globalThis).Event(type);
}

function mount(kernel: Kernel, root: Element, destroy: () => void = vi.fn()): Mount {
  let destroyed = false;
  const instance: Mount = {
    root,
    get destroyed() {
      return destroyed;
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      destroy();
      kernel.untrack(instance);
    },
  };
  return instance;
}

function caught(callback: () => unknown): unknown {
  try {
    callback();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

afterEach(() => {
  for (const current of realms.splice(0)) {
    const owner = current.contentDocument;
    const kernel = owner ? kernelFor(owner) : undefined;
    if (kernel && !kernel.disposed) kernel.dispose();
    current.remove();
  }
});

describe("the document claim", () => {
  it("refuses a second live kernel and releases the document claim on disposal", () => {
    const current = realm();
    const kernel = new Kernel(current.document);

    expect(kernelFor(current.document)).toBe(kernel);
    expect(() => new Kernel(current.document)).toThrow(
      "This Document is already claimed by a Tessera kernel.",
    );

    kernel.dispose();
    const replacement = new Kernel(current.document);
    expect(kernelFor(current.document)).toBe(replacement);
    replacement.dispose();
  });

  it("requires a document attached to a window", () => {
    const detached = document.implementation.createHTMLDocument("detached");
    expect(detached.defaultView).toBeNull();
    expect(() => new Kernel(detached)).toThrow("Tessera needs a Document attached to a Window.");
  });

  it("does not carry disposed state into a fresh document", () => {
    const first = realm();
    const firstKernel = new Kernel(first.document);
    firstKernel.own("subscription", "example.old", vi.fn());
    firstKernel.track(mount(firstKernel, main(first)));
    firstKernel.dispose();

    const second = realm();
    const secondKernel = new Kernel(second.document);
    expect(secondKernel.mountCount()).toBe(0);
    expect(secondKernel.resourceSummary()).toEqual([]);
    expect(secondKernel.disposed).toBe(false);
  });
});

describe("the resource ledger", () => {
  it("owns listeners, observers, subscriptions and services until disposal", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const listener = vi.fn();
    const observer = vi.fn();
    const subscription = vi.fn();
    const service = vi.fn();
    const target = main(current);

    kernel.listen("document:example", current.document, "example", listener);
    kernel.observe("document:mutation", target, observer, { childList: true });
    kernel.own("subscription", "test:subscription", subscription);
    kernel.own("service", "test:service", service);

    current.document.dispatchEvent(event(current, "example"));
    target.append(current.document.createElement("span"));
    await new Promise<void>((resolve) => {
      current.queueMicrotask(resolve);
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(observer).toHaveBeenCalledOnce();
    expect(kernel.resourceSummary()).toEqual([
      { kind: "listener", owner: "document:example" },
      { kind: "observer", owner: "document:mutation" },
      { kind: "subscription", owner: "test:subscription" },
      { kind: "service", owner: "test:service" },
    ]);

    kernel.dispose();
    current.document.dispatchEvent(event(current, "example"));
    target.append(current.document.createElement("span"));
    await new Promise<void>((resolve) => {
      current.queueMicrotask(resolve);
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(observer).toHaveBeenCalledOnce();
    expect(subscription).toHaveBeenCalledOnce();
    expect(service).toHaveBeenCalledOnce();
    expect(kernel.resourceSummary()).toEqual([]);
  });

  it("releases owned resources exactly once before or after disposal", () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const firstCleanup = vi.fn();
    const secondCleanup = vi.fn();
    const releaseFirst = kernel.own("service", "first", firstCleanup);
    const releaseSecond = kernel.own("service", "second", secondCleanup);

    releaseFirst();
    releaseFirst();
    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(kernel.resourceSummary()).toEqual([{ kind: "service", owner: "second" }]);

    kernel.dispose();
    releaseSecond();
    expect(secondCleanup).toHaveBeenCalledOnce();
  });

  it("removes the record before cleanup runs, so a re-entrant release does nothing", () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    let release: () => void = () => undefined;
    const cleanup = vi.fn(() => {
      expect(kernel.resourceSummary()).toEqual([]);
      release();
    });
    release = kernel.own("service", "reentrant", cleanup);

    release();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("removes a listener owned by a root when the root leaves the document", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const button = current.document.createElement("button");
    main(current).append(button);
    const listener = vi.fn();
    kernel.listen("button:click", button, "click", listener, undefined, button);

    button.click();
    button.remove();
    await kernel.whenEnhanced();
    button.click();

    expect(listener).toHaveBeenCalledOnce();
    expect(kernel.resourceSummary().map(({ owner }) => owner)).not.toContain("button:click");
  });

  it("owns and idempotently releases observers", () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const owned = kernel.observe("test:mutation", main(current), vi.fn(), { childList: true });

    expect(kernel.resourceSummary()).toContainEqual({ kind: "observer", owner: "test:mutation" });
    owned.release();
    owned.release();
    expect(kernel.resourceSummary()).not.toContainEqual({ kind: "observer", owner: "test:mutation" });
  });

  it("releases an owned observer if observation setup fails", () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const Observer = (current as Window & typeof globalThis).MutationObserver;
    const failure = new Error("observe failed");
    const observe = vi.spyOn(Observer.prototype, "observe").mockImplementation(() => {
      throw failure;
    });
    const disconnect = vi.spyOn(Observer.prototype, "disconnect");

    try {
      expect(() => kernel.observe("failed", main(current), vi.fn(), { childList: true })).toThrow(
        failure,
      );
      expect(disconnect).toHaveBeenCalledOnce();
      expect(kernel.resourceSummary()).not.toContainEqual({ kind: "observer", owner: "failed" });
    } finally {
      observe.mockRestore();
      disconnect.mockRestore();
    }
  });

  it("retains both a task failure and a failing error reporter", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const taskFailure = new Error("task failed");
    const reportingFailure = new Error("reporting failed");

    kernel.task("test:task", Promise.reject(taskFailure), () => {
      throw reportingFailure;
    });

    await expect(kernel.whenEnhanced()).rejects.toMatchObject({
      message: "Tessera enhancement failed.",
      errors: [taskFailure, reportingFailure],
    });
    expect(kernel.resourceSummary()).not.toContainEqual({ kind: "task", owner: "test:task" });
  });

  it("reports one task failure as itself and forgets it afterwards", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const failure = new Error("task failed");
    const onError = vi.fn();

    kernel.task("test:task", Promise.reject(failure), onError);

    await expect(kernel.whenEnhanced()).rejects.toBe(failure);
    expect(onError).toHaveBeenCalledWith(failure);
    await expect(kernel.whenEnhanced()).resolves.toBeUndefined();
  });

  it("ignores a released task's failure", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    let reject: (error: Error) => void = () => undefined;
    const onError = vi.fn();
    const release = kernel.task(
      "test:task",
      new Promise((_resolve, fail: (error: Error) => void) => {
        reject = fail;
      }),
      onError,
    );

    release();
    reject(new Error("too late"));
    await expect(kernel.whenEnhanced()).resolves.toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("mounts", () => {
  it("refuses to track one mount twice", () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const instance = kernel.track(mount(kernel, main(current)));
    expect(() => kernel.track(instance)).toThrow("This mount is already tracked by its kernel.");
    expect(kernel.mountCount()).toBe(1);
  });

  it("destroys outgoing roots deepest first before releasing their surviving owner", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const root = main(current);
    root.innerHTML = `<section id="outer"><section id="inner"></section></section>`;
    const outer = find(root, "#outer");
    const inner = find(root, "#inner");
    const order: string[] = [];

    kernel.track(
      mount(kernel, root, () => order.push("owner-destroy")),
      { releaseTree: () => order.push("owner-release") },
    );
    kernel.track(mount(kernel, outer, () => order.push("outer")));
    kernel.track(mount(kernel, inner, () => order.push("inner")));
    const transaction = kernel.beginRender(root);
    transaction.beforeRemove(outer);
    outer.remove();
    transaction.commit();
    await kernel.whenEnhanced();

    expect(order).toEqual(["inner", "outer", "owner-release"]);
    expect(kernel.mountCount()).toBe(1);
  });

  it("sorts nested roots deepest first regardless of registration order", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const root = main(current);
    root.innerHTML = `<section id="outer"><section id="inner"></section></section>`;
    const order: string[] = [];

    kernel.track(mount(kernel, find(root, "#inner"), () => order.push("inner")));
    kernel.track(mount(kernel, find(root, "#outer"), () => order.push("outer")));
    kernel.track(mount(kernel, root, () => order.push("owner")));
    const transaction = kernel.beginRender(root);
    transaction.beforeRemove(root);
    transaction.commit();
    await kernel.whenEnhanced();

    expect(order).toEqual(["inner", "outer", "owner"]);
  });

  it("tears down while the subtree is still connected", () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const root = main(current);
    root.innerHTML = `<section></section>`;
    const section = find(root, "section");
    const connected: boolean[] = [];
    kernel.track(mount(kernel, section, () => connected.push(section.isConnected)));
    kernel.own("effect", "scoped", () => connected.push(section.isConnected), section);

    const transaction = kernel.beginRender(root);
    transaction.beforeRemove(section);
    section.remove();
    transaction.commit();

    expect(connected).toEqual([true, true]);
  });

  it("compares nested element depth in both sort argument orders", () => {
    const current = realm();
    const root = main(current);
    root.innerHTML = `<section id="outer"><section id="inner"></section></section><aside></aside>`;
    const outer = find(root, "#outer");
    const inner = find(root, "#inner");

    expect(compareElementDepth(inner, outer)).toBe(-1);
    expect(compareElementDepth(outer, inner)).toBe(1);
    expect(compareElementDepth(outer, find(root, "aside"))).toBe(0);
  });

  it("boots incoming roots that have no mount, once each", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const root = main(current);
    root.innerHTML = `<i id="mounted"></i><i id="fresh"></i>`;
    const mounted = find(root, "#mounted");
    const fresh = find(root, "#fresh");
    kernel.track(mount(kernel, mounted));
    const boot = vi.fn();

    const transaction = kernel.beginRender(root, { boot });
    transaction.commit([mounted, fresh, fresh]);
    await kernel.whenEnhanced();

    expect(boot.mock.calls).toEqual([[fresh]]);
  });

  it("reports incoming roots that are detached or from another document", async () => {
    const current = realm();
    const other = realm();
    const kernel = new Kernel(current.document);
    const boot = vi.fn();
    const transaction = kernel.beginRender(main(current), { boot });

    expect(() => { transaction.commit([current.document.createElement("i"), main(other)]); },
    ).toThrow(
      expect.objectContaining({
        errors: [
          new Error("An incoming root must be connected before commit."),
          new Error("An incoming root must belong to this Tessera kernel's Document."),
        ],
      }),
    );
    expect(boot).not.toHaveBeenCalled();
    await kernel.whenEnhanced();
  });
});

describe("render transactions", () => {
  it("rejects render roots from another document", () => {
    const first = realm();
    const second = realm();
    const kernel = new Kernel(first.document);

    expect(() => kernel.beginRender(main(second))).toThrow(
      "A render root must belong to this Tessera kernel's Document.",
    );
  });

  it("rejects preserved roots outside the render root", () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const root = main(current);
    root.innerHTML = `<section></section>`;
    const outside = current.document.createElement("aside");
    current.document.body.append(outside);

    expect(() => kernel.beginRender(find(root, "section"), { preserveRoots: [outside] })).toThrow(
      "A preserved root must be contained by the render root.",
    );
  });

  it("numbers operations monotonically", () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const first = kernel.beginRender(main(current));
    const second = kernel.beginRender(main(current));
    expect([first.operationId, second.operationId]).toEqual([1, 2]);
    first.commit();
    second.commit();
  });

  it("settles failed render transactions and preserves their exact errors", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const firstFailure = new Error("render failed");
    const secondFailure = new Error("already finished");
    const transaction = kernel.beginRender(main(current));

    expect(transaction.operationId).toBe(1);
    expect(() => transaction.fail(firstFailure)).toThrow(firstFailure);
    expect(() => transaction.fail(secondFailure)).toThrow(secondFailure);
    await expect(kernel.whenEnhanced()).resolves.toBeUndefined();
  });

  it("keeps the enhancement barrier pending until an idempotent commit settles", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const transaction = kernel.beginRender(main(current));
    let enhanced = false;
    const barrier = kernel.whenEnhanced().then(() => {
      enhanced = true;
    });
    await new Promise<void>((resolve) => {
      current.setTimeout(resolve, 0);
    });

    expect(enhanced).toBe(false);
    const queued = vi.spyOn(globalThis, "queueMicrotask");
    try {
      transaction.commit();
      const firstCommitCalls = queued.mock.calls.length;
      expect(firstCommitCalls).toBe(1);
      transaction.commit();
      expect(queued).toHaveBeenCalledTimes(firstCommitCalls);
    } finally {
      queued.mockRestore();
    }
    await barrier;
    expect(enhanced).toBe(true);
  });

  it("waits for observer work queued in a later enhancement round", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const root = main(current);
    let rounds = 0;
    kernel.observe(
      "test:rounds",
      root,
      () => {
        rounds += 1;
        if (rounds === 1) {
          current.queueMicrotask(() => { root.append(current.document.createElement("i")); });
        }
      },
      { childList: true },
    );
    const transaction = kernel.beginRender(root);
    const enhanced = kernel.whenEnhanced();
    await new Promise<void>((resolve) => {
      current.setTimeout(resolve, 0);
    });

    root.append(current.document.createElement("b"));
    transaction.commit();
    await enhanced;

    expect(rounds).toBe(2);
  });

  it("aggregates teardown failures with the render operation identity", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const root = main(current);
    root.innerHTML = `<section id="target"></section><aside id="unrelated"></aside>`;
    const target = find(root, "#target");
    const cleanupFailure = new Error("cleanup failed");
    const patchFailure = new Error("patch failed");
    kernel.track(mount(kernel, find(root, "#unrelated")));
    kernel.track(
      mount(kernel, target, () => {
        throw cleanupFailure;
      }),
    );
    const transaction = kernel.beginRender(root);

    transaction.beforeRemove(current.document.createTextNode("not an element"));
    transaction.beforeRemove(target);
    const failure = caught(() => transaction.fail(patchFailure));

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).message).toBe("Tessera render operation 1 failed.");
    expect((failure as AggregateError).errors).toEqual([cleanupFailure, patchFailure]);
    expect(kernel.mountCount()).toBe(1);
    await kernel.whenEnhanced();
  });

  it("identifies cleanup failures raised while committing a render", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const root = main(current);
    root.innerHTML = `<i id="first"></i><i id="second"></i>`;
    const firstFailure = new Error("first failed");
    const secondFailure = new Error("second failed");
    kernel.track(
      mount(kernel, find(root, "#first"), () => {
        throw firstFailure;
      }),
    );
    kernel.track(
      mount(kernel, find(root, "#second"), () => {
        throw secondFailure;
      }),
    );
    const transaction = kernel.beginRender(root);
    transaction.beforeRemove(root);

    expect(() => {
      transaction.commit();
    }).toThrow(
      expect.objectContaining({
        message: "Tessera render operation 1 failed.",
        errors: [firstFailure, secondFailure],
      }),
    );
    await kernel.whenEnhanced();
  });

  it("restores focus inside a preserved root without scrolling", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const root = main(current);
    root.innerHTML = `<section id="kept"><input id="field"></section><p>old</p>`;
    const kept = find(root, "#kept");
    const field = find(root, "#field");
    field.focus();
    const focus = vi.spyOn(field, "focus");

    const transaction = kernel.beginRender(root, { preserveRoots: [kept] });
    root.replaceChildren(current.document.createElement("p"), kept);
    transaction.commit();
    await kernel.whenEnhanced();

    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(current.document.activeElement).toBe(field);
  });

  it("leaves focus alone when it was outside every preserved root", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const root = main(current);
    root.innerHTML = `<section id="kept"><input id="inside"></section><input id="outside">`;
    const inside = find(root, "#inside");
    find(root, "#outside").focus();
    const focus = vi.spyOn(inside, "focus");

    const transaction = kernel.beginRender(root, { preserveRoots: [find(root, "#kept")] });
    transaction.commit();
    await kernel.whenEnhanced();

    expect(focus).not.toHaveBeenCalled();
  });

  it("does not restore focus for a render a newer one overtook", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const root = main(current);
    root.innerHTML = `<section id="kept"><input id="field"></section>`;
    const field = find(root, "#field");
    field.focus();
    const focus = vi.spyOn(field, "focus");

    const older = kernel.beginRender(root, { preserveRoots: [find(root, "#kept")] });
    const newer = kernel.beginRender(root);
    older.commit();
    newer.commit();
    await kernel.whenEnhanced();

    expect(focus).not.toHaveBeenCalled();
  });
});

describe("the flush hook", () => {
  it("is awaited by the render barrier and by whenEnhanced", async () => {
    const current = realm();
    let flushes = 0;
    const kernel = new Kernel(current.document, {
      flush: async () => {
        flushes += 1;
        await Promise.resolve();
      },
    });
    const transaction = kernel.beginRender(main(current));
    transaction.commit();
    await kernel.whenEnhanced();
    // Two in the render's settling, and at least two rounds of whenEnhanced.
    expect(flushes).toBeGreaterThanOrEqual(4);
  });

  it("reports a flush failure captured while a render barrier settles, once", async () => {
    const current = realm();
    const failure = new Error("reactive update failed");
    let fail = false;
    const kernel = new Kernel(current.document, {
      flush: () => {
        if (!fail) return Promise.resolve();
        fail = false;
        return Promise.reject(failure);
      },
    });
    const transaction = kernel.beginRender(main(current));

    fail = true;
    transaction.commit();
    await new Promise<void>((resolve) => {
      current.setTimeout(resolve, 0);
    });
    await expect(kernel.whenEnhanced()).rejects.toThrow(failure);
    await expect(kernel.whenEnhanced()).resolves.toBeUndefined();
  });

  it("reports a flush failure pending at the enhancement barrier", async () => {
    const current = realm();
    const failure = new Error("pending update failed");
    let fail = true;
    const kernel = new Kernel(current.document, {
      flush: () => {
        if (!fail) return Promise.resolve();
        fail = false;
        return Promise.reject(failure);
      },
    });

    await expect(kernel.whenEnhanced()).rejects.toThrow(failure);
    await expect(kernel.whenEnhanced()).resolves.toBeUndefined();
  });

  it("aggregates several enhancement errors with the barrier message", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const first = new Error("first enhancement failed");
    const second = new Error("second enhancement failed");
    kernel.task("first", Promise.reject(first), vi.fn());
    kernel.task("second", Promise.reject(second), vi.fn());

    await expect(kernel.whenEnhanced()).rejects.toMatchObject({
      message: "Tessera enhancement failed.",
      errors: [first, second],
    });
  });
});

describe("disposal", () => {
  it("attempts every cleanup and reports the failures", () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const mountFailure = new Error("mount cleanup failed");
    const first = new Error("first cleanup failed");
    const second = new Error("second cleanup failed");
    const completed = vi.fn();
    kernel.track(
      mount(kernel, main(current), () => {
        throw mountFailure;
      }),
    );
    kernel.own("service", "completed", completed);
    kernel.own("service", "first", () => {
      throw first;
    });
    kernel.own("service", "second", () => {
      throw second;
    });

    const failure = caught(() => kernel.dispose());

    expect(failure).toBeInstanceOf(DisposalError);
    const disposalFailure = failure as DisposalError;
    expect(disposalFailure.message).toBe("Tessera kernel disposal failed.");
    expect(disposalFailure.errors).toEqual([mountFailure, second, first]);
    expect(disposalFailure.report.failed.map(({ category, owner }) => ({ category, owner }))).toEqual([
      { category: "mount", owner: "mount:1" },
      { category: "service", owner: "second" },
      { category: "service", owner: "first" },
    ]);
    expect(disposalFailure.report.released).toEqual([{ category: "service", owner: "completed" }]);
    expect(disposalFailure.report.remaining).toEqual([]);
    expect(Object.isFrozen(disposalFailure.report)).toBe(true);
    expect(Object.isFrozen(disposalFailure.report.failed)).toBe(true);
    expect(() => JSON.stringify(disposalFailure.report)).not.toThrow();
    expect(completed).toHaveBeenCalledOnce();
    expect(kernel.mountCount()).toBe(0);
    expect(kernel.resourceSummary()).toEqual([]);

    const repeated = caught(() => kernel.dispose());
    expect(repeated).toBe(disposalFailure);
    expect((repeated as DisposalError).report).toBe(disposalFailure.report);
  });

  it.each([
    ["null-prototype value", () => Object.create(null) as unknown],
    [
      "revoked proxy",
      () => {
        const { proxy, revoke } = Proxy.revocable({}, {});
        revoke();
        return proxy;
      },
    ],
    [
      "throwing conversion",
      () => ({
        [Symbol.toPrimitive]() {
          throw new Error("conversion failed");
        },
      }),
    ],
  ])("completes disposal after a %s is thrown", (_label, createThrown) => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const thrown = createThrown();
    const completed = vi.fn();
    kernel.own("service", "completed", completed);
    kernel.own("service", "invalid-value", () => {
      throw thrown;
    });

    const failure = caught(() => kernel.dispose());

    expect.soft(completed).toHaveBeenCalledOnce();
    expect.soft(kernel.resourceSummary()).toEqual([]);
    expect(failure).toBeInstanceOf(DisposalError);
    const aggregate = failure as DisposalError;
    expect(aggregate.errors).toHaveLength(1);
    expect(aggregate.errors[0] === thrown).toBe(true);
    expect(aggregate.report.failed).toEqual([
      {
        category: "service",
        owner: "invalid-value",
        error: { name: "ThrownValue", message: "Cleanup failed." },
      },
    ]);
    expect(() => JSON.stringify(aggregate.report)).not.toThrow();
    expect(Object.isFrozen(aggregate.report.failed[0]?.error)).toBe(true);
    expect(caught(() => kernel.dispose()) === aggregate).toBe(true);
    new Kernel(current.document).dispose();
  });

  it("reads changing error fields once and keeps ordinary thrown values", () => {
    const controller = createDisposalReport();
    const resource = { category: "service" as const, owner: "changing" };
    const changing = new Error();
    const name = vi.fn().mockReturnValueOnce("NamedFailure").mockReturnValue(Object.create(null));
    const message = vi.fn().mockReturnValueOnce("message").mockReturnValue(Object.create(null));
    Object.defineProperties(changing, { name: { get: name }, message: { get: message } });
    for (const thrown of [changing, new Error(""), "", 12n, null, Symbol("failure")]) {
      controller.fail(resource, thrown);
    }
    expect(controller.report.failed.map(({ error }) => error)).toEqual([
      { name: "NamedFailure", message: "message" },
      { name: "Error", message: "Cleanup failed." },
      { name: "ThrownValue", message: "" },
      { name: "ThrownValue", message: "12" },
      { name: "ThrownValue", message: "null" },
      { name: "ThrownValue", message: "Symbol(failure)" },
    ]);
    expect(name).toHaveBeenCalledOnce();
    expect(message).toHaveBeenCalledOnce();
    expect(() => JSON.stringify(controller.report)).not.toThrow();
  });

  it("bounds hostile failures and snapshots remaining resources", () => {
    const controller = createDisposalReport();
    const resource = { category: "service" as const, owner: "hostile" };
    const hostile = new Error();
    Object.defineProperties(hostile, {
      message: {
        configurable: true,
        get: () => {
          throw new Error("message accessor escaped");
        },
      },
      name: {
        configurable: true,
        get: () => {
          throw new Error("name accessor escaped");
        },
      },
    });

    controller.attempt(resource);
    controller.fail(resource, hostile);
    controller.fail(resource, "x".repeat(1_100));
    controller.remain(resource);

    expect(controller.report.failed).toEqual([
      { ...resource, error: { message: "Cleanup failed.", name: "Error" } },
      { ...resource, error: { message: "x".repeat(1_024), name: "ThrownValue" } },
    ]);
    expect(controller.report.remaining).toEqual([resource]);
    expect(Object.isFrozen(controller.report.failed[0]?.error)).toBe(true);
    expect(Object.isFrozen(controller.report.remaining[0])).toBe(true);
    expect(() => JSON.stringify(controller.report)).not.toThrow();
  });

  it("keeps a single cleanup error after completing disposal", () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const failure = new Error("cleanup failed");
    kernel.own("service", "failure", () => {
      throw failure;
    });

    const disposalFailure = caught(() => kernel.dispose());
    expect(disposalFailure).toBeInstanceOf(DisposalError);
    expect((disposalFailure as DisposalError).errors).toEqual([failure]);
    expect(kernel.disposed).toBe(true);
    expect(kernel.disposalSettled).toBe(true);
  });

  it("returns one report when cleanup recursively requests disposal", () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    let recursiveReport: unknown;
    const cleanup = vi.fn(() => {
      expect(kernel.disposalSettled).toBe(false);
      recursiveReport = kernel.dispose();
    });
    kernel.own("service", "recursive", cleanup);

    const report = kernel.dispose();

    expect(cleanup).toHaveBeenCalledOnce();
    expect(recursiveReport).toBe(report);
    expect(kernel.dispose()).toBe(report);
    expect(report.schema).toBe("tessera-disposal/1");
    expect(report.failed).toEqual([]);
    expect(report.remaining).toEqual([]);
  });

  it("abandons an open render, so its barrier resolves", async () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    kernel.beginRender(main(current));
    const report = kernel.dispose();

    expect(report.released).toEqual([{ category: "task", owner: "render:1" }]);
    await expect(kernel.whenEnhanced()).resolves.toBeUndefined();
  });

  it("disposes mounts and resources once, then refuses structural work", () => {
    const current = realm();
    const kernel = new Kernel(current.document);
    const destroyed = vi.fn();
    const cleaned = vi.fn();
    const instance = mount(kernel, main(current), destroyed);
    kernel.track(instance);
    kernel.own("service", "example.service", cleaned);

    kernel.dispose();
    kernel.dispose();

    expect(kernel.disposed).toBe(true);
    expect(destroyed).toHaveBeenCalledOnce();
    expect(cleaned).toHaveBeenCalledOnce();
    expect(kernel.mountCount()).toBe(0);
    expect(kernelFor(current.document)).toBeUndefined();
    expect(() => kernel.track(instance)).toThrow("cannot track mounts");
    expect(() => kernel.own("service", "late", vi.fn())).toThrow("cannot own resources");
    expect(() => kernel.beginRender(main(current))).toThrow(
      "This Tessera kernel has been disposed and cannot render.",
    );
    expect(() => kernel.listen("late", current.document, "late", vi.fn<() => void>())).toThrow(
      "cannot own resources",
    );
    expect(() => kernel.observe("late", current.document.body, vi.fn(), { childList: true })).toThrow(
      "This Tessera kernel has been disposed and cannot install observers.",
    );
    expect(() => kernel.task("late", Promise.resolve(), vi.fn())).toThrow("cannot register tasks");
    expect(kernel.canOwn(main(current))).toBe(false);
  });
});
