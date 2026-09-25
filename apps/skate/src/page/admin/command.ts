import { Effect, Schema } from "effect";
import { Command as FoldkitCommand } from "foldkit";
import { Auth } from "../../domain/auth";
import { Message } from "./message";
import { UserId } from "../../domain/session";

export const FetchAdminAccess = FoldkitCommand.define("FetchAdminAccess", {
  args: { userId: UserId, requestId: Schema.Number },
  messages: [Message.SettledFetchAccess],
  execute: ({ userId, requestId }) =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const result = yield* Effect.result(auth.hasAdminAccess());
      return Message.SettledFetchAccess({ userId, requestId, result });
    }),
});
