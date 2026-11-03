// Forms without replay: which submits Tessera takes, the blocked second write, a GET form's newer
// submit superseding the older, focus after a 422 or 409, the message for an indeterminate write,
// and the encoding guard. In jsdom's own document.
import { afterEach, describe, expect, it, vi } from "vitest";
import { formEligibility, INDETERMINATE_EVENT, INDETERMINATE_MESSAGE, interceptForms } from "../../src/forms.ts";
import type { FormEligibility } from "../../src/forms.ts";
import { disposeTransport, empty, fragments, hang, networkFailure, setup } from "./transport-fixture.ts";

afterEach(disposeTransport);

/** Submits `form` with `submitter`, recording what eligibility said, and keeps jsdom from submitting. */
function eligibility(html: string, submitter = "#go"): FormEligibility {
  document.body.innerHTML = html;
  const form = document.querySelector("form");
  if (!form) throw new Error("no form");
  let result: FormEligibility = { refused: "not-a-form" };
  const record = (event: Event): void => {
    result = formEligibility(event as SubmitEvent, document);
    event.preventDefault();
  };
  document.addEventListener("submit", record);
  form.requestSubmit(document.querySelector<HTMLElement>(submitter));
  document.removeEventListener("submit", record);
  return result;
}

const refused = (result: FormEligibility): string | undefined => ("refused" in result ? result.refused : undefined);

describe("form eligibility", () => {
  it("takes a same-origin POST or GET form, with its submitter", () => {
    const post = eligibility(`<form method="post" action="/save"><button id="go">Go</button></form>`);
    expect("form" in post ? post.submitter?.id : post).toBe("go");
    expect(refused(eligibility(`<form action="/search"><button id="go">Go</button></form>`))).toBeUndefined();
    expect(refused(eligibility(`<form method="post" action="https://elsewhere.example/" ><button id="go" formaction="/here">Go</button></form>`))).toBeUndefined();
  });

  it.each([
    ["a dialog form", `<form method="dialog"><button id="go">Go</button></form>`, "method"],
    ["a submitter with formmethod dialog", `<form method="post"><button id="go" formmethod="dialog">Go</button></form>`, "method"],
    ["a form with a target", `<form method="post" target="_blank"><button id="go">Go</button></form>`, "target"],
    ["a submitter with formtarget", `<form method="post"><button id="go" formtarget="frame">Go</button></form>`, "target"],
    ["another origin", `<form method="post" action="https://elsewhere.example/"><button id="go">Go</button></form>`, "origin"],
    ["a submitter's formaction to another origin", `<form method="post" action="/x"><button id="go" formaction="https://elsewhere.example/">Go</button></form>`, "origin"],
    ["a mailto action", `<form method="post" action="mailto:a@example.com"><button id="go">Go</button></form>`, "scheme"],
    ["data-enhance off on the form", `<form method="post" data-enhance="off"><button id="go">Go</button></form>`, "opted-out"],
    ["data-enhance off around the form", `<div data-enhance="off"><form method="post"><button id="go">Go</button></form></div>`, "opted-out"],
  ] as const)("leaves %s to the browser", (_case, html, reason) => {
    expect(refused(eligibility(html))).toBe(reason);
  });

  it("lets a submitter turn enhancement back on inside an off area", () => {
    expect(refused(eligibility(`<form method="post" data-enhance="off"><button id="go" data-enhance="on">Go</button></form>`))).toBeUndefined();
  });

  it("leaves a submit an application already prevented", () => {
    document.body.innerHTML = `<form method="post"><button id="go">Go</button></form>`;
    const form = document.querySelector("form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
    });
    let result: FormEligibility | undefined;
    document.addEventListener("submit", (event) => {
      result = formEligibility(event, document);
    }, { once: true });
    form?.requestSubmit();
    expect(result && refused(result)).toBe("prevented");
  });
});

describe("taking over submits", () => {
  const page = `<main data-region="content"><form id="f" method="post" action="/save"><input name="name" value="Ada"><button id="go" name="intent" value="send">Send</button></form></main>`;

  function forms(html = page, respond: Parameters<ReturnType<typeof setup>["respond"]> = []) {
    const fixture = setup(html);
    fixture.respond(...respond);
    interceptForms({ kernel: fixture.kernel, transport: fixture.transport, settleMs: 50 });
    const submit = (): void => {
      (fixture.find("#f") as HTMLFormElement).requestSubmit(fixture.find("#go"));
    };
    return { ...fixture, submit };
  }

  it("sends an eligible submit through the transport, with its submitter", async () => {
    const { submit, calls } = forms();
    submit();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]).toMatchObject({ method: "POST", url: "http://localhost:3000/save" });
    expect(String(calls[0]?.body)).toBe("name=Ada&intent=send");
    expect(calls[0]?.headers["tessera-targets"]).toBe("content");
  });

  it("blocks a second submit of the form while the first is in flight, and allows one after", async () => {
    let answer: (response: Response) => void = () => undefined;
    const { submit, calls } = forms(page, [() => new Promise<Response>((resolve) => { answer = resolve; }), () => empty(204)]);
    submit();
    submit();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    submit();
    expect(calls).toHaveLength(1);
    answer(empty(204));
    await new Promise((resolve) => setTimeout(resolve, 20));
    submit();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
  });

  it("sends a GET form's newer submit while the older is in flight, and the newer one wins", async () => {
    const search = `<main data-region="content"><form id="f" action="/search" data-target="results"><input id="q" name="q" value="c"><button id="go">Search</button></form><section data-region="results"><p id="shown">none</p></section></main>`;
    const results = (query: string): Response => fragments(`<template data-target="results"><section data-region="results"><p id="shown">${query}</p></section></template>`);
    let older: (response: Response) => void = () => undefined;
    // The older answer arrives late whatever its signal says, as from a server that ignores the abort.
    const { submit, calls, find } = forms(search, [() => new Promise<Response>((resolve) => { older = resolve; }), () => results("cr")]);
    submit();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    (find("#q") as HTMLInputElement).value = "cr";
    submit();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls.map(({ method, url }) => [method, url])).toEqual([
      ["GET", "http://localhost:3000/search?q=c"],
      ["GET", "http://localhost:3000/search?q=cr"],
    ]);
    expect(calls[0]?.signal.aborted).toBe(true);
    await vi.waitFor(() => {
      expect(find("#shown").textContent).toBe("cr");
    });
    older(results("c"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(find("#shown").textContent).toBe("cr");
  });

  it("sends a GET submission while a write of the same form is in flight, after the write", async () => {
    const both = `<main data-region="content"><form id="f" method="post" action="/save"><input name="name" value="Ada"><button id="go">Send</button><button id="find" formmethod="get" formaction="/find">Find</button></form></main>`;
    let answer: (response: Response) => void = () => undefined;
    const { submit, calls, find } = forms(both, [() => new Promise<Response>((resolve) => { answer = resolve; }), () => empty(204)]);
    submit();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    (find("#f") as HTMLFormElement).requestSubmit(find("#find"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The read queues behind the write (protocol 4.6); it is not dropped.
    expect(calls).toHaveLength(1);
    answer(empty(204));
    await vi.waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls[1]).toMatchObject({ method: "GET", url: "http://localhost:3000/find?name=Ada" });
  });

  it("focuses the error summary after a 422", async () => {
    const { submit, find } = forms(page, [
      () =>
        fragments(
          `<template data-target="content"><main data-region="content"><div data-error-summary role="alert">Name is required.</div><form id="f" method="post" action="/save"><input name="name" aria-invalid="true"><button id="go">Send</button></form></main></template>`,
          { status: 422 },
        ),
    ]);
    submit();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(find("[data-error-summary]"));
    });
    expect(find("[data-error-summary]").getAttribute("tabindex")).toBe("-1");
  });

  it("focuses the first invalid field after a 409 without a summary", async () => {
    const { submit, find } = forms(page, [
      () =>
        fragments(
          `<template data-target="content"><main data-region="content"><form id="f" method="post" action="/save"><input id="ok" name="a"><input id="bad" name="name" aria-invalid="true"><button id="go">Send</button></form></main></template>`,
          { status: 409 },
        ),
    ]);
    submit();
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(find("#bad"));
    });
  });

  it("shows a message when a write's fate is unknown, and removes it on the next submit", async () => {
    const { submit, find, calls } = forms(page, [networkFailure, hang]);
    submit();
    await vi.waitFor(() => {
      expect(document.querySelector("[data-tessera-indeterminate]")).not.toBeNull();
    });
    const message = document.querySelector("[data-tessera-indeterminate]");
    expect(message?.getAttribute("role")).toBe("alert");
    expect(message?.textContent).toBe(INDETERMINATE_MESSAGE);
    expect(message?.nextElementSibling).toBe(find("#f"));
    expect(calls).toHaveLength(1);
    submit();
    expect(document.querySelector("[data-tessera-indeterminate]")).toBeNull();
  });

  it("lets an application replace the message by cancelling tessera:indeterminate", async () => {
    const { submit, find } = forms(page, [networkFailure]);
    const seen = vi.fn((event: Event) => {
      event.preventDefault();
    });
    find("#f").addEventListener(INDETERMINATE_EVENT, seen);
    submit();
    await vi.waitFor(() => {
      expect(seen).toHaveBeenCalledOnce();
    });
    expect(document.querySelector("[data-tessera-indeterminate]")).toBeNull();
  });

  it("leaves an ineligible form to the browser", () => {
    const { calls, find } = forms(`<main data-region="content"><form id="f" method="post" action="/save" data-enhance="off"><button id="go">Send</button></form></main>`);
    let prevented: boolean | undefined;
    window.addEventListener("submit", (event) => {
      prevented = event.defaultPrevented;
      event.preventDefault();
    }, { once: true });
    (find("#f") as HTMLFormElement).requestSubmit(find("#go"));
    expect(prevented).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("the encoding guard", () => {
  it("drops a Content-Type an interceptor sets on a request with a body", async () => {
    const { transport, calls } = setup(`<main data-region="content"></main>`);
    transport.intercept({
      before: ({ headers }) => {
        headers.set("Content-Type", "application/json");
      },
    });
    await transport.request({ kind: "submit", method: "POST", url: "/x", body: new URLSearchParams({ a: "1" }) });
    expect(calls[0]?.headers["content-type"]).toBeUndefined();
    expect(calls[0]?.body).toBeInstanceOf(URLSearchParams);
  });
});
