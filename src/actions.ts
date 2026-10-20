// The action seam: `@get(url, options)` and its siblings in an expression call this. The
// transport (#11) supplies the real one; until then `createActionRecorder` records calls.

export type ActionMethod = "get" | "post" | "put" | "patch" | "delete";

export const ACTION_METHODS: readonly ActionMethod[] = ["get", "post", "put", "patch", "delete"];

export interface ActionCall {
  readonly method: ActionMethod;
  readonly url: string;
  readonly options: Readonly<Record<string, unknown>> | undefined;
  readonly element: Element;
  readonly event: Event | undefined;
}

/** Starts the request an action names; its result is what the expression gets back. */
export type ActionSeam = (call: ActionCall) => unknown;

export interface ActionRecorder {
  readonly seam: ActionSeam;
  readonly calls: readonly ActionCall[];
}

/** A seam that records each call and resolves to undefined. */
export function createActionRecorder(): ActionRecorder {
  const calls: ActionCall[] = [];
  return {
    seam: (call) => {
      calls.push(Object.freeze({ ...call }));
      return Promise.resolve(undefined);
    },
    calls,
  };
}
