import { Effect, Layer, Option } from "effect";
import { mounting, type MountFailure } from "./framework";
import { AuthLive } from "./auth";
import { browserHistory } from "./browser-history";
import { History } from "./history";
import { Home } from "./home";
import { LocalStorageLive } from "./local-storage";
import { RoutingDemo } from "./routing-demo/app";
import { mockResources } from "./routing-demo/resources";

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
    resources: Layer.mergeAll(
      AuthLive,
      LocalStorageLive,
      mockResources,
      Layer.effect(History, browserHistory(window)),
    ),
  });
  yield* h(root, [RoutingDemo, Home]);
  yield* Effect.never;
}, Effect.scoped);
