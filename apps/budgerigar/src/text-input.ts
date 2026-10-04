import { Effect, Match, Option } from "effect";
import { component } from "./framework";
import { occurrenceId } from "./occurrence";

export const TextInput = component({
  setup: ({ he, signal, derive, bindValue, events, subscribe }) =>
    Effect.gen(function* () {
      const id = occurrenceId("text-input");
      const text = yield* signal({ initial: "" });
      const disabled = yield* signal({ initial: false });
      const hint = yield* derive({
        sources: { text },
        compute: ({ text }) =>
          Match.value(text.length > 0).pipe(
            Match.when(true, () => Option.some("Reset to clear your text")),
            Match.when(false, () => Option.none<string>()),
            Match.exhaustive,
          ),
      });
      const toggleLabel = yield* derive({
        sources: { disabled },
        compute: ({ disabled }) =>
          Match.value(disabled).pipe(
            Match.when(true, () => "Enable input"),
            Match.when(false, () => "Disable input"),
            Match.exhaustive,
          ),
      });
      const input = yield* he("input", {
        attrs: { id: Option.some(id), title: hint },
        props: { type: "text", disabled },
      });
      yield* bindValue({ element: input, signal: text });
      const reset = yield* he("button", { props: { type: "button" }, children: ["Clear text"] });
      const toggle = yield* he("button", { props: { type: "button" }, children: [toggleLabel] });
      yield* subscribe(yield* events(reset, "click"), () => text.set(""));
      yield* subscribe(yield* events(toggle, "click"), () => disabled.update((value) => !value));
      return yield* he("section", {
        attrs: {
          class: Option.some("text-input"),
          "aria-label": Option.some("Reactive text input"),
        },
        children: [
          yield* he("label", { attrs: { for: Option.some(id) }, children: ["Your text"] }),
          input,
          yield* he("p", { children: ["Live text: ", yield* he("output", { children: [text] })] }),
          reset,
          toggle,
        ],
      });
    }),
});
