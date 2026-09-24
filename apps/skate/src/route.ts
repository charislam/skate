import { Schema, pipe } from "effect";
import { Route } from "foldkit";
import { defineRouteUnion } from "foldkit/route";

export const AppRoute = defineRouteUnion({
  Home: {},
  NotFound: { path: Schema.String },
});

export type AppRoute = typeof AppRoute.Type;

const homeRouter = pipe(Route.root, Route.mapTo(AppRoute.Home));

export const urlToAppRoute = Route.parseUrlWithFallback(homeRouter, AppRoute.NotFound);
