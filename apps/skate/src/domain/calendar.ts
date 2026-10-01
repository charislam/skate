import { Array, Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { Calendar } from "foldkit";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Supabase } from "./supabase";

export class CalendarError extends Schema.TaggedError<CalendarError>()("CalendarError", {
  message: Schema.String,
  cause: Schema.Defect(),
}) {}

export const SessionId = Schema.String.pipe(Schema.brand("CalendarSessionId"));
export type SessionId = typeof SessionId.Type;

export const toCalendarDate = (dateTime: DateTime.Zoned): Calendar.CalendarDate =>
  Calendar.make(
    DateTime.getPart(dateTime, "year"),
    DateTime.getPart(dateTime, "month"),
    DateTime.getPart(dateTime, "day"),
  );

const timeZone = "America/Toronto";
const isTorontoDateTime = (value: unknown): value is DateTime.Zoned =>
  DateTime.isDateTime(value) &&
  DateTime.isZoned(value) &&
  DateTime.zoneToString(value.zone) === timeZone;

export const CalendarSession = Schema.Struct({
  id: SessionId,
  start: Schema.declare(isTorontoDateTime),
  end: Schema.declare(isTorontoDateTime),
  raw_start: Schema.String,
  raw_end: Schema.String,
  audience: Schema.Literals(["general", "family", "adult", "children", "senior"]),
  is_cancelled: Schema.Boolean,
  certainty: Schema.Literals(["certain", "uncertain"]),
  rink_id: Schema.String,
  rink_name: Schema.String,
  rink_address: Schema.NullOr(Schema.String),
  rink_url: Schema.OptionFromNullOr(Schema.String),
});
export type CalendarSession = typeof CalendarSession.Type;

export interface Interface {
  readonly listDay: (
    date: Calendar.CalendarDate,
  ) => Effect.Effect<ReadonlyArray<CalendarSession>, CalendarError>;
  readonly findById: (
    id: SessionId,
  ) => Effect.Effect<Option.Option<CalendarSession>, CalendarError>;
}
export class Service extends Context.Service<Service, Interface>()("skate/Calendar") {}

const selection =
  "id,start,end,audience,is_cancelled,certainty,rink_id,rink_name,rink_address,rink_url";
const pageSize = 1000;
const CalendarSessionRow = Schema.Struct({
  id: Schema.String,
  start: Schema.String,
  end: Schema.String,
  audience: CalendarSession.fields.audience,
  is_cancelled: Schema.Boolean,
  certainty: CalendarSession.fields.certainty,
  rink_id: Schema.String,
  rink_name: Schema.String,
  rink_address: Schema.NullOr(Schema.String),
  rink_url: CalendarSession.fields.rink_url,
});

const parseTorontoDateTime = (raw: string) => {
  const [date = "", time = ""] = raw.split(/[ T]/);
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const [hour = 0, minute = 0, seconds = "0"] = time.split(":");
  const [second = 0, fraction = ""] = seconds.split(".");
  return DateTime.makeZonedUnsafe(
    {
      year,
      month,
      day,
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
      millisecond: Number(`0.${fraction}`) * 1000,
    },
    { timeZone, adjustForTimeZone: true },
  );
};

const toCalendarSession = (row: typeof CalendarSessionRow.Type): CalendarSession => ({
  ...row,
  id: SessionId.make(row.id),
  start: parseTorontoDateTime(row.start),
  end: parseTorontoDateTime(row.end),
  raw_start: row.start,
  raw_end: row.end,
});

const dateKey = (date: Calendar.CalendarDate) =>
  `${date.year.toString().padStart(4, "0")}-${date.month.toString().padStart(2, "0")}-${date.day.toString().padStart(2, "0")}`;

const makeInterface = (client: SupabaseClient): Interface => {
  const listDay = Effect.fn("Calendar.listDay")(function* (date: Calendar.CalendarDate) {
    const dayStart = `${dateKey(date)} 00:00:00`;
    const nextStart = `${dateKey(Calendar.addDays(date, 1))} 00:00:00`;
    const collect = (
      offset: number,
      accumulated: ReadonlyArray<CalendarSession>,
    ): Effect.Effect<ReadonlyArray<CalendarSession>, CalendarError> =>
      Effect.gen(function* () {
        const { data, error } = yield* Effect.tryPromise({
          try: (signal) =>
            client
              .from("calendar_session")
              .select(selection)
              .lt("start", nextStart)
              .gt("end", dayStart)
              .order("start", { ascending: true })
              .order("id", { ascending: true })
              .range(offset, offset + pageSize - 1)
              .abortSignal(signal),
          catch: (cause) => new CalendarError({ message: "Could not load sessions.", cause }),
        });
        if (error)
          return yield* Effect.fail(
            new CalendarError({ message: "Could not load sessions.", cause: error }),
          );
        const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(CalendarSessionRow))(
          data,
        ).pipe(
          Effect.mapError(
            (cause) => new CalendarError({ message: "The session response was invalid.", cause }),
          ),
        );
        const rows = Array.appendAll(accumulated, decoded.map(toCalendarSession));
        return decoded.length < pageSize ? rows : yield* collect(offset + pageSize, rows);
      });
    return yield* collect(0, []);
  });
  const findById = Effect.fn("Calendar.findById")(function* (id: SessionId) {
    const { data, error } = yield* Effect.tryPromise({
      try: (signal) =>
        client
          .from("calendar_session")
          .select(selection)
          .eq("id", id)
          .abortSignal(signal)
          .maybeSingle(),
      catch: (cause) => new CalendarError({ message: "Could not load session details.", cause }),
    });
    if (error)
      return yield* Effect.fail(
        new CalendarError({ message: "Could not load session details.", cause: error }),
      );
    if (data === null) return Option.none();
    const row = yield* Schema.decodeUnknownEffect(CalendarSessionRow)(data).pipe(
      Effect.mapError(
        (cause) => new CalendarError({ message: "The session response was invalid.", cause }),
      ),
    );
    return Option.some(toCalendarSession(row));
  });
  return { listDay, findById };
};

export const layerConfig = Layer.effect(Service, Effect.map(Supabase.Service, makeInterface));

export * as Calendar from "./calendar";
