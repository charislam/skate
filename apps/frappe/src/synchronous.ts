import { Effect, type Result } from "effect";

/** Keep Result-based operations lazy at Effect helper boundaries. */
export const lazy = <A, E>(work: () => Result.Result<A, E>): Effect.Effect<A, E> =>
  Effect.suspend(() => Effect.fromResult(work()));
