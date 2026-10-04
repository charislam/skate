import { Cause, Deferred, Effect, Exit, Fiber, Match, Option, Scope } from "effect";
import { isComponent, type Component } from "./component";
import {
  checkStructure,
  construct,
  inspect,
  isNode,
  makeRegion,
  reserve,
  selectedRegion,
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
  type ReactiveError,
  type ReactiveRuntime,
} from "./reactive";
import { activateReactiveNode } from "./reactive/dom";
import { requireValid } from "./reactive/runtime";
import { isSignal } from "./reactive/signal";

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

export interface OwnerContext extends ReactiveContext {
  readonly h: Mount;
  readonly he: Construct;
  readonly scope: Scope.Scope;
  /** Runs synchronously, descendants first, while outgoing DOM is still attached. */
  readonly addSyncFinalizer: (finalizer: () => undefined) => Effect.Effect<void, ReactiveError>;
  /** Cancels owned work before DOM finalizers and awaits interruption before resource cleanup. */
  readonly fork: (work: Effect.Effect<unknown, unknown, Scope.Scope>) => Effect.Effect<void>;
}

export interface ComponentContext extends OwnerContext {}
export interface ApplicationContext extends OwnerContext {}

export type Mount = (parent: Element, content: MountItem | ReadonlyArray<MountItem>) => void;

type DomSubject =
  | { readonly kind: "replacement"; readonly id: object; readonly items: ReadonlyArray<MountItem> }
  | {
      readonly kind: "component";
      readonly id: object;
      readonly component: Component;
      readonly region: Region;
    };

interface FailureDetails {
  readonly operation:
    | "fallback"
    | "setup"
    | "cleanup"
    | "ownership"
    | "queue"
    | "background"
    | "validation"
    | "reactive"
    | "reactive-dom";
  readonly resource?: object;
  readonly cause: Cause.Cause<unknown>;
}

export type ApplicationSubject = { readonly kind: "application"; readonly id: object };
export type MountSubject = DomSubject | ApplicationSubject;
type DomFailureContext<S extends DomSubject = DomSubject> = S extends DomSubject
  ? { readonly subject: S; readonly parent: Element }
  : never;
type FailureContext = DomFailureContext | { readonly subject: ApplicationSubject };
export type MountFailure = FailureDetails & FailureContext;

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
  readonly failureContext: Option.Option<FailureContext>;
  reactiveRuntime: Option.Option<ReactiveRuntime>;
  readonly parentRuntime: Option.Option<ReactiveRuntime>;
  readonly bindingCleanups: Set<() => void>;
  readonly parentOwner: Option.Option<Owner>;
  readonly dom: Set<Node>;
  readonly syncFinalizers: Array<() => undefined>;
  syncFinalized: boolean;
  cleanup: Option.Option<Fiber.Fiber<void, never>>;
}

interface Request {
  readonly subject: Extract<MountSubject, { kind: "replacement" }>;
  readonly tree: Tree;
  readonly direct: ReadonlyArray<Region>;
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
  readonly parentOwner?: Owner;
  readonly failureContext?: FailureContext;
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
  parentOwner: Option.fromUndefinedOr(options.parentOwner),
  dom: new Set(),
  syncFinalizers: [],
  syncFinalized: false,
  cleanup: Option.none(),
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
          retireOwner(owner);
          yield* Fiber.interruptAll(ownedFibers(owner));

          const children = Array.from(owner.children);
          for (const child of children) beginCleanup(child);
          for (const child of children) yield* awaitCleanup(child);
          owner.children.clear();

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

/** Async cleanup fibers remain retained by the parent until their complete exit. */
const awaitCleanup = (owner: Owner): Effect.Effect<void> =>
  Option.match(owner.cleanup, {
    onNone: () => disposeOwner(owner),
    onSome: (fiber) => Fiber.await(fiber).pipe(Effect.asVoid),
  });

const beginCleanup = (owner: Owner): void =>
  Option.match(owner.cleanup, {
    onSome: () => {},
    onNone: () => {
      const fiber = Effect.runFork(Effect.yieldNow.pipe(Effect.andThen(disposeOwner(owner))));
      owner.cleanup = Option.some(fiber);
      fiber.addObserver(() => {
        owner.cleanup = Option.none();
        Option.match(owner.parentOwner, {
          onNone: () => {},
          onSome: (parent) => parent.children.delete(owner),
        });
      });
    },
  });

const finalizeSync = (owner: Owner): void => {
  for (const child of owner.children) finalizeSync(child);
  Match.value(owner.syncFinalized).pipe(
    Match.when(true, () => {}),
    Match.when(false, () => {
      owner.syncFinalized = true;
      for (const finalizer of owner.syncFinalizers.splice(0).reverse()) {
        const exit = Effect.runSyncExit(Effect.sync(finalizer));
        Exit.match(exit, {
          onSuccess: () => {},
          onFailure: (cause) =>
            Option.match(owner.failureContext, {
              onNone: () => {},
              onSome: (context) => {
                Effect.runSync(report(owner, { ...context, operation: "cleanup", cause }));
              },
            }),
        });
      }
    }),
    Match.exhaustive,
  );
};

const detachOwner = (owner: Owner): void => {
  for (const child of owner.children) detachOwner(child);
  for (const node of owner.dom) node.parentNode?.removeChild(node);
  owner.dom.clear();
  for (const queue of owner.queues) {
    Match.value(parents.get(queue.parent) === queue).pipe(
      Match.when(true, () => {
        queue.parent.replaceChildren();
        parents.delete(queue.parent);
      }),
      Match.orElse(() => {}),
    );
  }
};

/** Finish DOM-dependent work before any node in the outgoing subtree detaches. */
const retireOwner = (owner: Owner): void => {
  deactivate(owner);
  for (const fiber of ownedFibers(owner)) fiber.interruptUnsafe();
  finalizeSync(owner);
  detachOwner(owner);
};

const background =
  (options: {
    owner: Owner;
    scope: Scope.Scope;
    failureContext: FailureContext;
  }): OwnerContext["fork"] =>
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
                  ...options.failureContext,
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

const ownerContext = (options: {
  owner: Owner;
  scope: Scope.Scope;
  runtime: ReactiveRuntime;
  fork: OwnerContext["fork"];
}): OwnerContext => ({
  h: bind(options.owner),
  he: construct(options.owner),
  scope: options.scope,
  addSyncFinalizer: (finalizer) =>
    Effect.suspend(() =>
      requireValid(options.owner.active, "Reactive runtime has been disposed").pipe(
        Effect.andThen(
          Effect.sync(() => {
            options.owner.syncFinalizers.push(finalizer);
          }),
        ),
      ),
    ),
  fork: options.fork,
  ...reactive(options.runtime),
});

const inspectOwned = (options: {
  roots: ReadonlyArray<Node>;
  owner: Owner;
  reservation?: object;
  direct?: ReadonlyArray<Region>;
}) =>
  inspect({
    ...options,
    ownedTarget: (node) => options.owner.ownsTarget(node),
  });

const prepareComponent = Effect.fn("Budgerigar.prepareComponent")(function* (options: {
  region: Region;
  definition: Component;
  lifetime: Owner;
  parent: Element;
}) {
  const { region, definition, lifetime, parent } = options;

  region.activated = true;

  const scope = yield* Scope.make();

  const subject: DomSubject = { kind: "component", id: {}, component: definition, region };
  const owner = makeOwner({
    report: lifetime.report,
    parentOwner: lifetime,
    scope,
    failureContext: { parent, subject },
    parentRuntime: reactiveParent(lifetime),
  });

  owner.active = lifetime.active;
  lifetime.children.add(owner);
  return { owner, scope, subject, parent, region, definition };
});

type Occurrence = Effect.Success<ReturnType<typeof prepareComponent>>;

const installFallback = Effect.fn("Budgerigar.installFallback")(function* (options: {
  owner: Owner;
  definition: Component;
  region: Region;
}) {
  const { owner, region } = options;
  yield* Option.match(Option.fromUndefinedOr(options.definition.fallback), {
    onNone: () => Effect.void,
    onSome: (fallback) =>
      Effect.gen(function* () {
        const output = yield* Effect.sync(fallback);
        yield* Match.value(owner.active).pipe(
          Match.when(true, () => Effect.void),
          Match.when(false, () => Effect.interrupt),
          Match.exhaustive,
        );
        const roots = Match.value(output).pipe(
          Match.when(isNode, (node) => [node]),
          Match.orElse((nodes) => [...nodes]),
        );
        const tree = yield* inspectOwned({ roots, owner });
        yield* validate(tree.regions.length === 0, "fallbacks must contain only native nodes");
        reserve(tree, {});
        for (const node of roots) {
          owner.dom.add(node);
          region.end.parentNode?.insertBefore(node, region.end);
        }
      }),
  });
});

const startComponent = (options: Occurrence & { deferSetup: boolean }): void => {
  const { owner, definition, region, scope, parent, subject } = options;
  const task = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      yield* Match.value(owner.active).pipe(
        Match.when(true, () => Effect.void),
        Match.when(false, () => Effect.interrupt),
        Match.exhaustive,
      );
      const fork = background({ owner, scope, failureContext: { parent, subject } });
      const stateOwner = yield* makeReactiveRuntime({
        active: () => owner.active,
        parent: owner.parentRuntime,
        fork,
        report: (failure) => report(owner, { parent, subject, ...failure }),
      });
      owner.reactiveRuntime = Option.some(stateOwner);
      const exit = yield* restore(
        Effect.suspend(() =>
          definition.setup(ownerContext({ owner, scope, fork, runtime: stateOwner })),
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
                  yield* Match.value(owner.active).pipe(
                    Match.when(true, () => Effect.void),
                    Match.when(false, () => Effect.interrupt),
                    Match.exhaustive,
                  );
                  for (const node of owner.dom) node.parentNode?.removeChild(node);
                  owner.dom.clear();
                  for (const node of roots) {
                    owner.dom.add(node);
                    region.end.parentNode?.insertBefore(node, region.end);
                  }
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

  // Selected setup is deferred past the commit; superseded attempts never run user setup.
  const work = Match.value(options.deferSetup).pipe(
    Match.when(true, () => Effect.yieldNow.pipe(Effect.andThen(task))),
    Match.when(false, () => task),
    Match.exhaustive,
  );
  owner.setup = Option.some(Effect.runFork(work));
};

const activateComponent = Effect.fn("Budgerigar.activateComponent")(function* (options: {
  region: Region;
  definition: Component;
  lifetime: Owner;
  parent: Element;
  onOwner?: (owner: Owner) => void;
  deferSetup?: boolean;
}) {
  const occurrence = yield* prepareComponent(options);
  const { owner, parent, subject } = occurrence;
  Option.match(Option.fromUndefinedOr(options.onOwner), {
    onNone: () => {},
    onSome: (ready) => ready(owner),
  });
  const fallback = yield* installFallback(occurrence).pipe(Effect.exit);
  yield* Exit.match(fallback, {
    onSuccess: () => Effect.void,
    onFailure: (cause) =>
      Match.value(Cause.hasInterruptsOnly(cause)).pipe(
        Match.when(true, () => Effect.void),
        Match.when(false, () =>
          Effect.sync(() => {
            for (const node of owner.dom) node.parentNode?.removeChild(node);
            owner.dom.clear();
          }).pipe(Effect.andThen(report(owner, { parent, subject, cause, operation: "fallback" }))),
        ),
        Match.exhaustive,
      ),
  });
  startComponent({ ...occurrence, deferSetup: options.deferSetup ?? false });
  return owner;
});

const sameSelection = (options: {
  left: Option.Option<Component>;
  right: Option.Option<Component>;
}) =>
  Option.match(options.left, {
    onNone: () => Option.isNone(options.right),
    onSome: (definition) => Option.exists(options.right, (other) => definition === other),
  });

/** The pending view changes in the commit; setup and resource cleanup run afterward. */
const activateSelection = Effect.fn("Budgerigar.activateSelection")(
  (options: { region: Region; lifetime: Owner; parent: Element }) =>
    Effect.sync(() => {
      const { region, lifetime, parent } = options;
      region.activated = true;
      const controller = makeOwner({
        report: lifetime.report,
        parentOwner: lifetime,
        parentRuntime: reactiveParent(lifetime),
      });
      lifetime.children.add(controller);
      let desired = Option.none<Component>();
      let current = Option.none<Owner>();
      const request = (selection: Option.Option<Component>) => {
        Match.value(controller.active && !sameSelection({ left: desired, right: selection })).pipe(
          Match.when(true, () => {
            desired = selection;
            Option.match(current, {
              onNone: () => {},
              onSome: (owner) => {
                retireOwner(owner);
                beginCleanup(owner);
              },
            });
            current = Option.none();
            Option.match(selection, {
              onNone: () => {},
              onSome: (definition) => {
                Effect.runSync(
                  activateComponent({
                    region,
                    definition,
                    lifetime: controller,
                    parent,
                    deferSetup: true,
                    onOwner: (owner) => {
                      current = Option.some(owner);
                    },
                  }),
                );
              },
            });
          }),
          Match.orElse(() => {}),
        );
      };
      region.request = Option.some(request);
      controller.bindingCleanups.add(() => {
        region.request = Option.none();
      });
      request(region.desired);
    }),
);

const activate = (options: {
  region: Region;
  lifetime: Owner;
  parent: Element;
}): Effect.Effect<void> =>
  Match.value(options.region.definition).pipe(
    Match.when(isComponent, (definition) =>
      activateComponent({ ...options, definition }).pipe(Effect.asVoid),
    ),
    Match.orElse(() => activateSelection(options)),
  );

const failAttempt = Effect.fn("Budgerigar.failAttempt")(
  (options: {
    owner: Owner;
    parent: Element;
    subject: Extract<DomSubject, { kind: "component" }>;
    cause: Cause.Cause<unknown>;
    operation: "fallback" | "setup" | "validation";
  }) =>
    Effect.sync(() => {
      retireOwner(options.owner);
      beginCleanup(options.owner);
    }).pipe(
      Effect.andThen(
        Match.value(Cause.hasInterruptsOnly(options.cause)).pipe(
          Match.when(true, () => Effect.void),
          Match.when(false, () =>
            report(options.owner, {
              parent: options.parent,
              subject: options.subject,
              cause: options.cause,
              operation: options.operation,
            }),
          ),
          Match.exhaustive,
        ),
      ),
    ),
);

const bindTree = Effect.fn("Budgerigar.bindTree")((options: { tree: Tree; lifetime: Owner }) =>
  // Adoption must activate the entire tree before another fiber can dispose it.
  Effect.sync(() =>
    Effect.runSyncExit(
      Effect.forEach(
        options.tree.nodes,
        (node) =>
          activateReactiveNode({
            node,
            lifetime: { cleanups: options.lifetime.bindingCleanups },
            report: Option.map(
              options.lifetime.failureContext,
              (context) => (failure) => report(options.lifetime, { ...context, ...failure }),
            ),
          }),
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
      direct: request.direct,
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
        Option.match(queue.current, {
          onNone: () => {},
          onSome: (current) => {
            retireOwner(current);
            beginCleanup(current);
          },
        });
        queue.current = Option.none();
        queue.parent.replaceChildren();

        yield* Match.value(queue.owner.active).pipe(
          Match.when(false, () => Effect.void),
          Match.when(true, () =>
            Effect.gen(function* () {
              const lifetime = makeOwner({
                report: queue.owner.report,
                parentOwner: queue.owner,
                failureContext: { parent: queue.parent, subject: request.subject },
                parentRuntime: reactiveParent(queue.owner),
              });
              queue.owner.children.add(lifetime);
              queue.current = Option.some(lifetime);

              yield* bindTree({ tree, lifetime });
              for (const node of tree.roots) {
                lifetime.dom.add(node);
                queue.parent.append(node);
              }
              yield* activateTree({ tree, lifetime, parent: queue.parent });
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
          const roots: Node[] = [];
          const direct: Region[] = [];
          for (const item of items) {
            yield* Match.value(item).pipe(
              Match.when(isNode, (node) =>
                Effect.sync(() => {
                  roots.push(node);
                }),
              ),
              Match.when(isComponent, (definition) =>
                Effect.sync(() => {
                  const region = makeRegion({ definition, issuer: owner });
                  direct.push(region);
                  roots.push(region.start, region.end);
                }),
              ),
              Match.when(isSignal, (signal) =>
                selectedRegion({ signal, issuer: owner }).pipe(
                  Effect.map((region) => {
                    direct.push(region);
                    roots.push(region.start, region.end);
                  }),
                ),
              ),
              Match.orElse(() => validate(false, "invalid mount item")),
            );
          }
          const tree = yield* inspectOwned({ roots, owner, direct });
          yield* validate(!tree.nodes.includes(parent), "mount content contains its target");
          reserve(tree, subject.id);
          return { tree, direct };
        });

        const exit = Effect.runSyncExit(submitted);
        Exit.match(exit, {
          onFailure: (cause) => {
            Effect.runFork(report(owner, { parent, subject, operation: "validation", cause }));
          },
          onSuccess: ({ tree, direct }) => {
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
                queue.pending.push({ subject, tree, direct });
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
  const scope = yield* Scope.make();
  const failureContext: FailureContext = { subject: { kind: "application", id: {} } };
  const owner = makeOwner({
    report: options.onError,
    scope,
    failureContext,
    parentRuntime: Option.none(),
  });
  yield* Scope.addFinalizer(options.scope, disposeOwner(owner));
  const fork = background({ owner, scope, failureContext });
  const runtime = yield* makeReactiveRuntime({
    active: () => owner.active,
    parent: Option.none(),
    fork,
    report: (failure) => report(owner, { ...failureContext, ...failure }),
  });
  owner.reactiveRuntime = Option.some(runtime);
  return ownerContext({ owner, scope, fork, runtime }) satisfies ApplicationContext;
}, Effect.uninterruptible);
