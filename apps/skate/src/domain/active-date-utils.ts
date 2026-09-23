import { Schema } from "effect";

export const Granularity = Schema.Literals(["Day", "Week", "Month"]);
export type Granularity = typeof Granularity.Type;

export const getStartOfDay = (date: Date): Date => {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

export const getStartOfWeek = (date: Date): Date => {
  const day = date.getDay();
  const daysSinceStartOfWeek = (day + 6) % 7; // Adjust so that Monday is the start of the Week
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysSinceStartOfWeek);
};

export const getStartOfMonth = (date: Date): Date => {
  return new Date(date.getFullYear(), date.getMonth(), 1);
};

export const incrementDay = (date: Date): Date => {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000);
};

export const decrementDay = (date: Date): Date => {
  return new Date(date.getTime() - 24 * 60 * 60 * 1000);
};

export const incrementWeek = (date: Date): Date => {
  return new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000);
};

export const decrementWeek = (date: Date): Date => {
  return new Date(date.getTime() - 7 * 24 * 60 * 60 * 1000);
};

export const incrementMonth = (date: Date): Date => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = Math.min(date.getDate(), new Date(year, month + 1, 0).getDate());
  return new Date(year, month, day);
};

export const decrementMonth = (date: Date): Date => {
  const year = date.getFullYear();
  const month = date.getMonth() - 1;
  const day = Math.min(date.getDate(), new Date(year, month + 1, 0).getDate());
  return new Date(year, month, day);
};

export * as ActiveDateUtils from "./active-date-utils";
