import { Schema } from "effect";
import { defineMessageUnion } from "foldkit/message";
import { ActiveDateUtils } from "./active-date-utils";

export const MessageSchema = {
  SelectedNextDateRange: {},
  SelectedPreviousDateRange: {},
  SelectedCurrentDateRange: {},
  SelectedDayView: {},
  SelectedWeekView: {},
  SelectedMonthView: {},
  ResolvedCurrentDateRange: {
    granularity: ActiveDateUtils.Granularity,
    date: Schema.Date,
  },
} as const;

export const Message = defineMessageUnion(MessageSchema);

export * as ActiveDateMessage from "./active-date-message";
