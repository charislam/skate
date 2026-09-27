import { cn } from "cn";

export const wrapperClass =
  "fixed inset-0 bg-transparent p-4 open:flex items-center justify-center";
export const backdropClass = "fixed inset-0 bg-black/50";
export const panelClass = cn(
  "relative",
  "w-full max-w-9/10 md:max-w-lg",
  "rounded-lg border border-slate-200 shadow-xl dark:border-slate-700",
  "p-6",
  "bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100",
);

export * as Dialog from "./dialog";
