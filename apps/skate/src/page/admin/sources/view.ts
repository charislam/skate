import { cn } from "cn";
import { Array, DateTime, Match, Option } from "effect";
import { AsyncData, Submodel } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { Sources } from "~/domain/sources";
import { Button } from "~/view/button";
import { view as formView } from "./form/view";
import { Message } from "./message";
import { type FeedData, type Model, More, hasActiveFilters } from "./model";
import { ObserveLoadMore } from "./mount";
import { AdminSourcesFilter } from "./view/filter";

const utcTimeToLocalDisplay = (utcTime: DateTime.Utc): string =>
  new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).format(DateTime.toDate(utcTime));

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
        [
          h.OnClick(Message.ClickedSort({ field })),
          h.Class(
            cn(
              "cursor-pointer",
              "flex items-center gap-1",
              selected ? "font-semibold" : "font-normal",
            ),
          ),
        ],
        [
          label,
          h.span([
            h.AriaHidden(true),
            h.InnerHTML(
              selected ? (model.query.direction === "asc" ? "&uarr;" : "&darr;") : "&#x21c5;",
            ),
          ]),
        ],
      ),
    ],
  );
};

const cellClass = "max-w-80 truncate px-3 py-2";
const headerCell = (text: string, h: HtmlBuilder<Message>): Html =>
  h.th([h.Class(cn(cellClass, "font-normal"))], [text]);
const cell = (text: string, h: HtmlBuilder<Message>): Html => h.td([h.Class(cellClass)], [text]);

const statusTextClass = "text-center font-light text-slate-600 dark:text-slate-300";
const tableEmptyMessage = (model: Model, h: HtmlBuilder<Message>): Html => {
  const isFiltered = hasActiveFilters(model.query.filters);

  return h.div(
    [h.Class("flex flex-col gap-2")],
    isFiltered
      ? [h.p([h.Class(statusTextClass)], ["No sources match these filters"])]
      : [h.p([h.Class(statusTextClass)], ["No sources yet"])],
  );
};

const tableHeader = (model: Model, h: HtmlBuilder<Message>): Html =>
  h.thead(
    [h.Class("border-b border-slate-300 dark:border-slate-700")],
    [
      h.tr(
        [],
        [
          sortButton(model, "name", "Name", h),
          headerCell("URL", h),
          sortButton(model, "type", "Type", h),
          sortButton(model, "enabled", "Enabled", h),
          sortButton(model, "last_fetched", "Last fetched", h),
          sortButton(model, "created_at", "Created", h),
          sortButton(model, "updated_at", "Updated", h),
          headerCell("Notes", h),
        ],
      ),
    ],
  );

const tableRowBorderClass = "border-b border-slate-100 dark:border-slate-800";

const optimisticSourceRow = (
  requestId: number,
  input: Sources.CreateSource,
  h: HtmlBuilder<Message>,
): Html =>
  h.keyed("tr")(
    `pending-${requestId}`,
    [h.Class(cn(tableRowBorderClass, "opacity-60")), h.AriaBusy(true)],
    [
      cell(input.name, h),
      cell(input.url, h),
      cell(input.type, h),
      cell("Enabled", h),
      cell("Never fetched", h),
      cell("Creating…", h),
      cell("—", h),
      cell(
        Option.getOrElse(input.notes, () => ""),
        h,
      ),
    ],
  );

const tableRow = (row: Sources.SourceRow, h: HtmlBuilder<Message>): Html =>
  h.keyed("tr")(
    row.id,
    [h.Class(tableRowBorderClass)],
    [
      cell(row.name, h),
      h.td(
        [h.Class("max-w-80 truncate px-3 py-2")],
        [
          row.url.protocol === "https:" || row.url.protocol === "http:"
            ? h.a(
                [h.Href(row.url.href), h.Title(row.url.href), h.Class("underline")],
                [row.url.href],
              )
            : h.span([h.Title(row.url.href)], [row.url.href]),
        ],
      ),
      cell(row.type, h),
      cell(row.enabled ? "Enabled" : "Disabled", h),
      cell(
        Option.match(row.last_fetched, {
          onNone: () => "Never fetched",
          onSome: utcTimeToLocalDisplay,
        }),
        h,
      ),
      cell(utcTimeToLocalDisplay(row.created_at), h),
      cell(utcTimeToLocalDisplay(row.updated_at), h),
      h.td(
        [h.Class(cellClass), h.Title(Option.getOrElse(row.notes, () => ""))],
        [Option.getOrElse(row.notes, () => "")],
      ),
    ],
  );

const tableDataLoadingIndicators = (
  model: Model,
  narrowed: { more: More },
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class("flex flex-col gap-2 items-center")],
    [
      ...Match.value(narrowed.more).pipe(
        Match.tag("Ready", () => [
          h.p([h.Role("status")]),
          h.button(
            [
              h.OnClick(Message.ClickedLoadMore()),
              h.Disabled(model.feed._tag === "Refreshing"),
              h.Class(Button.secondaryClass),
            ],
            ["Load more"],
          ),
        ]),
        Match.tag("Loading", () => [
          h.p([h.Role("status"), h.Class(statusTextClass)], ["Loading more…"]),
        ]),
        Match.tag("Failed", ({ error }) => [
          h.p([h.Role("status")]),
          h.p([h.Role("alert"), h.Class(statusTextClass)], [error.message]),
          h.button(
            [h.OnClick(Message.ClickedRetryMore()), h.Class(Button.secondaryClass)],
            ["Retry"],
          ),
        ]),
        Match.tag("End", () => []),
        Match.exhaustive,
      ),
      Match.value(narrowed.more).pipe(
        Match.tag("End", () => h.empty),
        Match.orElse(() => h.div([h.AriaHidden(true), h.OnMount(ObserveLoadMore())])),
      ),
    ],
  );

const tableData = (model: Model, data: FeedData, h: HtmlBuilder<Message>): Html => {
  const { items, more } = data;
  return h.div(
    [h.Class("flex flex-col gap-4")],
    [
      Array.match([...model.optimisticSources, ...items], {
        onEmpty: () => tableEmptyMessage(model, h),
        onNonEmpty: () =>
          h.div(
            [h.Id("admin-sources-table"), h.Class("overflow-auto")],
            [
              h.table(
                [h.Class("w-full min-w-[1000px] border-collapse text-left text-sm")],
                [
                  tableHeader(model, h),
                  h.tbody(
                    [],
                    [
                      ...model.optimisticSources.map(({ requestId, input }) =>
                        optimisticSourceRow(requestId, input, h),
                      ),
                      ...items.map((row) => tableRow(row, h)),
                    ],
                  ),
                ],
              ),
            ],
          ),
      }),
      tableDataLoadingIndicators(model, { more }, h),
    ],
  );
};

const feedTable = (model: Model, h: HtmlBuilder<Message>): Html =>
  AsyncData.matchData(model.feed, {
    onEmpty: () => h.p([h.Class(statusTextClass)], ["Loading sources…"]),
    onFailure: (error) =>
      h.div(
        [h.Class("flex flex-col items-center gap-3")],
        [
          h.p([h.Role("alert")], [error.message]),
          h.button([h.OnClick(Message.ClickedRetry()), h.Class(Button.secondaryClass)], ["Retry"]),
        ],
      ),
    onData: (data) => tableData(model, data, h),
  });

const failedCreateErrors = (model: Model, h: HtmlBuilder<Message>): Html => {
  const errors = model.creationErrors;
  if (Array.isReadonlyArrayEmpty(errors)) {
    return h.empty;
  }

  const title = `Failed to create source${errors.length > 1 ? "s" : ""}`;

  return h.div(
    [h.Role("alert"), h.Class("relative bg-red-50 dark:bg-red-950 px-4 py-2")],
    [
      h.h3(
        [h.Class("mb-2 text-red-800 dark:text-red-100")],
        [h.span([h.AriaHidden(true), h.InnerHTML("&#9888;"), h.Class("mr-2")]), title],
      ),
      ...errors.map(({ requestId, name, error }) =>
        h.keyed("p")(
          `create-error-${requestId}`,
          [h.Class("text-sm text-red-800 dark:text-red-100")],
          [`${name}: ${error.message}`],
        ),
      ),
      h.button(
        [
          h.OnClick(Message.ClickedDismissErrors()),
          h.Class(
            "cursor-pointer absolute top-0 right-2 p-2 hover:bg-red-100 dark:hover:bg-red-900 text-red-800 dark:text-red-100",
          ),
        ],
        [h.span([h.AriaHidden(true), h.InnerHTML("&times;")])],
      ),
    ],
  );
};

const tableWrapper = (model: Model, h: HtmlBuilder<Message>): Html => {
  return h.div(
    [h.Class("flex flex-col gap-4")],
    [failedCreateErrors(model, h), feedTable(model, h)],
  );
};

const createSourceButton = (model: Model, h: HtmlBuilder<Message>): Html => {
  const disabled = Option.isNone(model.scopeId);

  return h.button(
    [
      ...(disabled ? [] : [h.OnClick(Message.ClickedCreateSource())]),
      h.AriaDisabled(disabled),
      h.Class(Button.primaryClass),
    ],
    ["New source"],
  );
};

export const view = Submodel.defineView<Model, Message, { readonly tabletOrAbove: boolean }>(
  (model, { tabletOrAbove }, h) =>
    h.div(
      [h.Class("flex flex-col gap-8")],
      [
        h.submodel({
          slotId: "create-source-form",
          model: model.form,
          view: formView,
          toParentMessage: (message) => Message.GotFormMessage({ message }),
        }),
        tabletOrAbove
          ? AdminSourcesFilter.wideControls(model, h)
          : AdminSourcesFilter.narrowControls(model, h),
        tableWrapper(model, h),
        h.div([h.Class("flex justify-center")], [createSourceButton(model, h)]),
      ],
    ),
);
