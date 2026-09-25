import { Match, Option } from "effect";
import { Calendar } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import { ActiveDate, MainMenu } from "../domain";
import { Message } from "../message";
import type { Model } from "../model";
import * as Layout from "./layout";
import { selectorButtonClass } from "./selector-button";
import { WeekMonthSelector } from "./week-month-selector";

export const slots = (model: Model, h: HtmlBuilder<Message>): Layout.PageSlots => ({
  width: model.activeDateRange._tag === "Day" ? "compact" : "wide",
  headerEnd: Match.value(model.activeDateRange).pipe(
    Match.tags({
      Week: ({ startDate }) => WeekMonthSelector.selector({ granularity: "Week", startDate }, h),
      Month: ({ startDate }) => WeekMonthSelector.selector({ granularity: "Month", startDate }, h),
    }),
    Match.orElse(() => h.empty),
  ),
  content: h.div(
    [],
    Match.value(model.activeDateRange).pipe(
      Match.tagsExhaustive({
        Initial: () => [],
        Day: ({ date }) => [
          h.div(
            [h.Class("flex gap-2 justify-between")],
            [
              h.h2(
                [h.Class("flex gap-2")],
                [
                  h.span([h.Class("text-6xl")], [date.day.toString()]),
                  h.span(
                    [h.Class("py-2 flex flex-col justify-between")],
                    [
                      h.span(
                        [h.Class("uppercase text-sm text-slate-600 dark:text-slate-400")],
                        [
                          Option.match(ActiveDate.formatMonth({ format: "short" }, date), {
                            onSome: (month) => month,
                            onNone: () => "",
                          }),
                        ],
                      ),
                      h.span(
                        [h.Class("text-slate-600 dark:text-slate-400 font-light tracking-wide")],
                        [Calendar.dayOfWeek(date)],
                      ),
                    ],
                  ),
                ],
              ),
              h.div(
                [h.Class("flex gap-4")],
                [
                  h.button(
                    [
                      h.Class(
                        "flex items-center text-4xl text-slate-600 hover:bg-slate-100 cursor-pointer dark:text-slate-300 dark:hover:bg-slate-800",
                      ),
                      h.OnClick(Message.SelectedPreviousDateRange()),
                    ],
                    [
                      h.span([h.Class("sr-only")], ["Previous day"]),
                      h.span([h.AriaHidden(true), h.InnerHTML("&#8826;")]),
                    ],
                  ),
                  h.button(
                    [
                      h.Class(
                        "flex items-center text-4xl text-slate-600 hover:bg-slate-100 cursor-pointer dark:text-slate-300 dark:hover:bg-slate-800",
                      ),
                      h.OnClick(Message.SelectedNextDateRange()),
                    ],
                    [
                      h.span([h.Class("sr-only")], ["Next day"]),
                      h.span([h.AriaHidden(true), h.InnerHTML("&#8827;")]),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
        Week: ({ startDate }) => [
          h.div(
            [h.Class("flex flex-col gap-2")],
            [
              h.div(
                [h.Class("grid grid-cols-7 gap-2")],
                [
                  ...ActiveDate.DAYS_OF_WEEK.map((dayOfWeek, index) =>
                    h.keyed("div")(
                      dayOfWeek,
                      [h.Class("text-md tracking-wide")],
                      [`${dayOfWeek.slice(0, 3)} ${Calendar.addDays(startDate, index).day}`],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ],
        Month: () => [],
      }),
    ),
  ),
  footerStart: h.div(
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
              h.OnClick(Message.SelectedCurrentDateRange()),
            ],
            ["Go to today →"],
          ),
    ],
  ),
});

export const calendarViewSection = (
  activeDateRange: Model["activeDateRange"],
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
        MainMenu.actions.map((action, index, arr) => {
          const isActive = activeDateRange._tag === action;
          return h.keyed("button")(
            action,
            [
              h.Type("button"),
              h.AriaPressed(isActive ? "true" : "false"),
              ...(isActive ? [h.Disabled(true)] : []),
              h.Class(
                selectorButtonClass({
                  isFirst: index === 0,
                  isLast: index === arr.length - 1,
                  isActive,
                }),
              ),
              ...(!isActive ? [h.OnClick(Message.SelectedMainMenuAction({ action }))] : []),
            ],
            [action],
          );
        }),
      ),
    ],
  );
