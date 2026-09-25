import { Option, Schema, pipe } from "effect";
import { Route } from "foldkit";
import { defineRouteUnion, literal } from "foldkit/route";

export const AppRoute = defineRouteUnion({
  Home: {},
  Login: {},
  Admin: {},
  NotFound: { path: Schema.String },
});

const loggedOutRouteTags = ["Home", "Login", "NotFound"] as const;
const loggedInRouteTags = ["Home", "Admin", "NotFound"] as const;

export const LoggedOutRoute = AppRoute.subset(loggedOutRouteTags);
export const LoggedInRoute = AppRoute.subset(loggedInRouteTags);
export type LoggedOutRoute = typeof LoggedOutRoute.Type;
export type LoggedInRoute = typeof LoggedInRoute.Type;

export type AppRoute = typeof AppRoute.Type;
export type AppRouteTag = AppRoute["_tag"];

export const RedirectDestination = Schema.Literals(["Home", "Login"]);
export type RedirectDestination = typeof RedirectDestination.Type;

export interface RouteAccess<Route> {
  readonly route: Route;
  readonly maybeRedirect: Option.Option<RedirectDestination>;
}

export const guardLoggedOutRoute = (route: AppRoute): RouteAccess<LoggedOutRoute> =>
  Schema.is(LoggedOutRoute)(route)
    ? { route, maybeRedirect: Option.none() }
    : { route: AppRoute.Login(), maybeRedirect: Option.some("Login") };

export const guardLoggedInRoute = (route: AppRoute): RouteAccess<LoggedInRoute> =>
  Schema.is(LoggedInRoute)(route)
    ? { route, maybeRedirect: Option.none() }
    : { route: AppRoute.Home(), maybeRedirect: Option.some("Home") };

export const homeRouter = pipe(Route.root, Route.mapTo(AppRoute.Home));
export const loginRouter = pipe(literal("login"), Route.mapTo(AppRoute.Login));
export const adminRouter = pipe(literal("admin"), Route.mapTo(AppRoute.Admin));

export const navigationHref: Record<Exclude<AppRouteTag, "NotFound">, string> = {
  Home: homeRouter(),
  Login: loginRouter(),
  Admin: adminRouter(),
};

export const urlToAppRoute = Route.parseUrlWithFallback(
  Route.oneOf(loginRouter, adminRouter, homeRouter),
  AppRoute.NotFound,
);
