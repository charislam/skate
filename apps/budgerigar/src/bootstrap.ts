import { Effect, Layer, Option } from "effect";
import { mounting, type MountFailure } from "./framework";
import { AuthLive } from "./auth";
import { Home } from "./home";
import { LocalStorageLive } from "./local-storage";

/** Remains alive until interrupted, then awaits disposal of the application. */
export const bootstrap = Effect.fn("Budgerigar.bootstrap")(function* (
  onError: (failure: MountFailure) => void,
) {
  const root = yield* Option.match(Option.fromNullishOr(document.getElementById("app")), {
    onNone: () =>
      Effect.die(new Error('Budgerigar requires an existing root element with id="app"')),
    onSome: Effect.succeed,
  });
  const scope = yield* Effect.scope;
  const { h } = yield* mounting({
    scope,
    onError,
    resources: Layer.mergeAll(AuthLive, LocalStorageLive),
  });
  yield* h(root, Home);
  yield* Effect.never;
}, Effect.scoped);
