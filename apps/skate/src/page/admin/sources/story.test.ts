import { Option, Result, Schema } from "effect";
import { describe, expect, test } from "vitest";
import { Command, type StorySimulation, given, message, model, story } from "foldkit/story";
import { FieldValidation } from "foldkit";
import { SourceError, Sources } from "../../../domain/sources";
import { UserId } from "../../../domain/session";
import { Message } from "./message";
import { Feed, More, PendingRequest, ScopeId, defaultQuery, init } from "./model";
import { CreateSourcesScope, FetchPage, ScrollSourcesTableToTop, enter, update } from "./update";
import type { Model as SourcesModel } from "./model";

const context = { userId: UserId.make("owner"), isAllowed: true };
const revalidatingContext = { ...context, isAllowed: false };
const scopeId = ScopeId.make("test-sources-instance");
const sourceUpdate = (model: SourcesModel, message: Message) => update(model, message, context);
const sourceUpdateDuringAccessRevalidation = (model: SourcesModel, message: Message) =>
  update(model, message, revalidatingContext);
const initScoped = () => ({ ...init(), scopeId: Option.some(scopeId) });

const enterSources = (simulation: StorySimulation<SourcesModel, Message>) => {
  const entered = enter(simulation.model, context);
  return {
    ...simulation,
    model: entered.model,
    commands: [...simulation.commands, ...(entered.commands ?? [])],
  };
};

const row = (id: string, name: string): Sources.SourceRow =>
  Schema.decodeUnknownSync(Sources.SourceRow)({
    id,
    name,
    type: "web_scrape",
    url: "https://example.com/feed",
    notes: null,
    enabled: true,
    last_fetched: null,
    created_at: "2026-09-25T10:00:00.123456Z",
    updated_at: "2026-09-25T10:00:00.123456Z",
  });

describe("sources table stories", () => {
  test("entering creates a scope and dispatches the initial page request", () => {
    story(
      sourceUpdate,
      given(init()),
      enterSources,
      Command.expectExact(CreateSourcesScope),
      Command.resolve(
        CreateSourcesScope,
        Message.CreatedScope({ scopeId, userId: context.userId }),
      ),
      Command.expectExact(
        FetchPage({
          requestId: 1,
          scopeId,
          userId: context.userId,
          kind: "Initial",
          query: defaultQuery(),
          maybeCursor: Option.none(),
        }),
      ),
      model((current) => {
        expect(current.feed._tag).toBe("Loading");
        expect(current.pendingRequest).toEqual(
          Option.some(PendingRequest.Initial({ requestId: 1, scopeId, userId: context.userId })),
        );
      }),
      Command.resolve(
        FetchPage,
        Message.SettledPage({
          requestId: 1,
          scopeId: ScopeId.make("previous-admin-instance"),
          userId: context.userId,
          kind: "Initial",
          maybeCursor: Option.none(),
          result: Result.succeed({ items: [], nextCursor: Option.none() }),
        }),
      ),
      model((current) => {
        expect(current.feed._tag).toBe("Loading");
        expect(current.pendingRequest).toEqual(
          Option.some(PendingRequest.Initial({ requestId: 1, scopeId, userId: context.userId })),
        );
      }),
    );
  });

  test("search is validated on apply and an invalid search keeps the applied query", () => {
    story(
      sourceUpdate,
      given(initScoped()),
      message(Message.UpdatedSearch({ value: "ab" })),
      model((current) => {
        expect(current.draftFilters.searchText).toEqual({ _tag: "NotValidated", value: "ab" });
      }),
      message(Message.ClickedApply()),
      Command.expectNone(),
      model((current) => {
        expect(current.query.filters.searchText).toBe("");
        expect(current.draftFilters.searchText._tag).toBe("Invalid");
      }),
    );
  });

  test("an ignored page result makes the request retryable inside Sources", () => {
    const initial = {
      ...initScoped(),
      nextRequestId: 2,
      pendingRequest: Option.some(
        PendingRequest.Initial({ requestId: 1, scopeId, userId: context.userId }),
      ),
      feed: Feed.Loading(),
    };

    story(
      sourceUpdateDuringAccessRevalidation,
      given(initial),
      message(
        Message.SettledPage({
          requestId: 1,
          scopeId,
          userId: context.userId,
          kind: "Initial",
          maybeCursor: Option.none(),
          result: Result.succeed({ items: [], nextCursor: Option.none() }),
        }),
      ),
      model((current) => {
        expect(current.feed._tag).toBe("Idle");
        expect(current.pendingRequest).toEqual(Option.none());
      }),
      enterSources,
      Command.expectExact(
        FetchPage({
          requestId: 2,
          scopeId,
          userId: context.userId,
          kind: "Initial",
          query: initial.query,
          maybeCursor: Option.none(),
        }),
      ),
      Command.resolve(
        FetchPage,
        Message.SettledPage({
          requestId: 2,
          scopeId,
          userId: context.userId,
          kind: "Initial",
          maybeCursor: Option.none(),
          result: Result.succeed({ items: [], nextCursor: Option.none() }),
        }),
      ),
      model((current) => {
        expect(current.feed._tag).toBe("Idle");
        expect(current.pendingRequest).toEqual(Option.none());
      }),
    );
  });

  test("applying a valid search issues scroll and page commands", () => {
    const query = { ...defaultQuery(), filters: { ...defaultQuery().filters, searchText: "cats" } };
    story(
      sourceUpdate,
      given(initScoped()),
      message(Message.UpdatedSearch({ value: "cats" })),
      message(Message.PressedEnter()),
      Command.expectExact(
        ScrollSourcesTableToTop,
        FetchPage({
          requestId: 1,
          scopeId,
          userId: context.userId,
          kind: "Initial",
          query,
          maybeCursor: Option.none(),
        }),
      ),
      Command.resolve(ScrollSourcesTableToTop, Message.CompletedScrollSourcesTable()),
      Command.resolve(
        FetchPage,
        Message.SettledPage({
          requestId: 1,
          scopeId,
          userId: context.userId,
          kind: "Initial",
          maybeCursor: Option.none(),
          result: Result.succeed({
            items: [row("1", "Cats"), row("2", "Wildcats")],
            nextCursor: Option.none(),
          }),
        }),
      ),
      model((current) => {
        expect(current.query).toEqual(query);
        expect(current.feed._tag).toBe("Success");
        if (current.feed._tag === "Success") expect(current.feed.data.items).toHaveLength(2);
      }),
    );
  });

  test("does not refetch an equivalent query with reordered keys", () => {
    const query = {
      direction: "asc" as const,
      sortField: "name" as const,
      filters: {
        fetchStatus: Option.none(),
        enabled: Option.none(),
        type: Option.none(),
        searchText: "cats",
      },
    };
    const initial = {
      ...initScoped(),
      draftFilters: {
        enabled: Option.none(),
        fetchStatus: Option.none(),
        type: Option.none(),
        searchText: FieldValidation.Valid({ value: "cats" }),
      },
      query,
    };

    story(
      sourceUpdate,
      given(initial),
      message(Message.ClickedApply()),
      Command.expectNone(),
      model((current) => expect(current.query).toEqual(query)),
    );
  });

  test("appending merges rows by ID and retains a stale refresh error", () => {
    const cursor = Sources.SourceCursor.Kind({ type: "web_scrape", name: "Alpha" });
    const firstRow = row("1", "Alpha");
    const updatedRow = { ...firstRow, notes: Option.some("Updated during pagination") };
    const secondRow = row("2", "Beta");
    const refreshError = new SourceError({ message: "Refresh failed", cause: new Error() });
    const initial = {
      ...initScoped(),
      nextRequestId: 2,
      feed: Feed.Stale({
        data: { items: [firstRow], more: More.Ready({ cursor }) },
        error: refreshError,
      }),
    };
    const pageRequest = FetchPage({
      requestId: 2,
      scopeId,
      userId: context.userId,
      kind: "More",
      query: initial.query,
      maybeCursor: Option.some(cursor),
    });

    story(
      sourceUpdate,
      given(initial),
      message(Message.ClickedLoadMore()),
      Command.expectExact(pageRequest),
      Command.resolve(
        pageRequest,
        Message.SettledPage({
          requestId: 2,
          scopeId,
          userId: context.userId,
          kind: "More",
          maybeCursor: Option.some({ name: "Alpha", _tag: "Kind", type: "web_scrape" }),
          result: Result.succeed({ items: [updatedRow, secondRow], nextCursor: Option.none() }),
        }),
      ),
      model((current) => {
        expect(current.feed._tag).toBe("Stale");
        if (current.feed._tag === "Stale") {
          expect(current.feed.data.items).toEqual([updatedRow, secondRow]);
          expect(current.feed.data.more._tag).toBe("End");
        }
      }),
    );
  });

  test("failed refresh restores an abandoned append cursor", () => {
    const cursor = Sources.SourceCursor.Name({ name: "Alpha" });
    const initial = {
      ...initScoped(),
      nextRequestId: 2,
      pendingRequest: Option.some(
        PendingRequest.More({ requestId: 1, scopeId, userId: context.userId, cursor }),
      ),
      feed: Feed.Success({ data: { items: [row("1", "Alpha")], more: More.Loading({ cursor }) } }),
    };
    const pageRequest = FetchPage({
      requestId: 2,
      scopeId,
      userId: context.userId,
      kind: "Refresh",
      query: initial.query,
      maybeCursor: Option.none(),
    });

    story(
      sourceUpdate,
      given(initial),
      message(Message.ClickedRefresh()),
      Command.expectExact(pageRequest),
      Command.resolve(
        pageRequest,
        Message.SettledPage({
          requestId: 2,
          scopeId,
          userId: context.userId,
          kind: "Refresh",
          maybeCursor: Option.none(),
          result: Result.fail(new SourceError({ message: "Refresh failed", cause: new Error() })),
        }),
      ),
      model((current) => {
        expect(current.feed._tag).toBe("Stale");
        if (current.feed._tag === "Stale") {
          expect(current.feed.data.more).toEqual(More.Ready({ cursor }));
        }
      }),
    );
  });

  test("failed refresh preserves a pre-existing append error", () => {
    const cursor = Sources.SourceCursor.Name({ name: "Alpha" });
    const appendError = new SourceError({ message: "Append failed", cause: new Error() });
    const initial = {
      ...initScoped(),
      feed: Feed.Success({
        data: { items: [row("1", "Alpha")], more: More.Failed({ cursor, error: appendError }) },
      }),
    };
    const pageRequest = FetchPage({
      requestId: 1,
      scopeId,
      userId: context.userId,
      kind: "Refresh",
      query: initial.query,
      maybeCursor: Option.none(),
    });

    story(
      sourceUpdate,
      given(initial),
      message(Message.ClickedRefresh()),
      Command.expectExact(pageRequest),
      Command.resolve(
        pageRequest,
        Message.SettledPage({
          requestId: 1,
          scopeId,
          userId: context.userId,
          kind: "Refresh",
          maybeCursor: Option.none(),
          result: Result.fail(new SourceError({ message: "Refresh failed", cause: new Error() })),
        }),
      ),
      model((current) => {
        expect(current.feed._tag).toBe("Stale");
        if (current.feed._tag === "Stale") {
          expect(current.feed.data.more).toEqual(More.Failed({ cursor, error: appendError }));
        }
      }),
    );
  });
});
