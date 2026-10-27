// The reference server's answers (docs/protocol.md, sections 1 and 5): a document or fragments
// for the requested targets, redirects as Tessera-Location, and the version check. Shared by the
// fixture site (server.ts) and the navigation matrix's site (navigation.ts).
import { contains, fragmentBody, parseTargets, verify } from "./html.ts";
import type { Identity, Rendered } from "./html.ts";
import { header, isTessera, PROTOCOL, text } from "./http.ts";
import type { FixtureRequest, FixtureResponse, Secrets } from "./http.ts";

export function documentResponse(rendered: Rendered, status: number): FixtureResponse {
  return { status, headers: { "Content-Type": "text/html; charset=utf-8" }, body: rendered.html };
}

export function fragmentResponse(rendered: Rendered, targets: Identity[], status: number): FixtureResponse {
  return {
    status,
    headers: { "Content-Type": "text/vnd.tessera+html; charset=utf-8", "Tessera-Protocol": PROTOCOL },
    body: fragmentBody(rendered, targets),
  };
}

/**
 * Section 5.1: the full document for a plain request, for the `page` target, for a visit from
 * another layout and for a target this page lacks; fragments for the requested targets
 * otherwise, keeping only the outermost of targets that contain one another.
 */
export function answer(
  request: FixtureRequest,
  rendered: Rendered,
  status: number,
  secrets: Secrets,
): FixtureResponse {
  const raw = header(request.headers, "tessera-targets");
  if (!isTessera(request) || raw === undefined) return documentResponse(rendered, status);
  const entries = parseTargets(raw);
  if (!entries) return text(400, "Tessera-Targets does not follow the grammar of protocol 4.3.");
  if (entries.some((entry) => entry.target === "page")) return documentResponse(rendered, status);
  const kind = header(request.headers, "tessera-request");
  if (kind === "visit" && header(request.headers, "tessera-layout") !== rendered.layout) {
    return documentResponse(rendered, status);
  }
  const found = new Set<Identity>();
  for (const entry of entries) {
    const identity = rendered.identities.byTarget.get(entry.target);
    if (!identity) return documentResponse(rendered, status);
    if (entry.props !== undefined && verify(entry.props, secrets.key) === undefined) {
      return text(403, `The props token for ${entry.target} does not verify.`);
    }
    found.add(identity);
  }
  const outer = [...found].filter((identity) => ![...found].some((other) => contains(other, identity)));
  return fragmentResponse(rendered, outer, status);
}

/** Section 5.4: a redirect travels as `Tessera-Location` on a `200` for a Tessera request. */
export function redirect(request: FixtureRequest, location: string): FixtureResponse {
  return isTessera(request)
    ? { status: 200, headers: { "Tessera-Location": location, "Tessera-Protocol": PROTOCOL }, body: "" }
    : { status: 303, headers: { Location: location }, body: "" };
}

/** Section 1: a version this server does not speak is refused before anything else happens. */
export function versionRefusal(request: FixtureRequest): FixtureResponse | undefined {
  if (!isTessera(request) || header(request.headers, "tessera-protocol") === PROTOCOL) return undefined;
  return {
    ...text(400, `This server speaks Tessera protocol ${PROTOCOL}.`),
    headers: { "Content-Type": "text/plain; charset=utf-8", "Tessera-Protocol": PROTOCOL },
  };
}
