import { Effect, Layer, Option } from "effect";
import { Resource } from "./framework";

export class LocalStorage extends Resource.Service<
  LocalStorage,
  {
    readonly get: (key: string) => Effect.Effect<Option.Option<string>>;
    readonly set: (entry: { readonly key: string; readonly value: string }) => Effect.Effect<void>;
  }
>()("frappe/LocalStorage") {}

export const LocalStorageLive = Layer.effect(
  LocalStorage,
  Effect.sync(() =>
    LocalStorage.of({
      get: (key) => Effect.sync(() => Option.fromNullishOr(window.localStorage.getItem(key))),
      set: ({ key, value }) => Effect.sync(() => window.localStorage.setItem(key, value)),
    }),
  ),
);

/** Each acquisition owns its own memory, even when the layer description is reused. */
export const LocalStorageMemory = Layer.effect(
  LocalStorage,
  Effect.sync(() => {
    const entries = new Map<string, string>();
    return LocalStorage.of({
      get: (key) => Effect.sync(() => Option.fromUndefinedOr(entries.get(key))),
      set: ({ key, value }) =>
        Effect.sync(() => {
          entries.set(key, value);
        }),
    });
  }),
);
