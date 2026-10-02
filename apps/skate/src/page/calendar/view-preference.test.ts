import { Effect, Option } from "effect";
import { KeyValueStore } from "effect/unstable/persistence";
import { describe, expect, test } from "vitest";
import {
  CalendarView,
  loadUserCalendarView,
  saveUserCalendarView,
  userCalendarViewKey,
} from "./view-preference";

describe("calendar view persistence", () => {
  test.each(CalendarView.literals)("round trips %s without changing other keys", async (view) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* KeyValueStore.KeyValueStore;
        expect(yield* loadUserCalendarView()).toEqual(Option.none());

        yield* store.set("skate.userTheme", "dark");
        yield* store.set("unrelated", "keep");
        yield* saveUserCalendarView(view);

        expect(yield* store.get(userCalendarViewKey)).toBe(view);
        expect(yield* loadUserCalendarView()).toEqual(Option.some(view));
        expect(yield* store.get("skate.userTheme")).toBe("dark");
        expect(yield* store.get("unrelated")).toBe("keep");
      }).pipe(Effect.provide(KeyValueStore.layerMemory)),
    );
  });

  test.each(["", "day", "Year", '"Month"'])("rejects %s without rewriting it", async (value) => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* KeyValueStore.KeyValueStore;
        yield* store.set(userCalendarViewKey, value);
        expect((yield* Effect.result(loadUserCalendarView()))._tag).toBe("Failure");
        expect(yield* store.get(userCalendarViewKey)).toBe(value);
      }).pipe(Effect.provide(KeyValueStore.layerMemory)),
    );
  });

  test("exposes read and write failures", async () => {
    const error = new KeyValueStore.KeyValueStoreError({ method: "get", message: "unavailable" });
    const store = KeyValueStore.makeStringOnly({
      get: () => Effect.fail(error),
      set: () => Effect.fail(error),
      remove: () => Effect.fail(error),
      clear: Effect.fail(error),
      size: Effect.fail(error),
    });
    await Effect.runPromise(
      Effect.gen(function* () {
        expect((yield* Effect.result(loadUserCalendarView()))._tag).toBe("Failure");
        expect((yield* Effect.result(saveUserCalendarView("Month")))._tag).toBe("Failure");
      }).pipe(Effect.provideService(KeyValueStore.KeyValueStore, store)),
    );
  });
});
