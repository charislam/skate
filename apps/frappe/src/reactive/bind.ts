import { Match, Option, Result } from "effect";
import type { NativeProperties } from "~/construction";
import { nativeNode, type ElementOutput } from "~/output";
import {
  attributeNameValid,
  bindEntrySync,
  validateAttributeSync,
  validateElementOwnerSync,
  validateDestinationsSync,
  writeAttributeSync,
  type AttributeValue,
} from "./dom";
import { propertyValidatorSync, writePropertySync } from "./properties";
import { requireValidSync, type ReactiveRuntime, type ReactiveError } from "./runtime";
import { isSignal, readSync, type Signal } from "./signal";

export interface ElementBinding<N extends HTMLElement> {
  readonly element: ElementOutput<N, unknown>;
  readonly attrs?: Readonly<Record<string, AttributeValue | Signal<AttributeValue>>>;
  readonly props?: NativeProperties<NoInfer<N>>;
}

/** Before adoption, extend an element using the same destination rules as he(). */
export const bindElementSync = <N extends HTMLElement>(options: {
  runtime: ReactiveRuntime;
  binding: ElementBinding<N>;
}) =>
  Result.gen(function* () {
    const { runtime, binding } = options;
    const element = nativeNode(binding.element);
    yield* validateElementOwnerSync({ runtime, element });
    const entries: Array<{
      kind: "attribute" | "property";
      name: string;
      value: unknown;
      validate: (value: unknown) => Result.Result<unknown, ReactiveError>;
      write: (value: unknown) => Result.Result<void, ReactiveError>;
    }> = [];
    for (const [name, value] of Object.entries(binding.attrs ?? {})) {
      yield* requireValidSync(attributeNameValid(name), `unsupported attribute ${name}`);
      const normalized = name.toLowerCase();
      entries.push({
        kind: "attribute",
        name: normalized,
        value,
        validate: validateAttributeSync,
        write: (value) => writeAttributeSync({ element, name: normalized, value }),
      });
    }
    for (const [name, value] of Object.entries(binding.props ?? {})) {
      const validate = yield* propertyValidatorSync({ element, name });
      entries.push({
        kind: "property",
        name,
        value,
        validate,
        write: (value) => writePropertySync({ element, name, value }),
      });
    }
    for (const entry of entries) {
      const initial = yield* Match.value(entry.value).pipe(
        Match.when(isSignal, (signal) => readSync({ runtime, signal })),
        Match.orElse(Result.succeed),
      );
      yield* entry.validate(initial);
    }
    yield* validateDestinationsSync({
      element,
      entries: entries.map((entry) => ({ ...entry, reactive: isSignal(entry.value) })),
    });
    for (const entry of entries)
      yield* bindEntrySync({ runtime: Option.some(runtime), element, ...entry });
  });
