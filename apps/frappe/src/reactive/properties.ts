import { Result, Match, Option } from "effect";
import { lazy } from "~/synchronous";
import { propertyDescriptor } from "./destinations";
import { calculateSync, requireValidSync, ReactiveError } from "./runtime";

const forbidden = new Set([
  "innerHTML",
  "outerHTML",
  "textContent",
  "innerText",
  "outerText",
  "srcdoc",
  "style",
]);

export const propertyValidatorSync = (options: { element: HTMLElement; name: string }) =>
  Result.gen(function* () {
    const { element, name } = options;
    const descriptor = propertyDescriptor(options);
    const writable = Option.exists(
      descriptor,
      (entry) => typeof entry.set === "function" || entry.writable === true,
    );
    const initial: unknown = yield* calculateSync(() => Reflect.get(element, name));
    yield* requireValidSync(
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
            element instanceof HTMLInputElement &&
            ["selectionStart", "selectionEnd"].includes(name),
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
    return (value: unknown): Result.Result<void, ReactiveError> =>
      requireValidSync(valid(value), `Invalid native property value for ${name}`);
  });

export const writePropertySync = (options: {
  element: HTMLElement;
  name: string;
  value: unknown;
}) =>
  Result.gen(function* () {
    const current = yield* calculateSync(() => Reflect.get(options.element, options.name));
    yield* Match.value(Object.is(current, options.value)).pipe(
      Match.when(true, () => Result.succeed(undefined)),
      Match.when(false, () =>
        calculateSync(() => Reflect.set(options.element, options.name, options.value)).pipe(
          Result.flatMap((assigned) =>
            requireValidSync(assigned, `DOM property assignment failed: ${options.name}`),
          ),
        ),
      ),
      Match.exhaustive,
    );
  });

export const propertyValidator = (options: Parameters<typeof propertyValidatorSync>[0]) =>
  lazy(() =>
    propertyValidatorSync(options).pipe(
      Result.map((check) => (value: unknown) => lazy(() => check(value))),
    ),
  );

export const writeProperty = (options: Parameters<typeof writePropertySync>[0]) =>
  lazy(() => writePropertySync(options));
