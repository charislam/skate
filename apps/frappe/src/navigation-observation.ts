import { Match } from "effect";
import type { HistoryAdapter } from "./history";

/** Queue the initial snapshot before traversals emitted during subscription acquisition. */
export const observeHistory = (options: {
  readonly history: HistoryAdapter;
  readonly enqueue: (location: { readonly observed: string; readonly initial: boolean }) => void;
}) => {
  let acquiring = true;
  const buffered: string[] = [];
  const observation = options.history.observe((observed) =>
    Match.value(acquiring).pipe(
      Match.when(true, () => {
        buffered.push(observed);
      }),
      Match.orElse(() => options.enqueue({ observed, initial: false })),
    ),
  );
  options.enqueue({ observed: observation.initial, initial: true });
  acquiring = false;
  for (const observed of buffered) options.enqueue({ observed, initial: false });
  return observation;
};
