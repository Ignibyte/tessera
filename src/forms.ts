// Forms without replay: same-origin form submissions go through the transport, which sends the
// real submitter and never resends a write. jqstar 0027's contract (declined there, never built):
// eligibility, a blocked second submit, focus on the errors after a 422 or 409, and a visible
// message when a write's fate is unknown.
import { busyElements, resolveTarget } from "./coordination.ts";
import type { Kernel } from "./kernel.ts";
import { resolveAnchors } from "./patch.ts";
import { elementTargets } from "./transport.ts";
import type { RequestOutcome, Transport } from "./transport.ts";

export type FormRefusal = "prevented" | "not-a-form" | "method" | "target" | "scheme" | "origin" | "opted-out";

export type FormEligibility =
  | { readonly form: HTMLFormElement; readonly submitter: HTMLElement | null }
  | { readonly refused: FormRefusal };

/** The event an indeterminate submission raises on its form; cancel it to show your own message. */
export const INDETERMINATE_EVENT = "tessera:indeterminate";

export const INDETERMINATE_MESSAGE =
  "Your submission was sent, but no answer came back. It may have been saved, so check before sending it again.";

const HTML = "http://www.w3.org/1999/xhtml";

/**
 * Whether a submit is one Tessera takes over. The browser fires `submit` only after its own
 * validation (unless `novalidate` or `formnovalidate`), so an invalid form never gets here.
 */
export function formEligibility(event: SubmitEvent, document: Document): FormEligibility {
  if (event.defaultPrevented) return { refused: "prevented" };
  const form = event.target as Element | null;
  if (!form || form.localName !== "form" || form.namespaceURI !== HTML || form.ownerDocument !== document) {
    return { refused: "not-a-form" };
  }
  const submitter = event.submitter ?? null;
  const own = (name: string): string | null => submitter?.getAttribute(`form${name}`) ?? form.getAttribute(name);
  const method = (own("method") ?? "get").toLowerCase();
  if (method !== "get" && method !== "post") return { refused: "method" };
  const target = own("target");
  if (target !== null && target !== "" && target.toLowerCase() !== "_self") return { refused: "target" };
  const action = new URL(own("action") ?? "", document.baseURI);
  if (action.protocol !== "http:" && action.protocol !== "https:") return { refused: "scheme" };
  if (action.origin !== new URL(document.URL).origin) return { refused: "origin" };
  const enhance = (submitter ?? form).closest("[data-enhance]")?.getAttribute("data-enhance");
  if (enhance === "off") return { refused: "opted-out" };
  return { form: form as HTMLFormElement, submitter };
}

export interface FormOptions {
  readonly kernel: Kernel;
  readonly transport: Transport;
  /** The longest the error focus waits for enhancement after a 422 or 409. Default 1000 ms. */
  readonly settleMs?: number;
}

function focusable(element: HTMLElement): HTMLElement {
  if (element.tabIndex < 0 && !element.hasAttribute("tabindex")) element.setAttribute("tabindex", "-1");
  return element;
}

/** Takes over eligible form submissions on the document. The listener is owned by the kernel. */
export function interceptForms(options: FormOptions): void {
  const { kernel, transport } = options;
  const { document } = kernel;
  const window = kernel.window as Window & typeof globalThis;
  const settleMs = options.settleMs ?? 1000;
  const inFlight = new WeakSet<HTMLFormElement>();
  const messages = new WeakMap<HTMLFormElement, Element>();

  /** After a 422 or 409: the error summary in the form's targets, else the first invalid field. */
  const focusErrors = async (targets: readonly string[]): Promise<void> => {
    await Promise.race([kernel.whenEnhanced().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, settleMs))]);
    const roots = (targets.length > 0 ? targets : ["page"]).flatMap((target) => {
      const found = resolveTarget(document, target);
      return found ? busyElements(found) : [];
    });
    const find = (selector: string): HTMLElement | null => {
      for (const root of roots) {
        const element = root.matches(selector) ? root : root.querySelector(selector);
        if (element) return element as HTMLElement;
      }
      return null;
    };
    const summary = find("[data-error-summary]") ?? find('[aria-invalid="true"]');
    if (summary) focusable(summary).focus();
  };

  const indeterminate = (form: HTMLFormElement, outcome: RequestOutcome): void => {
    const event = new window.CustomEvent(INDETERMINATE_EVENT, { bubbles: true, cancelable: true, detail: { error: outcome.error } });
    if (!form.dispatchEvent(event) || !form.isConnected) return;
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.setAttribute("data-tessera-indeterminate", "");
    message.textContent = INDETERMINATE_MESSAGE;
    form.before(message);
    messages.set(form, message);
  };

  kernel.listen("forms:submit", document, "submit", (event) => {
    const eligibility = formEligibility(event as SubmitEvent, document);
    if ("refused" in eligibility) return;
    const { form, submitter } = eligibility;
    event.preventDefault();
    if (inFlight.has(form)) return;
    inFlight.add(form);
    messages.get(form)?.remove();
    messages.delete(form);
    // The paths the request names; an anchor that does not resolve fails the submission itself.
    let targets: string[] = [];
    try {
      targets = resolveAnchors(document, elementTargets(form, submitter));
    } catch {
      // The transport reports it.
    }
    void transport
      .submit(form, submitter)
      .then(async (outcome) => {
        inFlight.delete(form);
        if (outcome.status === "indeterminate") indeterminate(form, outcome);
        else if (outcome.status === "committed" && (outcome.httpStatus === 422 || outcome.httpStatus === 409)) await focusErrors(targets);
      })
      .catch(() => {
        inFlight.delete(form);
      });
  });
}
