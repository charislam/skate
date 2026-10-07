import { Match, Option, Result, type Scope } from "effect";
import type { FactoryLifecycle } from "./component";
import type { Lifecycle, Output, SynchronousContext } from "./framework";
import { calculateSync, requireValidSync, ReactiveError } from "./reactive/runtime";
import type { Signal } from "./reactive/signal";
import type { Normalize, OutputRequirements } from "./requirements";
import type { Sync } from "./sync";

const RowTypeId = "~budgerigar/Row";
const ListTypeId = "~budgerigar/KeyedList";

export type Key = string | number;
export interface RowInputs<A> {
  readonly key: Key;
  readonly item: Signal<A>;
  readonly index: Signal<number>;
}
export interface Row<A, R = never, EFactory = unknown, ESetup = unknown, EFallback = unknown> {
  readonly [RowTypeId]: typeof RowTypeId;
  readonly requirements?: () => R;
  factory(options: {
    readonly context: SynchronousContext;
    readonly inputs: RowInputs<A>;
  }): Sync<Lifecycle<ESetup, EFallback, unknown, unknown, unknown>, EFactory, unknown>;
}

/** Specify the item type first, then infer every lifecycle requirement and error. */
export const row =
  <A>() =>
  <
    EF = never,
    ES = never,
    EP = never,
    RF = never,
    RS = never,
    RB = never,
    OS extends Output<unknown> = never,
    OB extends Output<unknown> = never,
  >(
    factory: (options: {
      readonly context: SynchronousContext;
      readonly inputs: RowInputs<A>;
    }) => Sync<FactoryLifecycle<ES, EP, OS, OB, RS, RB>, EF, RF>,
  ): Row<
    A,
    Normalize<Exclude<RF | RS | RB, Scope.Scope>> | OutputRequirements<OS | OB>,
    EF,
    ES,
    EP
  > => ({
    [RowTypeId]: RowTypeId,
    factory,
  });

export interface KeyedList<A = unknown, R = never> {
  readonly [ListTypeId]: typeof ListTypeId;
  readonly requirements?: () => R;
  readonly items: Signal<ReadonlyArray<A>>;
  key(item: A): Key;
  row(item: A): Row<A, unknown>;
}

type RowRequirements<D> = D extends Row<infer _A, infer R> ? R : never;

export const keyed = <A, D extends Row<A, unknown>>(options: {
  readonly items: Signal<ReadonlyArray<A>>;
  readonly key: (item: A) => Key;
  readonly row: (item: A) => D;
}): KeyedList<A, RowRequirements<D>> => ({ ...options, [ListTypeId]: ListTypeId });

export const isKeyedList = (value: unknown): value is KeyedList<unknown, unknown> =>
  typeof value === "object" && value !== null && ListTypeId in value;

const isRow = (value: unknown): value is Row<unknown, unknown> =>
  typeof value === "object" &&
  value !== null &&
  Reflect.get(value, RowTypeId) === RowTypeId &&
  typeof Reflect.get(value, "factory") === "function";

export interface KeyedEntry {
  readonly key: Key;
  readonly item: unknown;
  readonly index: number;
  readonly descriptor: Row<unknown, unknown>;
}

export interface KeyedPlan {
  readonly entries: ReadonlyArray<KeyedEntry>;
  readonly byKey: ReadonlyMap<Key, KeyedEntry>;
}

export const planKeyed = (options: {
  readonly description: KeyedList<unknown, unknown>;
  readonly value: unknown;
}): Result.Result<KeyedPlan, ReactiveError> =>
  Result.gen(function* () {
    const snapshot = yield* Match.value(options.value).pipe(
      Match.when(
        (value: unknown): value is ReadonlyArray<unknown> => Array.isArray(value),
        (value) => Result.succeed(value),
      ),
      Match.orElse(() =>
        Result.fail(new ReactiveError({ message: "Keyed lists require array snapshots" })),
      ),
    );
    const values = yield* calculateSync(() => [...snapshot]);

    const entries: KeyedEntry[] = [];
    const byKey = new Map<Key, KeyedEntry>();

    for (const [index, item] of values.entries()) {
      const key = yield* calculateSync(() => options.description.key(item));
      yield* requireValidSync(
        typeof key === "string" || (typeof key === "number" && Number.isFinite(key)),
        "Keys must be strings or finite numbers",
      );
      yield* requireValidSync(!byKey.has(key), `Duplicate list key: ${String(key)}`);
      const descriptor = yield* calculateSync(() => options.description.row(item));
      yield* requireValidSync(isRow(descriptor), "Row selectors must return a row descriptor");
      const entry = { key, item, index, descriptor };
      entries.push(entry);
      byKey.set(key, entry);
    }

    return { entries, byKey };
  });

export const sameRow = (options: { previous: KeyedEntry; proposed: KeyedEntry }): boolean =>
  options.previous.descriptor === options.proposed.descriptor;

export const unchangedPlan = (options: { previous: KeyedPlan; proposed: KeyedPlan }): boolean =>
  options.previous.entries.length === options.proposed.entries.length &&
  options.previous.entries.every((previous, index) =>
    Option.exists(
      Option.fromUndefinedOr(options.proposed.entries[index]),
      (proposed) =>
        previous.key === proposed.key &&
        sameRow({ previous, proposed }) &&
        Object.is(previous.item, proposed.item),
    ),
  );
