import { Effect, Schema } from "effect";
import { Calendar, Command as FoldkitCommand } from "foldkit";
import { load, pushUrl, replaceUrl } from "foldkit/navigation";
import { Auth } from "./domain/auth";
import { Message } from "~/message";
import { UserId } from "./domain/session";
import {
  type RedirectDestination,
  RedirectDestination as RedirectDestinationSchema,
  homeRouter,
  loginRouter,
} from "./route";

const authenticationRedirectRouters: Record<
  RedirectDestination,
  () => ReturnType<typeof homeRouter>
> = {
  Home: homeRouter,
  Login: loginRouter,
};

export const NavigateInternal = FoldkitCommand.define("NavigateInternal", {
  args: { url: Schema.String },
  messages: [Message.CompletedNavigateInternal],
  execute: ({ url }) =>
    pushUrl(url).pipe(
      Effect.as(Message.CompletedNavigateInternal()),
      Effect.catch(() => Effect.succeed(Message.CompletedNavigateInternal())),
    ),
});

export const LoadExternal = FoldkitCommand.define("LoadExternal", {
  args: { href: Schema.String },
  messages: [Message.CompletedLoadExternal],
  execute: ({ href }) =>
    load(href).pipe(
      Effect.as(Message.CompletedLoadExternal()),
      Effect.catch(() => Effect.succeed(Message.CompletedLoadExternal())),
    ),
});

export const SyncInitialDate = FoldkitCommand.define("SyncInitialDate", {
  args: {
    today: Calendar.CalendarDate,
  },
  messages: [Message.SyncedInitialDate],
  execute: ({ today }) => Effect.succeed(Message.SyncedInitialDate({ date: today })),
});

export const SelectDayView = FoldkitCommand.define("SelectDayView", {
  messages: [Message.SelectedDayView],
  execute: Effect.succeed(Message.SelectedDayView()),
});

export const SelectWeekView = FoldkitCommand.define("SelectWeekView", {
  messages: [Message.SelectedWeekView],
  execute: Effect.succeed(Message.SelectedWeekView()),
});

export const SelectMonthView = FoldkitCommand.define("SelectMonthView", {
  messages: [Message.SelectedMonthView],
  execute: Effect.succeed(Message.SelectedMonthView()),
});

export const RedirectForAuthentication = FoldkitCommand.define("RedirectForAuthentication", {
  args: { destination: RedirectDestinationSchema },
  messages: [Message.CompletedRedirect],
  execute: ({ destination }) =>
    replaceUrl(authenticationRedirectRouters[destination]())
      .pipe(Effect.as(Message.CompletedRedirect()))
      .pipe(Effect.catch(() => Effect.succeed(Message.CompletedRedirect()))),
});

export const SignOut = FoldkitCommand.define("SignOut", {
  messages: [Message.SucceededSignOut, Message.FailedSignOut],
  execute: Effect.gen(function* () {
    const auth = yield* Auth.Service;
    yield* auth.signOut;
    return Message.SucceededSignOut();
  }).pipe(
    Effect.catchTag("AuthError", (error) =>
      Effect.succeed(Message.FailedSignOut({ kind: error.kind })),
    ),
  ),
});

export const FetchAdminAccess = FoldkitCommand.define("FetchAdminAccess", {
  args: { userId: UserId, requestId: Schema.Number },
  messages: [Message.SettledFetchAdminAccess],
  execute: ({ userId, requestId }) =>
    Effect.gen(function* () {
      const auth = yield* Auth.Service;
      const result = yield* Effect.result(auth.hasAdminAccess());
      return Message.SettledFetchAdminAccess({ userId, requestId, result });
    }),
});

export * as Command from "./command";
