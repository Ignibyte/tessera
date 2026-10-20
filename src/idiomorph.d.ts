// Types for Idiomorph 0.7.4, which ships none. Ported from jqstar `src/idiomorph.d.ts`, cut to
// what src/patch.ts uses. A callback returning `false` vetoes that step.
declare module "idiomorph" {
  export interface IdiomorphCallbacks {
    beforeNodeAdded?: (node: Node) => boolean | undefined;
    afterNodeAdded?: (node: Node) => undefined;
    beforeNodeMorphed?: (oldNode: Node, newNode: Node) => boolean | undefined;
    afterNodeMorphed?: (oldNode: Node, newNode: Node) => undefined;
    beforeNodeRemoved?: (node: Node) => boolean | undefined;
    afterNodeRemoved?: (node: Node) => undefined;
  }

  export interface IdiomorphOptions {
    morphStyle?: "outerHTML" | "innerHTML";
    ignoreActiveValue?: boolean;
    restoreFocus?: boolean;
    callbacks?: IdiomorphCallbacks;
  }

  export const Idiomorph: {
    morph(existingNode: Node, newContent: string | Node | Node[], options?: IdiomorphOptions): Node[];
  };
}
