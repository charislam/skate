import { Dialog, Popover } from "@foldkit/ui";
import { AsyncData, Calendar, Command as FoldkitCommand, Update } from "foldkit";
import { Machine } from "foldkit/experimental";
import { HashMap, Match, Option } from "effect";
import { evo } from "foldkit/struct";
import { ActiveDate, ActiveDateMessage } from "~/domain";
import { Calendar as CalendarDomain } from "~/domain/calendar";
import * as CalendarCache from "~/domain/calendar-cache";
import type { Resource } from "~/resource";
import type { AppRoute } from "~/route";
import {
  CopySessionLink,
  FetchCalendarDay,
  FetchCalendarDetail,
  PrepareCalendarDates,
  PrepareSessionDetail,
} from "./command";
import { Message as CalendarMessage, OutMessage as CalendarOutMessage } from "./message";
import type { Model } from "./model";

export type DateRangeMessage = Extract<
  CalendarMessage,
  { readonly _tag: ActiveDateMessage.MessageTag }
>;

export interface Context {
  readonly route: AppRoute;
  readonly tabletOrAbove: boolean;
}

export interface Input {
  readonly message: CalendarMessage;
  readonly context: Context;
}

const moveCalendarRange = (
  range: ActiveDate.Model,
  date: Calendar.CalendarDate,
  tabletOrAbove: boolean,
): ActiveDate.Model => {
  if (!tabletOrAbove) return ActiveDate.Model.Day({ date });
  return Match.value(range).pipe(
    Match.tagsExhaustive({
      Initial: () => ActiveDate.Model.Day({ date }),
      Day: () => ActiveDate.Model.Day({ date }),
      Week: () => ActiveDate.Model.Week({ startDate: Calendar.startOfWeek(date, "Monday") }),
      Month: () => ActiveDate.Model.Month({ startDate: Calendar.firstOfMonth(date) }),
    }),
  );
};

const sessionDialogOutMessage = Dialog.OutMessage.match<
  Update.Step<Model, CalendarMessage, Resource>
>({
  Opened: () => (model) => ({ model }),
  Closed: () => (model) => ({
    model: evo(model, {
      maybeDayDialogDate: () => Option.none(),
    }),
  }),
});

const sessionDialogFold = {
  read: (model: Model) => Option.some(model.sessionDialog),
  write: (model: Model, sessionDialog: Dialog.Model) =>
    evo(model, { sessionDialog: () => sessionDialog }),
  toParentMessage: (message: Dialog.Message) =>
    CalendarMessage.GotSessionDialogMessage({ message }),
  foldOutMessage: sessionDialogOutMessage,
};

const foldSessionDialog = Update.foldChild({ ...sessionDialogFold, update: Dialog.update });
const openSessionDialog = Update.foldChildStep({ ...sessionDialogFold, update: Dialog.open });

export const openSessionEntry = (model: Model, id: CalendarDomain.SessionId) =>
  Update.combine(model, [
    openSessionDialog,
    (current) => ({ model: current, commands: [PrepareSessionDetail({ id })] }),
  ]);

const dayDialogOutMessage = Dialog.OutMessage.match<Update.Step<Model, CalendarMessage, Resource>>({
  Opened: () => (model) => ({ model }),
  Closed: () => (model) => ({
    model: evo(model, { maybeDayDialogDate: () => Option.none() }),
  }),
});

const dayDialogFold = {
  read: (model: Model) => Option.some(model.dayDialog),
  write: (model: Model, dayDialog: Dialog.Model) => evo(model, { dayDialog: () => dayDialog }),
  toParentMessage: (message: Dialog.Message) => CalendarMessage.GotDayDialogMessage({ message }),
  foldOutMessage: dayDialogOutMessage,
};

const foldDayDialog = Update.foldChild({ ...dayDialogFold, update: Dialog.update });
const openDayDialog = Update.foldChildStep({ ...dayDialogFold, update: Dialog.open });

const popoverOutMessage = Popover.OutMessage.match<Update.Step<Model, CalendarMessage, Resource>>({
  Opened: () => (model) => ({ model }),
  Closed: () => (model) => ({ model }),
});

const sessionMenuFold = (menuId: string) => ({
  read: (model: Model): Option.Option<Popover.Model> =>
    Option.some(
      Option.getOrElse(HashMap.get(model.sessionMenus, menuId), () =>
        Popover.init({ id: menuId, contentFocus: true }),
      ),
    ),
  write: (model: Model, menu: Popover.Model) =>
    evo(model, {
      sessionMenus: () =>
        menu.isOpen || Option.isSome(menu.maybeLastButtonPointerType)
          ? HashMap.set(model.sessionMenus, menuId, menu)
          : HashMap.remove(model.sessionMenus, menuId),
    }),
  toParentMessage: (message: Popover.Message) =>
    CalendarMessage.GotSessionMenuMessage({ menuId, message }),
  foldOutMessage: popoverOutMessage,
});

const foldSessionMenu = (menuId: string) =>
  Update.foldChild({ ...sessionMenuFold(menuId), update: Popover.update });
const closeSessionMenu = (menuId: string) =>
  Update.foldChildStep({ ...sessionMenuFold(menuId), update: Popover.close });

const foldActiveDate: Update.Fold<Model, CalendarMessage, DateRangeMessage> = Machine.fold({
  machine: ActiveDate.machine,
  context: (model: Model) => ({ today: model.today }),
  read: (model: Model) => Option.some(model.activeDateRange),
  write: (model: Model, activeDateRange: ActiveDate.Model) =>
    evo(model, { activeDateRange: () => activeDateRange }),
});

const updateDateRange = (model: Model, message: DateRangeMessage) => {
  return Update.combine(model, [
    foldActiveDate(message),
    (currentModel) => ({
      model: currentModel,
      commands: [
        PrepareCalendarDates({
          dates: CalendarCache.displayedDates(currentModel.activeDateRange),
          force: false,
          origin: "automatic",
        }),
      ],
    }),
  ]);
};

const update = (
  model: Model,
  { message, context }: Input,
): Update.ReturnWithOutMessage<Model, CalendarMessage, CalendarOutMessage, Resource> =>
  Match.value(message).pipe(
    Match.withReturnType<
      Update.ReturnWithOutMessage<Model, CalendarMessage, CalendarOutMessage, Resource>
    >(),
    Match.when(ActiveDateMessage.isMessage, (value) => updateDateRange(model, value)),
    Match.tag("SelectedMainMenuAction", ({ action }) =>
      Update.withOutMessage(
        updateDateRange(
          model,
          Match.value(action).pipe(
            Match.when("Day", () => CalendarMessage.SelectedDayView()),
            Match.when("Week", () =>
              context.tabletOrAbove
                ? CalendarMessage.SelectedWeekView()
                : CalendarMessage.SelectedDayView(),
            ),
            Match.when("Month", () =>
              context.tabletOrAbove
                ? CalendarMessage.SelectedMonthView()
                : CalendarMessage.SelectedDayView(),
            ),
            Match.exhaustive,
          ),
        ),
        CalendarOutMessage.SelectedMainMenuAction(),
      ),
    ),
    Match.tag("GotSessionDialogMessage", ({ message }) => foldSessionDialog(model, message)),
    Match.tag("GotSessionMenuMessage", ({ menuId, message }) =>
      foldSessionMenu(menuId)(model, message),
    ),
    Match.tag("ClickedSessionDetails", ({ menuId, id }) =>
      Update.withOutMessage(
        Update.combine(model, [closeSessionMenu(menuId)]),
        CalendarOutMessage.NavigateToSessionDetails({ id }),
      ),
    ),
    Match.tag("ClickedCloseSessionDetails", () =>
      Update.withOutMessage(
        {
          model: evo(model, {
            maybeDayDialogDate: () => Option.none(),
          }),
        },
        CalendarOutMessage.RedirectToHome(),
      ),
    ),
    Match.tag("ClickedBackToDayDialog", () =>
      Update.withOutMessage({ model }, CalendarOutMessage.RedirectToHome()),
    ),
    Match.tag("ClickedOpenDayDialog", ({ date }) =>
      Update.combine(model, [
        (current) => ({
          model: evo(current, { maybeDayDialogDate: () => Option.some(date) }),
          commands: [PrepareCalendarDates({ dates: [date], force: false, origin: "automatic" })],
        }),
        openDayDialog,
      ]),
    ),
    Match.tag("GotDayDialogMessage", ({ message }) => foldDayDialog(model, message)),
    Match.tag("PreparedCalendarDates", (input) => {
      const prepared = CalendarCache.cacheVisible(model.calendarCache, {
        dates: input.dates,
        now: input.now,
        force: input.force,
        pinnedDates: [
          ...CalendarCache.displayedDates(model.activeDateRange),
          ...Option.toArray(model.maybeDayDialogDate),
        ],
        origin: input.origin,
      });
      return {
        model: evo(model, { calendarCache: () => prepared.model }),
        commands: prepared.requests.map((request) => FetchCalendarDay(request)),
      };
    }),
    Match.tag("CalendarFreshnessTick", ({ today }) => {
      const withToday = evo(model, { today: () => today });
      const current = ActiveDate.isDateRangeCurrent(model.activeDateRange, model.today)
        ? updateDateRange(withToday, CalendarMessage.SelectedCurrentDateRange()).model
        : withToday;
      return {
        model: current,
        commands: [
          PrepareCalendarDates({
            dates: CalendarCache.displayedDates(current.activeDateRange),
            force: false,
            origin: "automatic",
          }),
          ...(context.route._tag === "Session"
            ? [PrepareSessionDetail({ id: context.route.id })]
            : []),
        ],
      };
    }),
    Match.tag("ChangedPageVisibility", ({ isVisible }) => {
      const nextModel = evo(model, { pageVisible: () => isVisible });
      if (!isVisible || (context.route._tag !== "Home" && context.route._tag !== "Session")) {
        return { model: nextModel };
      }
      const sessionId = context.route._tag === "Session" ? context.route.id : undefined;
      const commands: FoldkitCommand.Command<typeof CalendarMessage.Type, never, Resource>[] = [
        PrepareCalendarDates({
          dates: CalendarCache.displayedDates(nextModel.activeDateRange),
          force: false,
          origin: "automatic",
        }),
      ];
      if (sessionId !== undefined) commands.push(PrepareSessionDetail({ id: sessionId }));
      return { model: nextModel, commands };
    }),
    Match.tag("MediaWidthChanged", ({ tabletOrAbove }) => {
      if (tabletOrAbove) return { model };
      if (context.route._tag === "Session") {
        const detail = CalendarCache.detailEntry(model.calendarCache, context.route.id);
        const session = Option.flatMap(detail, (entry) =>
          Option.flatten(AsyncData.getData(entry.value)),
        );
        return Option.match(session, {
          onNone: () => updateDateRange(model, CalendarMessage.SelectedDayView()),
          onSome: (value) => ({
            model: evo(model, {
              activeDateRange: () =>
                ActiveDate.Model.Day({ date: CalendarDomain.toCalendarDate(value.start) }),
            }),
          }),
        });
      }
      return updateDateRange(model, CalendarMessage.SelectedDayView());
    }),
    Match.orElse((remainder) =>
      Match.value(remainder).pipe(
        Match.withReturnType<
          Update.ReturnWithOutMessage<Model, CalendarMessage, CalendarOutMessage, Resource>
        >(),
        Match.tag("PreparedSessionDetail", ({ id, now }) => {
          if (context.route._tag !== "Session" || context.route.id !== id) return { model };
          const requested = CalendarCache.requestDetail(model.calendarCache, { id, now });
          return {
            model: evo(model, { calendarCache: () => requested.model }),
            commands: Option.match(requested.request, {
              onNone: () => [],
              onSome: (request) => [FetchCalendarDetail(request)],
            }),
          };
        }),
        Match.tag("ClickedRetrySessionDetails", ({ id }) => {
          const requested = CalendarCache.requestDetail(model.calendarCache, { id, force: true });
          return {
            model: evo(model, { calendarCache: () => requested.model }),
            commands: Option.match(requested.request, {
              onNone: () => [],
              onSome: (request) => [FetchCalendarDetail(request)],
            }),
          };
        }),
        Match.tag("SettledCalendarDay", (input) => {
          const pending = CalendarCache.dayEntry(model.calendarCache, input.date);
          if (Option.isNone(pending) || pending.value.requestId !== input.requestId)
            return { model };
          const refreshingDates = model.refreshingDates.filter(
            (date) => !Calendar.isEqual(date, input.date),
          );
          const dates =
            refreshingDates.length > 0
              ? refreshingDates
              : CalendarCache.displayedDates(model.activeDateRange);
          return {
            model: evo(model, {
              calendarCache: () => CalendarCache.settleDay(model.calendarCache, input),
              refreshingDates: () => refreshingDates,
            }),
            commands: [
              PrepareCalendarDates({
                dates,
                force: refreshingDates.length > 0,
                origin: refreshingDates.length > 0 ? "manual" : "automatic",
              }),
            ],
          };
        }),
        Match.tag("SettledCalendarDetail", (input) => {
          const pending = CalendarCache.detailEntry(model.calendarCache, input.id);
          if (Option.isNone(pending) || pending.value.requestId !== input.requestId)
            return { model };

          const previous = Option.flatMap(pending, (entry) =>
            Option.flatten(AsyncData.getData(entry.value)),
          );
          const cache = CalendarCache.settleDetail(model.calendarCache, input);

          const maybeSession =
            input.result._tag === "Success" ? input.result.success : Option.none();
          const invalidated =
            input.result._tag === "Success"
              ? CalendarCache.invalidateDaysForSessions(cache, [
                  ...Option.toArray(previous),
                  ...Option.toArray(maybeSession),
                ])
              : cache;

          const startDate = Option.map(maybeSession, (session) =>
            CalendarDomain.toCalendarDate(session.start),
          );
          const activeDateRange =
            context.route._tag === "Session" &&
            context.route.id === input.id &&
            Option.isSome(startDate)
              ? moveCalendarRange(model.activeDateRange, startDate.value, context.tabletOrAbove)
              : model.activeDateRange;
          return {
            model: evo(model, {
              calendarCache: () => invalidated,
              activeDateRange: () => activeDateRange,
            }),
            ...(context.route._tag === "Session" &&
            context.route.id === input.id &&
            input.result._tag === "Success"
              ? {
                  commands: [
                    PrepareCalendarDates({
                      dates: CalendarCache.displayedDates(activeDateRange),
                      force: false,
                      origin: "automatic",
                    }),
                  ],
                }
              : {}),
          };
        }),
        Match.tag("RetryCalendarDate", ({ date }) => ({
          model,
          commands: [PrepareCalendarDates({ dates: [date], force: true, origin: "retry" })],
        })),
        Match.tag("ClickedRefreshCalendarDate", ({ date }) => ({
          model,
          commands: [PrepareCalendarDates({ dates: [date], force: true, origin: "manual" })],
        })),
        Match.tag("ClickedCopySessionLink", ({ id }) => ({
          model,
          commands: [CopySessionLink({ id })],
        })),
        Match.tag("ClickedCalendarRefresh", () => {
          const dates = CalendarCache.displayedDates(model.activeDateRange);
          return {
            model: evo(model, { refreshingDates: () => dates }),
            commands: [PrepareCalendarDates({ dates, force: true, origin: "manual" })],
          };
        }),
        Match.tag("CompletedCopySessionLink", ({ success }) =>
          Update.withOutMessage({ model }, CalendarOutMessage.CopiedSessionLink({ success })),
        ),
        Match.exhaustive,
      ),
    ),
  );

export { update };
