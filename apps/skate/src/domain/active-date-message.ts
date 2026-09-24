import { Calendar } from "foldkit";
import { defineMessageUnion } from "foldkit/message";

export const MessageSchema = {
  SelectedNextDateRange: {},
  SelectedPreviousDateRange: {},
  SelectedCurrentDateRange: {},

  SelectedDayView: {},
  SelectedWeekView: {},
  SelectedMonthView: {},

  SyncedInitialDate: {
    date: Calendar.CalendarDate,
  },
} as const;

export const Message = defineMessageUnion(MessageSchema);

export * as ActiveDateMessage from "./active-date-message";
