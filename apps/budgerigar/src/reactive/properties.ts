import { Effect, Match, Option } from "effect";
import { propertyDescriptor } from "./destinations";
import { calculate, requireValid, ReactiveError } from "./runtime";

const forbidden = new Set([
  "innerHTML",
  "outerHTML",
  "textContent",
  "innerText",
  "outerText",
  "srcdoc",
  "style",
]);
export const propertyValidator = Effect.fn("Budgerigar.propertyValidator")(function* (options: {
  element: HTMLElement;
  name: string;
}) {
  const { element, name } = options;
  const descriptor = propertyDescriptor(options);
  const writable = Option.exists(
    descriptor,
    (entry) => typeof entry.set === "function" || entry.writable === true,
  );
  const initial: unknown = yield* calculate(() => Reflect.get(element, name));
  yield* requireValid(
    !forbidden.has(name) &&
      !name.toLowerCase().startsWith("on") &&
      writable &&
      typeof initial !== "function",
    `unsupported property ${name}`,
  );
  const valid = (value: unknown): boolean =>
    Match.value(name).pipe(
      Match.when("valueAsDate", () => value === null || value instanceof Date),
      Match.when("files", () => value === null || value instanceof FileList),
      Match.when(
        (name) => name.endsWith("Elements") && name.startsWith("aria"),
        () =>
          value === null ||
          (Array.isArray(value) && value.every((entry) => entry instanceof Element)),
      ),
      Match.when(
        (name) =>
          ["popoverTargetElement", "commandForElement", "ariaActiveDescendantElement"].includes(
            name,
          ),
        () => value === null || value instanceof Element,
      ),
      Match.when(
        (name) =>
          name === "nodeValue" ||
          (element instanceof HTMLInputElement && name === "selectionDirection"),
        () => value === null || typeof value === "string",
      ),
      Match.when(
        (name) =>
          element instanceof HTMLInputElement && ["selectionStart", "selectionEnd"].includes(name),
        () => value === null || typeof value === "number",
      ),
      Match.when("caption", () => value === null || value instanceof HTMLTableCaptionElement),
      Match.when(
        (name) => ["tHead", "tFoot"].includes(name),
        () => value === null || value instanceof HTMLTableSectionElement,
      ),
      Match.when(
        "srcObject",
        () =>
          value === null ||
          (typeof MediaStream !== "undefined" && value instanceof MediaStream) ||
          (typeof MediaSource !== "undefined" && value instanceof MediaSource) ||
          value instanceof Blob,
      ),
      Match.when("hidden", () => typeof value === "boolean" || value === "until-found"),
      Match.when(
        (name) => name.startsWith("aria") || ["popover", "crossOrigin", "role"].includes(name),
        () => value === null || typeof value === "string",
      ),
      Match.orElse(() =>
        Match.value(initial).pipe(
          Match.when(null, () => value === null),
          Match.when(
            (value: unknown) => typeof value === "object",
            (initial) =>
              typeof value === "object" &&
              value !== null &&
              Object.getPrototypeOf(value) === Object.getPrototypeOf(initial),
          ),
          Match.orElse(() => typeof value === typeof initial),
        ),
      ),
    );
  return (value: unknown): Effect.Effect<void, ReactiveError> =>
    Effect.suspend(() => requireValid(valid(value), `Invalid native property value for ${name}`));
});
export const writeProperty = Effect.fn("Budgerigar.writeProperty")(function* (options: {
  element: HTMLElement;
  name: string;
  value: unknown;
}) {
  const current = yield* calculate(() => Reflect.get(options.element, options.name));
  yield* Match.value(Object.is(current, options.value)).pipe(
    Match.when(true, () => Effect.void),
    Match.when(false, () =>
      calculate(() => Reflect.set(options.element, options.name, options.value)).pipe(
        Effect.flatMap((assigned) =>
          requireValid(assigned, `DOM property assignment failed: ${options.name}`),
        ),
      ),
    ),
    Match.exhaustive,
  );
});
