import { Match, Option } from "effect";

export interface Key<I> {
  readonly input: I;
}
/**
 * Effect v4 Equal/Hash already compare records and arrays structurally. Copy and
 * freeze supported inputs before handing them to hash collections, because both
 * equality and hashing cache results and therefore require immutable objects.
 */
export const snapshot = <I>(input: I): Key<I> => {
  const ancestors = new Set<object>();
  const visit = (value: unknown): unknown =>
    Match.value(value).pipe(
      Match.when(
        (v: unknown) =>
          v === null ||
          v === undefined ||
          ["string", "number", "boolean", "bigint"].includes(typeof v),
        (v) => v,
      ),
      Match.when(
        (v: unknown): v is object => typeof v === "object" && v !== null,
        (v): unknown => {
          Match.value(ancestors.has(v)).pipe(
            Match.when(true, () => {
              throw new TypeError("frappé query input contains a cycle");
            }),
            Match.orElse(() => {}),
          );
          ancestors.add(v);
          const result = Match.value(v).pipe(
            Match.when(Option.isOption, (option) =>
              Option.match(option, {
                onNone: () => Option.none(),
                onSome: (a) => Object.freeze(Option.some(visit(a))),
              }),
            ),
            Match.when(Array.isArray, (array) => {
              Match.value(
                Reflect.ownKeys(array).length === array.length + 1 &&
                  Array.from({ length: array.length }, (_, index) => index).every(
                    (index) => "value" in (Object.getOwnPropertyDescriptor(array, index) ?? {}),
                  ),
              ).pipe(
                Match.when(false, () => {
                  throw new TypeError(
                    "frappé query arrays must be dense data arrays without extra properties",
                  );
                }),
                Match.orElse(() => {}),
              );
              return Object.freeze(array.map(visit));
            }),
            Match.when(
              (record) =>
                Object.getPrototypeOf(record) === Object.prototype ||
                Object.getPrototypeOf(record) === null,
              (record) => {
                const keys = Reflect.ownKeys(record);
                Match.value(
                  keys.every(
                    (key) =>
                      typeof key === "string" &&
                      "value" in (Object.getOwnPropertyDescriptor(record, key) ?? {}) &&
                      Object.prototype.propertyIsEnumerable.call(record, key),
                  ),
                ).pipe(
                  Match.when(false, () => {
                    throw new TypeError(
                      "frappé query inputs cannot contain symbols, accessors, or hidden properties",
                    );
                  }),
                  Match.orElse(() => {}),
                );
                return Object.freeze(
                  Object.fromEntries(
                    Object.keys(record).map((name) => [name, visit(Reflect.get(record, name))]),
                  ),
                );
              },
            ),
            Match.orElse(() => {
              throw new TypeError(
                "frappé query input must be a primitive, array, record, or Option; supply canonicalize for opaque values",
              );
            }),
          );
          ancestors.delete(v);
          return result;
        },
      ),
      Match.orElse(() => {
        throw new TypeError("frappé query input cannot contain functions or symbols");
      }),
    );
  // Validation preserves Input's supported structure; only mutability changes.
  return Object.freeze({ input: visit(input) }) as Key<I>;
};
