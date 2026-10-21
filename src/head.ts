// The head policy of docs/protocol.md section 9, from jqstar 0025 (declined there, never built):
// tracked assets compared, new head elements added (stylesheets loaded before the body changes,
// scripts never), the title, `lang`, `dir` and the protocol's metas taken, and the head elements
// the incoming document lacks removed after the body commit.

const MANAGED_METAS = ["tessera-layout", "tessera-csrf-token"];

/**
 * The tracked assets among some head elements (protocol 9): each `<script src>` and
 * `<link href>` with `data-track`, by tag, resolved URL and `data-track` value.
 */
export function trackedSet(elements: Iterable<Element>, base: string): string {
  const entries: string[] = [];
  for (const element of elements) {
    if (!element.hasAttribute("data-track")) continue;
    const source = element.getAttribute(element.localName === "link" ? "href" : "src") ?? "";
    entries.push(`${element.localName} ${new URL(source, base).href} ${element.getAttribute("data-track") ?? ""}`);
  }
  return entries.sort().join("\n");
}

/** The title, the base and the protocol's metas, which are taken by value, not by markup. */
function managed(element: Element): boolean {
  if (element.localName === "title" || element.localName === "base") return true;
  return element.localName === "meta" && MANAGED_METAS.includes(element.getAttribute("name") ?? "");
}

function baseOf(document: Document): string | undefined {
  return document.head.querySelector("base[href]")?.getAttribute("href") ?? undefined;
}

/** Why an incoming document cannot be committed in place, if it cannot. */
export function headConflict(current: Document, incoming: Document, incomingUrl: string): string | undefined {
  if (trackedSet(incoming.head.children, incomingUrl) !== trackedSet(current.head.children, current.baseURI)) {
    return "its tracked assets differ";
  }
  if (baseOf(incoming) !== baseOf(current)) return "its <base> differs";
  return undefined;
}

function loaded(link: HTMLLinkElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      link.removeEventListener("load", done);
      link.removeEventListener("error", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    link.addEventListener("load", done);
    link.addEventListener("error", done);
  });
}

/**
 * Adds the incoming head elements the current head lacks, compared by markup, and resolves once
 * new stylesheets have loaded, failed or timed out. Scripts are never added. Returns the step
 * that removes the current head elements the incoming head lacks, for after the body commit.
 */
export async function addHead(current: Document, incoming: Document, stylesheetTimeoutMs: number): Promise<() => void> {
  const currentElements = Array.from(current.head.children).filter((element) => !managed(element));
  const incomingElements = Array.from(incoming.head.children).filter((element) => !managed(element));
  const currentMarkup = new Set(currentElements.map((element) => element.outerHTML));
  const incomingMarkup = new Set(incomingElements.map((element) => element.outerHTML));

  const waits: Promise<void>[] = [];
  for (const element of incomingElements) {
    if (element.localName === "script" || currentMarkup.has(element.outerHTML)) continue;
    const added = current.importNode(element, true);
    current.head.append(added);
    if (added.localName === "link" && (added.getAttribute("rel") ?? "").toLowerCase().split(/\s+/).includes("stylesheet")) {
      waits.push(loaded(added as HTMLLinkElement, stylesheetTimeoutMs));
    }
  }
  await Promise.all(waits);
  const obsolete = currentElements.filter((element) => !incomingMarkup.has(element.outerHTML));
  return () => {
    for (const element of obsolete) element.remove();
  };
}

/** Takes the incoming `<title>`, `lang`, `dir`, and `tessera-layout` and `tessera-csrf-token` metas. */
export function takeMetadata(current: Document, incoming: Document): void {
  current.title = incoming.title;
  for (const name of ["lang", "dir"]) {
    const value = incoming.documentElement.getAttribute(name);
    if (value === null) current.documentElement.removeAttribute(name);
    else current.documentElement.setAttribute(name, value);
  }
  for (const name of MANAGED_METAS) {
    const ours = current.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    const theirs = incoming.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
    if (theirs && ours) ours.content = theirs.content;
    else if (theirs) current.head.append(current.importNode(theirs, true));
    else ours?.remove();
  }
}
