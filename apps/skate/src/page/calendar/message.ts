import { Dialog, Popover } from "@foldkit/ui";
import { Schema } from "effect";
import { Calendar } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { ActiveDateMessage, MainMenu } from "~/domain";
import { Calendar as CalendarDomain } from "~/domain/calendar";

export const Message = defineMessageUnion({
  ...ActiveDateMessage.MessageSchema,

  GotSessionDialogMessage: { message: Dialog.Message },
  GotSessionMenuMessage: { menuId: Schema.String, message: Popover.Message },
  GotDayDialogMessage: { message: Dialog.Message },

  ClickedSessionDetails: { menuId: Schema.String, id: CalendarDomain.SessionId },
  ClickedCloseSessionDetails: {},
  ClickedBackToDayDialog: {},
  ClickedOpenDayDialog: { date: Calendar.CalendarDate },

  PreparedCalendarDates: {
    dates: Schema.Array(Calendar.CalendarDate),
    now: Schema.Number,
    force: Schema.Boolean,
    origin: Schema.Literals(["automatic", "manual", "retry"]),
  },
  CalendarFreshnessTick: { today: Calendar.CalendarDate, now: Schema.Number },
  SettledCalendarDay: {
    date: Calendar.CalendarDate,
    requestId: Schema.Number,
    now: Schema.Number,
    result: Schema.Result(
      Schema.Array(CalendarDomain.CalendarSession),
      CalendarDomain.CalendarError,
    ),
  },
  RetryCalendarDate: { date: Calendar.CalendarDate },
  ClickedRefreshCalendarDate: { date: Calendar.CalendarDate },
  ClickedCalendarRefresh: {},

  PreparedSessionDetail: { id: CalendarDomain.SessionId, now: Schema.Number },
  SettledCalendarDetail: {
    id: CalendarDomain.SessionId,
    requestId: Schema.Number,
    now: Schema.Number,
    result: Schema.Result(
      Schema.Option(CalendarDomain.CalendarSession),
      CalendarDomain.CalendarError,
    ),
  },
  ClickedRetrySessionDetails: { id: CalendarDomain.SessionId },

  ClickedCopySessionLink: { id: CalendarDomain.SessionId },
  CompletedCopySessionLink: { success: Schema.Boolean },

  ChangedPageVisibility: { isVisible: Schema.Boolean },
  MediaWidthChanged: { tabletOrAbove: Schema.Boolean },

  SelectedMainMenuAction: MainMenu.ActionFields,
});

export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({
  SelectedMainMenuAction: {},
  NavigateToSessionDetails: { id: CalendarDomain.SessionId },
  RedirectToHome: {},
  CopiedSessionLink: { success: Schema.Boolean },
});

export type OutMessage = typeof OutMessage.Type;
