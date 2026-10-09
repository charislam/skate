import {
  Cause,
  Context as EffectContext,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Match,
  Option,
  Result,
  Scope,
  Stream,
} from "effect";
import { isCases } from "./branch";
import { activateCases } from "./branch-runtime";
import { isComponent, subtreeContext, type Component, type Lifecycle } from "./component";
import {
  casesRegionSync,
  checkStructure,
  construct,
  constructSync,
  inspectSync,
  keyedRegionSync,
  selectedRegionSync,
  validateSelectionSync,
  validateSync,
  type SyncConstruct,
  ConstructionError,
  inspect,
  importNative,
  importNativeSync,
  type ImportNative,
  type SyncImportNative,
  makeRegion,
  reserve,
  validate,
  type Construct,
  type MountItem,
  type Region,
  type Tree,
} from "./construction";
import type { Identifier as ContextIdentifier } from "./context";
import { capturedWork } from "./deferred-context";
import { isKeyedList } from "./keyed";
import { activateKeyed, type RowContext } from "./keyed-runtime";
import { isElementOutput, nativeNode, nativeTarget, type MountTarget } from "./output";
import {
  makeReactiveRuntime,
  reactive,
  stopReactiveRuntime,
  type Equality,
  type EventStream,
  type ReactiveContext,
  type ReactiveError,
  type ReactiveRuntime,
} from "./reactive";
import { synchronousReactive, type SynchronousReactiveContext } from "./reactive/context";
import { activateReactiveNode } from "./reactive/dom";
import { registerOwner } from "./reactive/owner";
import { CurrentTransaction, requireValidSync } from "./reactive/runtime";
import { isSignal, makeCell, readonlySignal, signalData, type Signal } from "./reactive/signal";
import type { OutputRequirements, Structural } from "./requirements";
import type { Identifier as ResourceIdentifier } from "./resource";
import { fromResultLazy, toEffect, withContext, type Sync } from "./sync";
import { lazy } from "./synchronous";

export { branch, cases, type Branch, type Cases } from "./branch";
export { browserHistory } from "./browser-history";
export { component, provideContext, type Component, type Lifecycle } from "./component";
export { ConstructionError } from "./construction";
export type {
  Child,
  Construct,
  SyncConstruct,
  ElementOptions,
  ElementProperties,
  MountItem,
  NativeProperties,
} from "./construction";
export * as Context from "./context";
export { focus } from "./focus";
export {
  History,
  HistoryError,
  memoryHistory,
  type HistoryAdapter,
  type MemoryHistory,
} from "./history";
export { keyed, row, type Key, type KeyedList, type Row, type RowInputs } from "./keyed";
export {
  NavigationError,
  navigator,
  type NavigationDecision,
  type NavigationEvent,
  type Navigator,
} from "./navigation";
export { nativeNode, type ElementOutput } from "./output";
export { occurrenceId } from "./occurrence";
export * as Popover from "./popover";
export * as Positioning from "./positioning";
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
export type { ElementBinding } from "./reactive/bind";
export type { DomEventTarget, DomEventMap, DomEvent, DomEventOptions } from "./reactive/events";
export { readonlySignal } from "./reactive/signal";
export type { WatchOptions } from "./reactive/watch";
export * as Resource from "./resource";
export {
  arrayQuery,
  defaultQuery,
  optionalQuery,
  parameter,
  remaining,
  requiredQuery,
  router,
  route,
  type Destination,
  type ParseResult,
  type Prefix,
  type Router,
  UrlBuildError,
} from "./routes";
export { link } from "./router-link";
export * as Sync from "./sync-public";

export type Output<R = never> = MountItem<R> | ReadonlyArray<MountItem<R>>;
export interface SynchronousContext extends SynchronousReactiveContext {
  readonly h: <C extends Output<unknown>>(
    parent: MountTarget,
    content: C,
  ) => Sync<void, ConstructionError | ReactiveError, Structural<OutputRequirements<C>>>;
  readonly he: SyncConstruct;
  readonly importNative: SyncImportNative;
  readonly addFinalizer: <R>(
    finalizer: Effect.Effect<unknown, never, R>,
  ) => Sync<void, ReactiveError, Exclude<R, Scope.Scope>>;
  readonly addSyncFinalizer: (finalizer: () => undefined) => Sync<void, ReactiveError>;
  readonly fork: <A, E, R>(
    work: Effect.Effect<A, E, R>,
  ) => Sync<void, ReactiveError, Exclude<R, Scope.Scope>>;
}

export interface OwnerContext extends ReactiveContext {
  readonly h: Mount;
  readonly he: Construct;
  readonly importNative: ImportNative;
  /** Registers asynchronous cleanup without exposing the owning scope. */
  readonly addFinalizer: <R>(
    finalizer: Effect.Effect<unknown, never, R>,
  ) => Effect.Effect<void, ReactiveError, Exclude<R, Scope.Scope>>;
  /** Runs synchronously, descendants first, while outgoing DOM is still attached. */
  readonly addSyncFinalizer: (finalizer: () => undefined) => Effect.Effect<void, ReactiveError>;
  /** Cancels owned work before DOM finalizers and awaits interruption before resource cleanup. */
  readonly fork: <A, E, R>(
    work: Effect.Effect<A, E, R>,
  ) => Effect.Effect<void, never, Exclude<R, Scope.Scope>>;
}

export interface ComponentContext extends OwnerContext {}
/** Layer.buildWithMemoMap adds this private service; it is not an exported resource. */
type AvailableResources<R extends ResourceIdentifier> = Exclude<R, Layer.CurrentMemoMap>;

export interface ApplicationContext<Resources extends ResourceIdentifier = never> extends Omit<
  OwnerContext,
  "h" | "fork" | "batch" | "subscribe" | "subscribeStream" | "foldStream" | "addFinalizer"
> {
  readonly h: (parent: MountTarget, content: Output<Resources>) => Effect.Effect<void>;
  readonly addFinalizer: <R>(
    finalizer: Effect.Effect<unknown, never, R>,
  ) => Effect.Effect<
    void,
    ReactiveError,
    Exclude<Exclude<R, Scope.Scope>, AvailableResources<Resources>>
  >;
  readonly fork: <A, E, R>(
    work: Effect.Effect<A, E, R>,
  ) => Effect.Effect<void, never, Exclude<Exclude<R, Scope.Scope>, AvailableResources<Resources>>>;
  readonly batch: <A, E, R>(
    work: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | ReactiveError, Exclude<R, AvailableResources<Resources>>>;
  readonly subscribe: <A, E, R>(
    events: EventStream<A>,
    handler: (value: A) => Effect.Effect<unknown, E, R>,
  ) => Effect.Effect<
    void,
    ReactiveError,
    Exclude<Exclude<R, Scope.Scope>, AvailableResources<Resources>>
  >;
  readonly subscribeStream: <A, E, R, EH, RH>(
    stream: Stream.Stream<A, E, R>,
    handler: (value: A) => Effect.Effect<unknown, EH, RH>,
  ) => Effect.Effect<
    void,
    ReactiveError,
    Exclude<Exclude<R | RH, Scope.Scope>, AvailableResources<Resources>>
  >;
  readonly foldStream: <A, B, E, R>(options: {
    stream: Stream.Stream<A, E, R>;
    initial: B;
    reducer: (options: { readonly state: B; readonly event: A }) => B;
    equals?: Equality<B>;
  }) => Effect.Effect<
    Signal<B>,
    ReactiveError,
    Exclude<Exclude<R, Scope.Scope>, AvailableResources<Resources>>
  >;
}

export type Mount = <C extends Output<unknown>>(
  parent: MountTarget,
  content: C,
) => Effect.Effect<void, never, Structural<OutputRequirements<C>>>;

type DomSubject =
  | {
      readonly kind: "replacement";
      readonly id: object;
      readonly items: ReadonlyArray<MountItem<unknown>>;
    }
  | {
      readonly kind: "component";
      readonly id: object;
      readonly component: Component<unknown>;
      readonly region: Region;
      readonly row: Option.Option<RowContext>;
    };

interface FailureDetails {
  readonly operation:
    | "factory"
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
  readonly resources: EffectContext.Context<never>;
  readonly subtreeContext: EffectContext.Context<never>;
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
  pending: Option.Option<Owner>;
  readonly rowContext: Option.Option<RowContext>;
  onOccurrenceFailure: Option.Option<() => void>;
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
  readonly resources?: EffectContext.Context<never>;
  readonly subtreeContext?: EffectContext.Context<never>;
  readonly report: Owner["report"];
  readonly scope?: Scope.Closeable;
  readonly parentOwner?: Owner;
  readonly failureContext?: FailureContext;
  readonly parentRuntime: Option.Option<ReactiveRuntime>;
  readonly rowContext?: RowContext;
}): Owner => ({
  resources: options.resources ?? options.parentOwner?.resources ?? EffectContext.empty(),
  subtreeContext:
    options.subtreeContext ?? options.parentOwner?.subtreeContext ?? EffectContext.empty(),
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
  pending: Option.none(),
  rowContext: Option.orElse(Option.fromUndefinedOr(options.rowContext), () =>
    Option.flatMap(Option.fromUndefinedOr(options.parentOwner), (owner) => owner.rowContext),
  ),
  onOccurrenceFailure: Option.none(),
});

/** Requirements are checked at the public mount boundary; erased owner storage is internal. */
const executionContext = (owner: Owner): EffectContext.Context<unknown> =>
  EffectContext.merge(owner.resources, owner.subtreeContext) as EffectContext.Context<unknown>;

const reactiveParent = (owner: Owner) =>
  Option.orElse(owner.reactiveRuntime, () => owner.parentRuntime);

/** Internal DOM work is finite and runs under the same guard as signal flushes. */
const domCommit = <A, E>(options: {
  owner: Owner;
  work: Effect.Effect<A, E>;
}): Effect.Effect<A, E> =>
  Effect.sync(() => {
    const coordinator = Option.map(reactiveParent(options.owner), (runtime) => runtime.coordinator);
    const previous = Option.map(coordinator, (coordinator) => coordinator.committing);
    Option.match(coordinator, {
      onNone: () => {},
      onSome: (coordinator) => {
        coordinator.committing = true;
      },
    });
    try {
      return Effect.runSyncExit(options.work);
    } finally {
      Option.match(coordinator, {
        onNone: () => {},
        onSome: (coordinator) => {
          coordinator.committing = Option.getOrElse(previous, () => false);
        },
      });
    }
  }).pipe(Effect.flatMap((exit) => exit));

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
  const coordinator = Option.map(reactiveParent(owner), (runtime) => runtime.coordinator);
  const previous = Option.map(coordinator, (coordinator) => coordinator.committing);
  Option.match(coordinator, {
    onNone: () => {},
    onSome: (coordinator) => {
      coordinator.committing = true;
    },
  });
  try {
    deactivate(owner);
    for (const fiber of ownedFibers(owner)) fiber.interruptUnsafe();
    finalizeSync(owner);
    detachOwner(owner);
  } finally {
    Option.match(coordinator, {
      onNone: () => {},
      onSome: (coordinator) => {
        coordinator.committing = Option.getOrElse(previous, () => false);
      },
    });
  }
};

const registerBackground =
  (options: { owner: Owner; scope: Scope.Scope; failureContext: FailureContext }) =>
  (work: Effect.Effect<unknown, unknown, Scope.Scope>): Result.Result<void, ReactiveError> =>
    requireValidSync(options.owner.active, "Reactive runtime has been disposed").pipe(
      Result.map(() => {
        const task = Effect.uninterruptibleMask((restore) =>
          restore(
            Effect.yieldNow.pipe(
              Effect.andThen(
                Effect.suspend(() =>
                  Match.value(options.owner.active).pipe(
                    Match.when(false, () => Effect.void),
                    Match.when(true, () => work.pipe(Scope.provide(options.scope))),
                    Match.exhaustive,
                  ),
                ),
              ),
              Effect.provideService(CurrentTransaction, Option.none()),
            ),
          ).pipe(
            Effect.catchCause((cause) =>
              Match.value(
                Cause.hasInterruptsOnly(cause) ||
                  (!options.owner.active &&
                    cause.reasons.every((failure) =>
                      Match.value(failure).pipe(
                        Match.tag("Interrupt", () => true),
                        Match.tag("Fail", ({ error }) => Cause.isDone(error)),
                        Match.tag("Die", () => false),
                        Match.exhaustive,
                      ),
                    )),
              ).pipe(
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
        const fiber = Effect.runFork(task);
        options.owner.background.add(fiber);
        fiber.addObserver(() => options.owner.background.delete(fiber));
      }),
    );
const background =
  (options: {
    owner: Owner;
    scope: Scope.Scope;
    failureContext: FailureContext;
  }): OwnerContext["fork"] =>
  <A, E, R>(work: Effect.Effect<A, E, R>) =>
    Effect.context<Exclude<R, Scope.Scope>>().pipe(
      Effect.flatMap((context) =>
        lazy(() => registerBackground(options)(capturedWork({ work, context }))).pipe(Effect.orDie),
      ),
    );

const registerSyncFinalizer = (options: {
  owner: Owner;
  finalizer: () => undefined;
}): Result.Result<void, ReactiveError> =>
  requireValidSync(options.owner.active, "Reactive runtime has been disposed").pipe(
    Result.map(() => {
      options.owner.syncFinalizers.push(options.finalizer);
    }),
  );

const registerFinalizer = <R>(options: {
  owner: Owner;
  scope: Scope.Scope;
  finalizer: Effect.Effect<unknown, never, R>;
  context: EffectContext.Context<Exclude<R, Scope.Scope>>;
}) =>
  requireValidSync(options.owner.active, "Component owner has been disposed").pipe(
    Result.map(() =>
      Effect.runSync(
        Scope.addFinalizer(
          options.scope,
          capturedWork({ work: options.finalizer, context: options.context }).pipe(
            Scope.provide(options.scope),
          ),
        ),
      ),
    ),
  );

const synchronousContext = (options: {
  owner: Owner;
  scope: Scope.Scope;
  runtime: ReactiveRuntime;
  failureContext: FailureContext;
}): SynchronousContext =>
  registerOwner<SynchronousContext>(
    {
      ...synchronousReactive(options.runtime),
      h: (parent, content) =>
        fromResultLazy(() => bindSync(options.owner)(nativeTarget(parent), content)),
      he: constructSync(options.owner),
      importNative: importNativeSync(options.owner),
      addFinalizer: <R>(finalizer: Effect.Effect<unknown, never, R>) =>
        withContext((context: EffectContext.Context<Exclude<R, Scope.Scope>>) =>
          registerFinalizer({ ...options, finalizer, context }),
        ),
      fork: (work) =>
        withContext((context) => registerBackground(options)(capturedWork({ work, context }))),
      addSyncFinalizer: (finalizer) =>
        fromResultLazy(() => registerSyncFinalizer({ owner: options.owner, finalizer })),
    },
    options.runtime,
  );

const ownerContext = (options: {
  owner: Owner;
  scope: Scope.Scope;
  runtime: ReactiveRuntime;
  fork: OwnerContext["fork"];
}): OwnerContext =>
  registerOwner<OwnerContext>(
    {
      h: bind(options.owner),
      he: construct(options.owner),
      importNative: importNative(options.owner),
      addFinalizer: <R>(finalizer: Effect.Effect<unknown, never, R>) =>
        Effect.context<Exclude<R, Scope.Scope>>().pipe(
          Effect.flatMap((context) =>
            lazy(() => registerFinalizer({ ...options, finalizer, context })),
          ),
        ),
      addSyncFinalizer: (finalizer) =>
        lazy(() => registerSyncFinalizer({ owner: options.owner, finalizer })),
      fork: options.fork,
      ...reactive(options.runtime),
    },
    options.runtime,
  );

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
  definition: Component<unknown>;
  lifetime: Owner;
  parent: Element;
}) {
  const { region, definition, lifetime, parent } = options;

  region.activated = true;

  const scope = yield* Scope.make();

  const subject: DomSubject = {
    kind: "component",
    id: {},
    component: definition,
    region,
    row: lifetime.rowContext,
  };
  const owner = makeOwner({
    report: lifetime.report,
    parentOwner: lifetime,
    subtreeContext: subtreeContext({ definition, parent: lifetime.subtreeContext }),
    scope,
    failureContext: { parent, subject },
    parentRuntime: reactiveParent(lifetime),
  });

  owner.active = lifetime.active;
  lifetime.children.add(owner);
  const failureContext = { parent, subject };
  const runtime = yield* makeReactiveRuntime({
    active: () => owner.active,
    parent: owner.parentRuntime,
    fork: background({ owner, scope, failureContext }),
    registerWork: registerBackground({ owner, scope, failureContext }),
    report: (failure) => report(owner, { ...failureContext, ...failure }),
  });
  owner.reactiveRuntime = Option.some(runtime);
  return { owner, scope, subject, parent, region, definition, runtime };
});

type AnyLifecycle = Lifecycle<unknown, unknown, unknown, unknown, unknown>;
type Occurrence = Effect.Success<ReturnType<typeof prepareComponent>>;

/** One finite normalization path for imperative mounts, fallback, and setup. */
const describeOutput = (options: { output: Output<unknown>; owner: Owner }) =>
  Result.gen(function* () {
    const items = Match.value(options.output).pipe(
      Match.when(
        (value: Output<unknown>): value is ReadonlyArray<MountItem<unknown>> =>
          Array.isArray(value),
        (values) => [...values],
      ),
      Match.orElse((value) => [value]),
    );
    const roots: Node[] = [];
    const direct: Region[] = [];
    for (const item of items) {
      const nodes = yield* Match.value(item).pipe(
        Match.when(isElementOutput, (output) => Result.succeed([nativeNode(output)])),
        Match.when(isComponent, (definition) => {
          const region = makeRegion({ definition, issuer: options.owner });
          direct.push(region);
          return Result.succeed([region.start, region.end]);
        }),
        Match.when(isCases, (description) =>
          casesRegionSync({ description, issuer: options.owner }).pipe(
            Result.map((region) => {
              direct.push(region);
              return [region.start, region.end];
            }),
          ),
        ),
        Match.when(isKeyedList, (description) =>
          keyedRegionSync({ description, issuer: options.owner }).pipe(
            Result.map((region) => {
              direct.push(region);
              return [region.start, region.end];
            }),
          ),
        ),
        Match.when(isSignal, (signal) =>
          selectedRegionSync({ signal, issuer: options.owner }).pipe(
            Result.map((region) => {
              direct.push(region);
              return [region.start, region.end];
            }),
          ),
        ),
        Match.orElse(() => Result.fail(new ConstructionError({ message: "invalid mount item" }))),
      );
      roots.push(...nodes);
    }
    const tree = yield* inspectSync({
      roots,
      owner: options.owner,
      direct,
      ownedTarget: (node) => options.owner.ownsTarget(node),
    });
    return { tree, direct, items };
  });

const outputTree = (options: { output: Output<unknown>; owner: Owner }) =>
  lazy(() =>
    describeOutput(options).pipe(
      Result.map(({ tree }) => {
        reserve(tree, {});
        return tree;
      }),
    ),
  );

const callbackSync = <A, E>(options: {
  readonly work: () => Sync<A, E, unknown>;
  readonly owner: Owner;
  readonly scope: Scope.Scope;
}): Effect.Effect<A, E> =>
  Effect.suspend(() => toEffect(options.work())).pipe(
    Effect.provide(executionContext(options.owner)),
    Scope.provide(options.scope),
  );

const installFallback = Effect.fn("Budgerigar.installFallback")(function* (
  options: Occurrence & { lifecycle: AnyLifecycle },
) {
  const { owner, region, lifecycle, parent, subject, runtime } = options;
  yield* Option.match(Option.fromUndefinedOr(lifecycle.fallback), {
    onNone: () => Effect.void,
    onSome: (fallback) =>
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        const failureContext = { parent, subject };
        const pending = makeOwner({
          report: owner.report,
          scope,
          parentOwner: owner,
          parentRuntime: Option.some(runtime),
          failureContext,
        });
        owner.children.add(pending);
        owner.pending = Option.some(pending);
        const pendingRuntime = yield* makeReactiveRuntime({
          active: () => pending.active,
          parent: Option.some(runtime),
          fork: background({ owner: pending, scope, failureContext }),
          registerWork: registerBackground({ owner: pending, scope, failureContext }),
          report: (failure) => report(pending, { ...failureContext, ...failure }),
        });
        pending.reactiveRuntime = Option.some(pendingRuntime);
        const output = yield* callbackSync({
          owner: pending,
          scope,
          work: () =>
            fallback(
              synchronousContext({
                owner: pending,
                scope,
                runtime: pendingRuntime,
                failureContext,
              }),
            ),
        });
        const tree = yield* outputTree({ output, owner: pending });
        yield* bindTree({ tree, lifetime: pending });
        for (const node of tree.roots) {
          pending.dom.add(node);
          region.end.parentNode?.insertBefore(node, region.end);
        }
        yield* activateTree({ tree, lifetime: pending, parent });
      }),
  });
});

const startComponent = (options: Occurrence & { lifecycle: AnyLifecycle }): void => {
  const { owner, lifecycle, region, scope, parent, subject, runtime } = options;
  const task = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      yield* Match.value(owner.active).pipe(
        Match.when(true, () => Effect.void),
        Match.when(false, () => Effect.interrupt),
        Match.exhaustive,
      );
      const fork = background({ owner, scope, failureContext: { parent, subject } });
      const exit = yield* restore(
        Effect.suspend(() => lifecycle.setup(ownerContext({ owner, scope, fork, runtime }))).pipe(
          Effect.provide(executionContext(owner)),
          Scope.provide(scope),
        ),
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
                  const tree = yield* outputTree({ output, owner });
                  const roots = tree.roots;
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
                  Option.match(owner.pending, {
                    onNone: () => {},
                    onSome: (pending) => {
                      retireOwner(pending);
                      beginCleanup(pending);
                    },
                  });
                  owner.pending = Option.none();
                  for (const node of owner.dom) node.parentNode?.removeChild(node);
                  owner.dom.clear();
                  for (const node of roots) {
                    owner.dom.add(node);
                    region.end.parentNode?.insertBefore(node, region.end);
                  }
                  yield* activateTree({ tree, lifetime: owner, parent });
                  return tree;
                }).pipe((work) => domCommit({ owner, work }), Effect.exit);
                yield* Exit.match(adoption, {
                  onFailure: (cause) =>
                    failAttempt({ owner, parent, subject, cause, operation: "validation" }),
                  onSuccess: () => Effect.void,
                });
              }),
          }),
        ),
        Match.exhaustive,
      );
    }),
  );

  owner.setup = Option.some(
    Effect.runFork(
      Effect.yieldNow.pipe(
        Effect.andThen(task),
        Effect.provideService(CurrentTransaction, Option.none()),
      ),
    ),
  );
};

const activateComponent = Effect.fn("Budgerigar.activateComponent")(
  function* (options: {
    region: Region;
    definition: Component<unknown>;
    lifetime: Owner;
    parent: Element;
    onOwner?: (owner: Owner) => void;
    onOccurrenceFailure?: () => void;
  }) {
    const occurrence = yield* prepareComponent(options);
    const { owner, parent, subject } = occurrence;
    owner.onOccurrenceFailure = Option.fromUndefinedOr(options.onOccurrenceFailure);
    Option.match(Option.fromUndefinedOr(options.onOwner), {
      onNone: () => {},
      onSome: (ready) => ready(owner),
    });
    const factory = yield* callbackSync({
      owner,
      scope: occurrence.scope,
      work: () =>
        options.definition.factory(
          synchronousContext({ ...occurrence, failureContext: { parent, subject } }),
        ),
    }).pipe(
      Effect.flatMap((lifecycle) =>
        validate(
          typeof lifecycle === "object" &&
            lifecycle !== null &&
            typeof lifecycle.setup === "function" &&
            (lifecycle.fallback === undefined || typeof lifecycle.fallback === "function"),
          "invalid component lifecycle",
        ).pipe(Effect.as(lifecycle)),
      ),
      Effect.exit,
    );
    const lifecycle = yield* Exit.match(factory, {
      onSuccess: (value) => Effect.succeed(Option.some(value)),
      onFailure: (cause) =>
        failAttempt({ owner, parent, subject, cause, operation: "factory" }).pipe(
          Effect.as(Option.none<AnyLifecycle>()),
        ),
    });
    yield* Option.match(lifecycle, {
      onNone: () => Effect.void,
      onSome: (lifecycle) =>
        Effect.gen(function* () {
          const fallback = yield* installFallback({ ...occurrence, lifecycle }).pipe(Effect.exit);
          yield* Exit.match(fallback, {
            onSuccess: () => Effect.void,
            onFailure: (cause) =>
              Match.value(Cause.hasInterruptsOnly(cause)).pipe(
                Match.when(true, () => Effect.void),
                Match.when(false, () =>
                  Effect.sync(() => {
                    Option.match(owner.pending, {
                      onNone: () => {},
                      onSome: (pending) => {
                        retireOwner(pending);
                        beginCleanup(pending);
                      },
                    });
                    owner.pending = Option.none();
                  }).pipe(
                    Effect.andThen(
                      report(owner, { parent, subject, cause, operation: "fallback" }),
                    ),
                  ),
                ),
                Match.exhaustive,
              ),
          });
          startComponent({ ...occurrence, lifecycle });
        }),
    });
    return owner;
  },
  (work, options) => domCommit({ owner: options.lifetime, work }),
);

const sameSelection = (options: {
  left: Option.Option<Component<unknown>>;
  right: Option.Option<Component<unknown>>;
}) =>
  Option.match(options.left, {
    onNone: () => Option.isNone(options.right),
    onSome: (definition) => Option.exists(options.right, (other) => definition === other),
  });

/** Structural controllers and row inputs share the existing owned cleanup tree. */
const createStructuralOwner = Effect.fn("Budgerigar.createStructuralOwner")(function* (options: {
  lifetime: Owner;
  row: Option.Option<RowContext>;
}) {
  const { lifetime, row } = options;
  const failureContext = yield* Option.match(lifetime.failureContext, {
    onSome: Effect.succeed,
    onNone: () => Effect.die("Adopted structural owners require a failure context"),
  });
  const scope = yield* Scope.make();
  const owner = makeOwner({
    report: lifetime.report,
    scope,
    parentOwner: lifetime,
    parentRuntime: reactiveParent(lifetime),
    failureContext,
    ...Option.match(row, {
      onNone: () => ({}),
      onSome: (rowContext) => ({ rowContext }),
    }),
  });
  lifetime.children.add(owner);
  const runtime = yield* makeReactiveRuntime({
    active: () => owner.active,
    parent: owner.parentRuntime,
    fork: background({ owner, scope, failureContext }),
    registerWork: registerBackground({ owner, scope, failureContext }),
    report: (failure) => report(owner, { ...failureContext, ...failure }),
  });
  owner.reactiveRuntime = Option.some(runtime);
  return { owner, runtime };
});

/** The pending view changes in the commit; setup and resource cleanup run afterward. */
const activateSelection = Effect.fn("Budgerigar.activateSelection")(function* (options: {
  region: Region;
  lifetime: Owner;
  parent: Element;
  signal: Signal<unknown>;
}) {
  const { region, lifetime, parent, signal } = options;
  region.activated = true;
  const { owner: controller, runtime } = yield* createStructuralOwner({
    lifetime,
    row: Option.none(),
  });
  let desired = Option.none<Component<unknown>>();
  let current = Option.none<Owner>();
  const source = signalData(signal);
  const initial = yield* lazy(() => validateSelectionSync(source.committed()));
  const plan = readonlySignal(
    makeCell({
      runtime,
      initial,
      dependencies: [source.participant],
      structural: true,
      compute: Option.some((transaction) =>
        source.candidate(transaction).pipe(Result.flatMap(validateSelectionSync)),
      ),
      equals: ({ previous, proposed }) => sameSelection({ left: previous, right: proposed }),
      onPrepare: ({ transaction, proposed }) =>
        Match.value(!sameSelection({ left: desired, right: proposed })).pipe(
          Match.when(true, () =>
            Option.match(current, {
              onNone: () => {},
              onSome: (owner) =>
                Option.match(owner.reactiveRuntime, {
                  onNone: () => {},
                  onSome: (runtime) => transaction.retired.add(runtime.lifetime),
                }),
            }),
          ),
          Match.orElse(() => {}),
        ),
    }),
  );
  const request = (selection: Option.Option<Component<unknown>>) => {
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
  controller.bindingCleanups.add(
    signalData(plan).bind({
      validate: () => Result.succeed(undefined),
      flush: () => Effect.sync(() => request(signalData(plan).committed())),
    }),
  );
  controller.bindingCleanups.add(() => {
    current = Option.none();
  });
  request(initial);
});

const activate = (options: {
  region: Region;
  lifetime: Owner;
  parent: Element;
}): Effect.Effect<void, ReactiveError> =>
  Match.value(options.region.definition).pipe(
    Match.when(isComponent, (definition) =>
      activateComponent({ ...options, definition }).pipe(Effect.asVoid),
    ),
    Match.when(isCases, (description) =>
      activateCases({
        ...options,
        description,
        hooks: {
          createOwner: createStructuralOwner,
          retire: (owner) => {
            retireOwner(owner);
            beginCleanup(owner);
          },
          activate: (branch) => activateComponent({ ...branch, parent: options.parent }),
        },
      }),
    ),
    Match.when(isKeyedList, (description) =>
      activateKeyed({
        ...options,
        description,
        hooks: {
          createOwner: createStructuralOwner,
          retire: (owner) => {
            retireOwner(owner);
            beginCleanup(owner);
          },
          activate: (row) => activateComponent({ ...row, parent: options.parent }),
        },
      }),
    ),
    Match.orElse((signal) => activateSelection({ ...options, signal })),
  );

const failAttempt = Effect.fn("Budgerigar.failAttempt")(
  (options: {
    owner: Owner;
    parent: Element;
    subject: Extract<DomSubject, { kind: "component" }>;
    cause: Cause.Cause<unknown>;
    operation: "factory" | "fallback" | "setup" | "validation";
  }) =>
    Effect.sync(() => {
      retireOwner(options.owner);
      beginCleanup(options.owner);
      const onOccurrenceFailure = options.owner.onOccurrenceFailure;
      options.owner.onOccurrenceFailure = Option.none();
      Option.match(onOccurrenceFailure, { onNone: () => {}, onSome: (notify) => notify() });
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
}) => Effect.Effect<void, ReactiveError> = Effect.fn("Budgerigar.activateTree")(
  function* (options) {
    for (const region of options.tree.regions)
      yield* activate({ region, lifetime: options.lifetime, parent: options.parent });
  },
);

const install = Effect.fn("Budgerigar.install")(
  function* (queue: ParentQueue, request: Request) {
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
  },
  (work, queue) => domCommit({ owner: queue.owner, work }),
  Effect.uninterruptible,
);

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

const bindSync = (owner: Owner) => (parent: Element, content: Output<unknown>) =>
  Result.gen(function* () {
    yield* requireValidSync(owner.active, "Reactive runtime has been disposed");
    const { tree, direct, items } = yield* describeOutput({ owner, output: content });
    yield* validateSync(!tree.nodes.includes(parent), "mount content contains its target");
    const existing = Option.fromUndefinedOr(parents.get(parent));
    yield* validateSync(
      Option.match(existing, { onNone: () => true, onSome: (queue) => queue.owner === owner }),
      "Mount target already belongs to another live owner",
    );
    const subject: Request["subject"] = { kind: "replacement", id: {}, items };
    reserve(tree, subject.id);
    const queue = Option.getOrElse(existing, () => {
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
    queue.pending.push({ subject, tree, direct });
    Option.match(queue.worker, {
      onSome: () => {},
      onNone: () => {
        queue.worker = Option.some(
          Effect.runFork(
            Effect.yieldNow.pipe(
              Effect.andThen(drain(queue)),
              Effect.provideService(CurrentTransaction, Option.none()),
            ),
          ),
        );
      },
    });
  });

const bindWork = (owner: Owner) => (target: MountTarget, content: Output<unknown>) =>
  Effect.sync(() => {
    const parent = nativeTarget(target);
    const output: Output<unknown> = content;
    Match.value(owner.active).pipe(
      Match.when(false, () => {}),
      Match.when(true, () =>
        Result.match(bindSync(owner)(parent, content), {
          onSuccess: () => {},
          onFailure: (error) => {
            Effect.runFork(
              report(owner, {
                parent,
                subject: {
                  kind: "replacement",
                  id: {},
                  items: Match.value(output).pipe(
                    Match.when(
                      (value: Output<unknown>): value is ReadonlyArray<MountItem<unknown>> =>
                        Array.isArray(value),
                      (items) => [...items],
                    ),
                    Match.orElse((item) => [item]),
                  ),
                },
                operation: Match.value(error.message.includes("already belongs")).pipe(
                  Match.when(true, () => "ownership" as const),
                  Match.orElse(() => "validation" as const),
                ),
                cause: Cause.fail(error),
              }),
            );
          },
        }),
      ),
      Match.exhaustive,
    );
  });

const bind = (owner: Owner): Mount => bindWork(owner);

/** Acquires one isolated resource graph before exposing the mount binding. */
const mountResources = <Resources extends ResourceIdentifier, E, Inputs>(options: {
  readonly scope: Scope.Scope;
  readonly onError: (failure: MountFailure) => void;
  readonly resources: Layer.Layer<Resources, E, Inputs>;
}): Effect.Effect<ApplicationContext<Resources>, E, Inputs> =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const resourceScope = yield* Scope.make();
      const scope = yield* Scope.make();
      const failureContext: FailureContext = { subject: { kind: "application", id: {} } };
      const owner = makeOwner({
        report: options.onError,
        failureContext,
        parentRuntime: Option.none(),
      });
      let acquisition: Option.Option<Fiber.Fiber<EffectContext.Context<Resources>, E>> =
        Option.none();
      const close = (exit: Exit.Exit<unknown, unknown>) =>
        Effect.sync(() => retireOwner(owner)).pipe(
          Effect.andThen(
            Effect.withFiber((closingFiber) =>
              Option.match(acquisition, {
                onNone: () => Effect.void,
                onSome: (fiber) =>
                  Match.value(fiber.id === closingFiber.id).pipe(
                    // A layer may close its lexical parent scope during acquisition.
                    // Request self-interruption without awaiting the current fiber.
                    Match.when(true, () =>
                      Effect.sync(() => fiber.interruptUnsafe(closingFiber.id)),
                    ),
                    Match.when(false, () => Fiber.interrupt(fiber).pipe(Effect.asVoid)),
                    Match.exhaustive,
                  ),
              }),
            ),
          ),
          Effect.andThen(disposeOwner(owner)),
          Effect.ensuring(Scope.close(resourceScope, exit)),
        );
      yield* Scope.addFinalizerExit(options.scope, close);
      return yield* Effect.gen(function* () {
        yield* Match.value(owner.active).pipe(
          Match.when(true, () => Effect.void),
          Match.when(false, () => Effect.interrupt),
          Match.exhaustive,
        );
        const memoMap = yield* Layer.makeMemoMap;
        const build = Layer.buildWithMemoMap(options.resources, memoMap, resourceScope);
        const resources = yield* Match.value(Object.is(options.resources, Layer.empty)).pipe(
          Match.when(true, () => build),
          Match.when(false, () =>
            Effect.gen(function* () {
              const fiber = yield* Effect.forkChild(restore(build));
              acquisition = Option.some(fiber);
              return yield* restore(Fiber.join(fiber));
            }),
          ),
          Match.exhaustive,
        );
        // Erased Layer generics cannot expose token metadata. Validate the known
        // key namespaces as a runtime guard; this is not a global token registry.
        yield* Effect.sync(() => {
          for (const key of resources.mapUnsafe.keys()) {
            Match.value(
              key === Layer.CurrentMemoMap.key || key.startsWith("Budgerigar/Resource/"),
            ).pipe(
              Match.when(true, () => {}),
              Match.when(false, () => {
                throw new TypeError(
                  `Budgerigar resource layers cannot export ${key}; use Resource.Service`,
                );
              }),
              Match.exhaustive,
            );
          }
        });
        // buildWithMemoMap adds a private entry disjoint from every branded
        // resource identifier. Removing it preserves the complete Resources set.
        const publicResources = resources.pipe(EffectContext.omit(Layer.CurrentMemoMap));
        const runtimeOwner = makeOwner({
          resources: publicResources,
          report: options.onError,
          scope,
          failureContext,
          parentRuntime: Option.none(),
          parentOwner: owner,
        });
        owner.children.add(runtimeOwner);
        const fork = background({ owner: runtimeOwner, scope, failureContext });
        const runtime = yield* makeReactiveRuntime({
          active: () => runtimeOwner.active,
          parent: Option.none(),
          fork,
          registerWork: registerBackground({ owner: runtimeOwner, scope, failureContext }),
          report: (failure) => report(runtimeOwner, { ...failureContext, ...failure }),
        });
        runtimeOwner.reactiveRuntime = Option.some(runtime);
        yield* Match.value(owner.active).pipe(
          Match.when(true, () => Effect.void),
          Match.when(false, () => Effect.interrupt),
          Match.exhaustive,
        );
        const context = ownerContext({ owner: runtimeOwner, scope, fork, runtime });
        // Capture the caller's actual environment without claiming it supplies
        // any requirements. Explicit local overrides win; only Resources are
        // discharged from the public type, and descendants use their owner tree.
        const supplyResources = <A, E, R>(work: Effect.Effect<A, E, R>) =>
          Effect.context<never>().pipe(
            Effect.flatMap((caller) =>
              work.pipe(Effect.provide(EffectContext.merge(publicResources, caller))),
            ),
          );
        const application: ApplicationContext<Resources> = {
          ...context,
          h: bindWork(runtimeOwner),
          fork: (work) => supplyResources(context.fork(work)),
          batch: (work) => supplyResources(context.batch(work)),
          subscribe: (events, handler) => supplyResources(context.subscribe(events, handler)),
          subscribeStream: (stream, handler) =>
            supplyResources(context.subscribeStream(stream, handler)),
          foldStream: (options) => supplyResources(context.foldStream(options)),
          addFinalizer: (finalizer) => supplyResources(context.addFinalizer(finalizer)),
        };
        return registerOwner(application, runtime);
      }).pipe(
        Effect.onExit((exit) =>
          Exit.match(exit, { onSuccess: () => Effect.void, onFailure: () => close(exit) }),
        ),
      );
    }),
  );

interface MountingOptions {
  readonly scope: Scope.Scope;
  readonly onError: (failure: MountFailure) => void;
}

export function mounting<Resources extends ResourceIdentifier, E, Inputs>(
  options: MountingOptions & {
    readonly resources: Layer.Layer<Resources, E, Inputs> &
      ([
        Extract<
          Inputs,
          ContextIdentifier | Scope.Scope | Layer.CurrentMemoMap | Structural<unknown>
        >,
      ] extends [never]
        ? unknown
        : never);
  },
): Effect.Effect<ApplicationContext<Resources>, E, Inputs>;
export function mounting(
  options: MountingOptions & { readonly resources?: never },
): Effect.Effect<ApplicationContext>;
export function mounting(
  options: MountingOptions & {
    readonly resources?: Layer.Layer<ResourceIdentifier, unknown, unknown>;
  },
) {
  return mountResources({ ...options, resources: options.resources ?? Layer.empty });
}
