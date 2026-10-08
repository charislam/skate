import { Effect, Option } from "effect";
import { component } from "./framework";
import * as Sync from "./sync-public";

export const Home = component(() =>
  Sync.succeed({
    setup: ({ he }) =>
      Effect.gen(function* () {
        return yield* he("main", {
          attrs: { class: Option.some("home-page") },
          children: [
            yield* he("hgroup", {
              children: [
                yield* he("h1", { children: ["frappé"] }),
                yield* he("p", { children: ["Effect-based FRP for the frontend"] }),
              ],
            }),
          ],
        });
      }),
  }),
);
