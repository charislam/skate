import { Option, Result, type Scope } from "effect";
import type { FactoryLifecycle, Lifecycle } from "./component";
import type { Output, SynchronousContext } from "./framework";
import type { Key } from "./keyed";
import { calculateSync, requireValidSync, ReactiveError } from "./reactive/runtime";
import { type Signal, type WritableSignal } from "./reactive/signal";
import type { Normalize, OutputRequirements } from "./requirements";
import type { Sync } from "./sync";

const BranchTypeId = "~frappe/Branch";
const CasesTypeId = "~frappe/Cases";
export type Variant = { readonly _tag: string };
export interface Branch<
  A extends Variant,
  S extends Signal<A> = WritableSignal<A>,
  out R = never,
  out EF = unknown,
  out ES = unknown,
  out EB = unknown,
> {
  readonly [BranchTypeId]: typeof BranchTypeId;
  readonly requirements?: () => R;
  readonly variant?: () => A;
  readonly factory: (options: {
    context: SynchronousContext;
    inputs: { readonly state: S };
  }) => Sync<Lifecycle<ES, EB, unknown, unknown, unknown>, EF, unknown>;
}
/** Use branch<A, Signal<A>>() for a reusable read-only consumer. */
export const branch =
  <A extends Variant, S extends Signal<A> = WritableSignal<A>>() =>
  <
    EF = never,
    ES = never,
    EB = never,
    RF = never,
    RS = never,
    RB = never,
    OS extends Output<unknown> = never,
    OB extends Output<unknown> = never,
  >(
    factory: (options: {
      context: SynchronousContext;
      inputs: { readonly state: S };
    }) => Sync<FactoryLifecycle<ES, EB, OS, OB, RS, RB>, EF, RF>,
  ): Branch<
    A,
    S,
    Normalize<Exclude<RF | RS | RB, Scope.Scope>> | OutputRequirements<OS | OB>,
    EF,
    ES,
    EB
  > => ({
    [BranchTypeId]: BranchTypeId,
    factory,
  });

type Input<S, A> = S extends { readonly set: (value: never) => unknown }
  ? WritableSignal<A>
  : Signal<A>;
type Table<A extends Variant, S> = {
  readonly [T in A["_tag"]]: {
    readonly branch: Branch<Extract<A, { _tag: T }>, Input<S, Extract<A, { _tag: T }>>, unknown>;
    readonly key?: (value: Extract<A, { _tag: T }>) => Key;
  };
};
type Requirements<T> = T[keyof T] extends infer E
  ? E extends { branch: { requirements?: () => infer R } }
    ? R
    : never
  : never;
export interface Cases<out R = never> {
  readonly [CasesTypeId]: typeof CasesTypeId;
  readonly requirements?: () => R;
  readonly state: Signal<unknown>;
  readonly branches: Readonly<
    Record<
      string,
      {
        readonly branch: Branch<Variant, Signal<Variant>, unknown>;
        readonly key?: (value: Variant) => Key;
      }
    >
  >;
}
type Value<S> = S extends Signal<infer A extends Variant> ? A : never;
export const cases = <S extends Signal<Variant>, const T extends Table<Value<S>, S>>(options: {
  readonly state: S;
  readonly branches: T & Record<Exclude<keyof T, Value<S>["_tag"]>, never>;
}): Cases<Requirements<T>> =>
  ({ ...options, [CasesTypeId]: CasesTypeId }) as unknown as Cases<Requirements<T>>;
export const isCases = (value: unknown): value is Cases<unknown> =>
  typeof value === "object" && value !== null && CasesTypeId in value;
export interface BranchPlan {
  readonly value: Variant;
  readonly tag: string;
  readonly key: Option.Option<Key>;
  readonly descriptor: Branch<Variant, Signal<Variant>, unknown>;
}
export const planBranch = (options: {
  description: Cases<unknown>;
  value: unknown;
}): Result.Result<BranchPlan, ReactiveError> =>
  Result.gen(function* () {
    yield* requireValidSync(
      typeof options.value === "object" &&
        options.value !== null &&
        "_tag" in options.value &&
        typeof options.value._tag === "string",
      "Cases require a tagged union snapshot",
    );
    const value = options.value as Variant;
    const entry = yield* Option.match(
      Option.fromUndefinedOr(options.description.branches[value._tag]),
      {
        onNone: () => Result.fail(new ReactiveError({ message: `Missing branch: ${value._tag}` })),
        onSome: Result.succeed,
      },
    );
    yield* requireValidSync(
      typeof entry === "object" && entry !== null,
      "Cases require branch entries",
    );
    yield* requireValidSync(
      typeof entry.branch === "object" &&
        entry.branch !== null &&
        BranchTypeId in entry.branch &&
        typeof entry.branch.factory === "function",
      "Cases require branch descriptors",
    );
    const key = yield* calculateSync(() =>
      Option.map(Option.fromUndefinedOr(entry.key), (key) => key(value)),
    );
    yield* requireValidSync(
      Option.match(key, {
        onNone: () => true,
        onSome: (key) =>
          typeof key === "string" || (typeof key === "number" && Number.isFinite(key)),
      }),
      "Branch keys must be strings or finite numbers",
    );
    return { value, tag: value._tag, key, descriptor: entry.branch };
  });
export const sameBranch = (options: { previous: BranchPlan; proposed: BranchPlan }): boolean =>
  options.previous.tag === options.proposed.tag &&
  options.previous.descriptor === options.proposed.descriptor &&
  Option.makeEquivalence<Key>((previous, proposed) => previous === proposed)(
    options.previous.key,
    options.proposed.key,
  );
export const unchangedBranch = (options: { previous: BranchPlan; proposed: BranchPlan }): boolean =>
  sameBranch(options) && Object.is(options.previous.value, options.proposed.value);
