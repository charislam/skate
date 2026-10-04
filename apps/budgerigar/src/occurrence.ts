let nextId = 0;
/** Shared by fixed demo components; allocated once per setup occurrence. */
export const occurrenceId = (prefix: string): string => `${prefix}-${++nextId}`;
