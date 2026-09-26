import { AsyncData, FieldValidation, Submodel } from "foldkit";
import { Array, DateTime, Match, Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";
import { Sources } from "../../../domain/sources";
import { Message } from "./message";
import { ObserveLoadMore } from "./mount";
import { type FeedData, type Model, More } from "./model";

import { view as formView } from "./form/view";

const optionValue = <A>(maybeValue: Option.Option<A>, toValue: (value: A) => string): string =>
  Option.match(maybeValue, { onNone: () => "all", onSome: toValue });

const sortButton = (
  model: Model,
  field: Sources.SourceSortField,
  label: string,
  h: HtmlBuilder<Message>,
): Html => {
  const selected = model.query.sortField === field;
  const direction = selected ? model.query.direction : "none";
  return h.th(
    [h.AriaSort(direction)],
    [
      h.button(
        [h.OnClick(Message.ClickedSort({ field })), h.Class("cursor-pointer font-semibold")],
        [`${label}${selected ? (model.query.direction === "asc" ? " ↑" : " ↓") : ""}`],
      ),
    ],
  );
};

const cell = (text: string, h: HtmlBuilder<Message>): Html =>
  h.td([h.Class("max-w-80 truncate px-3 py-2")], [text]);

const tableData = (model: Model, data: FeedData, h: HtmlBuilder<Message>): Html => {
  const { items, more } = data;
  return h.div(
    [h.Class("flex flex-col gap-4")],
    [
      Array.match([...model.optimisticSources, ...items], {
        onEmpty: () =>
          h.div(
            [h.Class("flex flex-col gap-2")],
            [
              h.p([], ["No sources match these filters"]),
              h.button([h.OnClick(Message.ClickedClear())], ["Clear filters"]),
            ],
          ),
        onNonEmpty: () =>
          h.div(
            [h.Class("overflow-x-auto")],
            [
              h.table(
                [h.Class("w-full min-w-[1000px] border-collapse text-left text-sm")],
                [
                  h.thead(
                    [h.Class("border-b border-slate-300 dark:border-slate-700")],
                    [
                      h.tr(
                        [],
                        [
                          sortButton(model, "name", "Name", h),
                          cell("URL", h),
                          sortButton(model, "type", "Type", h),
                          sortButton(model, "enabled", "Enabled", h),
                          sortButton(model, "last_fetched", "Last fetched", h),
                          sortButton(model, "created_at", "Created", h),
                          sortButton(model, "updated_at", "Updated", h),
                          cell("Notes", h),
                        ],
                      ),
                    ],
                  ),
                  h.tbody(
                    [],
                    [
                      ...model.optimisticSources.map(({ requestId, input }) =>
                        h.keyed("tr")(
                          `pending-${requestId}`,
                          [h.Class("border-b border-slate-100 opacity-60"), h.AriaBusy(true)],
                          [
                            cell(input.name, h),
                            cell(input.url, h),
                            cell("Web scrape", h),
                            cell("Enabled", h),
                            cell("Never fetched", h),
                            cell("Creating…", h),
                            cell("—", h),
                            cell(
                              Option.getOrElse(input.notes, () => ""),
                              h,
                            ),
                          ],
                        ),
                      ),
                      ...items.map((row) =>
                        h.keyed("tr")(
                          row.id,
                          [h.Class("border-b border-slate-100 dark:border-slate-800")],
                          [
                            cell(row.name, h),
                            h.td(
                              [h.Class("max-w-80 truncate px-3 py-2")],
                              [
                                row.url.protocol === "https:" || row.url.protocol === "http:"
                                  ? h.a(
                                      [
                                        h.Href(row.url.href),
                                        h.Title(row.url.href),
                                        h.Class("underline"),
                                      ],
                                      [row.url.href],
                                    )
                                  : h.span([h.Title(row.url.href)], [row.url.href]),
                              ],
                            ),
                            cell("Web scrape", h),
                            cell(row.enabled ? "Enabled" : "Disabled", h),
                            cell(
                              Option.match(row.last_fetched, {
                                onNone: () => "Never fetched",
                                onSome: DateTime.formatIso,
                              }),
                              h,
                            ),
                            cell(DateTime.formatIso(row.created_at), h),
                            cell(DateTime.formatIso(row.updated_at), h),
                            h.td(
                              [
                                h.Class("max-w-80 truncate px-3 py-2"),
                                h.Title(Option.getOrElse(row.notes, () => "")),
                              ],
                              [Option.getOrElse(row.notes, () => "")],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
      }),
      h.p([h.Role("status"), h.AriaLive("polite")], [`${Array.length(items)} sources loaded`]),
      Match.value(more).pipe(
        Match.tag("Ready", () =>
          h.button(
            [h.OnClick(Message.ClickedLoadMore()), h.Disabled(model.feed._tag === "Refreshing")],
            ["Load more"],
          ),
        ),
        Match.tag("Loading", () => h.p([h.Role("status")], ["Loading more…"])),
        Match.tag("Failed", ({ error }) =>
          h.div(
            [],
            [
              h.p([h.Role("alert")], [error.message]),
              h.button([h.OnClick(Message.ClickedRetryMore())], ["Retry"]),
            ],
          ),
        ),
        Match.tag("End", () => h.p([h.Role("status")], ["All matching sources loaded"])),
        Match.exhaustive,
      ),
      more._tag === "Ready" && model.pendingRequest._tag === "None"
        ? h.div([h.AriaHidden(true), h.OnMount(ObserveLoadMore())])
        : h.empty,
    ],
  );
};

const feedTable = (model: Model, h: HtmlBuilder<Message>): Html =>
  AsyncData.match(model.feed, {
    onIdle: () => h.p([h.Role("status")], ["No sources loaded."]),
    onLoading: () => h.p([h.Role("status")], ["Loading sources…"]),
    onFailure: (error) =>
      h.div(
        [h.Class("flex items-center gap-3")],
        [
          h.p([h.Role("alert")], [error.message]),
          h.button([h.OnClick(Message.ClickedRetry())], ["Retry"]),
        ],
      ),
    onRefreshing: (data) =>
      h.div(
        [h.Class("flex flex-col gap-4")],
        [h.p([h.Role("status")], ["Refreshing sources…"]), tableData(model, data, h)],
      ),
    onStale: ({ data, error }) =>
      h.div(
        [h.Class("flex flex-col gap-4")],
        [h.p([h.Role("alert")], [error.message]), tableData(model, data, h)],
      ),
    onSuccess: (data) => tableData(model, data, h),
  });

const table = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("flex flex-col gap-4")],
    [
      ...model.creationErrors.map(({ requestId, name, error }) =>
        h.keyed("p")(
          `create-error-${requestId}`,
          [h.Role("alert"), h.Class("text-sm text-red-700")],
          [`${name}: ${error.message}`],
        ),
      ),
      feedTable(model, h),
      Option.isNone(AsyncData.getData(model.feed)) &&
      Array.isReadonlyArrayNonEmpty(model.optimisticSources)
        ? tableData(model, { items: [], more: More.End() }, h)
        : h.empty,
    ],
  );

const filterControls = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class("flex flex-wrap items-end gap-3")],
    [
      h.label(
        [h.Class("flex flex-col gap-1 text-sm")],
        [
          "Search names",
          h.input([
            h.Type("search"),
            h.Value(model.draftFilters.searchText.value),
            h.OnInput((value) => Message.UpdatedSearch({ value })),
            h.OnKeyDownPreventDefault((key) =>
              key === "Enter" ? Option.some(Message.PressedEnter()) : Option.none(),
            ),
            h.AriaInvalid(model.draftFilters.searchText._tag === "Invalid"),
            h.AriaLabel("Search names"),
            h.Class("rounded border px-2 py-1"),
          ]),
        ],
      ),
      h.label(
        [h.Class("flex flex-col gap-1 text-sm")],
        [
          "Enabled",
          h.select(
            [
              h.Value(optionValue(model.draftFilters.enabled, String)),
              h.OnChange((value) =>
                Message.UpdatedEnabled({
                  maybeValue: value === "all" ? Option.none() : Option.some(value === "true"),
                }),
              ),
            ],
            [
              h.option([h.Value("all")], ["All"]),
              h.option([h.Value("true")], ["Enabled"]),
              h.option([h.Value("false")], ["Disabled"]),
            ],
          ),
        ],
      ),
      h.label(
        [h.Class("flex flex-col gap-1 text-sm")],
        [
          "Type",
          h.select(
            [
              h.Value(optionValue(model.draftFilters.type, String)),
              h.OnChange((value) =>
                Message.UpdatedType({
                  maybeValue: value === "all" ? Option.none() : Option.some("web_scrape"),
                }),
              ),
            ],
            [
              h.option([h.Value("all")], ["All types"]),
              h.option([h.Value("web_scrape")], ["Web scrape"]),
            ],
          ),
        ],
      ),
      h.label(
        [h.Class("flex flex-col gap-1 text-sm")],
        [
          "Fetch status",
          h.select(
            [
              h.Value(optionValue(model.draftFilters.fetchStatus, String)),
              h.OnChange((value) =>
                Message.UpdatedFetchStatus({
                  maybeValue:
                    value === "never"
                      ? Option.some("never")
                      : value === "fetched"
                        ? Option.some("fetched")
                        : Option.none(),
                }),
              ),
            ],
            [
              h.option([h.Value("all")], ["All"]),
              h.option([h.Value("never")], ["Never fetched"]),
              h.option([h.Value("fetched")], ["Fetched"]),
            ],
          ),
        ],
      ),
      h.button([h.OnClick(Message.ClickedApply()), h.Class("rounded border px-3 py-1")], ["Apply"]),
      h.button(
        [h.OnClick(Message.ClickedClear()), h.Class("rounded border px-3 py-1")],
        ["Clear filters"],
      ),
      h.button(
        [h.OnClick(Message.ClickedRefresh()), h.Class("rounded border px-3 py-1")],
        ["Refresh"],
      ),
    ],
  );

export const view = Submodel.defineView<Model, Message>((model, h) =>
  h.div(
    [h.Id("admin-sources-table"), h.Class("flex flex-col gap-4")],
    [
      h.div(
        [h.Class("flex justify-end")],
        [
          h.button(
            [
              h.OnClick(Message.ClickedCreateSource()),
              h.Disabled(Option.isNone(model.scopeId)),
              h.Class("rounded bg-gray-900 px-3 py-2 text-white"),
            ],
            ["New source"],
          ),
        ],
      ),
      h.submodel({
        slotId: "create-source-form",
        model: model.form,
        view: formView,
        toParentMessage: (message) => Message.GotFormMessage({ message }),
      }),
      filterControls(model, h),
      FieldValidation.match(model.draftFilters.searchText, {
        onNotValidated: () => h.empty,
        onValidating: () => h.empty,
        onValid: () => h.empty,
        onInvalid: ({ errors }) =>
          h.p([h.Role("alert"), h.Class("text-sm text-red-700")], [Array.headNonEmpty(errors)]),
      }),
      table(model, h),
    ],
  ),
);
