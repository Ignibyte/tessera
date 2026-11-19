// A stand-in for a client library (a chart, a map, an editor) for test/browser/mount.spec.ts
// (#45): `mount` writes the library's own DOM into the element, and every call is logged on
// `window.mountLog`, the import itself included, so a test can count imports.
const log = (window.mountLog ??= []);
log.push("loaded");

export function mount(element, data) {
  log.push(`mount ${element.id} ${JSON.stringify(data)}`);
  const canvas = document.createElement("canvas");
  canvas.className = "library";
  canvas.dataset.label = data?.label ?? "";
  element.append(canvas);
  return () => {
    log.push(`cleanup ${element.id}`);
  };
}

export function unmount(element) {
  log.push(`unmount ${element.id} ${element.isConnected ? "connected" : "gone"}`);
  element.replaceChildren();
}
