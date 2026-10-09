import { Effect } from "effect";
import { it, expectTypeOf } from "vitest";
import {
  branch,
  cases,
  focus,
  component,
  Context,
  Resource,
  type ApplicationContext,
  type Cases,
  type Signal,
  type SynchronousContext,
  type WritableSignal,
} from "./framework";
import * as Sync from "./sync-public";

class UserContext extends Context.Service<UserContext, string>()("BranchTypes/User") {}
class Backend extends Resource.Service<Backend, string>()("BranchTypes/Backend") {}

type State =
  | { readonly _tag: "A"; readonly id: number; readonly nested: { readonly count: number } }
  | { readonly _tag: "B"; readonly name: string };
type A = Extract<State, { _tag: "A" }>;
type B = Extract<State, { _tag: "B" }>;
const writableA = branch<A>()(({ context, inputs }) => {
  expectTypeOf(inputs.state).toEqualTypeOf<WritableSignal<A>>();
  inputs.state.update((state) => ({ ...state, id: 2 }));
  // @ts-expect-error Narrowed setters cannot change the tag.
  inputs.state.set({ _tag: "B", name: "bad" });
  focus({ context, source: inputs.state, key: "nested" });
  // @ts-expect-error Allocation requires an explicit owning context.
  focus({ source: inputs.state, key: "nested" });
  // @ts-expect-error Discriminant projection is excluded.
  focus({ context, source: inputs.state, key: "_tag" });
  return Sync.succeed({ setup: () => Effect.succeed([]) });
});
const readonlyA = branch<A, Signal<A>>()(({ context, inputs }) => {
  const projection = focus({ context, source: inputs.state, key: "nested" });
  projection.pipe(
    Sync.map((state) => {
      // @ts-expect-error Read-only projections cannot be written.
      state.set({ count: 1 });
    }),
  );
  // @ts-expect-error Read-only branch inputs cannot be written.
  inputs.state.set({ _tag: "A", id: 1, nested: { count: 0 } });
  return Sync.succeed({ setup: () => Effect.succeed([]) });
});
const readonlyB = branch<B, Signal<B>>()(() => Sync.succeed({ setup: () => Effect.succeed([]) }));
it("preserves capabilities and exhaustive inputs", () => {
  const author = (source: WritableSignal<State>, readOnly: Signal<State>) => {
    cases({
      state: source,
      branches: { A: { branch: writableA, key: (state) => state.id }, B: { branch: readonlyB } },
    });
    cases({ state: readOnly, branches: { A: { branch: readonlyA }, B: { branch: readonlyB } } });
    // @ts-expect-error Incomplete case table.
    cases({ state: source, branches: { A: { branch: writableA } } });
    cases({
      state: source,
      // @ts-expect-error Unknown case.
      branches: { A: { branch: writableA }, B: { branch: readonlyB }, C: { branch: readonlyB } },
    });
    // @ts-expect-error Wrong narrowed input.
    cases({ state: source, branches: { A: { branch: readonlyB }, B: { branch: readonlyB } } });
    // @ts-expect-error Writable descriptors require writable sources.
    cases({ state: readOnly, branches: { A: { branch: writableA }, B: { branch: readonlyB } } });
  };
  void author;
});

it("infers deferred factory/setup/fallback/context/resource requirements", () => {
  const proof = (options: {
    source: WritableSignal<State>;
    app: ApplicationContext;
    context: SynchronousContext;
    target: Element;
  }) => {
    const child = component(() =>
      Sync.gen(function* () {
        yield* Sync.service(UserContext);
        return { setup: () => Effect.succeed([]) };
      }),
    );
    const descriptor = branch<A>()(({ context }) =>
      Sync.gen(function* () {
        yield* Sync.service(UserContext);
        yield* context.fork(
          Effect.gen(function* () {
            yield* Backend;
          }),
        );
        return { fallback: () => Sync.succeed(child), setup: () => Effect.succeed(child) };
      }),
    );
    const output = cases({
      state: options.source,
      branches: { A: { branch: descriptor }, B: { branch: readonlyB } },
    });
    expectTypeOf(output).toEqualTypeOf<Cases<UserContext | Backend>>();
    options.context.he("div", { children: [output] });
    // @ts-expect-error The root provides neither requirement.
    options.app.h(options.target, output);
    const parent = component(() => Sync.succeed({ setup: () => Effect.succeed(output) }));
    // @ts-expect-error Local computation provision does not satisfy deferred output.
    options.app.h(options.target, parent);
  };
  void proof;
});
