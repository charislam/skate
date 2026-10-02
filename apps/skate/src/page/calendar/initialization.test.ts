import { Effect, Layer, Option } from "effect";
import { Calendar } from "foldkit";
import { fromString } from "foldkit/url";
import { describe, expect, test } from "vitest";
import { ActiveDate } from "~/domain";
import { Auth } from "~/domain/auth";
import { Flags, flags, init } from "~/main";
import { SaveUserCalendarView } from "./command";
import { boot } from "./model";
import { Message } from "./message";
import { CalendarView, userCalendarViewKey } from "./view-preference";

const today = Calendar.make(2024, 5, 17);

const start = (input: { view: Option.Option<CalendarView>; wide: boolean }) =>
  boot({
    today,
    pageVisible: true,
    maybeUserTabletView: input.view,
    tabletOrAbove: input.wide,
  });

describe("calendar initialization and browser persistence", () => {
  test.each([true, false])("boot resolves every preference at width %s", (wide) => {
    [Option.none<CalendarView>(), ...CalendarView.literals.map(Option.some)].forEach((view) => {
      const result = start({ view, wide });
      const expected = wide ? Option.getOrElse(view, () => "Day") : "Day";
      expect(result.model.activeDateRange._tag).toBe(expected);
      expect(result.model.maybeUserTabletView).toEqual(view);
      expect(result.commands).toBeUndefined();
    });
  });

  test("root transports preference without loading calendar data", () => {
    const flags: Flags = {
      today,
      pageVisible: true,
      tabletOrAbove: true,
      maybeUserTabletView: Option.some("Month"),
      maybeUserTheme: Option.none(),
      systemTheme: "light",
      maybeSession: Option.none(),
    };
    const result = init(flags, Option.getOrThrow(fromString("https://skate.to/")));
    expect(result.model.calendar.activeDateRange).toEqual(
      ActiveDate.Model.Month({ startDate: Calendar.firstOfMonth(today) }),
    );
    expect(result.commands?.map((command) => command.name)).not.toContain("PrepareCalendarDates");
    expect(result.commands?.map((command) => command.name)).not.toContain("SyncInitialDate");
  });

  test("rapid browser command execution persists the latest choice", async () => {
    localStorage.clear();
    await Effect.runPromise(
      Effect.all(
        CalendarView.literals.map((view) => SaveUserCalendarView({ view }).effect),
        { concurrency: "unbounded" },
      ),
    );
    expect(localStorage.getItem(userCalendarViewKey)).toBe("Month");
    localStorage.clear();
  });

  test("browser write failure returns a failure message without rolling back intent", async () => {
    const { vi } = await import("vitest");
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("blocked");
      },
    });
    try {
      const result = await Effect.runPromise(SaveUserCalendarView({ view: "Week" }).effect);
      expect(result).toEqual(Message.FailedSaveUserCalendarView());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test.each(["invalid", "unavailable"])(
    "startup recovers %s storage without rewriting",
    async (value) => {
      const { vi } = await import("vitest");
      const setItem = vi.fn();
      vi.stubGlobal("localStorage", {
        getItem: (key: string) => {
          if (key === userCalendarViewKey) {
            if (value === "unavailable") {
              throw new Error("blocked");
            }
            return "Year";
          }
          return null;
        },
        setItem,
      });
      try {
        const result = await Effect.runPromise(
          flags.pipe(
            Effect.provide(Layer.mock(Auth.Service, { getSession: Effect.succeed(Option.none()) })),
          ),
        );
        expect(result.maybeUserTabletView).toEqual(Option.none());
        expect(setItem).not.toHaveBeenCalled();
        expect(
          init(result, Option.getOrThrow(fromString("https://skate.to/"))).model.calendar
            .activeDateRange._tag,
        ).toBe("Day");
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
});
