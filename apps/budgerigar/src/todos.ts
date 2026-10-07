import { Effect, Match, Option } from "effect";
import { component, keyed, row } from "./framework";
import * as Sync from "./sync-public";

interface Todo {
  readonly id: string;
  readonly text: string;
  readonly completed: boolean;
}

const Empty = component(() =>
  Sync.succeed({
    setup: ({ he }) => he("p", { children: ["No todos yet. Add one above."] }),
  }),
);

export const Todos = component((context) =>
  Sync.gen(function* () {
    let nextId = 0;
    const items = yield* context.signal<ReadonlyArray<Todo>>({ initial: [] });
    const newText = yield* context.signal({ initial: "" });
    const empty = yield* context.derive({
      sources: { items },
      compute: ({ items }) =>
        Match.value(items.length === 0).pipe(
          Match.when(true, () => Option.some(Empty)),
          Match.when(false, () => Option.none()),
          Match.exhaustive,
        ),
    });
    const TodoRow = row<Todo>()(({ context, inputs }) =>
      Sync.gen(function* () {
        const initial = yield* context.read(inputs.item);
        const draft = yield* context.signal({ initial: initial.text });
        const position = yield* context.derive({
          sources: { index: inputs.index },
          compute: ({ index }) => `${index + 1}. `,
        });
        const saved = yield* context.derive({
          sources: { item: inputs.item },
          compute: ({ item }) => item.text,
        });
        const complete = yield* context.derive({
          sources: { item: inputs.item },
          compute: ({ item }) => item.completed,
        });
        const upDisabled = yield* context.derive({
          sources: { index: inputs.index },
          compute: ({ index }) => index === 0,
        });
        const downDisabled = yield* context.derive({
          sources: { index: inputs.index, items },
          compute: ({ index, items }) => index === items.length - 1,
        });
        const move = (offset: number) =>
          items.update((previous) => {
            const index = previous.findIndex((item) => item.id === inputs.key);
            const destination = index + offset;
            return Match.value(
              index >= 0 && destination >= 0 && destination < previous.length,
            ).pipe(
              Match.when(true, () => {
                const next = [...previous];
                next.splice(destination, 0, ...next.splice(index, 1));
                return next;
              }),
              Match.when(false, () => previous),
              Match.exhaustive,
            );
          });
        return {
          setup: (ctx) =>
            Effect.gen(function* () {
              const input = yield* ctx.he("input", {
                attrs: { "aria-label": Option.some("Todo draft") },
                props: { type: "text" },
              });
              yield* ctx.bindValue({ element: input, signal: draft });
              const save = yield* ctx.he("button", {
                props: { type: "button" },
                children: ["Save"],
              });
              const toggle = yield* ctx.he("input", {
                attrs: { "aria-label": Option.some("Completed") },
                props: { type: "checkbox", checked: complete },
              });
              const remove = yield* ctx.he("button", {
                props: { type: "button" },
                children: ["Delete"],
              });
              const up = yield* ctx.he("button", {
                props: { type: "button", disabled: upDisabled },
                children: ["Move up"],
              });
              const down = yield* ctx.he("button", {
                props: { type: "button", disabled: downDisabled },
                children: ["Move down"],
              });
              yield* ctx.subscribe(yield* ctx.events(save, "click"), () =>
                draft.get.pipe(
                  Effect.flatMap((text) =>
                    items.update((previous) =>
                      previous.map((item) =>
                        Match.value(item.id === inputs.key).pipe(
                          Match.when(true, () => ({ ...item, text })),
                          Match.orElse(() => item),
                        ),
                      ),
                    ),
                  ),
                ),
              );
              yield* ctx.subscribe(yield* ctx.events(toggle, "change"), () =>
                items.update((previous) =>
                  previous.map((item) =>
                    Match.value(item.id === inputs.key).pipe(
                      Match.when(true, () => ({ ...item, completed: !item.completed })),
                      Match.orElse(() => item),
                    ),
                  ),
                ),
              );
              yield* ctx.subscribe(yield* ctx.events(remove, "click"), () =>
                items.update((previous) => previous.filter((item) => item.id !== inputs.key)),
              );
              yield* ctx.subscribe(yield* ctx.events(up, "click"), () => move(-1));
              yield* ctx.subscribe(yield* ctx.events(down, "click"), () => move(1));
              return yield* ctx.he("li", {
                attrs: { "data-todo-id": Option.some(String(inputs.key)) },
                children: [
                  yield* ctx.he("div", {
                    attrs: { class: Option.some("todo-title") },
                    children: [position, yield* ctx.he("span", { children: [saved] })],
                  }),
                  yield* ctx.he("div", {
                    attrs: { class: Option.some("todo-editor") },
                    children: [input, save],
                  }),
                  yield* ctx.he("div", {
                    attrs: { class: Option.some("todo-actions") },
                    children: [
                      yield* ctx.he("label", { children: [toggle, "Completed"] }),
                      up,
                      down,
                      remove,
                    ],
                  }),
                ],
              });
            }),
        };
      }),
    );
    const list = keyed({ items, key: (item) => item.id, row: () => TodoRow });
    return {
      setup: (ctx) =>
        Effect.gen(function* () {
          const input = yield* ctx.he("input", {
            attrs: { "aria-label": Option.some("New todo") },
            props: { type: "text" },
          });
          yield* ctx.bindValue({ element: input, signal: newText });
          const add = yield* ctx.he("button", {
            props: { type: "button" },
            children: ["Add todo"],
          });
          yield* ctx.subscribe(yield* ctx.events(add, "click"), () =>
            newText.get.pipe(
              Effect.flatMap((text) =>
                Match.value(text.trim().length > 0).pipe(
                  Match.when(false, () => Effect.void),
                  Match.when(true, () =>
                    ctx.batch(
                      Effect.gen(function* () {
                        const id = `todo-${nextId++}`;
                        yield* items.update((previous) => [
                          ...previous,
                          { id, text: text.trim(), completed: false },
                        ]);
                        yield* newText.set("");
                      }),
                    ),
                  ),
                  Match.exhaustive,
                ),
              ),
            ),
          );
          return yield* ctx.he("section", {
            attrs: { class: Option.some("todos"), "aria-label": Option.some("Reorderable todos") },
            children: [
              yield* ctx.he("h2", { children: ["Todos"] }),
              input,
              add,
              empty,
              yield* ctx.he("ol", { children: [list] }),
            ],
          });
        }),
    };
  }),
);
