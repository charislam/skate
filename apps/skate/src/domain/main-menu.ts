import { Menu as FoldkitMenu } from "@foldkit/ui";

export type Action = "Day" | "Week" | "Month";
export const actions: ReadonlyArray<Action> = ["Day", "Week", "Month"];

export const Menu = FoldkitMenu.create<Action>();

export * as MainMenu from "./main-menu";
