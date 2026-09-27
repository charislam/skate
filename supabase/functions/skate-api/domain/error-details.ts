const maxCauseLength = 8_000;

export const describeCause = (cause: unknown): string => {
  const seen = new Set<unknown>();
  const describe = (value: unknown): string => {
    if (value instanceof Error) {
      if (seen.has(value)) return "[cyclic error cause]";
      seen.add(value);
      const own = value.stack ?? `${value.name}: ${value.message}`;
      const nested = "cause" in value ? describe(value.cause) : "";
      return nested === "" ? own : `${own}\nCaused by: ${nested}`;
    }
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  };
  return describe(cause).slice(0, maxCauseLength);
};
