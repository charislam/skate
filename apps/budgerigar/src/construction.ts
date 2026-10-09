import { Effect, Result, Match, Option, Schema } from "effect";
import { isCases, planBranch, type Cases } from "./branch";
import { isComponent, type Component } from "./component";
import { isKeyedList, planKeyed, type KeyedList } from "./keyed";
import {
  elementOutput,
  isElementOutput,
  managedNodes,
  nativeNode,
  type ElementOutput,
} from "./output";
import { isSignal, type Signal, type ReactiveRuntime, ReactiveError } from "./reactive";
import { readSync } from "./reactive/signal";
import { reactiveTextSync as reactiveText } from "./reactive/text";
import type { OutputRequirements } from "./requirements";
import { fromResultLazy, type Sync } from "./sync";
import { lazy } from "./synchronous";
import {
  attributeNameValid,
  bindEntrySync,
  registerBindingSync,
  markElementOwner,
  validateAttributeSync,
  validateReactiveNodeSync,
  writeAttributeSync,
  type AttributeValue,
} from "./reactive/dom";
import { propertyValidatorSync, writePropertySync } from "./reactive/properties";

export type MountItem<R = never> =
  | Component<R>
  | ElementOutput<Node, R>
  | Signal<Option.Option<Component<R>>>
  | KeyedList<unknown, R>
  | Cases<R>;
export type Child<R = never> = string | MountItem<R> | Signal<string>;

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

type WritableKeys<T> = {
  [K in keyof T]-?: Equal<Pick<T, K>, { -readonly [P in K]: T[P] }> extends true ? K : never;
}[keyof T];

type PropertyKeys<T> = {
  [K in WritableKeys<T>]: K extends
    | `on${string}`
    | "innerHTML"
    | "outerHTML"
    | "textContent"
    | "innerText"
    | "outerText"
    | "srcdoc"
    | "style"
    ? never
    : T[K] extends (...args: never[]) => unknown
      ? never
      : K;
}[WritableKeys<T>];

export type NativeProperties<N extends HTMLElement> = {
  readonly [P in PropertyKeys<N>]?: N[P] | Signal<N[P]>;
};
export type ElementProperties<K extends keyof HTMLElementTagNameMap> = NativeProperties<
  HTMLElementTagNameMap[K]
>;

export interface ElementOptions<K extends keyof HTMLElementTagNameMap, R = never> {
  readonly attrs?: Readonly<Record<string, AttributeValue | Signal<AttributeValue>>>;
  readonly props?: ElementProperties<K>;
  readonly children?: ReadonlyArray<Child<R>>;
}

type InferredOptions<
  K extends keyof HTMLElementTagNameMap,
  C extends ReadonlyArray<unknown>,
> = Omit<ElementOptions<K, unknown>, "children"> & {
  readonly children?: C & (C extends ReadonlyArray<Child<unknown>> ? unknown : never);
};

export type SyncConstruct = <
  K extends keyof HTMLElementTagNameMap,
  const C extends ReadonlyArray<unknown> = readonly [],
>(
  tag: K,
  options?: InferredOptions<K, C>,
) => Sync<ElementOutput<HTMLElementTagNameMap[K], OutputRequirements<C>>, ConstructionError>;

export interface ConstructionOwner {
  readonly active: boolean;
  readonly ownsTarget: (node: Node) => boolean;
  readonly reactiveRuntime: Option.Option<ReactiveRuntime>;
}

export interface Region {
  readonly start: Comment;
  readonly end: Comment;
  readonly definition:
    | Component<unknown>
    | Signal<unknown>
    | KeyedList<unknown, unknown>
    | Cases<unknown>;
  readonly issuer: ConstructionOwner;
  activated: boolean;
}

export interface Tree {
  readonly roots: ReadonlyArray<Node>;
  readonly nodes: ReadonlyArray<Node>;
  readonly regions: ReadonlyArray<Region>;
  readonly structure: ReadonlyMap<Node, ReadonlyArray<Node>>;
}

const anchors = new WeakMap<Node, Region>();
const consumed = new WeakMap<Node, object>();
const constructedRegions = new WeakMap<Node, ReadonlyArray<Region>>();
const importedTrees = new WeakMap<Node, Tree>();

export class ConstructionError extends Schema.TaggedError<ConstructionError>()(
  "ConstructionError",
  {
    message: Schema.String,
  },
) {}

export const validateSync = (
  valid: boolean,
  message: string,
): Result.Result<void, ConstructionError> =>
  Match.value(valid).pipe(
    Match.when(true, () => Result.succeed(undefined)),
    Match.when(false, () =>
      Result.fail(new ConstructionError({ message: `Budgerigar construction: ${message}` })),
    ),
    Match.exhaustive,
  );

export const isNode = (value: unknown): value is Node => value instanceof Node;

export const makeRegion = (options: {
  definition: Component<unknown> | Signal<unknown> | KeyedList<unknown, unknown> | Cases<unknown>;
  issuer: ConstructionOwner;
}): Region => {
  const region: Region = {
    ...options,
    start: document.createComment("budgerigar:start"),
    end: document.createComment("budgerigar:end"),
    activated: false,
  };
  anchors.set(region.start, region);
  anchors.set(region.end, region);
  managedNodes.add(region.start);
  managedNodes.add(region.end);
  return region;
};

const isSelection = (value: unknown): value is Option.Option<Component<unknown>> =>
  Option.isOption(value) && (Option.isNone(value) || isComponent(value.value));

export const keyedRegionSync = (options: {
  description: KeyedList<unknown, unknown>;
  issuer: ConstructionOwner;
}) =>
  Result.gen(function* () {
    const runtime = yield* Option.match(options.issuer.reactiveRuntime, {
      onNone: () =>
        Result.fail(
          new ConstructionError({ message: "Keyed lists require a live issuing context" }),
        ),
      onSome: Result.succeed,
    });
    yield* validateSync(
      options.issuer.active && isSignal(options.description.items),
      "Keyed lists require a live issuing context and an items signal",
    );
    const region = makeRegion({ definition: options.description, issuer: options.issuer });
    yield* registerBindingSync({
      runtime,
      node: region.start,
      signal: options.description.items,
      kind: "list",
      name: "list",
      validate: (value) => planKeyed({ description: options.description, value }),
      initialize: () => {},
      write: () => Result.succeed(undefined),
    }).pipe(Result.mapError((error) => new ConstructionError({ message: error.message })));
    return region;
  });

export const casesRegionSync = (options: {
  description: Cases<unknown>;
  issuer: ConstructionOwner;
}) =>
  Result.gen(function* () {
    const runtime = yield* Option.match(options.issuer.reactiveRuntime, {
      onNone: () =>
        Result.fail(new ConstructionError({ message: "Cases require a live issuing context" })),
      onSome: Result.succeed,
    });
    const value = yield* readSync({ runtime, signal: options.description.state }).pipe(
      Result.mapError((error) => new ConstructionError({ message: error.message })),
    );
    yield* planBranch({ description: options.description, value }).pipe(
      Result.mapError((error) => new ConstructionError({ message: error.message })),
    );
    return makeRegion({ definition: options.description, issuer: options.issuer });
  });

export const validateSelectionSync = (
  value: unknown,
): Result.Result<Option.Option<Component<unknown>>, ReactiveError> =>
  Match.value(value).pipe(
    Match.when(isSelection, (selection) => Result.succeed(selection)),
    Match.orElse(() =>
      Result.fail(new ReactiveError({ message: "Selection requires Option<Component>" })),
    ),
  );

export const selectedRegionSync = (options: {
  signal: Signal<unknown>;
  issuer: ConstructionOwner;
}) =>
  Result.gen(function* () {
    const runtime = yield* Option.match(options.issuer.reactiveRuntime, {
      onNone: () =>
        Result.fail(
          new ConstructionError({ message: "Selection requires a live issuing context" }),
        ),
      onSome: Result.succeed,
    });
    const region = makeRegion({ definition: options.signal, issuer: options.issuer });
    yield* registerBindingSync({
      runtime,
      node: region.start,
      signal: options.signal,
      kind: "selection",
      name: "selection",
      validate: validateSelectionSync,
      initialize: () => {},
      write: () => Result.succeed(undefined),
    }).pipe(Result.mapError((error) => new ConstructionError({ message: error.message })));
    return region;
  });

/** Validate the entire forest before moving or consuming any of its nodes. */
export const inspectSync = (options: {
  readonly roots: ReadonlyArray<Node>;
  readonly owner: ConstructionOwner;
  readonly reservation?: object;
  readonly ownedTarget?: (node: Node) => boolean;
  readonly direct?: ReadonlyArray<Region>;
}) =>
  Result.gen(function* () {
    const nodes: Node[] = [];
    const regions: Region[] = [];
    const seen = new Set<Node>();
    const structure = new Map<Node, ReadonlyArray<Node>>();

    const checkReservation = (node: Node): Result.Result<void, ConstructionError> =>
      Option.match(Option.fromUndefinedOr(consumed.get(node)), {
        onNone: () => Result.succeed(undefined),
        onSome: (token) =>
          validateSync(token === options.reservation, "node was already adopted or reserved"),
      });

    const visitAnchor = (node: Node) =>
      Result.gen(function* () {
        yield* validateSync(!seen.has(node), "duplicate region anchor");
        yield* checkReservation(node);

        yield* validateReactiveNodeSync({ node, runtime: options.owner.reactiveRuntime }).pipe(
          Result.mapError((error) => new ConstructionError({ message: error.message })),
        );
        seen.add(node);
        nodes.push(node);
        structure.set(node, []);
      });

    const visit: (options: {
      node: Node;
      root: boolean;
    }) => Result.Result<void, ConstructionError> = ({ node, root }) =>
      Result.gen(function* () {
        yield* validateSync(!seen.has(node), "duplicate or overlapping nodes");
        seen.add(node);

        yield* validateSync(
          new Set<number>([Node.ELEMENT_NODE, Node.TEXT_NODE, Node.COMMENT_NODE]).has(
            node.nodeType,
          ),
          "only element, text, and ordinary comment nodes are insertable",
        );

        yield* validateSync(!root || node.parentNode === null, "roots must be detached");
        yield* Option.match(Option.fromUndefinedOr(importedTrees.get(node)), {
          onNone: () => Result.succeed(undefined),
          onSome: checkStructureSync,
        });

        yield* validateSync(
          !root || !anchors.has(node),
          "region anchors cannot be explicit content",
        );

        yield* checkReservation(node);

        yield* validateReactiveNodeSync({
          node,
          runtime: options.owner.reactiveRuntime,
        }).pipe(Result.mapError((error) => new ConstructionError({ message: error.message })));

        nodes.push(node);

        const children = Array.from(node.childNodes);
        for (const region of constructedRegions.get(node) ?? []) {
          yield* validateSync(
            children.includes(region.start) && children.includes(region.end),
            "missing region boundaries",
          );
        }
        structure.set(node, children);

        yield* Match.value(options.ownedTarget?.(node) === true).pipe(
          Match.when(true, () => Result.succeed(undefined)),
          Match.when(false, () =>
            Result.gen(function* () {
              for (const child of children) {
                yield* Option.match(Option.fromUndefinedOr(anchors.get(child)), {
                  onNone: () => visit({ node: child, root: false }),
                  onSome: (region) =>
                    Result.gen(function* () {
                      yield* validateSync(
                        region.issuer === options.owner && !region.activated,
                        "foreign-owned or previously activated region",
                      );
                      yield* validateSync(
                        region.start.parentNode === node &&
                          region.start.nextSibling === region.end &&
                          region.end.parentNode === node,
                        "tampered region boundaries",
                      );
                      Match.value(child === region.start).pipe(
                        Match.when(true, () => regions.push(region)),
                        Match.orElse(() => {}),
                      );
                      yield* visitAnchor(child);
                    }),
                });
              }
            }),
          ),
          Match.exhaustive,
        );
      });

    for (const root of options.roots) {
      yield* Option.match(Option.fromUndefinedOr(anchors.get(root)), {
        onNone: () => visit({ node: root, root: true }),
        onSome: (region) =>
          Result.gen(function* () {
            yield* validateSync(
              options.direct?.includes(region) === true &&
                region.issuer === options.owner &&
                !region.activated &&
                root.parentNode === null,
              "region anchors cannot be explicit content",
            );
            yield* visitAnchor(root);
            Match.value(root === region.start).pipe(
              Match.when(true, () => regions.push(region)),
              Match.orElse(() => {}),
            );
          }),
      });
    }

    return { roots: [...options.roots], nodes, regions, structure } satisfies Tree;
  });

export const reserve = (tree: Tree, token: object): void => {
  for (const node of tree.nodes) {
    consumed.set(node, token);
    managedNodes.add(node);
  }
};

export const checkStructureSync = (tree: Tree) =>
  Result.gen(function* () {
    for (const [node, children] of tree.structure) {
      const current = Array.from(node.childNodes);
      yield* validateSync(
        current.length === children.length &&
          current.every((child, index) => child === children[index]),
        "submitted tree structure changed",
      );
    }
  });

const tags = new Set(
  "a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta meter nav noscript object ol optgroup option output p picture pre progress q rp rt ruby s samp script search section select slot small source span strong style sub summary sup table tbody td template textarea tfoot th thead time title tr track u ul var video wbr".split(
    " ",
  ),
);

const constructElement = <K extends keyof HTMLElementTagNameMap>(
  owner: ConstructionOwner,
  tag: K,
  options: Omit<ElementOptions<K, unknown>, "children"> & {
    readonly children?: ReadonlyArray<unknown>;
  },
) =>
  Result.gen(function* () {
    yield* validateSync(owner.active, "owner has been disposed");
    yield* validateSync(tags.has(tag), "unsupported HTML tag");

    const content = [...(options.children ?? [])];
    for (const child of content) {
      yield* validateSync(
        typeof child === "string" ||
          isElementOutput(child) ||
          isComponent(child) ||
          isSignal(child) ||
          isKeyedList(child) ||
          isCases(child),
        "unsupported child",
      );
    }
    // The preceding validation establishes this private erased union.
    const validContent = content as ReadonlyArray<
      | string
      | ElementOutput<Node, unknown>
      | Component<unknown>
      | Signal<unknown>
      | KeyedList<unknown, unknown>
      | Cases<unknown>
    >;
    const children = validContent.map((child) =>
      Match.value(child).pipe(
        Match.when(isElementOutput, nativeNode),
        Match.orElse((value) => value),
      ),
    );

    yield* inspectSync({
      roots: children.filter(isNode),
      owner,
      ownedTarget: (node) => owner.ownsTarget(node),
    });

    const element = document.createElement(tag);
    managedNodes.add(element);
    markElementOwner({ element, runtime: owner.reactiveRuntime });

    const constructionFailure = (error: { message: string }) =>
      new ConstructionError({ message: error.message });
    for (const [name, value] of Object.entries(options.attrs ?? {})) {
      yield* validateSync(attributeNameValid(name), `unsupported attribute ${name}`);
      yield* bindEntrySync({
        runtime: owner.reactiveRuntime,
        element,
        kind: "attribute",
        name: name.toLowerCase(),
        value,
        validate: validateAttributeSync,
        write: (value) => writeAttributeSync({ element, name: name.toLowerCase(), value }),
      }).pipe(Result.mapError(constructionFailure));
    }
    // Validate and claim property destinations before moving children. Native
    // properties are still assigned last, preserving wholly static precedence.
    const propertyWrites: Array<() => Result.Result<void, ReactiveError>> = [];
    for (const [name, value] of Object.entries(options.props ?? {})) {
      const check = yield* propertyValidatorSync({ element, name }).pipe(
        Result.mapError(constructionFailure),
      );
      yield* bindEntrySync({
        runtime: owner.reactiveRuntime,
        element,
        kind: "property",
        name,
        value,
        validate: check,
        write: (value) => writePropertySync({ element, name, value }),
        initialize: (write) => {
          propertyWrites.push(write);
        },
      }).pipe(Result.mapError(constructionFailure));
    }

    const regions: Region[] = [];
    for (const child of children) {
      yield* Match.value(child).pipe(
        Match.when(
          (v): v is string => typeof v === "string",
          (v) => Result.succeed(element.append(document.createTextNode(v))),
        ),
        Match.when(isNode, (node) => Result.succeed(element.append(node))),
        Match.when(isCases, (description) =>
          casesRegionSync({ description, issuer: owner }).pipe(
            Result.map((region) => {
              element.append(region.start, region.end);
              regions.push(region);
            }),
          ),
        ),
        Match.when(isKeyedList, (description) =>
          keyedRegionSync({ description, issuer: owner }).pipe(
            Result.map((region) => {
              element.append(region.start, region.end);
              regions.push(region);
            }),
          ),
        ),
        Match.when(isSignal, (signal) =>
          Option.match(owner.reactiveRuntime, {
            onNone: () =>
              Result.fail(
                new ConstructionError({
                  message: "Reactive children require a live issuing context",
                }),
              ),
            onSome: (runtime) =>
              Result.gen(function* () {
                const input: Signal<unknown> = signal;
                const value = yield* readSync({ runtime, signal: input }).pipe(
                  Result.mapError((error) => new ConstructionError({ message: error.message })),
                );
                yield* Match.value(typeof value === "string").pipe(
                  Match.when(true, () =>
                    reactiveText({ runtime, signal }).pipe(
                      Result.mapError((error) => new ConstructionError({ message: error.message })),
                      Result.map((node) => element.append(node)),
                    ),
                  ),
                  Match.when(false, () =>
                    selectedRegionSync({ signal, issuer: owner }).pipe(
                      Result.map((region) => {
                        element.append(region.start, region.end);
                        regions.push(region);
                      }),
                    ),
                  ),
                  Match.exhaustive,
                );
              }),
          }),
        ),
        Match.orElse((definition) => {
          const region = makeRegion({ definition, issuer: owner });
          element.append(region.start, region.end);
          regions.push(region);
          return Result.succeed(undefined);
        }),
      );
    }
    constructedRegions.set(element, regions);

    for (const write of propertyWrites) yield* write().pipe(Result.mapError(constructionFailure));
    propertyWrites.length = 0;

    for (const node of element.childNodes) managedNodes.add(node);

    return element;
  });

/** Construction stays lazy until its Effect is evaluated by the issuing context. */
export const constructSync =
  (owner: ConstructionOwner): SyncConstruct =>
  (tag, options = {}) =>
    fromResultLazy(() => constructElement(owner, tag, options).pipe(Result.map(elementOutput)));

export type Construct = <
  K extends keyof HTMLElementTagNameMap,
  const C extends ReadonlyArray<unknown> = readonly [],
>(
  tag: K,
  options?: InferredOptions<K, C>,
) => Effect.Effect<
  ElementOutput<HTMLElementTagNameMap[K], OutputRequirements<C>>,
  ConstructionError
>;
export const construct =
  (owner: ConstructionOwner): Construct =>
  (tag, options = {}) =>
    lazy(() => constructElement(owner, tag, options).pipe(Result.map(elementOutput)));

const importNodeSync = <N extends Node>(options: {
  readonly node: N;
  readonly owner: ConstructionOwner;
}) =>
  Result.gen(function* () {
    yield* validateSync(options.owner.active, "owner has been disposed");
    yield* validateSync(isNode(options.node), "native import requires a Node");
    const tree = yield* inspectSync({ roots: [options.node], owner: options.owner });
    for (const node of tree.nodes) {
      yield* validateSync(!managedNodes.has(node), "native import requires a fresh unmanaged tree");
    }
    for (const node of tree.nodes) {
      managedNodes.add(node);
      Match.value(node).pipe(
        Match.when(
          (node): node is HTMLElement => node instanceof HTMLElement,
          (element) => markElementOwner({ element, runtime: options.owner.reactiveRuntime }),
        ),
        Match.orElse(() => {}),
      );
    }
    importedTrees.set(options.node, tree);
    return elementOutput(options.node);
  });

export type ImportNative = <N extends Node>(
  node: N,
) => Effect.Effect<ElementOutput<N>, ConstructionError>;
export type SyncImportNative = <N extends Node>(
  node: N,
) => Sync<ElementOutput<N>, ConstructionError>;
export const importNative =
  (owner: ConstructionOwner): ImportNative =>
  (node) =>
    lazy(() => importNodeSync({ node, owner }));
export const importNativeSync =
  (owner: ConstructionOwner): SyncImportNative =>
  (node) =>
    fromResultLazy(() => importNodeSync({ node, owner }));
export const validate = (valid: boolean, message: string) =>
  lazy(() => validateSync(valid, message));
export const validateSelection = (value: unknown) => lazy(() => validateSelectionSync(value));
export const selectedRegion = (options: Parameters<typeof selectedRegionSync>[0]) =>
  lazy(() => selectedRegionSync(options));
export const inspect = (options: Parameters<typeof inspectSync>[0]) =>
  lazy(() => inspectSync(options));
export const checkStructure = (tree: Tree) => lazy(() => checkStructureSync(tree));
