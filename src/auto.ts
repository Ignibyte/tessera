// The IIFE builds start themselves: once the document is parsed, unless the page asks to start
// Tessera itself with `<meta name="tessera-start" content="manual">`.
export function autoStart(start: () => unknown): void {
  const run = (): void => {
    if (document.querySelector('meta[name="tessera-start"]')?.getAttribute("content") === "manual") return;
    start();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
}
