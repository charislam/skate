import { Effect } from "effect";
import { Counter } from "./counter";
import { component } from "./framework";

export const Home = component({
  setup: ({ he }) =>
    Effect.gen(function* () {
      return yield* he("main", {
        children: [
          yield* he("h1", { children: ["Budgerigar"] }),
          yield* he("p", { children: ["Welcome home."] }),
          Counter,
          Counter,
        ],
      });
    }),
});
