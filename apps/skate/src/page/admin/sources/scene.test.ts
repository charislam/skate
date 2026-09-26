import { Option, Result } from "effect";
import { Command, Mount, expect, given, scene, text } from "foldkit/scene";
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

test("pending sources appear in an otherwise empty table", () => {
  scene(
    { update: sourceUpdate, view },
    given({
      ...model,
      feed: Feed.Success({ data: { items: [], more: More.End() } }),
      optimisticSources: [
        {
          requestId: 1,
          input: {
            name: "Pending source",
            type: "web_scrape",
            url: "https://example.com",
            notes: Option.none(),
          },
        },
      ],
    }),
    expect(text("Pending source")).toExist(),
    expect(text("Creating…")).toExist(),
  );
});

test("creation failures remain visible outside the closed dialog", () => {
  scene(
    { update: sourceUpdate, view },
    given({
      ...model,
      feed: Feed.Success({ data: { items: [], more: More.End() } }),
      creationErrors: [
        {
          requestId: 1,
          name: "Failed source",
          error: new Sources.SourceError({ message: "Could not create source.", cause: null }),
        },
      ],
    }),
    expect(text("Failed source: Could not create source.")).toExist(),
  );
});
