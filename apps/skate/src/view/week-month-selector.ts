import { Option } from "effect";
import { Calendar } from "foldkit";
import type { HtmlBuilder } from "foldkit/html";
import { ActiveDate } from "~/domain";
import { Message } from "~/message";
import { Heading } from "./heading";

export const selector = (
  { granularity, startDate }: { granularity: "Week" | "Month"; startDate: Calendar.CalendarDate },
  h: HtmlBuilder<Message>,
) => {
  const formattedMonth = Option.match(ActiveDate.formatMonth({ format: "long" }, startDate), {
    onSome: (month) => month,
    onNone: () => "",
  });
  const rangeName = granularity === "Week" ? "week" : "month";

  return h.div(
    [h.Class("flex gap-2 items-center")],
    [
      h.button(
        [
          h.Class(
            "text-slate-400 hover:bg-slate-100 cursor-pointer dark:text-slate-500 dark:hover:bg-slate-800",
          ),
          h.AriaLabel(`Previous ${rangeName}`),
          h.OnClick(Message.SelectedPreviousDateRange()),
        ],
        [h.span([h.AriaHidden(true), h.InnerHTML("&#8826;")])],
      ),
      h.h2(
        [h.Class(Heading.capsHeadingStyle)],
        [
          granularity === "Week"
            ? `${formattedMonth} ${startDate.day}-${Calendar.addDays(startDate, 6).day}`
            : `${formattedMonth} ${startDate.year}`,
        ],
      ),
      h.button(
        [
          h.Class(
            "text-slate-400 hover:bg-slate-100 cursor-pointer dark:text-slate-500 dark:hover:bg-slate-800",
          ),
          h.AriaLabel(`Next ${rangeName}`),
          h.OnClick(Message.SelectedNextDateRange()),
        ],
        [h.span([h.AriaHidden(true), h.InnerHTML("&#8827")])],
      ),
    ],
  );
};

export * as WeekMonthSelector from "./week-month-selector";
