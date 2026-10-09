import { Effect, Match, Option } from "effect";
import {
  nativeNode,
  Sync,
  type ElementOutput,
  type Signal,
  type SynchronousContext,
} from "./framework";

export interface Options {
  readonly placement: "bottom-end";
  readonly gap: number;
  readonly padding: number;
}

export const geometry = (
  options: Options & {
    readonly anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">;
    readonly width: number;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly height: number;
  },
) => {
  const { anchor, viewport, padding, gap } = options;
  const width = Math.max(0, Math.min(options.width, viewport.width - padding * 2));
  const viewportBottom = Math.max(padding, viewport.height - padding);
  const belowTop = Math.max(padding, Math.min(anchor.bottom + gap, viewportBottom));
  const aboveBottom = Math.max(padding, Math.min(anchor.top - gap, viewportBottom));
  const below = Math.max(0, viewportBottom - belowTop);
  const above = Math.max(0, aboveBottom - padding);
  const flip = options.height > below && above > below;
  const maxHeight = Match.value(flip).pipe(
    Match.when(true, () => above),
    Match.when(false, () => below),
    Match.exhaustive,
  );
  const top = Match.value(flip).pipe(
    Match.when(true, () => Math.max(padding, aboveBottom - Math.min(options.height, maxHeight))),
    Match.when(false, () => belowTop),
    Match.exhaustive,
  );
  return {
    width,
    maxHeight,
    top,
    left: Math.max(padding, Math.min(anchor.right - width, viewport.width - padding - width)),
  };
};

export const attach = (
  options: Options & {
    readonly context: SynchronousContext;
    readonly anchor: ElementOutput<HTMLElement, unknown>;
    readonly floating: ElementOutput<HTMLElement, unknown>;
    readonly isOpen: Signal<boolean>;
  },
) =>
  Sync.gen(function* () {
    const { context } = options;
    yield* context.bind({ element: options.anchor });
    yield* context.bind({ element: options.floating });
    const anchor = nativeNode(options.anchor);
    const floating = nativeNode(options.floating);
    const view = Option.fromNullishOr(anchor.ownerDocument.defaultView);
    let frame: Option.Option<number> = Option.none();
    let active = true;
    let open = false;
    const cancel = () => {
      Option.map(frame, (id) => Option.map(view, (window) => window.cancelAnimationFrame(id)));
      frame = Option.none();
    };
    const schedule = () =>
      Match.value(active && open && Option.isSome(view) && Option.isNone(frame)).pipe(
        Match.when(true, () => {
          frame = Option.map(view, (window) => window.requestAnimationFrame(measure));
        }),
        Match.orElse(() => {}),
      );
    const measure = () => {
      frame = Option.none();
      Match.value(active && open && Option.isSome(view)).pipe(
        Match.when(true, () => {
          Match.value(anchor.isConnected && floating.isConnected && !floating.hidden).pipe(
            Match.when(false, schedule),
            Match.when(true, () =>
              Option.map(view, (window) => {
                const position = geometry({
                  ...options,
                  anchor: anchor.getBoundingClientRect(),
                  width: floating.getBoundingClientRect().width,
                  height: floating.scrollHeight + floating.offsetHeight - floating.clientHeight,
                  viewport: { width: window.innerWidth, height: window.innerHeight },
                });
                Object.assign(floating.style, {
                  position: "fixed",
                  left: `${position.left}px`,
                  top: `${position.top}px`,
                  maxWidth: `${Math.max(0, window.innerWidth - options.padding * 2)}px`,
                  maxHeight: `${position.maxHeight}px`,
                  overflowY: "auto",
                });
              }),
            ),
            Match.exhaustive,
          );
        }),
        Match.orElse(() => {}),
      );
    };
    const observer = view.pipe(
      Option.flatMap((window) => Option.fromNullishOr(window.ResizeObserver)),
      Option.map((Observer) => new Observer(schedule)),
    );
    yield* context.addSyncFinalizer(() => {
      active = false;
      cancel();
      Option.map(observer, (observer) => observer.disconnect());
      return undefined;
    });
    yield* context.watchSync({
      signal: options.isOpen,
      onChange: (value) => {
        open = value;
        cancel();
        schedule();
      },
    });
    floating.style.position = "fixed";
    Option.map(observer, (observer) => {
      observer.observe(anchor);
      observer.observe(floating);
    });
    for (const window of Option.toArray(view)) {
      yield* context.subscribe(
        yield* context.events(window, "resize", { synchronous: schedule }),
        () => Effect.void,
      );
      for (const viewport of Option.toArray(Option.fromNullishOr(window.visualViewport))) {
        yield* context.subscribe(
          yield* context.events(viewport, "resize", { synchronous: schedule }),
          () => Effect.void,
        );
        yield* context.subscribe(
          yield* context.events(viewport, "scroll", { synchronous: schedule }),
          () => Effect.void,
        );
      }
    }
    yield* context.subscribe(
      yield* context.events(anchor.ownerDocument, "scroll", {
        capture: true,
        synchronous: schedule,
      }),
      () => Effect.void,
    );
  });
