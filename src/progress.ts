// A delayed progress bar, as Livewire's: a thin bar across the top of the page, shown only when a
// visit takes longer than a threshold, so quick visits show nothing. Its colour comes from the
// `--tessera-progress-color` custom property.

export interface ProgressBar {
  /** Marks a visit as started; the returned function marks it done. */
  start(): () => void;
}

export function createProgressBar(document: Document, options: { delayMs?: number } = {}): ProgressBar {
  const delayMs = options.delayMs ?? 200;
  let pending = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let bar: HTMLElement | undefined;

  const show = (): void => {
    bar = document.createElement("div");
    bar.setAttribute("data-tessera-progress", "");
    bar.setAttribute("aria-hidden", "true");
    bar.style.cssText =
      "position:fixed;top:0;left:0;height:3px;width:0;z-index:2147483647;pointer-events:none;" +
      "background:var(--tessera-progress-color,#29d);transition:width 10s cubic-bezier(.1,.7,.2,1)";
    document.documentElement.append(bar);
    void bar.offsetWidth;
    bar.style.width = "90%";
  };

  const hide = (): void => {
    clearTimeout(timer);
    timer = undefined;
    bar?.remove();
    bar = undefined;
  };

  return {
    start() {
      pending++;
      if (pending === 1) timer = setTimeout(show, delayMs);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        pending--;
        if (pending === 0) hide();
      };
    },
  };
}
