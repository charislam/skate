import { Deferred, Effect, Option, Result } from "effect";
import { component, type Signal } from "./framework";

/** Stable child description closes over parent state; its occurrence owns progress. */
const loadingContent = (options: { title: Signal<string>; release: Deferred.Deferred<void> }) =>
  component(({ signal }) =>
    Result.gen(function* () {
      const progress = yield* signal({ initial: "Loading…" });
      return {
        fallback: ({ he, events, subscribe }) =>
          Result.gen(function* () {
            const finish = yield* he("button", { children: ["Finish loading"] });
            yield* subscribe(yield* events(finish, "click"), () =>
              Deferred.succeed(options.release, undefined),
            );
            return yield* he("article", {
              attrs: { class: Option.some("loading-content") },
              children: [
                yield* he("div", {
                  children: [
                    yield* he("h3", { children: [options.title] }),
                    yield* he("p", {
                      attrs: { role: Option.some("status") },
                      children: [progress],
                    }),
                  ],
                }),
                finish,
              ],
            });
          }),
        setup: ({ he }) =>
          Effect.gen(function* () {
            yield* progress.set("Preparing content…");
            yield* Deferred.await(options.release);
            return yield* he("article", {
              attrs: { class: Option.some("loading-content") },
              children: [
                yield* he("div", {
                  children: [
                    yield* he("h3", { children: [options.title] }),
                    yield* he("p", {
                      attrs: { role: Option.some("status") },
                      children: ["Content is ready."],
                    }),
                  ],
                }),
              ],
            });
          }),
      };
    }),
  );

/** An explicit gate makes the loading example deterministic without a network request. */
export const LoadingExample = component(({ signal }) =>
  Result.gen(function* () {
    const title = yield* signal({ initial: "First title" });
    const release = Deferred.makeUnsafe<void>();
    const content = loadingContent({ title, release });
    return {
      setup: ({ he, events, subscribe }) =>
        Effect.gen(function* () {
          const changeTitle = yield* he("button", { children: ["Change title while loading"] });
          yield* subscribe(yield* events(changeTitle, "click"), () => title.set("Updated title"));
          return yield* he("section", {
            attrs: { class: Option.some("loading-example") },
            children: [
              yield* he("h2", { children: ["Reactive loading view"] }),
              changeTitle,
              content,
            ],
          });
        }),
    };
  }),
);
