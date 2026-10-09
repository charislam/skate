import { Effect, Option } from "effect";
import type { SynchronousContext } from "~/framework";
import { link } from "~/router-link";
import * as Sync from "~/sync";
import { Navigation } from "./context";
import { urls, type Destination } from "./routes";

export const button = <A, E, R>(
  context: SynchronousContext,
  options: { readonly label: string; readonly action: Effect.Effect<A, E, R> },
) =>
  Sync.gen(function* () {
    const node = yield* context.he("button", {
      props: { type: "button" },
      children: [options.label],
    });
    yield* context.subscribe(yield* context.events(node, "click"), () => options.action);
    return node;
  });

export const routeLink = (
  context: SynchronousContext,
  options: { readonly label: string; readonly destination: Destination },
) =>
  Sync.gen(function* () {
    const navigator = yield* Sync.service(Navigation);
    return yield* link({
      context,
      router: urls,
      navigator,
      destination: options.destination,
      children: [options.label],
    });
  });

export const counter = (context: SynchronousContext, label: string) =>
  Sync.gen(function* () {
    const count = yield* context.signal({ initial: 0 });
    const display = yield* context.derive({
      sources: { count },
      compute: ({ count }) => `${label}: ${count}`,
    });
    return yield* context.he("div", {
      attrs: { class: Option.some("routing-counter") },
      children: [
        yield* context.he("output", { children: [display] }),
        yield* button(context, { label: `Increment ${label}`, action: count.update((n) => n + 1) }),
      ],
    });
  });

export const message = (context: SynchronousContext, text: string) =>
  context.he("p", { attrs: { role: Option.some("status") }, children: [text] });
