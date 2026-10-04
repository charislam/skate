import { Effect, Match, Option, Schema } from "effect";
import { isComponent, type Component } from "./component";
import {
  isSignal,
  reactiveText,
  validateReactiveNode,
  type Signal,
  type ReactiveRuntime,
} from "./reactive";

export type MountItem = Component | Node;
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

export type ElementProperties<K extends keyof HTMLElementTagNameMap> = Partial<
  Pick<HTMLElementTagNameMap[K], PropertyKeys<HTMLElementTagNameMap[K]>>
>;

export interface ElementOptions<K extends keyof HTMLElementTagNameMap> {
  readonly attrs?: Readonly<Record<string, string | boolean>>;
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
  readonly definition: Component;
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
  definition: Component;
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
  return region;
};

/** Validate the entire forest before moving or consuming any of its nodes. */
export const inspect = Effect.fn("Budgerigar.inspect")(function* (options: {
  readonly roots: ReadonlyArray<Node>;
  readonly owner: ConstructionOwner;
  readonly reservation?: object;
  readonly ownedTarget?: (node: Node) => boolean;
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

  for (const root of options.roots) yield* visit({ node: root, root: true });

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

const forbiddenAttribute = (name: string): boolean =>
  name.toLowerCase().startsWith("on") || name.toLowerCase() === "srcdoc";

const forbiddenProperty = (name: string): boolean =>
  forbiddenAttribute(name) ||
  ["innerhtml", "outerhtml", "textcontent", "innertext", "outertext", "srcdoc"].includes(
    name.toLowerCase(),
  );

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

  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    yield* validate(!forbiddenAttribute(name), `unsupported attribute ${name}`);
    yield* Match.value(value).pipe(
      Match.when(
        (v): v is string => typeof v === "string",
        (v) => Effect.sync(() => element.setAttribute(name, v)),
      ),
      Match.when(true, () => Effect.sync(() => element.setAttribute(name, ""))),
      Match.when(false, () => Effect.void),
      Match.orElse(() => validate(false, `unsupported attribute value for ${name}`)),
    );
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
              new ConstructionError({ message: "Reactive text requires a component owner" }),
            ),
          onSome: (reactiveRuntime) =>
            reactiveText({ runtime: reactiveRuntime, signal }).pipe(
              Effect.mapError((error) => new ConstructionError({ message: error.message })),
              Effect.map((node) => element.append(node)),
            ),
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

  for (const [name, value] of Object.entries(options.props ?? {})) {
    yield* validate(
      !forbiddenProperty(name) &&
        name !== "style" &&
        name in element &&
        typeof Reflect.get(element, name) !== "function",
      `unsupported property ${name}`,
    );
    Reflect.set(element, name, value);
  }
  return element;
});

/** Construction stays lazy until its Effect is evaluated by the issuing context. */
export const construct =
  (owner: ConstructionOwner): Construct =>
  (tag, options = {}) =>
    constructElement(owner, tag, options);
