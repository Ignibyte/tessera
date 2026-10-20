// Fixture rendering for the reference server: pages and layouts from files, the scanner that
// finds regions and components in the rendered HTML (docs/protocol.md, section 2), and the
// pieces of a fragment response (section 5.3).
//
// The scanner reads the server's own fixtures, which are well-formed: every region element has
// its end tag and no attribute value holds `>`. It is not a general HTML parser.
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = import.meta.dirname;

export const REGION_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
export const COMPONENT_KEY = /^[A-Za-z0-9_.:]+(-[A-Za-z0-9_.:]+)*$/;
const PROPS_TOKEN = /^[A-Za-z0-9\-_.~+/=]+$/;

// --- Templates -----------------------------------------------------------------------------

/** Values a template reads: `{{name}}` is escaped, `{{{name}}}` is inserted as markup. */
export type Vars = Readonly<Record<string, string>>;

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fill(template: string, vars: Vars, source: string): string {
  return template.replace(
    /\{\{\{([a-z-]+)\}\}\}|\{\{([a-z-]+)\}\}/g,
    (_match, raw: string | undefined, escaped: string | undefined) => {
      const name = raw ?? escaped ?? "";
      const value = vars[name];
      if (value === undefined) throw new Error(`${source}: no value for {{${name}}}`);
      return raw === undefined ? escapeHtml(value) : value;
    },
  );
}

interface PageFile {
  title: string;
  layout: string;
  slots: Record<string, string>;
}

/**
 * Reads `pages/NAME.html`: a `<!--page {"title":…,"layout":…}-->` line, then one or more
 * `<!--slot NAME-->` lines, each followed by that slot's markup.
 */
function readPage(name: string): PageFile {
  const source = `pages/${name}.html`;
  const text = readFileSync(resolve(root, source), "utf8");
  const head = /^<!--page (\{.*\})-->\n/.exec(text);
  if (!head?.[1]) throw new Error(`${source}: the first line must be <!--page {…}-->`);
  const meta = JSON.parse(head[1]) as { title?: unknown; layout?: unknown };
  if (typeof meta.title !== "string" || typeof meta.layout !== "string") {
    throw new Error(`${source}: the page line needs a string title and layout`);
  }
  const parts = text.slice(head[0].length).split(/^<!--slot ([a-z-]+)-->\n/m);
  if (parts.shift()?.trim()) throw new Error(`${source}: markup before the first slot`);
  const slots: Record<string, string> = {};
  for (let index = 0; index < parts.length; index += 2) {
    slots[parts[index] ?? ""] = (parts[index + 1] ?? "").trimEnd();
  }
  return { title: meta.title, layout: meta.layout, slots };
}

/** A rendered page: the document, the layout it used, and its scanned identities. */
export interface Rendered {
  readonly html: string;
  readonly layout: string;
  readonly identities: Identities;
}

/** Renders `pages/NAME.html` into its layout, signing the props in its component markers. */
export function renderPage(name: string, vars: Vars, key: string): Rendered {
  const page = readPage(name);
  const all: Record<string, string> = { ...vars, title: vars.title ?? page.title };
  for (const [slot, markup] of Object.entries(page.slots)) {
    all[slot] = fill(markup, all, `pages/${name}.html`);
  }
  const layoutSource = `layouts/${page.layout}.html`;
  const layout = readFileSync(resolve(root, layoutSource), "utf8");
  const html = signMarkers(fill(layout, all, layoutSource), key);
  return { html, layout: page.layout, identities: scan(html) };
}

// --- Props tokens --------------------------------------------------------------------------

/**
 * In fixture files a component marker may carry JSON props, `<!--t:c line-7 {"id":7}-->`; the
 * server replaces the JSON with a signed token before it sends the page.
 */
function signMarkers(html: string, key: string): string {
  return html.replace(
    /<!--t:c ([^ >]+) (\{.*?\})-->/g,
    (_match, componentKey: string, json: string) => `<!--t:c ${componentKey} ${sign(json, key)}-->`,
  );
}

function mac(payload: string, key: string): Buffer {
  return createHmac("sha256", key).update(payload).digest();
}

/** A props token: the JSON in base64url, a dot, and its HMAC-SHA256 in base64url. */
export function sign(json: string, key: string): string {
  const payload = Buffer.from(json).toString("base64url");
  return `${payload}.${mac(payload, key).toString("base64url")}`;
}

/** The props JSON a token carries, or undefined when its signature does not verify. */
export function verify(token: string, key: string): string | undefined {
  const [payload, signature, extra] = token.split(".");
  if (payload === undefined || signature === undefined || extra !== undefined) return undefined;
  const expected = mac(payload, key);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  return Buffer.from(payload, "base64url").toString("utf8");
}

// --- The scanner ---------------------------------------------------------------------------

/** A region or component: its target spelling (section 2.6) and its span in the document. */
export interface Identity {
  readonly kind: "region" | "component";
  readonly target: string;
  readonly start: number;
  readonly end: number;
}

export interface Identities {
  readonly byTarget: ReadonlyMap<string, Identity>;
}

interface Span {
  kind: "region" | "component";
  name: string;
  start: number;
  end: number;
}

function regionSpans(html: string): Span[] {
  const spans: Span[] = [];
  const opening = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*?\sdata-region="([^"]*)"[^>]*>/g;
  for (const match of html.matchAll(opening)) {
    const [text, tag = "", name = ""] = match;
    const tags = new RegExp(`<!--[\\s\\S]*?-->|<(/?)${tag}\\b[^>]*>`, "gi");
    tags.lastIndex = match.index + text.length;
    let depth = 1;
    let end = -1;
    for (let next = tags.exec(html); next; next = tags.exec(html)) {
      if (next[0].startsWith("<!--")) continue;
      depth += next[1] === "/" ? -1 : 1;
      if (depth === 0) {
        end = next.index + next[0].length;
        break;
      }
    }
    if (end < 0) throw new Error(`region ${name}: no end tag for <${tag}>`);
    spans.push({ kind: "region", name, start: match.index, end });
  }
  return spans;
}

function componentSpans(html: string): Span[] {
  const spans: Span[] = [];
  const open: { key: string; start: number }[] = [];
  for (const match of html.matchAll(/<!--t:c ([^ >]+)(?: ([^ >]+))?-->|<!--\/t:c-->/g)) {
    const [text, key, props] = match;
    if (key === undefined) {
      const opener = open.pop();
      if (!opener) throw new Error(`a closing component marker at ${match.index} has no opener`);
      spans.push({ kind: "component", name: opener.key, start: opener.start, end: match.index + text.length });
      continue;
    }
    if (!COMPONENT_KEY.test(key) || key.length > 64) throw new Error(`bad component key ${key}`);
    if (props !== undefined && !PROPS_TOKEN.test(props)) throw new Error(`bad props on ${key}`);
    open.push({ key, start: match.index });
  }
  if (open.length > 0) throw new Error(`component ${open[0]?.key ?? ""} is never closed`);
  return spans;
}

/** Finds every region and component and computes their targets (sections 2.1 to 2.4). */
export function scan(html: string): Identities {
  const spans = [...regionSpans(html), ...componentSpans(html)];
  const byTarget = new Map<string, Identity>();
  for (const span of spans) {
    let target: string;
    if (span.kind === "region") {
      if (!REGION_NAME.test(span.name) || span.name.length > 64 || span.name === "page") {
        throw new Error(`bad region name ${span.name}`);
      }
      target = span.name;
    } else {
      // Enclosing spans from the innermost out: component keys until the first region.
      const enclosing = spans
        .filter((other) => other.start < span.start && span.end <= other.end)
        .sort((left, right) => right.start - left.start);
      const keys = [span.name];
      let base = "page";
      for (const outer of enclosing) {
        if (outer.kind === "region") {
          base = outer.name;
          break;
        }
        keys.unshift(outer.name);
      }
      target = [base, ...keys].join("/");
      if (target.length > 512) throw new Error(`path too long: ${target}`);
    }
    if (byTarget.has(target)) throw new Error(`two elements share the target ${target}`);
    byTarget.set(target, { kind: span.kind, target, start: span.start, end: span.end });
  }
  return { byTarget };
}

/** Whether `outer` contains `inner`; a target does not contain itself. */
export function contains(outer: Identity, inner: Identity): boolean {
  return outer !== inner && outer.start <= inner.start && inner.end <= outer.end;
}

// --- Tessera-Targets -----------------------------------------------------------------------

export interface TargetEntry {
  readonly target: string;
  readonly props?: string;
}

/** Whether a string is a target (section 2.6): `page`, a region name or a component path. */
export function isTarget(value: string): boolean {
  if (value === "page") return true;
  if (!value.includes("/")) return REGION_NAME.test(value) && value.length <= 64;
  if (value.length > 512) return false;
  const [base = "", ...keys] = value.split("/");
  return (
    (base === "page" || (REGION_NAME.test(base) && base.length <= 64)) &&
    keys.every((key) => COMPONENT_KEY.test(key) && key.length <= 64)
  );
}

/** Parses a `Tessera-Targets` value (section 4.3); undefined when it breaks the grammar. */
export function parseTargets(value: string): TargetEntry[] | undefined {
  const entries: TargetEntry[] = [];
  for (const item of value.split(",")) {
    const entry = item.replace(/^[ \t]+|[ \t]+$/g, "");
    const [target = "", props, extra] = entry.split(" ");
    if (!isTarget(target) || extra !== undefined) return undefined;
    if (props === undefined) entries.push({ target });
    else if (PROPS_TOKEN.test(props)) entries.push({ target, props });
    else return undefined;
  }
  return entries;
}

// --- Fragment responses --------------------------------------------------------------------

/** The `<title>` and tracked assets of a document's head, as a fragment response copies them. */
export function headCopies(html: string): string[] {
  const head = /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? "";
  const copies: string[] = [];
  const title = /<title>[\s\S]*?<\/title>/.exec(head);
  if (title) copies.push(title[0]);
  for (const tag of head.matchAll(/<link\b[^>]*\sdata-track\b[^>]*>|<script\b[^>]*\sdata-track\b[^>]*><\/script>/g)) {
    copies.push(tag[0]);
  }
  return copies;
}

/** One `<template>` per target, after the head copies (section 5.3). */
export function fragmentBody(rendered: Rendered, targets: readonly Identity[]): string {
  const parts = headCopies(rendered.html);
  for (const identity of targets) {
    const markup = rendered.html.slice(identity.start, identity.end);
    parts.push(`<template data-target="${identity.target}">\n${markup}\n</template>`);
  }
  return `${parts.join("\n")}\n`;
}
