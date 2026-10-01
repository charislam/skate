import { Popover } from "@foldkit/ui";
import { Schema } from "effect";
import type { AppRouteTag } from "../route";

export type Action = "Day" | "Week" | "Month";
export const actions: ReadonlyArray<Action> = ["Day", "Week", "Month"];
export const ActionFields = { action: Schema.Literals(actions) };

export type NavigationRoute = Exclude<AppRouteTag, "NotFound" | "Session">;
export type NavigationLink = {
  readonly label: string;
  readonly route: NavigationRoute;
};
export const navigationLinks = {
  loggedOut: [
    { label: "Home", route: "Home" },
    { label: "Sign in", route: "Login" },
  ],
  loggedIn: [
    { label: "Home", route: "Home" },
    { label: "Admin", route: "Admin" },
  ],
} as const satisfies Record<string, ReadonlyArray<NavigationLink>>;

export { Popover };

export * as MainMenu from "./main-menu";
