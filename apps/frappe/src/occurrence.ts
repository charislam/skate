let nextId = 0;
/** Public ID allocator for component and UI-library occurrences. Call once during construction. */
export const occurrenceId = (prefix: string): string => `${prefix}-${++nextId}`;
