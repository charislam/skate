import { Effect, Option } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { describe, expect, test } from "vitest";
import { loadUserTheme, saveUserTheme } from "./theme";

describe("theme persistence", () => {
  test("loads, saves, and removes the raw theme value while preserving other keys", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* KeyValueStore.KeyValueStore;
        const missing = yield* loadUserTheme();
        yield* store.set("unrelated", "keep");
        yield* saveUserTheme(Option.some("dark"));
        const saved = yield* loadUserTheme();
        yield* saveUserTheme(Option.none());
        const removed = yield* loadUserTheme();
        const unrelated = yield* store.get("unrelated");
        return { missing, saved, removed, unrelated };
      }).pipe(Effect.provide(KeyValueStore.layerMemory)),
    );

    expect(result).toEqual({
      missing: Option.none(),
      saved: Option.some("dark"),
      removed: Option.none(),
      unrelated: "keep",
    });
  });

  test("leaves invalid stored values untouched and fails decoding", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* KeyValueStore.KeyValueStore;
        yield* store.set("skate.userTheme", "sepia");
        const decoded = yield* Effect.result(loadUserTheme());
        const stored = yield* store.get("skate.userTheme");
        return { decoded, stored };
      }).pipe(Effect.provide(KeyValueStore.layerMemory)),
    );

    expect(result.decoded._tag).toBe("Failure");
    expect(result.stored).toBe("sepia");
  });
});
