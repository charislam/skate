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
export type MessageTag = (typeof Message.Type)["_tag"];

export const MessageTags = Object.keys(MessageSchema).filter(
  (tag): tag is MessageTag => tag in MessageSchema,
);

export const isMessage = (message: { readonly _tag: string }): message is typeof Message.Type =>
  MessageTags.some((tag) => tag === message._tag);

export * as ActiveDateMessage from "./active-date-message";
