import { Effect, Match, Option, Result } from "effect";
import { planBranch, sameBranch, unchangedBranch, type Cases } from "./branch";
import { component, type Component } from "./component";
import type { Region } from "./construction";
import { makeLens } from "./reactive/lens";
import type { ReactiveError, ReactiveRuntime } from "./reactive/runtime";
import { makeCell, readonlySignal, signalData } from "./reactive/signal";
import { lazy } from "./synchronous";
import * as Sync from "./sync";

interface BranchOwner {
  readonly active: boolean;
  readonly bindingCleanups: Set<() => void>;
  readonly reactiveRuntime: Option.Option<ReactiveRuntime>;
}
/** A structural plan retires descendants before any narrowed derivation is prepared. */
export const activateCases = <O extends BranchOwner>(options: {
  region: Region;
  description: Cases<unknown>;
  lifetime: O;
  hooks: {
    createOwner: (options: {
      lifetime: O;
      row: Option.Option<never>;
    }) => Effect.Effect<{ owner: O; runtime: ReactiveRuntime }>;
    retire: (owner: O) => void;
    activate: (options: {
      lifetime: O;
      region: Region;
      definition: Component<unknown>;
      onOccurrenceFailure: () => void;
    }) => Effect.Effect<unknown>;
  };
}): Effect.Effect<void, ReactiveError> =>
  Effect.gen(function* () {
    const { region, description, hooks } = options;
    region.activated = true;
    const { owner: controller, runtime } = yield* hooks.createOwner({
      lifetime: options.lifetime,
      row: Option.none(),
    });
    const source = signalData(description.state);
    let current = Option.none<O>();
    let desired = yield* lazy(() => planBranch({ description, value: source.committed() }));
    const plan = readonlySignal(
      makeCell({
        runtime,
        initial: desired,
        structural: true,
        dependencies: [source.participant],
        compute: Option.some((transaction) =>
          source
            .candidate(transaction)
            .pipe(Result.flatMap((value) => planBranch({ description, value }))),
        ),
        equals: unchangedBranch,
        onPrepare: ({ transaction, proposed }) =>
          Match.value(!sameBranch({ previous: desired, proposed })).pipe(
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
    const start = () =>
      Effect.gen(function* () {
        const identity = desired;
        const { owner, runtime: inputsRuntime } = yield* hooks.createOwner({
          lifetime: controller,
          row: Option.none(),
        });
        current = Option.some(owner);
        yield* hooks.activate({
          lifetime: owner,
          region,
          definition: component((context) =>
            Sync.gen(function* () {
              const state = yield* Sync.fromResultLazy(() =>
                makeLens({
                  runtime: inputsRuntime,
                  source: description.state,
                  project: (value) => value as typeof identity.value,
                  valid: ({ value, transaction }) =>
                    Option.match(
                      Option.filter(transaction, (tx) => tx.phase._tag === "Staging"),
                      {
                        onNone: () =>
                          sameBranch({
                            previous: identity,
                            proposed: signalData(plan).committed(),
                          }),
                        onSome: () =>
                          Result.match(planBranch({ description, value }), {
                            onFailure: () => false,
                            onSuccess: (proposed) => sameBranch({ previous: identity, proposed }),
                          }),
                      },
                    ),
                  replace: ({ value }) => {
                    Match.value(value._tag === identity.tag).pipe(
                      Match.when(true, () => {}),
                      Match.when(false, () => {
                        throw new TypeError("A narrowed setter cannot change its variant tag");
                      }),
                      Match.exhaustive,
                    );
                    return value;
                  },
                }),
              );
              return yield* identity.descriptor.factory({ context, inputs: { state } });
            }),
          ),
          onOccurrenceFailure: () => {
            hooks.retire(owner);
            Match.value(Option.contains(current, owner)).pipe(
              Match.when(true, () => {
                current = Option.none();
              }),
              Match.orElse(() => {}),
            );
          },
        });
      });
    controller.bindingCleanups.add(
      signalData(plan).bind({
        validate: () => Result.succeed(undefined),
        flush: () =>
          Effect.gen(function* () {
            const proposed = signalData(plan).committed();
            const retained = sameBranch({ previous: desired, proposed });
            desired = proposed;
            yield* Match.value(retained).pipe(
              Match.when(true, () => Effect.void),
              Match.when(false, () =>
                Effect.gen(function* () {
                  Option.match(current, { onNone: () => {}, onSome: hooks.retire });
                  current = Option.none();
                  yield* start();
                }),
              ),
              Match.exhaustive,
            );
          }),
      }),
    );
    yield* start();
  });
