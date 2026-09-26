import { Effect, Queue, Stream } from "effect";
import { Mount } from "foldkit";
import { Message } from "./message";

export const ObserveLoadMore = Mount.defineStream("ObserveSourcesLoadMore", {
  messages: [Message.ObservedLoadMore],
  execute: ({ element }) =>
    Stream.callback<typeof Message.ObservedLoadMore.Type>((queue) =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const observer = new IntersectionObserver((entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                Queue.offerUnsafe(queue, Message.ObservedLoadMore());
              }
            });
            observer.observe(element);
            return observer;
          }),
          (observer) => Effect.sync(() => observer.disconnect()),
        );
        return yield* Effect.never;
      }),
    ),
});
