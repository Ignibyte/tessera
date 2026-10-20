// Resources scoped to a root: released by a render's removal or by the root leaving the
// document, kept for preserved roots, refused inside a removal boundary. Ported from jqstar
// `test/scoped-resource-lifecycle.test.ts`.
import { afterEach, expect, it, vi } from "vitest";
import { Kernel } from "../../src/kernel.ts";

const fixtures: { frame: HTMLIFrameElement; kernel: Kernel }[] = [];

function fixture() {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const owner = frame.contentDocument;
  if (!owner) throw new Error("Missing fixture document.");
  owner.body.innerHTML = "<main><section><button>Keep</button></section></main>";
  const kernel = new Kernel(owner);
  fixtures.push({ frame, kernel });
  const main = owner.querySelector("main");
  const root = owner.querySelector("section");
  const child = owner.querySelector("button");
  if (!main || !root || !child) throw new Error("Missing fixture nodes.");
  return { kernel, main, root, child };
}

afterEach(() => {
  for (const { frame, kernel } of fixtures.splice(0)) {
    if (!kernel.disposed) kernel.dispose();
    frame.remove();
  }
});

it("releases scoped work before removal once, preserving unscoped services", async () => {
  const { kernel, main, root } = fixture();
  const calls: boolean[] = [];
  const unscoped = vi.fn();
  const release = kernel.own("task", "scoped", () => calls.push(root.isConnected), root);
  kernel.own("service", "global", unscoped);
  expect(kernel.resourceSummary().find(({ owner }) => owner === "scoped")).toEqual({
    kind: "task",
    owner: "scoped",
  });
  const render = kernel.beginRender(main);
  render.beforeRemove(root);
  render.beforeRemove(root);
  expect(calls).toEqual([true]);
  expect(unscoped).not.toHaveBeenCalled();
  expect(kernel.canOwn(root)).toBe(false);
  expect(() => kernel.own("task", "too late", vi.fn(), root)).toThrow();
  root.remove();
  render.commit();
  await kernel.whenEnhanced();
  release();
  expect(calls).toEqual([true]);
  kernel.dispose();
  expect(unscoped).toHaveBeenCalledOnce();
});

/** A child preserved while its parent is removed, up to the point where the host acts. */
function preservedChild() {
  const parts = fixture();
  const { kernel, main, root, child } = parts;
  const parentCleanup = vi.fn();
  const childCleanup = vi.fn();
  kernel.own("listener", "parent", parentCleanup, root);
  kernel.own("observer", "child", childCleanup, child);
  const render = kernel.beginRender(main, { preserveRoots: [child] });
  render.beforeRemove(root);
  expect(parentCleanup).toHaveBeenCalledOnce();
  expect(childCleanup).not.toHaveBeenCalled();
  expect(kernel.canOwn(child)).toBe(true);
  return { ...parts, render, childCleanup };
}

it("keeps a promised preserved root the host kept", async () => {
  const { kernel, main, root, child, render, childCleanup } = preservedChild();
  main.append(child);
  root.remove();
  render.commit();
  await kernel.whenEnhanced();
  expect(childCleanup).not.toHaveBeenCalled();
  expect(kernel.canOwn(root)).toBe(true);
});

it("releases and reports a promised preserved root the host lost", async () => {
  const { kernel, root, render, childCleanup } = preservedChild();
  root.remove();
  expect(() => {
    render.commit();
  }).toThrow("preserved");
  await kernel.whenEnhanced();
  expect(childCleanup).toHaveBeenCalledOnce();
  expect(kernel.canOwn(root)).toBe(true);
});

it("releases a promised preserved root when the host fails", async () => {
  const { kernel, root, render, childCleanup } = preservedChild();
  root.remove();
  expect(() => render.fail(new Error("host failed"))).toThrow();
  await kernel.whenEnhanced();
  expect(childCleanup).toHaveBeenCalledOnce();
  expect(kernel.canOwn(root)).toBe(true);
});

it("releases native removals but preserves same-document moves and detached acquisition", async () => {
  const { kernel, main, root, child } = fixture();
  const moved = vi.fn();
  const detached = kernel.document.createElement("aside");
  const detachedCleanup = vi.fn();
  kernel.own("listener", "move", moved, child);
  kernel.own("task", "detached", detachedCleanup, detached);
  main.append(child);
  root.remove();
  await kernel.whenEnhanced();
  expect(moved).not.toHaveBeenCalled();
  expect(detachedCleanup).not.toHaveBeenCalled();
  child.remove();
  await kernel.whenEnhanced();
  expect(moved).toHaveBeenCalledOnce();
  kernel.dispose();
  expect(detachedCleanup).toHaveBeenCalledOnce();
});

it("retains a temporarily detached preserved root until its render finishes", async () => {
  const { kernel, main, root } = fixture();
  const cleanup = vi.fn();
  kernel.own("observer", "preserved", cleanup, root);
  const render = kernel.beginRender(main, { preserveRoots: [root] });
  render.beforeRemove(root);
  root.remove();
  await Promise.resolve();
  await Promise.resolve();
  expect(cleanup).not.toHaveBeenCalled();
  main.append(root);
  render.commit();
  await kernel.whenEnhanced();
  expect(cleanup).not.toHaveBeenCalled();
});

it("does not retire a new detached acquisition for an earlier removal", async () => {
  const { kernel, root } = fixture();
  const old = vi.fn();
  const fresh = vi.fn();
  kernel.own("listener", "old", old, root);
  root.remove();
  kernel.own("listener", "fresh", fresh, root);
  await kernel.whenEnhanced();
  expect(old).toHaveBeenCalledOnce();
  expect(fresh).not.toHaveBeenCalled();
  kernel.dispose();
  expect(fresh).toHaveBeenCalledOnce();
});

it("rechecks ownership when draining earlier removals disposes the kernel", () => {
  const { kernel, root } = fixture();
  kernel.own("listener", "old", () => kernel.dispose(), root);
  root.remove();
  expect(() => kernel.own("listener", "fresh", vi.fn(), root)).toThrow();
  expect(kernel.resourceSummary()).toEqual([]);
});

it("does not register a scope after observer setup disposes the kernel", () => {
  const { kernel, root } = fixture();
  const Observer = (kernel.window as Window & typeof globalThis).MutationObserver;
  const observe = vi
    .spyOn(Observer.prototype, "observe")
    .mockImplementation(() => kernel.dispose());
  try {
    expect(() => kernel.own("listener", "interrupted", vi.fn(), root)).toThrow();
    expect(kernel.resourceSummary()).toEqual([]);
  } finally {
    observe.mockRestore();
  }
});

it("forgets an earlier removal while unrelated preservation is pending", async () => {
  const { kernel, main, root, child } = fixture();
  main.append(child);
  const old = vi.fn();
  const fresh = vi.fn();
  kernel.own("listener", "old", old, root);
  const render = kernel.beginRender(main, { preserveRoots: [child] });
  root.remove();
  kernel.own("listener", "fresh", fresh, root);
  kernel.own("listener", "another", vi.fn(), main);
  render.commit();
  await kernel.whenEnhanced();
  expect(old).toHaveBeenCalledOnce();
  expect(fresh).not.toHaveBeenCalled();
});

it("keeps overlapping removal barriers independent", async () => {
  const { kernel, main, root, child } = fixture();
  const outer = kernel.beginRender(main);
  const inner = kernel.beginRender(root);
  outer.beforeRemove(root);
  inner.beforeRemove(child);
  inner.commit();
  expect(kernel.canOwn(child)).toBe(false);
  outer.commit();
  expect(kernel.canOwn(child)).toBe(true);
  await kernel.whenEnhanced();
});

it("contains cleanup failure and reentry without skipping later resources or leaking barriers", async () => {
  const { kernel, main, root } = fixture();
  const calls: string[] = [];
  kernel.own("listener", "first", () => calls.push("first"), root);
  kernel.own(
    "observer",
    "throwing",
    () => {
      calls.push("throwing");
      expect(() => kernel.own("task", "reentry", vi.fn(), root)).toThrow();
      throw new Error("cleanup failure");
    },
    root,
  );
  const render = kernel.beginRender(main);
  render.beforeRemove(root);
  expect(calls).toEqual(["throwing", "first"]);
  expect(() => { render.commit(); }).toThrow("cleanup failure");
  await kernel.whenEnhanced();
  expect(kernel.canOwn(root)).toBe(true);
  expect(kernel.resourceSummary().some(({ owner }) => owner === "reentry")).toBe(false);
});

it("rejects foreign scope and releases adopted roots only in their old owner", async () => {
  const first = fixture();
  const second = fixture();
  const cleanup = vi.fn();
  expect(first.kernel.canOwn(second.root)).toBe(false);
  expect(() => first.kernel.own("task", "foreign", cleanup, second.root)).toThrow();
  first.kernel.own("task", "adopted", cleanup, first.root);
  second.main.append(second.kernel.document.adoptNode(first.root));
  await first.kernel.whenEnhanced();
  expect(cleanup).toHaveBeenCalledOnce();
  expect(second.kernel.canOwn(first.root)).toBe(true);
});

it("abandons open barriers on disposal and rejects cleanup-time acquisition", () => {
  const { kernel, main, root } = fixture();
  let active: boolean | undefined;
  kernel.own(
    "task",
    "root",
    () => {
      active = kernel.canOwn(root);
      expect(() => kernel.own("task", "new", vi.fn(), root)).toThrow();
    },
    root,
  );
  kernel.beginRender(main);
  kernel.dispose();
  expect(active).toBe(false);
  expect(kernel.resourceSummary()).toEqual([]);
});

it("allows preserved-child acquisition from parent cleanup", async () => {
  const { kernel, main, root, child } = fixture();
  const cleanup = vi.fn();
  kernel.own(
    "listener",
    "parent",
    () => {
      kernel.own("listener", "kept child", cleanup, child);
    },
    root,
  );
  const render = kernel.beginRender(main, { preserveRoots: [child] });
  render.beforeRemove(root);
  main.append(child);
  root.remove();
  render.commit();
  await kernel.whenEnhanced();
  expect(cleanup).not.toHaveBeenCalled();
  kernel.dispose();
  expect(cleanup).toHaveBeenCalledOnce();
});

it("reports native cleanup errors after releasing siblings and refuses native cleanup reentry", async () => {
  const { kernel, root, child } = fixture();
  const sibling = vi.fn();
  kernel.own("task", "sibling", sibling, child);
  kernel.own(
    "listener",
    "throwing",
    () => {
      expect(kernel.canOwn(child)).toBe(false);
      expect(() => kernel.own("task", "reentry", vi.fn(), root)).toThrow();
      throw new Error("native cleanup failure");
    },
    root,
  );
  root.remove();
  await expect(kernel.whenEnhanced()).rejects.toThrow("native cleanup failure");
  expect(sibling).toHaveBeenCalledOnce();
  await expect(kernel.whenEnhanced()).resolves.toBeUndefined();
  expect(kernel.canOwn(root)).toBe(true);
});

it("releases a preserved root removed after commit while the enhancement barrier settles", async () => {
  const { kernel, main, root } = fixture();
  const cleanup = vi.fn();
  kernel.own("task", "kept", cleanup, root);
  const render = kernel.beginRender(main, { preserveRoots: [root] });
  render.commit();
  root.remove();
  await kernel.whenEnhanced();
  expect(cleanup).toHaveBeenCalledOnce();
});

it("blocks missing promised roots throughout incoming boot", async () => {
  const { kernel, main, root } = fixture();
  const incoming = kernel.document.createElement("aside");
  main.append(incoming);
  const boot = vi.fn(() => {
    expect(kernel.canOwn(root)).toBe(false);
    expect(() => kernel.own("task", "revival", vi.fn(), root)).toThrow();
  });
  const render = kernel.beginRender(main, { preserveRoots: [root], boot });
  root.remove();
  expect(() => { render.commit([incoming]); }).toThrow("preserved");
  expect(boot).toHaveBeenCalledOnce();
  await kernel.whenEnhanced();
  expect(kernel.canOwn(root)).toBe(true);
});
