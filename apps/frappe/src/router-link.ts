import { Effect, Match, Option } from "effect";
import type { Child, ElementOptions } from "./construction";
import type { SynchronousContext } from "./framework";
import type { Navigator } from "./navigation";
import { nativeNode } from "./output";
import type { Destination, Route, Router } from "./routes";
import { fromResultLazy, gen } from "./sync";

/** Explicit, owner-bound router link. All other anchors retain native behavior. */
export const link = <
  T extends ReadonlyArray<Route>,
  E,
  const C extends ReadonlyArray<Child<unknown>> = readonly [],
>(options: {
  readonly context: SynchronousContext;
  readonly router: Router<T>;
  readonly navigator: Navigator<T, E>;
  readonly destination: Destination<T>;
  readonly children?: C;
  readonly attrs?: ElementOptions<"a">["attrs"];
  readonly props?: Omit<NonNullable<ElementOptions<"a">["props"]>, "href">;
}) =>
  gen(function* () {
    const href = yield* fromResultLazy(() => options.router.build(options.destination));
    const anchor = yield* options.context.he("a", {
      attrs: { ...options.attrs, href: Option.some(href) },
      ...Match.value(options.props).pipe(
        Match.when(
          (props) => props !== undefined,
          (props) => ({ props }),
        ),
        Match.orElse(() => ({})),
      ),
      children: options.children ?? [],
    });
    const node = nativeNode(anchor);

    let intercepted = new WeakSet<Event>();
    const events = yield* options.context.events(anchor, "click", {
      synchronous: (event) => {
        const target = node.getAttribute("target");
        const eligible =
          !event.defaultPrevented &&
          event.button === 0 &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !node.hasAttribute("download") &&
          (target === null || target === "" || target.toLowerCase() === "_self") &&
          new URL(node.href).origin === node.ownerDocument.location.origin;
        Match.value(eligible).pipe(
          Match.when(true, () => {
            event.preventDefault();
            intercepted.add(event);
          }),
          Match.orElse(() => {}),
        );
      },
    });
    yield* options.context.subscribe(events, (event) =>
      Match.value(intercepted.has(event)).pipe(
        Match.when(true, () =>
          options.navigator.navigate(options.destination).pipe(Effect.catch(() => Effect.void)),
        ),
        Match.orElse(() => Effect.void),
      ),
    );

    yield* options.context.addSyncFinalizer(() => {
      intercepted = new WeakSet();
      return undefined;
    });

    return anchor;
  });
