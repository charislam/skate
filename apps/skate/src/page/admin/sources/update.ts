import { AsyncData, Dom, FieldValidation, Command as FoldkitCommand, Update } from "foldkit";
import { Effect, Crypto as EffectCrypto, Equal, Match, Option, Result, Schema } from "effect";
import { BrowserCrypto } from "@effect/platform-browser";
import { Listbox } from "@foldkit/ui";
import { evo } from "foldkit/struct";
import { Sources } from "../../../domain/sources";
import { UserId } from "../../../domain/session";
import type { Resource } from "../../../resource";
import { Message } from "./message";
import {
  Feed,
  type FeedData,
  More,
  PendingRequest,
  ScopeId,
  type Model as SourcesModel,
  emptyFilters,
  init as initSourcesModel,
} from "./model";
import { searchTextRules, validateSearchText } from "./validation";

import * as Form from "./form/model";
import * as FormUpdate from "./form/update";
import * as FormMessage from "./form/message";
import { EnabledFilterListbox, FetchStatusFilterListbox, TypeFilterListbox } from "./listboxes";

const foldEnabledListbox = Update.foldChild({
  update: EnabledFilterListbox.update,
  read: (model: SourcesModel) => Option.some(model.enabledListbox),
  write: (model, nextListbox) => evo(model, { enabledListbox: () => nextListbox }),
  toParentMessage: (message) => Message.GotEnabledListboxMessage({ message }),
  foldOutMessage: Listbox.OutMessage.match<
    Update.Step<SourcesModel, Message>,
    Listbox.OutMessage<"all" | "true" | "false">
  >({
    Selected:
      ({ value }) =>
      (model) => ({
        model: evo(model, {
          draftFilters: (filters) =>
            evo(filters, {
              enabled: () => (value === "all" ? Option.none() : Option.some(value === "true")),
            }),
        }),
      }),
  }),
});
const foldTypeListbox = Update.foldChild({
  update: TypeFilterListbox.update,
  read: (model: SourcesModel) => Option.some(model.typeListbox),
  write: (model, nextListbox) => evo(model, { typeListbox: () => nextListbox }),
  toParentMessage: (message) => Message.GotTypeListboxMessage({ message }),
  foldOutMessage: Listbox.OutMessage.match<
    Update.Step<SourcesModel, Message>,
    Listbox.OutMessage<"all" | Form.SourceType>
  >({
    Selected:
      ({ value }) =>
      (model) => ({
        model: evo(model, {
          draftFilters: (filters) =>
            evo(filters, {
              type: () => (value === "all" ? Option.none() : Option.some(value)),
            }),
        }),
      }),
  }),
});
const foldFetchStatusListbox = Update.foldChild({
  update: FetchStatusFilterListbox.update,
  read: (model: SourcesModel) => Option.some(model.fetchStatusListbox),
  write: (model, nextListbox) => evo(model, { fetchStatusListbox: () => nextListbox }),
  toParentMessage: (message) => Message.GotFetchStatusListboxMessage({ message }),
  foldOutMessage: Listbox.OutMessage.match<
    Update.Step<SourcesModel, Message>,
    Listbox.OutMessage<"all" | "never" | "fetched">
  >({
    Selected:
      ({ value }) =>
      (model) => ({
        model: evo(model, {
          draftFilters: (filters) =>
            evo(filters, {
              fetchStatus: () => (value === "all" ? Option.none() : Option.some(value)),
            }),
        }),
      }),
  }),
});

type Context = Readonly<{ userId: UserId; isAllowed: boolean }>;

export const CreateSourcesScope = FoldkitCommand.define("CreateSourcesScope", {
  args: { userId: UserId },
  messages: [Message.CreatedScope],
  execute: ({ userId }) =>
    Effect.gen(function* () {
      const crypto = yield* EffectCrypto.Crypto;
      const scopeId = yield* Effect.orDie(crypto.randomUUIDv4);
      return Message.CreatedScope({ scopeId: ScopeId.make(scopeId), userId });
    }).pipe(Effect.provide(BrowserCrypto.layer)),
});

export const FetchPage = FoldkitCommand.define("FetchPage", {
  args: {
    requestId: Schema.Number,
    scopeId: ScopeId,
    userId: UserId,
    kind: Schema.Literals(["Initial", "Refresh", "More"]),
    query: Sources.SourceQuery,
    maybeCursor: Schema.Option(Sources.SourceCursor),
  },
  messages: [Message.SettledPage],
  execute: ({ requestId, scopeId, userId, kind, query, maybeCursor }) =>
    Effect.gen(function* () {
      const sources = yield* Sources.Service;
      const result = yield* Effect.result(sources.listPage(query, maybeCursor));
      return Message.SettledPage({ requestId, scopeId, userId, kind, maybeCursor, result });
    }),
});

export const ScrollSourcesTableToTop = FoldkitCommand.define("ScrollSourcesTableToTop", {
  messages: [Message.CompletedScrollSourcesTable],
  execute: Dom.scrollIntoViewAfterPaint("#admin-sources-table", { block: "start" }).pipe(
    Effect.as(Message.CompletedScrollSourcesTable()),
    Effect.catch(() => Effect.succeed(Message.CompletedScrollSourcesTable())),
  ),
});

const formFold = {
  read: (model: SourcesModel) => Option.some(model.form),
  write: (model: SourcesModel, nextForm: Form.Model) => evo(model, { form: () => nextForm }),
  toParentMessage: (message: FormMessage.Message) => Message.GotFormMessage({ message }),
};
const openForm = Update.foldChildStep({ ...formFold, update: FormUpdate.open });

const foldForm = (model: SourcesModel, message: FormMessage.Message, context: Context) => {
  if (Option.isNone(model.scopeId)) {
    return { model };
  }
  const formContext = { ...context, scopeId: model.scopeId.value };
  return Update.foldChild({
    ...formFold,
    update: (form: Form.Model, childMessage: FormMessage.Message) =>
      FormUpdate.update(form, childMessage, formContext),
    foldOutMessage: (
      outMessage: FormMessage.OutMessage,
    ): Update.Step<SourcesModel, Message, Resource> =>
      FormMessage.OutMessage.match(outMessage, {
        SubmittedSource:
          ({ requestId, input }) =>
          (stepModel) => ({
            model: evo(stepModel, {
              optimisticSources: (sources) => [...sources, { requestId, input }],
            }),
          }),
        FailedCreateSource:
          ({ requestId, error }) =>
          (stepModel) => {
            const pending = stepModel.optimisticSources.find(
              (source) => source.requestId === requestId,
            );
            return {
              model: evo(stepModel, {
                optimisticSources: (sources) =>
                  sources.filter((source) => source.requestId !== requestId),
                creationErrors: (errors) => [
                  ...errors,
                  { requestId, name: pending?.input.name ?? "Unnamed Source", error },
                ],
              }),
            };
          },
        CreatedSource:
          ({ requestId, source }) =>
          (stepModel) => {
            const data: FeedData = Option.getOrElse(AsyncData.getData(stepModel.feed), () => ({
              items: [],
              more: More.End(),
            }));
            const feed = Feed.Success({
              data: evo(data, {
                items: (items) => [source, ...items.filter((row) => row.id !== source.id)],
              }),
            });
            return refresh(
              evo(stepModel, {
                feed: () => feed,
                pendingRequest: () => Option.none(),
                optimisticSources: (sources) =>
                  sources.filter((pending) => pending.requestId !== requestId),
              }),
              context,
            );
          },
      }),
  })(model, message);
};

export const update = (model: SourcesModel, message: Message, context: Context) =>
  Message.match<Update.Return<SourcesModel, Message, Resource>>(message, {
    ClickedCreateSource: () =>
      context.isAllowed && Option.isSome(model.scopeId) ? openForm(model) : { model },
    GotFormMessage: ({ message: formMessage }) => foldForm(model, formMessage, context),
    GotEnabledListboxMessage: ({ message: listboxMessage }) =>
      foldEnabledListbox(model, listboxMessage),
    GotTypeListboxMessage: ({ message: listboxMessage }) => foldTypeListbox(model, listboxMessage),
    GotFetchStatusListboxMessage: ({ message: listboxMessage }) =>
      foldFetchStatusListbox(model, listboxMessage),
    UpdatedSearch: ({ value }) => ({
      model: evo(model, {
        draftFilters: () =>
          evo(model.draftFilters, {
            searchText: () => FieldValidation.NotValidated({ value }),
          }),
      }),
    }),
    ClickedApply: () => apply(model, context),
    PressedEnter: () => apply(model, context),
    ClickedClear: () => apply(evo(model, { draftFilters: () => emptyFilters() }), context),
    ClickedRefresh: () => refresh(model, context),
    ClickedRetry: () => startInitial(model, context),
    ClickedLoadMore: () => loadMore(model, false, context),
    ClickedRetryMore: () => loadMore(model, true, context),
    ObservedLoadMore: () => loadMore(model, false, context),
    ClickedSort: ({ field }) => {
      const direction =
        model.query.sortField === field && model.query.direction === "asc" ? "desc" : "asc";
      return applyQuery(model, { ...model.query, sortField: field, direction }, context);
    },
    CreatedScope: ({ scopeId, userId }) => {
      if (!context.isAllowed || context.userId !== userId) return { model };
      const scopedModel = evo(model, { scopeId: () => Option.some(scopeId) });
      const feed = AsyncData.loadIfMissing(scopedModel.feed);
      return Option.match(feed, {
        onNone: () => ({ model: scopedModel }),
        onSome: (nextFeed) =>
          request(
            evo(scopedModel, { feed: () => nextFeed, pendingRequest: () => Option.none() }),
            context,
          ),
      });
    },
    SettledPage: (completion) => settle(model, completion, context),
    CompletedScrollSourcesTable: () => ({ model }),
  });

export const enter = (
  model: SourcesModel,
  context: Context,
): Update.Return<SourcesModel, Message, Resource> => {
  if (!context.isAllowed) {
    return { model: evo(initSourcesModel(), { nextRequestId: () => model.nextRequestId }) };
  }
  if (Option.isNone(model.scopeId)) {
    return { model, commands: [CreateSourcesScope({ userId: context.userId })] };
  }
  const maybeLoading = AsyncData.loadIfMissing(model.feed);
  return Option.match(maybeLoading, {
    onNone: () => ({ model }),
    onSome: (feed) =>
      request(evo(model, { feed: () => feed, pendingRequest: () => Option.none() }), context),
  });
};

// Revalidation temporarily denies access, so in-flight results are ignored; clear pending state so they can be retried.
const recoverAfterIgnoredRequest = (model: SourcesModel): SourcesModel => {
  const feed = AsyncData.map(model.feed, (data) => ({
    ...data,
    more: Match.value(data.more).pipe(
      Match.tag("Loading", ({ cursor }) => More.Ready({ cursor })),
      Match.orElse(() => data.more),
    ),
  }));
  const settledFeed = Match.value(feed).pipe(
    Match.tag("Refreshing", ({ data }) => Feed.Success({ data })),
    Match.tag("Loading", () => Feed.Idle()),
    Match.orElse(() => feed),
  );
  return evo(model, { feed: () => settledFeed, pendingRequest: () => Option.none() });
};

const apply = (model: SourcesModel, context: Context) => {
  const searchText = validateSearchText(model.draftFilters.searchText.value);
  const draftFilters = evo(model.draftFilters, { searchText: () => searchText });
  const nextModel = evo(model, { draftFilters: () => draftFilters });
  if (!FieldValidation.isValid(searchTextRules)(searchText)) return { model: nextModel };

  const query = {
    ...model.query,
    filters: { ...draftFilters, searchText: searchText.value.trim() },
  };
  return applyQuery(nextModel, query, context);
};

const applyQuery = (model: SourcesModel, query: Sources.SourceQuery, context: Context) => {
  if (Equal.equals(model.query, query)) return { model };
  const started = startInitial(
    evo(model, {
      query: () => query,
      feed: () => Feed.Idle(),
      pendingRequest: () => Option.none(),
    }),
    context,
  );
  return {
    model: started.model,
    commands: [ScrollSourcesTableToTop(), ...(started.commands ?? [])],
  };
};

const startInitial = (
  model: SourcesModel,
  context: Context,
): Update.Return<SourcesModel, Message, Resource> => {
  if (!context.isAllowed) return { model };
  if (AsyncData.isPending(model.feed)) return { model };
  return request(
    evo(model, { feed: () => Feed.Loading(), pendingRequest: () => Option.none() }),
    context,
  );
};

const refresh = (model: SourcesModel, context: Context) => {
  if (!context.isAllowed || model.feed._tag === "Refreshing") return { model };
  const retained = AsyncData.map(model.feed, (data) => ({
    ...data,
    more: Match.value(data.more).pipe(
      Match.tag("Loading", ({ cursor }) => More.Ready({ cursor })),
      Match.orElse(() => data.more),
    ),
  }));
  const maybeRefreshing = AsyncData.revalidateOrLoad(retained);
  return Option.match(maybeRefreshing, {
    onNone: () => ({ model }),
    onSome: (feed) =>
      request(evo(model, { feed: () => feed, pendingRequest: () => Option.none() }), context),
  });
};

const loadMore = (model: SourcesModel, isRetry: boolean, context: Context) => {
  if (!context.isAllowed || Option.isSome(model.pendingRequest)) return { model };
  const data = AsyncData.getData(model.feed);
  if (Option.isNone(data)) return { model };
  const maybeCursor = Match.value(data.value.more).pipe(
    Match.tag("Ready", ({ cursor }) => Option.some(cursor)),
    Match.tag("Failed", ({ cursor }) => (isRetry ? Option.some(cursor) : Option.none())),
    Match.orElse(() => Option.none()),
  );
  return Option.match(maybeCursor, {
    onNone: () => ({ model }),
    onSome: (cursor) => {
      const feed = AsyncData.map(model.feed, (current) => ({
        ...current,
        more: More.Loading({ cursor }),
      }));
      return request(
        evo(model, { feed: () => feed, pendingRequest: () => Option.none() }),
        context,
      );
    },
  });
};

type RequestDescriptor =
  | { readonly kind: "Initial" }
  | { readonly kind: "Refresh" }
  | { readonly kind: "More"; readonly cursor: Sources.SourceCursor };

const request = (model: SourcesModel, context: Context) => {
  if (!context.isAllowed || Option.isNone(model.scopeId) || Option.isSome(model.pendingRequest))
    return { model };
  const scopeId = model.scopeId.value;

  const descriptor: Option.Option<RequestDescriptor> =
    model.feed._tag === "Loading"
      ? Option.some({ kind: "Initial" })
      : model.feed._tag === "Refreshing"
        ? Option.some({ kind: "Refresh" })
        : Option.flatMap(AsyncData.getData(model.feed), ({ more }) =>
            more._tag === "Loading"
              ? Option.some({ kind: "More", cursor: more.cursor })
              : Option.none(),
          );

  return Option.match(descriptor, {
    onNone: () => ({ model }),
    onSome: (requestDescriptor) => {
      const requestId = model.nextRequestId;
      let pendingRequest: typeof PendingRequest.Type;
      let maybeCursor: Option.Option<Sources.SourceCursor>;
      if (requestDescriptor.kind === "More") {
        pendingRequest = PendingRequest.More({
          requestId,
          scopeId,
          userId: context.userId,
          cursor: requestDescriptor.cursor,
        });
        maybeCursor = Option.some(requestDescriptor.cursor);
      } else if (requestDescriptor.kind === "Refresh") {
        pendingRequest = PendingRequest.Refresh({ requestId, scopeId, userId: context.userId });
        maybeCursor = Option.none();
      } else {
        pendingRequest = PendingRequest.Initial({ requestId, scopeId, userId: context.userId });
        maybeCursor = Option.none();
      }
      return {
        model: evo(model, {
          nextRequestId: () => requestId + 1,
          pendingRequest: () => Option.some(pendingRequest),
        }),
        commands: [
          FetchPage({
            requestId,
            scopeId,
            userId: context.userId,
            kind: requestDescriptor.kind,
            query: model.query,
            maybeCursor,
          }),
        ],
      };
    },
  });
};

const settle = (
  model: SourcesModel,
  completion: Extract<Message, { readonly _tag: "SettledPage" }>,
  context: Context,
): Update.Return<SourcesModel, Message, Resource> => {
  const expectedPending: Option.Option<typeof PendingRequest.Type> =
    completion.kind === "More"
      ? Option.map(completion.maybeCursor, (cursor) =>
          PendingRequest.More({
            requestId: completion.requestId,
            scopeId: completion.scopeId,
            userId: completion.userId,
            cursor,
          }),
        )
      : Option.some(
          completion.kind === "Initial"
            ? PendingRequest.Initial({
                requestId: completion.requestId,
                scopeId: completion.scopeId,
                userId: completion.userId,
              })
            : PendingRequest.Refresh({
                requestId: completion.requestId,
                scopeId: completion.scopeId,
                userId: completion.userId,
              }),
        );
  if (context.userId !== completion.userId) return { model };
  return Option.match(Option.product(model.pendingRequest, expectedPending), {
    onNone: () => ({ model }),
    onSome: ([pending, expected]) => {
      if (!Equal.equals(pending, expected)) return { model };
      if (!context.isAllowed) return { model: recoverAfterIgnoredRequest(model) };
      if (completion.kind === "More") {
        return pending._tag === "More"
          ? settleMore(model, completion.result, pending.cursor)
          : { model };
      }
      return settleInitialOrRefresh(model, completion.result);
    },
  });
};

const settleMore = (
  model: SourcesModel,
  result: Extract<Message, { readonly _tag: "SettledPage" }>["result"],
  cursor: Sources.SourceCursor,
): Update.Return<SourcesModel, Message, Resource> => {
  const nextPending = Option.none();
  const nextFeed = Result.match(result, {
    onFailure: (error) =>
      AsyncData.map(model.feed, (data) => ({
        ...data,
        more: More.Failed({ cursor, error }),
      })),
    onSuccess: (page) =>
      AsyncData.map(model.feed, (data) => ({
        items: mergeRows({ existing: data.items, incoming: page.items }),
        more: Option.match(page.nextCursor, {
          onNone: () => More.End(),
          onSome: (nextCursor) => More.Ready({ cursor: nextCursor }),
        }),
      })),
  });
  return { model: evo(model, { feed: () => nextFeed, pendingRequest: () => nextPending }) };
};

const settleInitialOrRefresh = (
  model: SourcesModel,
  result: Extract<Message, { readonly _tag: "SettledPage" }>["result"],
): Update.Return<SourcesModel, Message, Resource> => {
  const nextPending = Option.none();
  const pageResult = Result.map(result, (page) => ({
    items: page.items,
    more: Option.match(page.nextCursor, {
      onNone: () => More.End(),
      onSome: (cursor) => More.Ready({ cursor }),
    }),
  }));
  const nextFeed = AsyncData.settle(model.feed, pageResult);
  return { model: evo(model, { feed: () => nextFeed, pendingRequest: () => nextPending }) };
};

const mergeRows = ({
  existing,
  incoming,
}: {
  existing: ReadonlyArray<Sources.SourceRow>;
  incoming: ReadonlyArray<Sources.SourceRow>;
}) => {
  const updates = new Map(incoming.map((row) => [row.id, row]));
  const seen = new Set(existing.map((row) => row.id));
  return [
    ...existing.map((row) => updates.get(row.id) ?? row),
    ...incoming.filter((row) => !seen.has(row.id)),
  ];
};
