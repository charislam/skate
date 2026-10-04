import { Effect, Match, Option, Schema } from "effect";
import { isComponent, type Component } from "./component";
import {
  isSignal,
  reactiveText,
  type Signal,
  type ReactiveRuntime,
  ReactiveError,
} from "./reactive";
import {
  attributeNameValid,
  bindEntry,
  registerBinding,
  markElementOwner,
  validateAttribute,
  validateReactiveNode,
  writeAttribute,
  type AttributeValue,
} from "./reactive/dom";
import { propertyValidator, writeProperty } from "./reactive/properties";

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

export type Construct = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options?: ElementOptions<K>,
) => Effect.Effect<HTMLElementTagNameMap[K], ConstructionError>;

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

export const validate = (valid: boolean, message: string): Effect.Effect<void, ConstructionError> =>
  Match.value(valid).pipe(
    Match.when(true, () => Effect.void),
    Match.when(false, () =>
      Effect.fail(new ConstructionError({ message: `Budgerigar construction: ${message}` })),
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

export const validateSelection = (
  value: unknown,
): Effect.Effect<Option.Option<Component>, ReactiveError> =>
  Effect.suspend(() =>
    Match.value(value).pipe(
      Match.when(isSelection, (selection) => Effect.succeed(selection)),
      Match.orElse(() =>
        Effect.fail(new ReactiveError({ message: "Selection requires Option<Component>" })),
      ),
    ),
  );

export const selectedRegion = Effect.fn("Budgerigar.selectedRegion")(function* (options: {
  signal: Signal<unknown>;
  issuer: ConstructionOwner;
}) {
  const runtime = yield* Option.match(options.issuer.reactiveRuntime, {
    onNone: () =>
      Effect.fail(new ConstructionError({ message: "Selection requires a live issuing context" })),
    onSome: Effect.succeed,
  });
  const region = makeRegion({ definition: options.signal, issuer: options.issuer });
  yield* registerBinding({
    runtime,
    node: region.start,
    signal: options.signal,
    kind: "selection",
    name: "selection",
    validate: validateSelection,
    initialize: () => {},
    write: (value) =>
      validateSelection(value).pipe(
        Effect.map((selection) => {
          region.desired = selection;
          Option.match(region.request, {
            onNone: () => {},
            onSome: (request) => request(selection),
          });
        }),
      ),
  }).pipe(Effect.mapError((error) => new ConstructionError({ message: error.message })));
  return region;
});

/** Validate the entire forest before moving or consuming any of its nodes. */
export const inspect = Effect.fn("Budgerigar.inspect")(function* (options: {
  readonly roots: ReadonlyArray<Node>;
  readonly owner: ConstructionOwner;
  readonly reservation?: object;
  readonly ownedTarget?: (node: Node) => boolean;
  readonly direct?: ReadonlyArray<Region>;
}) {
  const nodes: Node[] = [];
  const regions: Region[] = [];
  const seen = new Set<Node>();
  const structure = new Map<Node, ReadonlyArray<Node>>();

  const checkReservation = (node: Node): Effect.Effect<void, ConstructionError> =>
    Option.match(Option.fromUndefinedOr(consumed.get(node)), {
      onNone: () => Effect.void,
      onSome: (token) =>
        validate(token === options.reservation, "node was already adopted or reserved"),
    });

  const visitAnchor = Effect.fn("Budgerigar.inspectAnchor")(function* (node: Node) {
    yield* validate(!seen.has(node), "duplicate region anchor");
    yield* checkReservation(node);
    yield* validateReactiveNode({ node, runtime: options.owner.reactiveRuntime }).pipe(
      Effect.mapError((error) => new ConstructionError({ message: error.message })),
    );
    seen.add(node);
    nodes.push(node);
    structure.set(node, []);
  });

  const visit: (options: { node: Node; root: boolean }) => Effect.Effect<void, ConstructionError> =
    Effect.fn("Budgerigar.inspectNode")(function* ({ node, root }) {
      yield* validate(!seen.has(node), "duplicate or overlapping nodes");
      seen.add(node);

      yield* validate(
        new Set<number>([Node.ELEMENT_NODE, Node.TEXT_NODE, Node.COMMENT_NODE]).has(node.nodeType),
        "only element, text, and ordinary comment nodes are insertable",
      );

      yield* validate(!root || node.parentNode === null, "roots must be detached");
      yield* validate(!root || !anchors.has(node), "region anchors cannot be explicit content");

      yield* checkReservation(node);

      yield* validateReactiveNode({
        node,
        runtime: options.owner.reactiveRuntime,
      }).pipe(Effect.mapError((error) => new ConstructionError({ message: error.message })));

      nodes.push(node);

      const children = Array.from(node.childNodes);
      for (const region of constructedRegions.get(node) ?? []) {
        yield* validate(
          children.includes(region.start) && children.includes(region.end),
          "missing region boundaries",
        );
      }
      structure.set(node, children);

      yield* Match.value(options.ownedTarget?.(node) === true).pipe(
        Match.when(true, () => Effect.void),
        Match.when(false, () =>
          Effect.gen(function* () {
            for (const child of children) {
              yield* Option.match(Option.fromUndefinedOr(anchors.get(child)), {
                onNone: () => visit({ node: child, root: false }),
                onSome: (region) =>
                  Effect.gen(function* () {
                    yield* validate(
                      region.issuer === options.owner && !region.activated,
                      "foreign-owned or previously activated region",
                    );
                    yield* validate(
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
        Effect.gen(function* () {
          yield* validate(
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

export const checkStructure = Effect.fn("Budgerigar.checkStructure")(function* (tree: Tree) {
  for (const [node, children] of tree.structure) {
    const current = Array.from(node.childNodes);
    yield* validate(
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

const constructElement = Effect.fn("Budgerigar.constructElement")(function* <
  K extends keyof HTMLElementTagNameMap,
>(owner: ConstructionOwner, tag: K, options: ElementOptions<K>) {
  yield* validate(owner.active, "owner has been disposed");
  yield* validate(tags.has(tag), "unsupported HTML tag");

  const children = [...(options.children ?? [])];
  for (const child of children) {
    yield* validate(
      typeof child === "string" || isNode(child) || isComponent(child) || isSignal(child),
      "unsupported child",
    );
  }

  yield* inspect({
    roots: children.filter(isNode),
    owner,
    ownedTarget: (node) => owner.ownsTarget(node),
  });

  const element = document.createElement(tag);
  markElementOwner({ element, runtime: owner.reactiveRuntime });

  const constructionFailure = (error: { message: string }) =>
    new ConstructionError({ message: error.message });
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    yield* validate(attributeNameValid(name), `unsupported attribute ${name}`);
    yield* bindEntry({
      runtime: owner.reactiveRuntime,
      element,
      kind: "attribute",
      name: name.toLowerCase(),
      value,
      validate: validateAttribute,
      write: (value) => writeAttribute({ element, name: name.toLowerCase(), value }),
    }).pipe(Effect.mapError(constructionFailure));
  }
  // Validate and claim property destinations before moving children. Native
  // properties are still assigned last, preserving wholly static precedence.
  const propertyWrites: Array<Effect.Effect<void, ReactiveError>> = [];
  for (const [name, value] of Object.entries(options.props ?? {})) {
    const check = yield* propertyValidator({ element, name }).pipe(
      Effect.mapError(constructionFailure),
    );
    yield* bindEntry({
      runtime: owner.reactiveRuntime,
      element,
      kind: "property",
      name,
      value,
      validate: check,
      write: (value) => writeProperty({ element, name, value }),
      initialize: (write) => {
        propertyWrites.push(write);
      },
    }).pipe(Effect.mapError(constructionFailure));
  }

  const regions: Region[] = [];
  for (const child of children) {
    yield* Match.value(child).pipe(
      Match.when(
        (v): v is string => typeof v === "string",
        (v) => Effect.sync(() => element.append(document.createTextNode(v))),
      ),
      Match.when(isNode, (node) => Effect.sync(() => element.append(node))),
      Match.when(isSignal, (signal) =>
        Option.match(owner.reactiveRuntime, {
          onNone: () =>
            Effect.fail(
              new ConstructionError({
                message: "Reactive children require a live issuing context",
              }),
            ),
          onSome: (runtime) =>
            Effect.gen(function* () {
              const input: Signal<unknown> = signal;
              const value = yield* input.get.pipe(
                Effect.mapError((error) => new ConstructionError({ message: error.message })),
              );
              yield* Match.value(typeof value === "string").pipe(
                Match.when(true, () =>
                  reactiveText({ runtime, signal }).pipe(
                    Effect.mapError((error) => new ConstructionError({ message: error.message })),
                    Effect.map((node) => element.append(node)),
                  ),
                ),
                Match.when(false, () =>
                  selectedRegion({ signal, issuer: owner }).pipe(
                    Effect.map((region) => {
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
        return Effect.sync(() => {
          element.append(region.start, region.end);
          regions.push(region);
        });
      }),
    );
  }
  constructedRegions.set(element, regions);

  for (const write of propertyWrites) yield* write.pipe(Effect.mapError(constructionFailure));
  propertyWrites.length = 0;

  return element;
});

/** Construction stays lazy until its Effect is evaluated by the issuing context. */
export const construct =
  (owner: ConstructionOwner): Construct =>
  (tag, options = {}) =>
    constructElement(owner, tag, options);
