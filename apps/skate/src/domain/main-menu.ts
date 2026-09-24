import { Popover } from "@foldkit/ui";

export type Action = "Day" | "Week" | "Month";
export const actions: ReadonlyArray<Action> = ["Day", "Week", "Month"];

export { Popover };

export * as MainMenu from "./main-menu";
