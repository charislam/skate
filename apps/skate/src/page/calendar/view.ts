import { Dialog as UiDialog, Popover as UiPopover } from "@foldkit/ui";
import { cn } from "cn";
import { DateTime, HashMap, Match, Option } from "effect";
import { AsyncData, Calendar, Submodel } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { ActiveDate, MainMenu } from "~/domain";
import { Calendar as CalendarDomain } from "~/domain/calendar";
import * as CalendarCache from "~/domain/calendar-cache";
import type { AppRoute } from "~/route";
import { Button } from "~/view/button";
import { Heading } from "~/view/heading";
import { MAIN_MENU_ITEM_CLASS_IDENTIFIER } from "~/view/main-menu";
import { selectorButtonClass } from "~/view/selector-button";
import * as CalendarPageMessage from "./message";
import type { Message } from "./message";
import type { Model } from "./model";

const RANGE_PAGE_BUTTON_CLASS =
  "cursor-pointer text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-800";

const SESSION_MENU_ITEM_CLASS_IDENTIFIER = "skating-session-details-menu-item";
const SESSION_MENU_ITEM_CLASS = cn(
  SESSION_MENU_ITEM_CLASS_IDENTIFIER,
  "cursor-pointer",
  "px-3 py-2",
  "hover:bg-slate-100 dark:hover:bg-slate-800",
  "focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800",
  "text-left text-sm text-slate-800 dark:text-slate-300",
);

const weekMonthSelector = (
  { granularity, startDate }: { granularity: "Week" | "Month"; startDate: Calendar.CalendarDate },
  h: HtmlBuilder<Message>,
) => {
  const formattedMonth = Option.match(ActiveDate.formatMonth({ format: "long" }, startDate), {
    onSome: (month) => month,
    onNone: () => "",
  });

  const rangeName = granularity === "Week" ? "week" : "month";
  const endDate = granularity === "Week" ? Calendar.addDays(startDate, 6) : undefined;
  const formattedRange =
    endDate && (endDate.month !== startDate.month || endDate.year !== startDate.year)
      ? `${formattedMonth} ${startDate.day} – ${Option.getOrElse(ActiveDate.formatMonth({ format: "long" }, endDate), () => "")} ${endDate.day}${endDate.year === startDate.year ? `, ${endDate.year}` : `, ${startDate.year} – ${endDate.year}`}`
      : `${formattedMonth} ${granularity === "Week" ? `${startDate.day}-${endDate?.day}` : startDate.year}`;

  return h.div(
    [h.Class("flex gap-2 items-center")],
    [
      h.button(
        [
          h.Class(RANGE_PAGE_BUTTON_CLASS),
          h.AriaLabel(`Previous ${rangeName}`),
          h.OnClick(CalendarPageMessage.Message.SelectedPreviousDateRange()),
        ],
        [h.span([h.AriaHidden(true), h.InnerHTML("&#8826;")])],
      ),
      h.h2([h.Class(Heading.capsHeadingStyle)], [formattedRange]),
      h.button(
        [
          h.Class(RANGE_PAGE_BUTTON_CLASS),
          h.AriaLabel(`Next ${rangeName}`),
          h.OnClick(CalendarPageMessage.Message.SelectedNextDateRange()),
        ],
        [h.span([h.AriaHidden(true), h.InnerHTML("&#8827")])],
      ),
    ],
  );
};

const formatTime = (dateTime: DateTime.Zoned) => {
  const hour = DateTime.getPart(dateTime, "hour");
  const minute = DateTime.getPart(dateTime, "minute").toString().padStart(2, "0");
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
};

const formatDate = (date: Calendar.CalendarDate) =>
  `${date.year.toString().padStart(4, "0")}-${date.month.toString().padStart(2, "0")}-${date.day.toString().padStart(2, "0")}`;

const formatDateTime = (dateTime: DateTime.Zoned) => {
  return `${Calendar.formatLong(Calendar.defaultEnglishLocale)(CalendarDomain.toCalendarDate(dateTime))} at ${formatTime(dateTime)}`;
};

type SessionEntryContext = {
  readonly date: Calendar.CalendarDate;
  readonly model: Model;
  readonly slotScope: "day-week-listing" | "month-cell" | "day-dialog";
};

const sessionEntry = (
  session: CalendarDomain.CalendarSession,
  { date, model, slotScope }: SessionEntryContext,
  h: HtmlBuilder<Message>,
) => {
  const formattedDate = formatDate(date);
  const nextDay = Calendar.addDays(date, 1);
  const startsEarlier = Calendar.isBefore(CalendarDomain.toCalendarDate(session.start), date);
  const nextMidnight = DateTime.makeZonedUnsafe(
    { year: nextDay.year, month: nextDay.month, day: nextDay.day },
    { timeZone: "America/Toronto", adjustForTimeZone: true },
  );
  const endsLater = session.end.epochMilliseconds > nextMidnight.epochMilliseconds;

  const website = Option.flatMap(session.rink_url, validHttpUrl);
  const menuKey = `session-actions-${slotScope}-${encodeURIComponent(`${formattedDate}:${session.id}`)}`;
  const menuId = menuKey;
  const menuModel = Option.getOrElse(HashMap.get(model.sessionMenus, menuKey), () =>
    UiPopover.init({ id: menuId, contentFocus: true }),
  );

  const sessionActions = h.submodel({
    slotId: menuKey,
    model: menuModel,
    view: UiPopover.view,
    toParentMessage: (message) =>
      CalendarPageMessage.Message.GotSessionMenuMessage({ menuId: menuKey, message }),
    viewInputs: {
      anchor: { placement: "bottom-end", gap: 4 },
      ariaLabel: `Actions for ${session.rink_name} ${formatTime(session.start)}`,
      focusSelector: `.${SESSION_MENU_ITEM_CLASS_IDENTIFIER}:first-child`,
      toView: (render) =>
        h.div(
          [h.Class("relative inline-block shrink-0")],
          [
            h.button(
              [
                ...render.button,
                h.Class(
                  cn(
                    "cursor-pointer",
                    "size-8 rounded",
                    "hover:bg-slate-100 dark:hover:bg-slate-800",
                    "grid place-items-center",
                  ),
                ),
              ],
              [h.span([h.Class("text-2xl leading-none")], ["⋮"])],
            ),
            ...(render.isVisible
              ? [
                  h.div([...render.backdrop, h.Class("fixed inset-0")]),
                  h.div(
                    [
                      ...render.panel,
                      h.Class(
                        cn(
                          "z-10",
                          "rounded border border-slate-200 shadow-xs bg-white",
                          "dark:border-slate-800 dark:bg-slate-900",
                        ),
                      ),
                    ],
                    [
                      h.div(
                        [h.Class("min-w-40 flex flex-col")],
                        [
                          h.button(
                            [
                              h.OnClick(
                                CalendarPageMessage.Message.ClickedSessionDetails({
                                  menuId: menuKey,
                                  id: session.id,
                                }),
                              ),
                              h.Class(SESSION_MENU_ITEM_CLASS),
                            ],
                            ["View details"],
                          ),
                          Option.match(website, {
                            onNone: () => h.empty,
                            onSome: (href) =>
                              h.a(
                                [
                                  h.Href(href),
                                  h.Target("_blank"),
                                  h.Rel("noopener noreferrer"),
                                  h.Class(SESSION_MENU_ITEM_CLASS),
                                ],
                                ["Open rink website"],
                              ),
                          }),
                        ],
                      ),
                    ],
                  ),
                ]
              : []),
          ],
        ),
    },
  });

  return h.div(
    [
      h.Class(
        cn(
          "@container/session-entry",
          "py-2",
          "border-b border-slate-200 dark:border-slate-700 last:border-0",
          "flex flex-col gap-1",
        ),
      ),
    ],
    [
      h.div(
        [h.Class("flex items-start @sm:items-center justify-between gap-2")],
        [
          h.div(
            [h.Class("flex flex-1 min-w-0 flex-wrap items-center gap-x-2 text-sm @sm:text-base")],
            [
              h.span(
                [
                  h.Class(
                    session.is_cancelled
                      ? "line-through text-slate-500 dark:text-slate-400"
                      : "font-medium",
                  ),
                ],
                [`${formatTime(session.start)}–${formatTime(session.end)}`],
              ),
              h.span([], [session.rink_name]),
              session.is_cancelled ? h.span([h.Class("sr-only")], ["Cancelled"]) : h.empty,
            ],
          ),
          sessionActions,
        ],
      ),
      Match.value(session.audience).pipe(
        Match.when("general", () => h.empty),
        Match.orElse((specificAudience) =>
          h.span(
            [h.Class("text-sm text-slate-600 dark:text-slate-300")],
            [
              Match.value(specificAudience).pipe(
                Match.when("children", () => "Children"),
                Match.when("adult", () => "Adult"),
                Match.when("senior", () => "Senior"),
                Match.when("family", () => "Family"),
                Match.exhaustive,
              ),
            ],
          ),
        ),
      ),
      startsEarlier
        ? h.span(
            [h.Class("text-sm text-slate-600 dark:text-slate-400")],
            ["Continues from previous day"],
          )
        : h.empty,
      endsLater
        ? h.span([h.Class("text-sm text-slate-600 dark:text-slate-400")], ["Continues next day"])
        : h.empty,
      session.certainty === "uncertain"
        ? h.span(
            [h.Class("text-sm italic text-slate-600 dark:text-slate-400")],
            ["Details uncertain"],
          )
        : h.empty,
    ],
  );
};

const validHttpUrl = (value: string): Option.Option<string> => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? Option.some(value)
      : Option.none();
  } catch {
    return Option.none();
  }
};

const loadingMessage = (h: HtmlBuilder<Message>) =>
  h.p([h.Class("py-4 text-slate-600 dark:text-slate-300")], ["Loading sessions…"]);

const dayFailure = (
  props: { date: Calendar.CalendarDate; error: CalendarDomain.CalendarError },
  h: HtmlBuilder<Message>,
) =>
  h.div(
    [h.Class("py-4 flex flex-col items-start gap-4")],
    [
      h.p(
        [h.Class("text-slate-600 dark:text-slate-300")],
        [`Could not load sessions: ${props.error.message}`],
      ),
      h.button(
        [
          h.OnClick(CalendarPageMessage.Message.RetryCalendarDate({ date: props.date })),
          h.Class(Button.secondaryClass),
        ],
        ["Retry"],
      ),
    ],
  );

const dayContent = ({ date, model, slotScope }: SessionEntryContext, h: HtmlBuilder<Message>) => {
  return Option.match(CalendarCache.dayEntry(model.calendarCache, date), {
    onNone: () => loadingMessage(h),
    onSome: (entry) =>
      AsyncData.matchData(entry.sessions, {
        onEmpty: () => loadingMessage(h),
        onFailure: (error) => dayFailure({ date, error }, h),
        onData: (sessions) => sessionList(sessions, { date, model, slotScope }, h),
      }),
  });
};

const sessionList = (
  sessions: ReadonlyArray<CalendarDomain.CalendarSession>,
  context: SessionEntryContext,
  h: HtmlBuilder<Message>,
) =>
  sessions.length === 0
    ? h.p([h.Class("py-4 text-slate-600 dark:text-slate-300")], ["No sessions"])
    : h.div(
        [h.Class("divide-y divide-slate-200 dark:divide-slate-700")],
        sessions.map((session) =>
          h.keyed("div")(session.id, [], [sessionEntry(session, context, h)]),
        ),
      );

const MONTH_CELL_CLASS = cn(
  "min-h-36",
  "border border-slate-200 dark:border-slate-700",
  "p-2",
  "flex flex-col gap-2",
);

const monthCellButton = (
  props: { date: Calendar.CalendarDate; isInCurrentMonth: boolean; isToday: boolean },
  h: HtmlBuilder<Message>,
) =>
  h.button(
    [
      h.Type("button"),
      h.AriaLabel("Open day details"),
      h.OnClick(CalendarPageMessage.Message.ClickedOpenDayDialog({ date: props.date })),
      h.Class(
        cn(
          "text-left",
          !props.isInCurrentMonth && "text-slate-400 dark:text-slate-500",
          props.isToday && "font-bold underline underline-offset-4",
        ),
      ),
    ],
    [props.date.day.toString()],
  );

const monthCellSessionsOnSome = (
  props: {
    date: Calendar.CalendarDate;
    model: Model;
    rows: ReadonlyArray<CalendarDomain.CalendarSession>;
  },
  h: HtmlBuilder<Message>,
): Html => {
  const MAX_LISTINGS_SHOWN = 3;

  return h.div(
    [h.Class("flex flex-col gap-1")],
    [
      ...props.rows
        .slice(0, MAX_LISTINGS_SHOWN)
        .map((session) =>
          h.keyed("div")(
            session.id,
            [h.Class("text-xs")],
            [
              sessionEntry(
                session,
                { date: props.date, model: props.model, slotScope: "month-cell" },
                h,
              ),
            ],
          ),
        ),
      props.rows.length > MAX_LISTINGS_SHOWN
        ? h.button(
            [
              h.Type("button"),
              h.OnClick(CalendarPageMessage.Message.ClickedOpenDayDialog({ date: props.date })),
              h.Class(cn(Button.secondaryClass, "text-xs")),
            ],
            [`${props.rows.length - 3} more`],
          )
        : h.empty,
    ],
  );
};

const monthCellSessionsOnEmpty = (h: HtmlBuilder<Message>): Html =>
  h.p([h.Class("text-xs text-slate-600 dark:text-slate-300")], ["Loading sessions…"]);

const monthCellSessionsOnFailure = (
  { date }: { date: Calendar.CalendarDate },
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class("text-xs text-red-800 dark:text-red-300")],
    [
      h.p([], ["Could not load sessions"]),
      h.button(
        [
          h.OnClick(CalendarPageMessage.Message.RetryCalendarDate({ date })),
          h.Class("cursor-pointer mt-2 underline"),
        ],
        ["Retry"],
      ),
    ],
  );

const monthCellSessions = (
  props: {
    date: Calendar.CalendarDate;
    entry: ReturnType<typeof CalendarCache.dayEntry>;
    model: Model;
  },
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(props.entry, {
    onNone: () => h.empty,
    onSome: ({ sessions }) =>
      AsyncData.matchData(sessions, {
        onEmpty: () => monthCellSessionsOnEmpty(h),
        onFailure: () => monthCellSessionsOnFailure({ date: props.date }, h),
        onData: (rows) =>
          monthCellSessionsOnSome({ date: props.date, model: props.model, rows }, h),
      }),
  });

const monthCell = (
  date: Calendar.CalendarDate,
  activeMonth: Calendar.CalendarDate,
  model: Model,
  h: HtmlBuilder<Message>,
) => {
  const key = formatDate(date);

  const entry = CalendarCache.dayEntry(model.calendarCache, date);

  return h.keyed("section")(
    key,
    [h.Class(MONTH_CELL_CLASS)],
    [
      monthCellButton(
        {
          date,
          isInCurrentMonth: date.month === activeMonth.month && date.year === activeMonth.year,
          isToday: Calendar.isEqual(date, model.today),
        },
        h,
      ),
      monthCellSessions({ date, entry, model }, h),
    ],
  );
};

// DAY VIEW

const DAY_VIEW_SCAFFOLD = "flex flex-col gap-4";
const DAY_HEADER_CLASS = "flex gap-2 justify-between";
const DAY_HEADER_DATE_WRAPPER_CLASS = "flex gap-2";
const DAY_HEADER_DATE_CLASS = "text-6xl";
const DAY_HEADER_DATE_DETAILS_CLASS = "py-2 flex flex-col justify-between";
const DAY_HEADER_MONTH_CLASS = "uppercase text-sm text-slate-600 dark:text-slate-400";
const DAY_HEADER_WEEKDAY_CLASS = "text-slate-600 dark:text-slate-400 font-light tracking-wide";
const DAY_HEADER_RANGE_NAVIGATOR_CLASS = "flex gap-2";
const DAY_HEADER_RANGE_BUTTON_CLASS =
  "cursor-pointer px-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-4xl";

const dayDateDisplay = (props: { date: Calendar.CalendarDate }, h: HtmlBuilder<Message>): Html => {
  const formattedMonth = Option.getOrElse(
    ActiveDate.formatMonth({ format: "short" }, props.date),
    () => "",
  );

  return h.h2(
    [h.Class(DAY_HEADER_DATE_WRAPPER_CLASS)],
    [
      h.span([h.Class(DAY_HEADER_DATE_CLASS)], [props.date.day.toString()]),
      h.span(
        [h.Class(DAY_HEADER_DATE_DETAILS_CLASS)],
        [
          h.span([h.Class(DAY_HEADER_MONTH_CLASS)], [formattedMonth]),
          h.span([h.Class(DAY_HEADER_WEEKDAY_CLASS)], [Calendar.dayOfWeek(props.date)]),
        ],
      ),
    ],
  );
};

const dayRangeButton = (
  props: { direction: "previous" | "next" },
  h: HtmlBuilder<Message>,
): Html => {
  const label = Match.value(props.direction).pipe(
    Match.when("previous", () => "Previous day"),
    Match.when("next", () => "Next day"),
    Match.exhaustive,
  );
  const symbol = Match.value(props.direction).pipe(
    Match.when("previous", () => "‹"),
    Match.when("next", () => "›"),
    Match.exhaustive,
  );

  return h.button(
    [
      h.Class(DAY_HEADER_RANGE_BUTTON_CLASS),
      h.OnClick(CalendarPageMessage.Message.SelectedPreviousDateRange()),
      h.AriaLabel(label),
    ],
    [symbol],
  );
};

const dayView = (
  props: { date: Calendar.CalendarDate; model: Model },
  h: HtmlBuilder<Message>,
): Array<Html> => [
  h.div(
    [h.Class(DAY_VIEW_SCAFFOLD)],
    [
      h.div(
        [h.Class(DAY_HEADER_CLASS)],
        [
          dayDateDisplay({ date: props.date }, h),
          h.div(
            [h.Class(DAY_HEADER_RANGE_NAVIGATOR_CLASS)],
            [
              dayRangeButton({ direction: "previous" }, h),
              dayRangeButton({ direction: "next" }, h),
            ],
          ),
        ],
      ),
      dayContent({ date: props.date, model: props.model, slotScope: "day-week-listing" }, h),
    ],
  ),
];

const WEEK_VIEW_GRID_CLASS = "grid grid-cols-7 gap-2";
const WEEK_VIEW_DAY_HEADER_CLASS =
  "border-b border-slate-300 dark:border-slate-600 pb-2 font-medium";

const weekView = (
  props: { startDate: Calendar.CalendarDate; model: Model },
  h: HtmlBuilder<Message>,
): Array<Html> => [
  h.div(
    [h.Class(WEEK_VIEW_GRID_CLASS)],
    ActiveDate.DAYS_OF_WEEK.map((day, index) => {
      const date = Calendar.addDays(props.startDate, index);
      return h.keyed("section")(
        formatDate(date),
        [],
        [
          h.h3([h.Class(WEEK_VIEW_DAY_HEADER_CLASS)], [`${day.slice(0, 3)} ${date.day}`]),
          dayContent(
            {
              date,
              model: props.model,
              slotScope: "day-week-listing",
            },
            h,
          ),
        ],
      );
    }),
  ),
];

const content = (model: Model, route: AppRoute, h: HtmlBuilder<Message>): Html => {
  const sectionTitle = Match.value(model.activeDateRange).pipe(
    Match.tagsExhaustive({
      Initial: () => "",
      Day: () => "Daily schedule",
      Week: () => "Weekly schedule",
      Month: () => "Monthly schedule",
    }),
  );

  return h.section(
    [h.AriaLabel(sectionTitle)],
    [
      ...Match.value(model.activeDateRange).pipe(
        Match.tagsExhaustive({
          Initial: () => [],
          Day: ({ date }) => dayView({ date, model }, h),
          Week: ({ startDate }) => weekView({ startDate, model }, h),
          Month: ({ startDate }) => [
            h.div(
              [h.Class("grid grid-cols-7 gap-2")],
              ActiveDate.DAYS_OF_WEEK.map((day) =>
                h.keyed("div")(day, [h.Class("text-sm font-medium")], [day.slice(0, 3)]),
              ),
            ),
            h.div(
              [h.Class("grid grid-cols-7 gap-2")],
              CalendarCache.monthDates(startDate).map((date) =>
                monthCell(date, startDate, model, h),
              ),
            ),
          ],
        }),
      ),
      ...(route._tag === "Session" ? [sessionDetailsDialog(model, route.id, h)] : []),
      ...(route._tag !== "Session"
        ? [
            dayDialog(
              model,
              Option.getOrElse(model.maybeDayDialogDate, () => model.today),
              h,
            ),
          ]
        : []),
    ],
  );
};

export const footerStartView = Submodel.defineView<Model, Message>((model, h) =>
  h.div(
    [h.Class("flex divide-x-2 divide-slate-300 dark:divide-slate-700")],
    [
      h.button(
        [
          h.Class(
            "px-2 text-sm text-slate-600 hover:bg-slate-100 cursor-pointer dark:text-slate-300 dark:hover:bg-slate-800",
          ),
        ],
        ["Showing all"],
      ),
      ActiveDate.isDateRangeCurrent(model.activeDateRange, model.today)
        ? h.empty
        : h.button(
            [
              h.Class(
                "px-2 text-sm text-slate-600 hover:bg-slate-100 cursor-pointer dark:text-slate-300 dark:hover:bg-slate-800",
              ),
              h.OnClick(CalendarPageMessage.Message.SelectedCurrentDateRange()),
            ],
            ["Go to today →"],
          ),
    ],
  ),
);

export const headerEndView = Submodel.defineView<Model, Message>((model, h) =>
  Match.value(model.activeDateRange).pipe(
    Match.tags({
      Week: ({ startDate }) => weekMonthSelector({ granularity: "Week", startDate }, h),
      Month: ({ startDate }) => weekMonthSelector({ granularity: "Month", startDate }, h),
    }),
    Match.orElse(() => h.empty),
  ),
);

export const contentView = Submodel.defineView<Model, Message, { readonly route: AppRoute }>(
  (model, { route }, h) => content(model, route, h),
);

const sessionDetailsDialog = (
  model: Model,
  id: CalendarDomain.SessionId,
  h: HtmlBuilder<Message>,
) =>
  h.submodel({
    slotId: model.sessionDialog.id,
    model: model.sessionDialog,
    view: UiDialog.view,
    viewInputs: {
      hasDescription: true,
      toView: (render) =>
        h.dialog(
          [...render.dialog],
          render.isVisible
            ? [
                h.div([...render.backdrop, h.Class("fixed inset-0 bg-black/50")]),
                h.div(
                  [
                    ...render.panel,
                    h.Class(
                      "relative mx-auto my-8 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                    ),
                  ],
                  [
                    h.h2([...render.title, h.Class("text-xl font-semibold")], ["Session details"]),
                    h.p(
                      [...render.description, h.Class("sr-only")],
                      ["Public skating session information"],
                    ),
                    sessionDetailBody(model, id, h),
                    h.button(
                      [
                        h.OnClick(CalendarPageMessage.Message.ClickedRetrySessionDetails({ id })),
                        h.Class("mt-3 rounded border px-2 py-1 text-sm"),
                      ],
                      ["Refresh details"],
                    ),
                    Option.match(model.maybeDayDialogDate, {
                      onNone: () => h.empty,
                      onSome: (date) =>
                        h.button(
                          [
                            h.OnClick(CalendarPageMessage.Message.ClickedBackToDayDialog()),
                            h.Class("mt-4 underline"),
                          ],
                          [`Back to ${Calendar.formatLong(Calendar.defaultEnglishLocale)(date)}`],
                        ),
                    }),
                    h.button(
                      [
                        h.Type("button"),
                        h.OnClick(CalendarPageMessage.Message.ClickedCloseSessionDetails()),
                        h.Class("mt-6 rounded border px-3 py-2"),
                      ],
                      ["Close"],
                    ),
                  ],
                ),
              ]
            : [],
        ),
    },
    toParentMessage: (message) => CalendarPageMessage.Message.GotSessionDialogMessage({ message }),
  });

const dayDialog = (model: Model, date: Calendar.CalendarDate, h: HtmlBuilder<Message>) => {
  return h.submodel({
    slotId: model.dayDialog.id,
    model: model.dayDialog,
    view: UiDialog.view,
    viewInputs: {
      hasDescription: true,
      toView: (render) =>
        h.dialog(
          [...render.dialog],
          render.isVisible
            ? [
                h.div([...render.backdrop, h.Class("fixed inset-0 bg-black/50")]),
                h.div(
                  [
                    ...render.panel,
                    h.Class(
                      "relative mx-auto my-8 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 text-slate-900 shadow-xl dark:bg-slate-950 dark:text-slate-100",
                    ),
                  ],
                  [
                    h.h2(
                      [...render.title, h.Class("text-xl font-semibold")],
                      [Calendar.formatLong(Calendar.defaultEnglishLocale)(date)],
                    ),
                    h.p(
                      [...render.description, h.Class("sr-only")],
                      ["Public skating sessions for this date"],
                    ),
                    h.button(
                      [
                        h.OnClick(CalendarPageMessage.Message.ClickedRefreshCalendarDate({ date })),
                        h.Class("mt-3 rounded border px-2 py-1 text-sm"),
                      ],
                      ["Refresh day"],
                    ),
                    dayContent({ date, model, slotScope: "day-dialog" }, h),
                    h.button(
                      [...render.closeButton, h.Class("mt-6 rounded border px-3 py-2")],
                      ["Close"],
                    ),
                  ],
                ),
              ]
            : [],
        ),
    },
    toParentMessage: (message) => CalendarPageMessage.Message.GotDayDialogMessage({ message }),
  });
};

const sessionDetailBody = (model: Model, id: CalendarDomain.SessionId, h: HtmlBuilder<Message>) => {
  const entry = CalendarCache.detailEntry(model.calendarCache, id);
  return Option.match(entry, {
    onNone: () => h.p([h.Class("mt-4"), h.AriaLive("polite")], ["Loading session details…"]),
    onSome: ({ value }) =>
      AsyncData.match(value, {
        onIdle: () => h.p([h.Class("mt-4"), h.AriaLive("polite")], ["Loading session details…"]),
        onLoading: () => h.p([h.Class("mt-4"), h.AriaLive("polite")], ["Loading session details…"]),
        onFailure: (error) =>
          h.div(
            [h.Class("mt-4"), h.Role("alert")],
            [h.p([], [`Could not load session details: ${error.message}`])],
          ),
        onRefreshing: (maybeSession) =>
          h.div(
            [h.Class("mt-4")],
            [
              detailContent(maybeSession, h),
              h.p([h.AriaLive("polite"), h.Class("text-sm")], ["Refreshing…"]),
            ],
          ),
        onStale: ({ data, error }) =>
          h.div(
            [h.Class("mt-4")],
            [detailContent(data, h), h.p([h.Role("alert")], [`Refresh failed: ${error.message}`])],
          ),
        onSuccess: (maybeSession) => h.div([h.Class("mt-4")], [detailContent(maybeSession, h)]),
      }),
  });
};

const detailContent = (
  maybeSession: Option.Option<CalendarDomain.CalendarSession>,
  h: HtmlBuilder<Message>,
) =>
  Option.match(maybeSession, {
    onNone: () => h.p([h.Class("font-semibold")], ["Session not found"]),
    onSome: (session) => {
      const website = Option.flatMap(session.rink_url, validHttpUrl);
      return h.div(
        [h.Class("flex flex-col gap-2")],
        [
          h.p([], [`${formatDateTime(session.start)} – ${formatDateTime(session.end)}`]),
          h.p([h.Class("font-semibold")], [session.rink_name]),
          session.rink_address ? h.p([], [session.rink_address]) : h.empty,
          h.p([], [session.audience]),
          session.is_cancelled ? h.p([h.Class("font-semibold")], ["Cancelled"]) : h.empty,
          session.certainty === "uncertain"
            ? h.p([h.Class("font-semibold")], ["Uncertain"])
            : h.empty,
          Option.match(website, {
            onNone: () => h.empty,
            onSome: (href) =>
              h.a(
                [
                  h.Href(href),
                  h.Target("_blank"),
                  h.Rel("noopener noreferrer"),
                  h.Class("underline"),
                ],
                ["Rink website"],
              ),
          }),
          h.button(
            [
              h.OnClick(CalendarPageMessage.Message.ClickedCopySessionLink({ id: session.id })),
              h.Class("w-fit underline"),
            ],
            ["Copy link"],
          ),
        ],
      );
    },
  });

const calendarViewSection = (
  activeDateRange: Model["activeDateRange"],
  tabletOrAbove: boolean,
  h: HtmlBuilder<Message>,
) =>
  h.div(
    [],
    [
      h.h3(
        [
          h.Id("main-menu-view-label"),
          h.Class("mb-2 text-xs font-medium text-slate-600 dark:text-slate-300"),
        ],
        ["View"],
      ),
      h.div(
        [h.Role("group"), h.AriaLabelledBy("main-menu-view-label"), h.Class("inline-flex")],
        MainMenu.actions
          .filter((action) => tabletOrAbove || action === "Day")
          .map((action, index, arr) => {
            const isActive = activeDateRange._tag === action;
            return h.keyed("button")(
              action,
              [
                h.Type("button"),
                h.AriaPressed(isActive ? "true" : "false"),
                ...(isActive ? [h.Disabled(true)] : []),
                h.Class(
                  cn(
                    MAIN_MENU_ITEM_CLASS_IDENTIFIER,
                    selectorButtonClass({
                      isFirst: index === 0,
                      isLast: index === arr.length - 1,
                      isActive,
                    }),
                  ),
                ),
                ...(!isActive
                  ? [h.OnClick(CalendarPageMessage.Message.SelectedMainMenuAction({ action }))]
                  : []),
              ],
              [action],
            );
          }),
      ),
    ],
  );

export const mainMenuView = Submodel.defineView<
  Model,
  Message,
  { readonly tabletOrAbove: boolean }
>((model, { tabletOrAbove }, h) => calendarViewSection(model.activeDateRange, tabletOrAbove, h));
