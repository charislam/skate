import { Cause, Deferred, Effect, Exit, Fiber, Match, Option, Scope } from "effect";
import { isComponent, type Component } from "./component";
import {
  checkStructure,
  construct,
  inspect,
  isNode,
  makeRegion,
  reserve,
  validate,
  type Construct,
  type MountItem,
  type Region,
  type Tree,
} from "./construction";
import {
  makeReactiveRuntime,
  reactive,
  stopReactiveRuntime,
  type ReactiveContext,
  type ReactiveRuntime,
} from "./reactive";
import { activateReactiveNode } from "./reactive/dom";

export { component, type Component } from "./component";
export { ConstructionError } from "./construction";
export { ReactiveError, mapEvents, mergeEvents } from "./reactive";
export type {
  Signal,
  WritableSignal,
  SignalOptions,
  Equality,
  EventStream,
  EventSource,
  ReactiveContext,
} from "./reactive";
export type {
  Child,
  Construct,
  ElementOptions,
  ElementProperties,
  MountItem,
} from "./construction";

export type Output = Node | ReadonlyArray<Node>;

export interface ComponentContext extends ReactiveContext {
  readonly h: Mount;
  readonly he: Construct;
  readonly scope: Scope.Scope;
  /** Starts owned background work, interrupted before descendant cleanup. */
  readonly fork: (work: Effect.Effect<unknown, unknown, Scope.Scope>) => Effect.Effect<void>;
}

export type Mount = (parent: Element, content: MountItem | ReadonlyArray<MountItem>) => void;

export type MountSubject =
  | { readonly kind: "replacement"; readonly id: object; readonly items: ReadonlyArray<MountItem> }
  | {
      readonly kind: "component";
      readonly id: object;
      readonly component: Component;
      readonly region: Region;
    };

export interface MountFailure {
  readonly operation:
    | "setup"
    | "cleanup"
    | "ownership"
    | "queue"
    | "background"
    | "validation"
    | "reactive"
    | "reactive-dom";
  readonly resource?: object;
  readonly parent: Element;
  readonly subject: MountSubject;
  readonly cause: Cause.Cause<unknown>;
}

interface Owner {
  active: boolean;
  readonly ownsTarget: (node: Node) => boolean;
  disposing: boolean;
  readonly done: Deferred.Deferred<void>;
  readonly queues: Set<ParentQueue>;
  readonly children: Set<Owner>;
  readonly background: Set<Fiber.Fiber<unknown, unknown>>;
  setup: Option.Option<Fiber.Fiber<void, never>>;
  readonly scope: Option.Option<Scope.Closeable>;
  readonly report: (failure: MountFailure) => void;
  readonly failureContext: Option.Option<{ parent: Element; subject: MountSubject }>;
  reactiveRuntime: Option.Option<ReactiveRuntime>;
  readonly parentRuntime: Option.Option<ReactiveRuntime>;
  readonly bindingCleanups: Set<() => void>;
}

interface Request {
  readonly subject: Extract<MountSubject, { kind: "replacement" }>;
  readonly tree: Tree;
}

interface ParentQueue {
  readonly parent: Element;
  readonly owner: Owner;
  readonly pending: Array<Request>;
  current: Option.Option<Owner>;
  worker: Option.Option<Fiber.Fiber<void, never>>;
}
const parents = new WeakMap<Element, ParentQueue>();

const makeOwner = (options: {
  readonly report: Owner["report"];
  readonly scope?: Scope.Closeable;
  readonly failureContext?: { parent: Element; subject: MountSubject };
  readonly parentRuntime: Option.Option<ReactiveRuntime>;
}): Owner => ({
  active: true,
  ownsTarget(node) {
    return node instanceof Element && parents.get(node)?.owner === this;
  },
  disposing: false,
  done: Deferred.makeUnsafe<void>(),
  queues: new Set(),
  children: new Set(),
  background: new Set(),
  setup: Option.none(),
  scope: Option.fromUndefinedOr(options.scope),
  report: options.report,
  failureContext: Option.fromUndefinedOr(options.failureContext),
  reactiveRuntime: Option.none(),
  parentRuntime: options.parentRuntime,
  bindingCleanups: new Set(),
});

const reactiveParent = (owner: Owner) =>
  Option.orElse(owner.reactiveRuntime, () => owner.parentRuntime);

const report = (owner: Owner, failure: MountFailure) =>
  Effect.sync(() => owner.report(failure)).pipe(Effect.catchCause(() => Effect.void));

const deactivate = (owner: Owner): void => {
  owner.active = false;
  Option.match(owner.reactiveRuntime, { onNone: () => {}, onSome: stopReactiveRuntime });
  for (const stop of owner.bindingCleanups) stop();
  owner.bindingCleanups.clear();
  for (const queue of owner.queues) queue.pending.length = 0;
  for (const child of owner.children) deactivate(child);
};

const ownedFibers = (owner: Owner): ReadonlyArray<Fiber.Fiber<unknown, unknown>> => [
  ...owner.background,
  ...Option.toArray(owner.reactiveRuntime).flatMap((reactiveRuntime) => [
    ...reactiveRuntime.lifetime.batchFibers,
  ]),
  ...Option.toArray(owner.setup),
  ...Array.from(owner.queues).flatMap((queue) => Option.toArray(queue.worker)),
  ...Array.from(owner.children).flatMap(ownedFibers),
];

const disposeOwner: (owner: Owner) => Effect.Effect<void> = Effect.fn("Budgerigar.disposeOwner")(
  function* (owner) {
    yield* Match.value(owner.disposing).pipe(
      Match.when(true, () => Deferred.await(owner.done)),
      Match.when(false, () =>
        Effect.gen(function* () {
          owner.disposing = true;
          deactivate(owner);
          yield* Fiber.interruptAll(ownedFibers(owner));

          for (const child of owner.children) yield* disposeOwner(child);
          owner.children.clear();

          for (const queue of owner.queues) {
            queue.parent.replaceChildren();
            parents.delete(queue.parent);
          }

          owner.queues.clear();

          yield* Option.match(owner.scope, {
            onNone: () => Effect.void,
            onSome: (scope) =>
              Scope.close(scope, Exit.void).pipe(
                Effect.catchCause((cause) =>
                  Option.match(owner.failureContext, {
                    onNone: () => Effect.void,
                    onSome: (failureContext) =>
                      report(owner, { ...failureContext, operation: "cleanup", cause }),
                  }),
                ),
              ),
          });

          yield* Deferred.succeed(owner.done, undefined);
        }),
      ),
      Match.exhaustive,
    );
  },
  Effect.uninterruptible,
);

const background =
  (options: {
    owner: Owner;
    scope: Scope.Scope;
    parent: Element;
    subject: MountSubject;
  }): ComponentContext["fork"] =>
  (work) =>
    Effect.gen(function* () {
      yield* Match.value(options.owner.active).pipe(
        Match.when(false, () => Effect.interrupt),
        Match.orElse(() => Effect.void),
      );
      const task = Effect.uninterruptibleMask((restore) =>
        restore(work.pipe(Scope.provide(options.scope))).pipe(
          Effect.catchCause((cause) =>
            Match.value(Cause.hasInterruptsOnly(cause)).pipe(
              Match.when(true, () => Effect.void),
              Match.when(false, () =>
                report(options.owner, {
                  parent: options.parent,
                  subject: options.subject,
                  operation: Match.value(options.owner.active).pipe(
                    Match.when(true, () => "background" as const),
                    Match.orElse(() => "cleanup" as const),
                  ),
                  cause,
                }),
              ),
              Match.exhaustive,
            ),
          ),
        ),
      );
      const fiber = yield* Effect.forkIn(task, options.scope);
      options.owner.background.add(fiber);
      fiber.addObserver(() => options.owner.background.delete(fiber));
    });

const inspectOwned = (options: {
  roots: ReadonlyArray<Node>;
  owner: Owner;
  reservation?: object;
}) =>
  inspect({
    ...options,
    ownedTarget: (node) => options.owner.ownsTarget(node),
  });

const activate = Effect.fn("Budgerigar.activate")(function* (options: {
  region: Region;
  lifetime: Owner;
  parent: Element;
}) {
  const { region, lifetime, parent } = options;

  region.activated = true;

  const scope = yield* Scope.make();

  const subject: MountSubject = { kind: "component", id: {}, component: region.definition, region };
  const owner = makeOwner({
    report: lifetime.report,
    scope,
    failureContext: { parent, subject },
    parentRuntime: reactiveParent(lifetime),
  });

  lifetime.children.add(owner);

  const task = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const fork = background({ owner, scope, parent, subject });
      const stateOwner = yield* makeReactiveRuntime({
        active: () => owner.active,
        parent: owner.parentRuntime,
        fork,
        report: (failure) => report(owner, { parent, subject, ...failure }),
      });
      owner.reactiveRuntime = Option.some(stateOwner);
      const exit = yield* restore(
        Effect.suspend(() =>
          region.definition.setup({
            h: bind(owner),
            he: construct(owner),
            scope,
            fork,
            ...reactive(stateOwner),
          }),
        ).pipe(Scope.provide(scope)),
      ).pipe(Effect.exit);

      owner.setup = Option.none();

      yield* Match.value(owner.active).pipe(
        Match.when(false, () =>
          Exit.match(exit, {
            onSuccess: () => Effect.void,
            onFailure: (cause) =>
              Match.value(Cause.hasInterruptsOnly(cause)).pipe(
                Match.when(true, () => Effect.void),
                Match.when(false, () =>
                  report(owner, { parent, subject, operation: "cleanup", cause }),
                ),
                Match.exhaustive,
              ),
          }),
        ),
        Match.when(true, () =>
          Exit.match(exit, {
            onFailure: (cause) =>
              failAttempt({ owner, parent, subject, cause, operation: "setup" }),
            onSuccess: (output) =>
              Effect.gen(function* () {
                const adoption = yield* Effect.gen(function* () {
                  const roots = Match.value(output).pipe(
                    Match.when(isNode, (node) => [node]),
                    Match.orElse((nodes) => [...nodes]),
                  );
                  const tree = yield* inspectOwned({ roots, owner });
                  reserve(tree, {});

                  yield* validate(
                    region.start.parentNode === region.end.parentNode &&
                      region.end.parentNode !== null,
                    "region boundaries were removed",
                  );

                  yield* bindTree({ tree, lifetime: owner });

                  for (const node of roots) region.end.parentNode?.insertBefore(node, region.end);
                  return tree;
                }).pipe(Effect.exit);
                yield* Exit.match(adoption, {
                  onFailure: (cause) =>
                    failAttempt({ owner, parent, subject, cause, operation: "validation" }),
                  onSuccess: (tree) => activateTree({ tree, lifetime: owner, parent }),
                });
              }),
          }),
        ),
        Match.exhaustive,
      );
    }),
  );

  // Start every invocation immediately; asynchronous completion never holds the queue.
  owner.setup = Option.some(Effect.runFork(task));
});

const failAttempt = Effect.fn("Budgerigar.failAttempt")(function* (options: {
  owner: Owner;
  parent: Element;
  subject: MountSubject;
  cause: Cause.Cause<unknown>;
  operation: "setup" | "validation";
}) {
  yield* disposeOwner(options.owner);
  yield* report(options.owner, {
    parent: options.parent,
    subject: options.subject,
    cause: options.cause,
    operation: options.operation,
  });
});

const bindTree = Effect.fn("Budgerigar.bindTree")((options: { tree: Tree; lifetime: Owner }) =>
  // Adoption must activate the entire tree before another fiber can dispose it.
  Effect.sync(() =>
    Effect.runSyncExit(
      Effect.forEach(
        options.tree.nodes,
        (node) =>
          activateReactiveNode({ node, lifetime: { cleanups: options.lifetime.bindingCleanups } }),
        { discard: true },
      ),
    ),
  ).pipe(Effect.flatMap((exit) => exit)),
);

const activateTree: (options: {
  tree: Tree;
  lifetime: Owner;
  parent: Element;
}) => Effect.Effect<void> = Effect.fn("Budgerigar.activateTree")(function* (options) {
  for (const region of options.tree.regions)
    yield* activate({ region, lifetime: options.lifetime, parent: options.parent });
});

const install = Effect.fn("Budgerigar.install")(function* (queue: ParentQueue, request: Request) {
  const validation = yield* Effect.gen(function* () {
    yield* checkStructure(request.tree);
    yield* validate(
      !request.tree.nodes.includes(queue.parent),
      "mount content contains its target",
    );
    return yield* inspectOwned({
      roots: request.tree.roots,
      owner: queue.owner,
      reservation: request.subject.id,
    });
  }).pipe(Effect.exit);

  yield* Exit.match(validation, {
    onFailure: (cause) =>
      report(queue.owner, {
        parent: queue.parent,
        subject: request.subject,
        operation: "validation",
        cause,
      }),
    onSuccess: (tree) =>
      Effect.gen(function* () {
        yield* Option.match(queue.current, {
          onNone: () => Effect.void,
          onSome: (current) =>
            disposeOwner(current).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  queue.owner.children.delete(current);
                }),
              ),
            ),
        });
        queue.current = Option.none();
        queue.parent.replaceChildren();

        yield* Match.value(queue.owner.active).pipe(
          Match.when(false, () => Effect.void),
          Match.when(true, () =>
            Effect.gen(function* () {
              const lifetime = makeOwner({
                report: queue.owner.report,
                parentRuntime: reactiveParent(queue.owner),
              });
              queue.owner.children.add(lifetime);
              queue.current = Option.some(lifetime);

              const direct: Region[] = [];

              yield* bindTree({ tree, lifetime });

              for (const item of request.subject.items) {
                Match.value(item).pipe(
                  Match.when(isNode, (node) => queue.parent.append(node)),
                  Match.orElse((definition) => {
                    const region = makeRegion({ definition, issuer: queue.owner });
                    queue.parent.append(region.start, region.end);
                    direct.push(region);
                  }),
                );
              }

              yield* activateTree({ tree, lifetime, parent: queue.parent });

              for (const region of direct)
                yield* activate({ region, lifetime, parent: queue.parent });
            }),
          ),
          Match.exhaustive,
        );
      }),
  });
}, Effect.uninterruptible);

const drain = (queue: ParentQueue): Effect.Effect<void> =>
  Effect.gen(function* () {
    while (queue.owner.active && queue.pending.length > 0) {
      yield* Option.match(Option.fromUndefinedOr(queue.pending.shift()), {
        onNone: () => Effect.void,
        onSome: (request) =>
          install(queue, request).pipe(
            Effect.catchCause((cause) =>
              report(queue.owner, {
                parent: queue.parent,
                subject: request.subject,
                operation: "queue",
                cause,
              }),
            ),
          ),
      });
    }
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        queue.worker = Option.none();
      }),
    ),
  );

const bind =
  (owner: Owner): Mount =>
  (parent, content) => {
    Match.value(owner.active).pipe(
      Match.when(false, () => {}),
      Match.when(true, () => {
        const items = Match.value(content).pipe(
          Match.when(
            (value: MountItem | ReadonlyArray<MountItem>): value is ReadonlyArray<MountItem> =>
              Array.isArray(value),
            (values) => [...values],
          ),
          Match.orElse((value) => [value]),
        );

        const subject: Request["subject"] = { kind: "replacement", id: {}, items };

        const submitted = Effect.gen(function* () {
          for (const item of items) {
            yield* validate(isNode(item) || isComponent(item), "invalid mount item");
          }
          const tree = yield* inspectOwned({ roots: items.filter(isNode), owner });
          yield* validate(!tree.nodes.includes(parent), "mount content contains its target");
          reserve(tree, subject.id);
          return tree;
        });

        const exit = Effect.runSyncExit(submitted);
        Exit.match(exit, {
          onFailure: (cause) => {
            Effect.runFork(report(owner, { parent, subject, operation: "validation", cause }));
          },
          onSuccess: (tree) => {
            const queue = Option.getOrElse(Option.fromUndefinedOr(parents.get(parent)), () => {
              const created: ParentQueue = {
                parent,
                owner,
                pending: [],
                current: Option.none(),
                worker: Option.none(),
              };
              parents.set(parent, created);
              owner.queues.add(created);
              return created;
            });
            Match.value(queue.owner === owner).pipe(
              Match.when(false, () => {
                Effect.runFork(
                  report(owner, {
                    parent,
                    subject,
                    operation: "ownership",
                    cause: Cause.die(
                      new Error("Mount target already belongs to another live owner"),
                    ),
                  }),
                );
              }),
              Match.when(true, () => {
                queue.pending.push({ subject, tree });
                Option.match(queue.worker, {
                  onSome: () => {},
                  onNone: () => {
                    queue.worker = Option.some(
                      Effect.runFork(Effect.yieldNow.pipe(Effect.andThen(drain(queue)))),
                    );
                  },
                });
              }),
              Match.exhaustive,
            );
          },
        });
      }),
      Match.exhaustive,
    );
  };

/** Acquires a mount binding whose lifetime is the supplied application scope. */
export const mounting = Effect.fn("Budgerigar.mounting")(function* (options: {
  readonly scope: Scope.Scope;
  readonly onError: (failure: MountFailure) => void;
}) {
  const owner = makeOwner({ report: options.onError, parentRuntime: Option.none() });
  yield* Scope.addFinalizer(options.scope, disposeOwner(owner));
  return bind(owner);
});
