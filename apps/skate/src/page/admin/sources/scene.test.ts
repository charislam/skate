import { Option, Result } from "effect";
import { Command, Mount, given, scene } from "foldkit/scene";
import { describe, test } from "vitest";
import { Sources } from "../../../domain/sources";
import { UserId } from "../../../domain/session";
import { Message } from "./message";
import { ObserveLoadMore } from "./mount";
import { Feed, More, ScopeId, init } from "./model";
import type { Model as SourcesModel } from "./model";
import { FetchPage, update } from "./update";
import { view } from "./view";

const context = { userId: UserId.make("owner"), isAllowed: true };
const scopeId = ScopeId.make("sources-view-test");
const cursor = Sources.SourceCursor.Name({ name: "Alpha" });
const model: SourcesModel = {
  ...init(),
  scopeId: Option.some(scopeId),
  feed: Feed.Success({ data: { items: [], more: More.Ready({ cursor }) } }),
};
const sourceUpdate = (current: SourcesModel, message: Message) => update(current, message, context);

describe("Sources view mounts", () => {
  test("the load-more sentinel owns the observer and folds its message", () => {
    const pageRequest = FetchPage({
      requestId: 1,
      scopeId,
      userId: context.userId,
      kind: "More",
      query: model.query,
      maybeCursor: Option.some(cursor),
    });

    scene(
      { update: sourceUpdate, view },
      given(model),
      Mount.expectHas(ObserveLoadMore),
      Mount.resolve(ObserveLoadMore, Message.ObservedLoadMore()),
      Command.expectHas(pageRequest),
      Command.resolve(
        pageRequest,
        Message.SettledPage({
          requestId: 1,
          scopeId,
          userId: context.userId,
          kind: "More",
          maybeCursor: Option.some(cursor),
          result: Result.succeed({ items: [], nextCursor: Option.none() }),
        }),
      ),
      Mount.expectEnded(ObserveLoadMore),
      Command.expectNone(),
    );
  });
});
