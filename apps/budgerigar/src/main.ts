import { Cause, Effect, Fiber, Match } from "effect";
import { bootstrap } from "./bootstrap";
import "./style.css";

export const application = Effect.runFork(
  bootstrap((failure) => console.error("Budgerigar mount failed", failure)).pipe(
    Effect.tapCause((cause) =>
      Match.value(Cause.hasInterruptsOnly(cause)).pipe(
        Match.when(true, () => Effect.void),
        Match.when(false, () => Effect.logError("Budgerigar bootstrap failed", cause)),
        Match.exhaustive,
      ),
    ),
  ),
);

import.meta.hot?.dispose(() => {
  Effect.runFork(Fiber.interrupt(application));
});
