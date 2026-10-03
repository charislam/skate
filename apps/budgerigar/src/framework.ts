import { Cause, Effect, Exit, Fiber, Match, Option, Scope } from "effect";

export type Output = Node | ReadonlyArray<Node>;

export interface ComponentContext {
  readonly h: Mount;
  readonly scope: Scope.Scope;
  /** Starts owned background work, interrupted before descendant cleanup. */
  readonly fork: (work: Effect.Effect<unknown, unknown, Scope.Scope>) => Effect.Effect<void>;
}

export interface Component {
  readonly setup: (context: ComponentContext) => Effect.Effect<Output, unknown, Scope.Scope>;
}

export type Mount = (parent: Element, definition: Component) => void;

export interface MountFailure {
  readonly operation: "setup" | "cleanup" | "ownership" | "queue" | "background";
  readonly parent: Element;
  readonly component: Component;
  readonly cause: Cause.Cause<unknown>;
}

export const component = (definition: Component): Component => definition;

interface Owner {
  active: boolean;
  readonly queues: Set<ParentQueue>;
  readonly background: Set<Fiber.Fiber<unknown, unknown>>;
  readonly report: (failure: MountFailure) => void;
}

interface Instance {
  readonly owner: Owner;
  readonly scope: Scope.Closeable;
  readonly definition: Component;
}

interface ParentQueue {
  readonly parent: Element;
  readonly owner: Owner;
  readonly pending: Array<Component>;
  current: Option.Option<Instance>;
  worker: Option.Option<Fiber.Fiber<void, never>>;
}

const parents = new WeakMap<Element, ParentQueue>();

const makeOwner = (report: Owner["report"]): Owner => ({
  active: true,
  queues: new Set(),
  background: new Set(),
  report,
});

// A reporting callback cannot break lifecycle bookkeeping, even when it throws.
const report = (
  queue: Pick<ParentQueue, "owner" | "parent">,
  failure: Omit<MountFailure, "parent">,
) =>
  Effect.sync(() => queue.owner.report({ ...failure, parent: queue.parent })).pipe(
    Effect.catchCause(() => Effect.void),
  );

const deactivate = (owner: Owner): void => {
  owner.active = false;
  for (const queue of owner.queues) {
    queue.pending.length = 0;
    Option.match(queue.current, {
      onNone: () => {},
      onSome: (instance) => deactivate(instance.owner),
    });
  }
};

// Send cancellation to the entire subtree before awaiting any asynchronous cleanup.
const ownedFibers = (owner: Owner): readonly Fiber.Fiber<unknown, unknown>[] => [
  ...owner.background,
  ...Array.from(owner.queues).flatMap((queue) => [
    ...Option.toArray(queue.worker),
    ...Option.toArray(queue.current).flatMap((instance) => ownedFibers(instance.owner)),
  ]),
];

const disposeOwner: (owner: Owner) => Effect.Effect<void> = Effect.fn("Budgerigar.disposeOwner")(
  function* (owner: Owner) {
    deactivate(owner);
    yield* Fiber.interruptAll(ownedFibers(owner));
    for (const queue of owner.queues) {
      yield* clear(queue);
      parents.delete(queue.parent);
    }
    owner.queues.clear();
  },
);

const clear: (queue: ParentQueue) => Effect.Effect<void> = Effect.fn("Budgerigar.clear")(function* (
  queue: ParentQueue,
) {
  yield* Option.match(queue.current, {
    onNone: () => Effect.void,
    onSome: (instance) =>
      Effect.gen(function* () {
        yield* disposeOwner(instance.owner);
        const exit = yield* Scope.close(instance.scope, Exit.void).pipe(Effect.exit);
        yield* Exit.match(exit, {
          onSuccess: () => Effect.void,
          onFailure: (cause) =>
            report(queue, { operation: "cleanup", component: instance.definition, cause }),
        });
        queue.current = Option.none();
        queue.parent.replaceChildren();
      }),
  });
});

const background =
  (options: {
    readonly owner: Owner;
    readonly queue: ParentQueue;
    readonly scope: Scope.Scope;
    readonly definition: Component;
  }): ComponentContext["fork"] =>
  (work) =>
    Effect.gen(function* () {
      yield* Match.value(options.owner.active).pipe(
        Match.when(false, () => Effect.interrupt),
        Match.when(true, () => Effect.void),
        Match.exhaustive,
      );
      const task = Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const exit = yield* restore(work.pipe(Scope.provide(options.scope))).pipe(Effect.exit);
          yield* Exit.match(exit, {
            onSuccess: () => Effect.void,
            onFailure: (cause) =>
              Match.value(Cause.hasInterruptsOnly(cause)).pipe(
                Match.when(true, () => Effect.void),
                Match.when(false, () =>
                  report(options.queue, {
                    operation: Match.value(options.owner.active).pipe(
                      Match.when(true, () => "background" as const),
                      Match.when(false, () => "cleanup" as const),
                      Match.exhaustive,
                    ),
                    component: options.definition,
                    cause,
                  }),
                ),
                Match.exhaustive,
              ),
          });
        }),
      );
      const fiber = yield* Effect.forkIn(task, options.scope);
      options.owner.background.add(fiber);
      fiber.addObserver(() => {
        options.owner.background.delete(fiber);
      });
    });

const mountOne = Effect.fn("Budgerigar.mountOne")(function* (
  queue: ParentQueue,
  definition: Component,
) {
  yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      yield* clear(queue);
      queue.parent.replaceChildren();
      yield* Match.value(queue.owner.active).pipe(
        Match.when(false, () => Effect.interrupt),
        Match.when(true, () => Effect.void),
        Match.exhaustive,
      );
      const scope = yield* Scope.make();
      const owner = makeOwner(queue.owner.report);
      queue.current = Option.some({ owner, scope, definition });
      const exit = yield* restore(
        Effect.suspend(() =>
          definition.setup({
            h: bind(owner),
            scope,
            fork: background({ owner, queue, scope, definition }),
          }),
        ).pipe(Scope.provide(scope)),
      ).pipe(Effect.exit);
      yield* Exit.match(exit, {
        onSuccess: (output) =>
          Effect.sync(() => {
            Match.value(owner.active && queue.owner.active).pipe(
              Match.when(true, () => {
                const nodes = Match.value(output).pipe(
                  Match.when(
                    (value: Output): value is Node => value instanceof Node,
                    (node) => [node],
                  ),
                  Match.orElse((nodes) => nodes),
                );
                queue.parent.append(...nodes);
              }),
              Match.when(false, () => {}),
              Match.exhaustive,
            );
          }),
        onFailure: (cause) =>
          Effect.gen(function* () {
            yield* clear(queue).pipe(Effect.uninterruptible);
            yield* Match.value(queue.owner.active || !Cause.hasInterruptsOnly(cause)).pipe(
              Match.when(true, () =>
                report(queue, { operation: "setup", component: definition, cause }),
              ),
              Match.when(false, () => Effect.void),
              Match.exhaustive,
            );
          }),
      });
    }),
  );
});

const drain = (queue: ParentQueue): Effect.Effect<void> =>
  Effect.gen(function* () {
    while (queue.owner.active && queue.pending.length > 0) {
      yield* Option.match(Option.fromUndefinedOr(queue.pending.shift()), {
        onNone: () => Effect.void,
        onSome: (definition) =>
          mountOne(queue, definition).pipe(
            Effect.catchCause((cause) =>
              clear(queue).pipe(
                Effect.andThen(report(queue, { operation: "queue", component: definition, cause })),
              ),
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
  (parent, definition) => {
    Match.value(owner.active).pipe(
      Match.when(false, () => {}),
      Match.when(true, () => {
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
              report(
                { owner, parent },
                {
                  operation: "ownership",
                  component: definition,
                  cause: Cause.die(new Error("Mount target already belongs to another live owner")),
                },
              ),
            );
          }),
          Match.when(true, () => {
            queue.pending.push(definition);
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
      }),
      Match.exhaustive,
    );
  };

/** Acquires a mount binding whose lifetime is the supplied application scope. */
export const mounting = Effect.fn("Budgerigar.mounting")(function* (options: {
  readonly scope: Scope.Scope;
  readonly onError: (failure: MountFailure) => void;
}) {
  const owner = makeOwner(options.onError);
  yield* Scope.addFinalizer(options.scope, disposeOwner(owner));
  return bind(owner);
});
