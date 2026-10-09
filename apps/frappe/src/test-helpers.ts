import { Deferred, Effect, Exit, Match, Scope } from "effect";
import { afterEach } from "vitest";
import { component, mounting, type ComponentContext, type MountFailure } from "./framework";
import { nativeNode, type ElementOutput } from "./output";
import * as Sync from "./sync-public";

const run = Effect.runPromise;
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
export const rendered = (options: { parent: Node; check: () => boolean }): Promise<void> =>
  new Promise((resolve) => {
    const observer = new MutationObserver(() => check());
    const check = () =>
      Match.value(options.check()).pipe(
        Match.when(true, () => {
          observer.disconnect();
          resolve();
        }),
        Match.orElse(() => {}),
      );
    observer.observe(options.parent, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    check();
  });
export const harness = async (options: { onError?: (failure: MountFailure) => void } = {}) => {
  const scope = await run(Scope.make());
  const failures: MountFailure[] = [];
  const { h } = await run(
    mounting({
      scope,
      onError: (failure) => {
        failures.push(failure);
        options.onError?.(failure);
      },
    }),
  );
  const parent = document.createElement("div");
  const ready = Deferred.makeUnsafe<ComponentContext>();
  Effect.runSync(
    h(
      parent,
      component(() =>
        Sync.succeed({
          setup: (ctx) => Deferred.succeed(ready, ctx).pipe(Effect.andThen(ctx.he("main"))),
        }),
      ),
    ),
  );
  const ctx = await run(Deferred.await(ready));
  await rendered({ parent, check: () => parent.querySelector("main") !== null });
  const target = parent.querySelector("main") ?? parent;
  const close = () => run(Scope.close(scope, Exit.void));
  cleanups.push(close);
  const adopt = async (node: ElementOutput<Node>) => {
    Effect.runSync(ctx.h(target, node));
    await rendered({ parent, check: () => target.contains(nativeNode(node)) });
  };
  return { ctx, parent, target, failures, close, adopt, h };
};
