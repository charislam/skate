import { cn } from "cn";

const baseClass =
  "px-3 py-1.5 text-xs font-medium border-t border-b border-r border-slate-200 dark:border-slate-700";
const activeClass = "bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-white";
const inactiveClass =
  "text-slate-600 hover:bg-slate-100 cursor-pointer dark:text-slate-300 dark:hover:bg-slate-800";

export const selectorButtonClass = (options: {
  readonly isFirst: boolean;
  readonly isLast: boolean;
  readonly isActive: boolean;
}) =>
  cn(
    baseClass,
    options.isFirst && "rounded-l-lg border-l",
    options.isLast && "rounded-r-lg border-r",
    options.isActive ? activeClass : inactiveClass,
  );
