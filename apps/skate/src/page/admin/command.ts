import { Effect, Schema } from "effect";
import { Command as FoldkitCommand } from "foldkit";
import { Auth } from "../../domain/auth";
import { Message } from "./message";
import { UserId } from "../../domain/session";
import { Sources } from "../../domain/sources";

export const FetchAdminAccess = FoldkitCommand.define("FetchAdminAccess", {
  args: { userId: UserId, adminRequestId: Schema.Number },
  messages: [Message.SettledFetchAccess],
  execute: ({ userId, adminRequestId }) =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const result = yield* Effect.result(auth.hasAdminAccess());
      return Message.SettledFetchAccess({ userId, adminRequestId, result });
    }),
});

export const FetchActiveSources = FoldkitCommand.define("FetchActiveSources", {
  args: { sourceRequestId: Schema.Number },
  messages: [Message.SettledFetchActiveSources],
  execute: ({ sourceRequestId }) =>
    Effect.gen(function* () {
      const sources = yield* Sources.Service;
      const result = yield* Effect.result(sources.countActive);
      return Message.SettledFetchActiveSources({ sourceRequestId, result });
    }),
});
