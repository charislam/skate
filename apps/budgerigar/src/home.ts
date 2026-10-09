import { Effect, Option } from "effect";
import { component } from "./framework";
import * as Sync from "./sync-public";

const benefitsSection = component(() =>
  Sync.succeed({
    setup: ({ he }) =>
      Effect.gen(function* () {
        return yield* he("section", {
          attrs: {
            "aria-label": Option.some("Benefits"),
          },
          children: [
            yield* he("ol", {
              children: [
                yield* he("li", { children: ["Signals"] }),
                yield* he("li", { children: ["Fully typed contexts"] }),
              ],
            }),
          ],
        });
      }),
  }),
);

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
                benefitsSection,
              ],
            }),
          ],
        });
      }),
  }),
);
