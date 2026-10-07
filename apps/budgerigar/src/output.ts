import { Match } from "effect";

const TypeId = Symbol("Budgerigar/ElementOutput");

/** A mountable handle, with no implicit native DOM conversion. */
export interface ElementOutput<out N extends Node = Node, out R = never> {
  readonly [TypeId]: typeof TypeId;
  readonly nodeType?: () => N;
  readonly requirements?: () => R;
}

const nodes = new WeakMap<object, Node>();

/** Internal checked construction boundary. Not re-exported by the framework. */
export const elementOutput = <N extends Node, R = never>(node: N): ElementOutput<N, R> => {
  const output: ElementOutput<N, R> = { [TypeId]: TypeId };
  nodes.set(output, node);
  return output;
};

export const isElementOutput = (value: unknown): value is ElementOutput<Node, unknown> =>
  typeof value === "object" && value !== null && nodes.has(value);

/** Focus, measurement, and widget access do not make this Node mountable output. */
export const nativeNode = <N extends Node, R>(output: ElementOutput<N, R>): N => {
  Match.value(isElementOutput(output)).pipe(
    Match.when(true, () => {}),
    Match.when(false, () => {
      throw new TypeError("Budgerigar native access requires an element output");
    }),
    Match.exhaustive,
  );
  // The private registry is populated only with the handle's corresponding N.
  return nodes.get(output) as N;
};

/** Permanently remembers provenance, including detached and failed framework trees. */
export const managedNodes = new WeakSet<Node>();

export type MountTarget = Element | ElementOutput<Element, unknown>;
export const nativeTarget = (target: MountTarget): Element =>
  // Match on the registry check to avoid recursively unifying native DOM types.
  Match.value(isElementOutput(target)).pipe(
    Match.when(true, () => nativeNode(target as ElementOutput<Element, unknown>)),
    Match.when(false, () => target as Element),
    Match.exhaustive,
  );
