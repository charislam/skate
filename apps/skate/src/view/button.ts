import { cn } from "cn";

export const base = "cursor-pointer";
export const basePadding = "px-3 py-2";

export const primaryClass = cn(
  base,
  basePadding,
  "bg-slate-900 text-slate-100 hover:bg-slate-800",
  "dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-700",
  "tracking-wide",
);

export const secondaryClass = cn(
  base,
  "w-fit",
  "px-2 py-1",
  "bg-slate-200 hover:bg-slate-300",
  "text-sm text-slate-800",
  "dark:bg-slate-600 dark:hover:bg-slate-500 dark:text-slate-200",
);

export const dialogCancelClass = cn(secondaryClass, "dark:bg-slate-900");
export const dialogConfirmClass = cn(primaryClass, "dark:bg-slate-800 text-sm tracking-normal");

export * as Button from "./button";
