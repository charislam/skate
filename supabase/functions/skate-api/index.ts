import { Context, Effect } from "effect";
import { makeHandler } from "./app.ts";

const handler = await Effect.runPromise(makeHandler);
Deno.serve((request) => handler.handler(request, Context.empty())).finished
  .finally(() => handler.dispose());
