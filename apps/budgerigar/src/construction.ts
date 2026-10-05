import { Effect, Result, Match, Option, Schema } from "effect";
import { isComponent, type Component } from "./component";
import { isSignal, type Signal, type ReactiveRuntime, ReactiveError } from "./reactive";
import { readSync } from "./reactive/signal";
import { reactiveTextSync as reactiveText } from "./reactive/text";
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

export type MountItem = Component | Node | Signal<Option.Option<Component>>;
export type Child = string | MountItem | Signal<string>;

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

export type ElementProperties<K extends keyof HTMLElementTagNameMap> = {
  readonly [P in PropertyKeys<HTMLElementTagNameMap[K]>]?:
    | HTMLElementTagNameMap[K][P]
    | Signal<HTMLElementTagNameMap[K][P]>;
};

export interface ElementOptions<K extends keyof HTMLElementTagNameMap> {
  readonly attrs?: Readonly<Record<string, AttributeValue | Signal<AttributeValue>>>;
  readonly props?: ElementProperties<K>;
  readonly children?: ReadonlyArray<Child>;
}

export type SyncConstruct = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: ElementOptions<K>,
) => Result.Result<HTMLElementTagNameMap[K], ConstructionError>;

export interface ConstructionOwner {
  readonly active: boolean;
  readonly ownsTarget: (node: Node) => boolean;
  readonly reactiveRuntime: Option.Option<ReactiveRuntime>;
}

export interface Region {
  readonly start: Comment;
  readonly end: Comment;
  readonly definition: Component | Signal<unknown>;
  desired: Option.Option<Component>;
  request: Option.Option<(selection: Option.Option<Component>) => void>;
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
  definition: Component | Signal<unknown>;
  issuer: ConstructionOwner;
}): Region => {
  const region: Region = {
    ...options,
    start: document.createComment("budgerigar:start"),
    end: document.createComment("budgerigar:end"),
    activated: false,
    desired: Option.none(),
    request: Option.none(),
  };
  anchors.set(region.start, region);
  anchors.set(region.end, region);
  return region;
};

const isSelection = (value: unknown): value is Option.Option<Component> =>
  Option.isOption(value) && (Option.isNone(value) || isComponent(value.value));

export const validateSelectionSync = (
  value: unknown,
): Result.Result<Option.Option<Component>, ReactiveError> =>
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
      write: (value) =>
        validateSelectionSync(value).pipe(
          Result.map((selection) => {
            region.desired = selection;
            Option.match(region.request, {
              onNone: () => {},
              onSome: (request) => request(selection),
            });
          }),
        ),
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
  for (const node of tree.nodes) consumed.set(node, token);
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
  options: ElementOptions<K>,
) =>
  Result.gen(function* () {
    yield* validateSync(owner.active, "owner has been disposed");
    yield* validateSync(tags.has(tag), "unsupported HTML tag");

    const children = [...(options.children ?? [])];
    for (const child of children) {
      yield* validateSync(
        typeof child === "string" || isNode(child) || isComponent(child) || isSignal(child),
        "unsupported child",
      );
    }

    yield* inspectSync({
      roots: children.filter(isNode),
      owner,
      ownedTarget: (node) => owner.ownsTarget(node),
    });

    const element = document.createElement(tag);
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

    return element;
  });

/** Construction stays lazy until its Effect is evaluated by the issuing context. */
export const constructSync =
  (owner: ConstructionOwner): SyncConstruct =>
  (tag, options = {}) =>
    constructElement(owner, tag, options);

export type Construct = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: ElementOptions<K>,
) => Effect.Effect<HTMLElementTagNameMap[K], ConstructionError>;
export const construct =
  (owner: ConstructionOwner): Construct =>
  (tag, options = {}) =>
    lazy(() => constructSync(owner)(tag, options));
export const validate = (valid: boolean, message: string) =>
  lazy(() => validateSync(valid, message));
export const validateSelection = (value: unknown) => lazy(() => validateSelectionSync(value));
export const selectedRegion = (options: Parameters<typeof selectedRegionSync>[0]) =>
  lazy(() => selectedRegionSync(options));
export const inspect = (options: Parameters<typeof inspectSync>[0]) =>
  lazy(() => inspectSync(options));
export const checkStructure = (tree: Tree) => lazy(() => checkStructureSync(tree));
