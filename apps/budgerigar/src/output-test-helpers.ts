import { Effect, Option } from "effect";
import { importNative } from "./construction";
import type { ElementOutput } from "./output";

/** Checked import for static test fixtures without an application owner. */
export const importTestNode = importNative({
  active: true,
  ownsTarget: () => false,
  reactiveRuntime: Option.none(),
});
export const testText = (value: string) =>
  Effect.runSync(importTestNode(document.createTextNode(value)));

/** Deliberately bypass static validation to exercise untyped caller rejection. */
export const untypedOutput = (value: unknown): ElementOutput<Node> => value as ElementOutput<Node>;
